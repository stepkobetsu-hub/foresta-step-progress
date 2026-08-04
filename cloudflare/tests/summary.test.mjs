import test from "node:test";
import assert from "node:assert/strict";
import { buildDashboardSummary } from "../src/summary.ts";

const target = (unit, subject, series = "FORESTA_STEP", hasLct = 1) => ({
  unit_id: unit, subject, series, has_lct: hasLct, included: 1,
});
const progress = (unit, round, tried = 0, lct = "") => ({
  unit_id: unit, round, try_completed: tried, lct_result: lct,
});

test("v83 denominator, rounds, subjects, vocabulary, LCT and homework rules", () => {
  const targets = [
    target("eng", "英語"),
    target("vocab", "英語", "VOCABULARY", 0),
    target("math", "数学"),
    target("jp", "国語"),
    target("social", "社会"),
  ];
  const rows = [
    progress("eng", 1, 1, "PERFECT"),
    progress("eng", 2, 1),
    progress("vocab", 1, 1),
    progress("math", 1, 1, "GOOD"),
    progress("outside", 1, 1, "PERFECT"),
    progress("jp", 4, 1, "PERFECT"),
  ];
  const homework = [
    { status: "UNINPUT" },
    { status: "UNINPUT", archived_at: "2026-08-01T00:00:00Z" },
    { status: "UNINPUT", is_archived: 1 },
    { status: "DECLARED_DONE" },
  ];
  const summary = buildDashboardSummary(targets, rows, homework);

  assert.deepEqual(
    [summary.targetCount, summary.completedCount, summary.progressPercent],
    [5, 4, 80],
  );
  assert.deepEqual(summary.rounds.map((row) => row.completedCount), [3, 1, 0]);
  assert.deepEqual(
    summary.subjects.map((row) => [row.subject, row.targetCount, row.completedCount, row.progressPercent]),
    [["英語", 2, 3, 150], ["数学", 1, 1, 100], ["国語", 1, 0, 0], ["理科", 0, 0, 0], ["社会", 1, 0, 0]],
  );
  assert.deepEqual(summary.lct, { targetCount: 4, completedCount: 2, progressRate: 0.5, progressPercent: 50 });
  assert.deepEqual(summary.homework, { totalCount: 2, uninputCount: 1 });
});

test("empty target set returns v83-compatible zero over zero values", () => {
  const summary = buildDashboardSummary([], [], []);
  assert.equal(summary.targetCount, 0);
  assert.equal(summary.completedCount, 0);
  assert.equal(summary.progressRate, null);
  assert.equal(summary.progressPercent, 0);
  assert.deepEqual(summary.subjects.map((row) => [row.targetCount, row.completedCount, row.progressPercent]), Array(5).fill([0, 0, 0]));
});
