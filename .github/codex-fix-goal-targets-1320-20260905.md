# Codex task: restore FORESTA_GOAL target selection for 1320 and other non-G3 students

## Base / safety
- Work only on branch `codex/fix-goal-targets-1320-20260905`, based on `agent/step-progress-v3-implementation` SHA `5369343f046c583210bc43d04c6b7b998b9d6f3a` or newer if that base advanced.
- Do not roll back unrelated production work.
- Preserve D1-first autosave, homework, login, progress, Step targets, required textbook, vocabulary, and Goal Japanese 57-unit self-heal.
- Do not alter existing target selections/data except as necessary to make the already-defined Goal catalog visible/selectable.

## Production reproduction / confirmed cause
Student 1320 (加瀬智子 / kase) is `中2`. The Goal master/catalog is intentionally a single entrance-exam catalog with Goal units stored as grade `中3` / `gradeScope: 中3` (288 units total across five subjects; Goal Japanese 57 units).

The browser UI already supports `FORESTA_GOAL` and filters `d.selectableUnits` by `(subject, series)`. The failure is backend visibility:

1. Google Apps Script `filterUnitsForProfile_` / cached unit selection allows `FORESTA_GOAL` gradeScope `中3` for non-G3 students only when `isDevelopment_()` is true.
2. Cloudflare V3 production `readDashboardV3` uses a D1 selectable-unit query that only returns units/materials matching the student's own grade (or common grade). For 1320 中2 this excludes all Goal rows stored as 中3.

Therefore Step works, but Goal target selection shows no progression rows in production.

## Required behavior
- `FORESTA_GOAL` is an entrance-exam catalog and must be selectable for active middle-school students regardless of whether the student is 中1, 中2, or 中3, while the catalog itself can remain stored as grade 中3.
- For 1320 中2, dashboard `selectableUnits` must contain Goal rows, including Goal English/Math and Goal Japanese catalog where applicable.
- Step grade filtering must remain unchanged: Step must still use the student's grade/common rows only.
- Required textbook and vocabulary behavior must remain unchanged.
- Goal and Step target selections must remain independent by `series + subject + unitId` in V3 target overrides.

## Implementation requirements
1. In Cloudflare V3 production path (`cloudflare/src/v3.ts` or the active source after generated patches), change selectable-unit eligibility so:
   - existing own-grade/common rules stay;
   - OR Goal catalog rows (`m.series='FORESTA_GOAL'`) stored as the Goal catalog grade are included for middle-school students.
   Prefer an explicit condition for Goal rather than globally ignoring grade.
2. In Apps Script fallback/source, remove the development-only restriction for Goal cross-grade visibility in every relevant unit-selection helper (`filterUnitsForProfile_`, cached/selectable unit retrieval, admin/target helpers if duplicated). Use one shared semantic where possible.
3. Ensure target save validation accepts those Goal units for 1320/non-G3 once exposed; it must not reject them as non-selectable.
4. Add regression tests that model a 中2 student like 1320 and assert:
   - Step returns 中2 Step rows, not unrelated Step grades;
   - Goal returns the Goal catalog rows stored as 中3;
   - Goal target page/data is non-empty;
   - saving Goal targets remains independent from Step targets;
   - a 中3 student still sees Goal normally;
   - no change to Required Textbook/Vocabulary rules.
5. If current D1 production catalog lacks Goal rows other than Japanese self-heal, inspect bootstrap/import logic. Do not invent unit content. Use the existing 288-unit master/source and existing D1 catalog migration/seed mechanism. If full Goal catalog is missing in D1, STOP and report exactly which subjects/counts are missing before deploying rather than silently exposing only partial Goal.

## Verification
- Run all existing Cloudflare checks/tests and repo tests applicable to this branch.
- Type/syntax checks and `git diff --check` must pass.
- Add a targeted diagnostic/test for 1320-like grade 中2 that demonstrates Goal selectable count > 0 and Step behavior unchanged.
- Report exact changed files, tests, and any D1 catalog counts by Goal subject.
- Commit to this branch only; do not push directly to the base branch and do not deploy production until PR review.