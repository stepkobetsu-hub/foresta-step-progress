import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildV83Dashboard } from "../src/dashboard.ts";

test("D1 rows are mapped to the v83 dashboard shape used by the real UI", () => {
  const dashboard = buildV83Dashboard(
    { student_id: "1320", display_name: "確認生徒", grade: "中2", campus: "神領", status: "ACTIVE" },
    [{ unit_id: "MATH-1", subject: "数学", included: 1, series: "FORESTA_STEP", has_lct: 1 }],
    [{ unit_id: "MATH-1", round: 1, point_confirmed: 1, warmup_confirmed: 0, try_completed: 1, lct_result: "PASS", learning_date: "2026-08-05", updated_at: "2026-08-05T01:00:00Z" }],
    [{ unit_id: "MATH-1", status: "UNINPUT" }],
    [{ unit_id: "MATH-1", subject: "数学", unit_order: 1, unit_title: "正負の数", unit_type: "normal", series: "FORESTA_STEP", has_lct: 1 }],
  );

  assert.equal(dashboard.profile.studentId, "1320");
  assert.deepEqual([dashboard.overall.completedCount, dashboard.overall.targetCount], [1, 1]);
  assert.equal(dashboard.subjects.find((row) => row.subject === "数学").progressRate, 1);
  assert.equal(dashboard.units[0].rounds.length, 3);
  assert.equal(dashboard.units[0].rounds[0].tryCompleted, true);
  assert.equal(dashboard.selectableUnits[0].targetIncluded, true);
  assert.equal(dashboard.lct.completedCount, 1);
  assert.equal(dashboard.homeworkSummary.unconfirmedCount, 1);
});

test("dashboard query includes units shared by all junior-high grades", () => {
  const source = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");
  assert.match(source, /u\.grade='中1～中3共通'/);
  assert.match(source, /m\.grade='中1～中3共通'/);
});
