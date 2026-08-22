import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import worker, { isHomeworkLocked, normalizeTeacherStatus, overlayHomework } from "../src/v3.ts";

const hashToken = async (token) => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
};

const homeworkDb = async () => {
  const rows = new Map();
  const sessions = new Map([
    [await hashToken("student-token"), { user_id: "1320", role: "STUDENT", profile_json: JSON.stringify({ studentId: "1320", name: "テスト生徒" }), expires_at: "2099-01-01 00:00:00" }],
    [await hashToken("teacher-token"), { user_id: "teacher-1", role: "TEACHER", profile_json: JSON.stringify({ name: "テスト講師" }), expires_at: "2099-01-01 00:00:00" }],
  ]);
  const execute = async (statement) => {
    const { sql, values } = statement;
    if (/^CREATE TABLE/.test(sql)) return { results: [] };
    if (/SELECT student_id FROM v3_homework_snapshot/.test(sql)) return { results: [{ student_id: "1320" }] };
    if (/SELECT teacher_status FROM v3_homework_overrides/.test(sql)) {
      const row = rows.get(`${values[0]}|${values[1]}`);
      return { results: row ? [{ teacher_status: row.teacher_status ?? null }] : [] };
    }
    if (/SELECT student_status,student_completed_date,teacher_status,confirmation_memo/.test(sql)) {
      const row = rows.get(`${values[0]}|${values[1]}`);
      return { results: row ? [{ ...row }] : [] };
    }
    if (/INSERT INTO v3_homework_overrides\(student_id,homework_id,student_status/.test(sql)) {
      const key = `${values[0]}|${values[1]}`;
      rows.set(key, { ...rows.get(key), student_status: values[2], student_completed_date: values[3] });
      return { results: [] };
    }
    if (/INSERT INTO v3_homework_overrides\(student_id,homework_id,teacher_status/.test(sql)) {
      const key = `${values[0]}|${values[1]}`;
      rows.set(key, { ...rows.get(key), teacher_status: values[2], confirmation_memo: values[3] });
      return { results: [] };
    }
    return { results: [] };
  };
  return {
    rows,
    prepare(sql) {
      return {
        sql,
        values: [],
        bind(...values) { this.values = values; return this; },
        async first() {
          if (/SELECT value FROM v3_meta/.test(sql)) return { value: "1" };
          if (/SELECT user_id,role,profile_json,expires_at FROM v3_sessions/.test(sql)) return sessions.get(this.values[0]) || null;
          const result = await execute(this);
          return result.results[0] || null;
        },
        async run() { return execute(this); },
        async all() { return execute(this); },
      };
    },
    async batch(statements) { return Promise.all(statements.map(execute)); },
  };
};

const homeworkApi = async (env, token, action, body = {}) => {
  const response = await worker.fetch(new Request("https://local.invalid/api", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action, token, ...body }),
  }), env);
  return { status: response.status, body: await response.json() };
};

test("null and empty teacher status are canonical unconfirmed states", () => {
  assert.equal(normalizeTeacherStatus(null), "UNCONFIRMED");
  assert.equal(normalizeTeacherStatus(""), "UNCONFIRMED");
  assert.equal(normalizeTeacherStatus(" verified "), "VERIFIED");
  assert.equal(isHomeworkLocked(null), false);
  assert.equal(isHomeworkLocked("UNCONFIRMED"), false);
  assert.equal(isHomeworkLocked("VERIFIED"), true);
});

test("D1 null teacher status clears stale Google verified state recursively", () => {
  const google = {
    success: true,
    data: {
      homework: [{ homeworkId: "hw-1320", studentStatus: "UNINPUT", teacherStatus: "VERIFIED", confirmationMemo: "stale" }],
      groups: [{ items: [{ homeworkId: "hw-1320", studentStatus: "UNINPUT", teacherStatus: "VERIFIED", confirmationMemo: "stale" }] }],
    },
  };
  const patched = overlayHomework(google, [{
    homework_id: "hw-1320",
    student_status: "DECLARED_DONE",
    student_completed_date: "2026-08-22",
    teacher_status: null,
    confirmation_memo: null,
  }]);

  for (const item of [patched.data.homework[0], patched.data.groups[0].items[0]]) {
    assert.equal(item.studentStatus, "DECLARED_DONE");
    assert.equal(item.teacherStatus, "UNCONFIRMED");
    assert.equal(item.confirmationMemo, "");
  }
  assert.equal(google.data.homework[0].teacherStatus, "VERIFIED");
});

test("homework mutation routes keep student and teacher field ownership separate", () => {
  const source = fs.readFileSync(new URL("../src/v3.ts", import.meta.url), "utf8");
  assert.match(source, /HOMEWORK_STUDENT_ACTION_FORBIDDEN/);
  assert.match(source, /HOMEWORK_TEACHER_ACTION_FORBIDDEN/);
  assert.match(source, /HOMEWORK_ALREADY_CONFIRMED/);
  assert.match(source, /INSERT INTO v3_homework_overrides\(student_id,homework_id,student_status,student_completed_date,updated_at,updated_by\)/);
  assert.match(source, /INSERT INTO v3_homework_overrides\(student_id,homework_id,teacher_status,confirmation_memo,updated_at,updated_by\)/);
  assert.match(source, /teacherStatus:normalizeTeacherStatus\(savedRow\.teacher_status\)/);
});

test("1320 can declare, undo and redeclare until a teacher confirms", async () => {
  const db = await homeworkDb();
  const env = { DB: db, GOOGLE_API_URL: "https://google.invalid" };
  const homeworkId = "hw-1320";

  const declared = await homeworkApi(env, "student-token", "declareHomework", { homeworkId, studentStatus: "DECLARED_DONE" });
  assert.equal(declared.status, 200);
  assert.deepEqual([declared.body.homework.studentStatus, declared.body.homework.teacherStatus], ["DECLARED_DONE", "UNCONFIRMED"]);
  assert.equal(db.rows.get(`1320|${homeworkId}`).teacher_status, undefined);

  const undone = await homeworkApi(env, "student-token", "declareHomework", { homeworkId, studentStatus: "UNINPUT" });
  assert.deepEqual([undone.status, undone.body.homework.studentStatus, undone.body.homework.teacherStatus], [200, "UNINPUT", "UNCONFIRMED"]);

  const redeclared = await homeworkApi(env, "student-token", "declareHomework", { homeworkId, studentStatus: "DECLARED_DONE" });
  assert.deepEqual([redeclared.status, redeclared.body.homework.studentStatus, redeclared.body.homework.teacherStatus], [200, "DECLARED_DONE", "UNCONFIRMED"]);

  const studentConfirm = await homeworkApi(env, "student-token", "confirmHomework", { homeworkId, teacherStatus: "VERIFIED" });
  assert.deepEqual([studentConfirm.status, studentConfirm.body.code], [403, "HOMEWORK_TEACHER_ACTION_FORBIDDEN"]);

  const confirmed = await homeworkApi(env, "teacher-token", "confirmHomework", { homeworkId, teacherStatus: "VERIFIED" });
  assert.deepEqual([confirmed.status, confirmed.body.homework.teacherStatus], [200, "VERIFIED"]);

  const locked = await homeworkApi(env, "student-token", "declareHomework", { homeworkId, studentStatus: "UNINPUT" });
  assert.deepEqual([locked.status, locked.body.code], [409, "HOMEWORK_ALREADY_CONFIRMED"]);
});

test("production fast-path build preserves the canonical teacher status fix", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "foresta-v3-homework-"));
  const target = path.join(directory, "v3.ts");
  const sourcePath = new URL("../src/v3.ts", import.meta.url);
  const scriptPath = new URL("../scripts/apply-v3-runtime-fastpath.mjs", import.meta.url);
  fs.writeFileSync(target, fs.readFileSync(sourcePath, "utf8").replaceAll("\r\n", "\n"));
  try {
    const result = spawnSync(process.execPath, [fileURLToPath(scriptPath), target], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const built = fs.readFileSync(target, "utf8");
    assert.match(built, /out\.teacherStatus=normalizeTeacherStatus\(o\.teacher_status\)/);
    assert.match(built, /teacherStatus:normalizeTeacherStatus\(savedRow\.teacher_status\)/);
    assert.match(built, /HOMEWORK_TEACHER_ACTION_FORBIDDEN/);
    assert.match(built, /HOMEWORK_ALREADY_CONFIRMED/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
