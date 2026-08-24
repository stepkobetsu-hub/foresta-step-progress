import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildV83Dashboard } from "../src/dashboard.ts";
import { generatedHomeworkToBrowser, homeworkTypesForUnit, mergeHomeworkPayload } from "../src/v3.ts";

test("homework types follow each material rule, including Japanese Foresta Step", () => {
  assert.deepEqual(homeworkTypesForUnit("FORESTA_STEP", "国語"), ["TRY_REDO", "EXERCISE"]);
  assert.deepEqual(homeworkTypesForUnit("FORESTA_STEP", "英語"), ["TRY_REDO", "EXERCISE", "MEMORIZATION_MARK"]);
  assert.deepEqual(homeworkTypesForUnit("FORESTA_GOAL", "英語"), ["TRY_REDO", "EXERCISE", "MY_VOCABULARY"]);
  assert.deepEqual(homeworkTypesForUnit("REQUIRED_TEXTBOOK", "数学"), ["REQUIRED_REMAINDER"]);
});

test("generated homework is browser-compatible, grouped, and deduplicated against Google rows", () => {
  const generated = ["TRY_REDO", "EXERCISE"].map((homework_type) => ({
    homework_id: `V3H:1097:JP-9:1:${homework_type}:2026-08-24`,
    student_id: "1097",
    unit_id: "JP-9",
    homework_type,
    assigned_date: "2026-08-24",
    due_date: "2026-08-28",
    round_number: 1,
    school_year: 2026,
    subject: "国語",
    series: "FORESTA_STEP",
    unit_order: 9,
    unit_title: "【論説③】言葉の意味",
    learning_date: "2026-08-24",
  }));
  const google = generatedHomeworkToBrowser({ ...generated[0], homework_id:"GOOGLE-EXISTING", student_status:"DECLARED_DONE" });
  const result = mergeHomeworkPayload({ success:true, homework:[google], groups:[] }, generated);

  assert.equal(result.homework.length, 2);
  assert.equal(result.groups.length, 1);
  assert.equal(result.groups[0].items.length, 2);
  assert.equal(result.homework.find((row) => row.homeworkType === "TRY_REDO").homeworkId, "GOOGLE-EXISTING");
  assert.equal(result.groups[0].unitTitle, "【論説③】言葉の意味");
});

test("today dashboard counts generated homework units and items", () => {
  const today = new Date().toLocaleDateString("sv-SE", { timeZone:"Asia/Tokyo" });
  const dashboard = buildV83Dashboard(
    { student_id:"1097", display_name:"上野 心美" }, [], [], [], [],
    [
      { assigned_date:today, unit_id:"JP-9", round_number:1, homework_type:"TRY_REDO" },
      { assigned_date:today, unit_id:"JP-9", round_number:1, homework_type:"EXERCISE" },
    ],
  );
  assert.equal(dashboard.today.homeworkUnitCount, 1);
  assert.equal(dashboard.today.homeworkItemCount, 2);
});

test("progress writes and bootstrap both create generated homework idempotently", () => {
  const source = readFileSync(new URL("../src/v3.ts", import.meta.url), "utf8");
  assert.match(source, /INSERT OR IGNORE INTO v3_homework_items/);
  assert.match(source, /UNIQUE\(student_id,unit_id,round_number,assigned_date,homework_type\)/);
  assert.match(source, /HOMEWORK_BACKFILL_KEY/);
  assert.match(source, /homeworkTypesForUnit\(unit\.series, unit\.subject\)/);
});
