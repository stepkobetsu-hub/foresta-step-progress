import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { buildV83Dashboard } from "../src/dashboard.ts";

const v3 = fs.readFileSync(new URL("../src/v3.ts", import.meta.url), "utf8");
const gas = fs.readFileSync(new URL("../../apps-script/code.gs", import.meta.url), "utf8");

test("Goal is explicitly cross-grade for middle school only", () => {
  assert.match(v3, /m\.series='FORESTA_GOAL'.*\? IN \('中1','中2','中3'\)/s);
  assert.match(gas, /function isMiddleSchoolGradeForGoal_/);
  assert.match(gas, /\['中1', '中2', '中3'\]\.includes/);
  assert.match(gas, /isGoalCatalogUnitForGrade_\(grade, unit\)/);
});

test("Goal and Step target inclusion remain independent", () => {
  const student = { student_id: "1320", display_name: "加瀬智子", grade: "中2", campus: "大手", school: "南城中", status: "ACTIVE" };
  const selectable = [
    { unit_id: "SAME", subject: "英語", series: "FORESTA_STEP", unit_order: 1, title: "Step" },
    { unit_id: "SAME", subject: "英語", series: "FORESTA_GOAL", unit_order: 1, title: "Goal" },
  ];
  const targets = [{ unit_id: "SAME", subject: "英語", series: "FORESTA_GOAL", included: 1 }];
  const dashboard = buildV83Dashboard(student, targets, [], [], selectable, []);
  const step = dashboard.selectableUnits.find((u) => u.series === "FORESTA_STEP");
  const goal = dashboard.selectableUnits.find((u) => u.series === "FORESTA_GOAL");
  assert.equal(step.targetIncluded, false);
  assert.equal(goal.targetIncluded, true);
  assert.deepEqual(dashboard.units.map((u) => u.series), ["FORESTA_GOAL"]);
});

test("Goal writes validate against subject and series selectable candidates", () => {
  assert.match(v3, /allowedUnitIds=new Set/);
  assert.match(v3, /選択できない単元が含まれています/);
});
