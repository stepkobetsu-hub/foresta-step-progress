import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import worker from "../src/index.ts";
import { applyHomeworkArchivePersistence } from "../scripts/apply-homework-archive-persistence.mjs";

function archiveDb(initial = []) {
  const rows = new Map(initial.map((key) => [key, 1]));
  return {
    prepare(sql) {
      let values = [];
      return {
        bind(...next) { values = next; return this; },
        async all() {
          assert.match(sql, /SELECT group_key FROM homework_group_archives/);
          return { results: [...rows].filter(([, archived]) => archived).map(([group_key]) => ({ group_key })) };
        },
        async run() {
          if (/CREATE TABLE IF NOT EXISTS homework_group_archives/.test(sql)) return { results: [], meta: { changes: 0 } };
          assert.match(sql, /INSERT INTO homework_group_archives/);
          rows.set(String(values[1]), Number(values[2]));
          return { results: [], meta: { changes: 1 } };
        },
      };
    },
  };
}

test("listHomework includes the authenticated student's persisted archive keys", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body || "{}")); calls.push(body);
    if (body.action === "getSession") return Response.json({ success: true, role: "STUDENT", userId: "1320" });
    return Response.json({ success: true, homework: [], groups: [] });
  };
  try {
    const response = await worker.fetch(new Request("https://local.invalid/api", { method: "POST", body: JSON.stringify({ action: "listHomework", token: "valid" }) }), { GOOGLE_API_URL: "https://google.invalid", DB: archiveDb(["math|1"]) }, { waitUntil() {} });
    assert.equal(response.headers.get("x-data-source"), "google-v83+archive-d1");
    assert.deepEqual((await response.json()).archivedGroupKeys, ["math|1"]);
    assert.deepEqual(calls.map((call) => call.action), ["listHomework", "getSession"]);
  } finally { globalThis.fetch = originalFetch; }
});

test("archive writes use the session student id and return the saved state", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ success: true, role: "STUDENT", userId: "1320" });
  try {
    const response = await worker.fetch(new Request("https://local.invalid/api", { method: "POST", body: JSON.stringify({ action: "setHomeworkGroupArchived", token: "valid", groupKey: "math|1", archived: true, studentId: "1100" }) }), { GOOGLE_API_URL: "https://google.invalid", DB: archiveDb() }, { waitUntil() {} });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { success: true, archivedGroupKeys: ["math|1"] });
  } finally { globalThis.fetch = originalFetch; }
});

test("production UI patch makes archive clicks await a server save", () => {
  const html = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  const patched = applyHomeworkArchivePersistence(html);
  assert.match(patched, /setHomeworkGroupArchived/);
  assert.match(patched, /body\.onclick=async event/);
  assert.match(patched, /await setHomeworkArchived_/);
  assert.match(patched, /archivedGroupKeys/);
  assert.match(patched, /saveStudentViewCache_\(\)/);
  assert.match(patched, /viewCache:archivePersistence20260817/);
  assert.doesNotMatch(patched, /'setHomeworkGroupArchived','setHomeworkGroupArchived'/);
});
