export const DASHBOARD_SUBJECTS = ["英語", "数学", "国語", "理科", "社会"] as const;
export const STUDY_ROUNDS = [1, 2, 3] as const;

type Row = Record<string, unknown>;

const truthy = (value: unknown) => value === true || value === 1 || String(value).toLowerCase() === "true";
const text = (value: unknown) => String(value ?? "").trim();
const rate = (completedCount: number, targetCount: number) => targetCount ? completedCount / targetCount : null;
const percent = (completedCount: number, targetCount: number) => targetCount
  ? Math.round(completedCount / targetCount * 100)
  : 0;

const unitIdOfTarget = (row: Row) => text(row.unit_id || row.target_start);
const isIncludedTarget = (row: Row) => truthy(row.included);
const unitHasLct = (row: Row) => text(row.series) === "FORESTA_STEP" || truthy(row.has_lct);
const isActiveHomework = (row: Row) => !truthy(row.is_archived) && !text(row.archived_at);

export type DashboardSummary = {
  targetCount: number;
  completedCount: number;
  progressRate: number | null;
  progressPercent: number;
  uninputCount: number;
  rounds: Array<{ roundNumber: number; targetCount: number; completedCount: number; progressRate: number | null; progressPercent: number }>;
  subjects: Array<{ subject: string; targetCount: number; completedCount: number; progressRate: number | null; progressPercent: number; rounds: Array<{ roundNumber: number; targetCount: number; completedCount: number; progressRate: number | null; progressPercent: number }> }>;
  lct: { targetCount: number; completedCount: number; progressRate: number | null; progressPercent: number };
  homework: { totalCount: number; uninputCount: number };
};

/**
 * Mirrors getStudentDashboard_ in the published Apps Script v83.
 * homework_records contains only rows that passed v83 hasLessonProgress_ at import time;
 * this function applies the remaining archive/display and UNINPUT conditions.
 */
export const buildDashboardSummary = (targets: Row[], progress: Row[], homework: Row[]): DashboardSummary => {
  const includedTargets = targets.filter(isIncludedTarget);
  const targetByUnit = new Map(includedTargets.map((row) => [unitIdOfTarget(row), row]));
  const targetIds = new Set(targetByUnit.keys());
  const targetProgress = progress.filter((row) => {
    const round = Number(row.round);
    return targetIds.has(text(row.unit_id)) && STUDY_ROUNDS.includes(round as 1 | 2 | 3);
  });

  const summarizeRound = (roundNumber: number, ids: Set<string>) => {
    const completedCount = targetProgress.filter((row) =>
      Number(row.round) === roundNumber && ids.has(text(row.unit_id)) && truthy(row.try_completed)
    ).length;
    return {
      roundNumber,
      targetCount: ids.size,
      completedCount,
      progressRate: rate(completedCount, ids.size),
      progressPercent: percent(completedCount, ids.size),
    };
  };

  const rounds = STUDY_ROUNDS.map((roundNumber) => summarizeRound(roundNumber, targetIds));
  const completedCount = rounds.reduce((sum, row) => sum + row.completedCount, 0);
  const subjects = DASHBOARD_SUBJECTS.map((subject) => {
    const ids = new Set(includedTargets
      .filter((row) => text(row.subject) === subject)
      .map(unitIdOfTarget));
    const subjectRounds = STUDY_ROUNDS.map((roundNumber) => summarizeRound(roundNumber, ids));
    const subjectCompleted = subjectRounds.reduce((sum, row) => sum + row.completedCount, 0);
    return {
      subject,
      targetCount: ids.size,
      completedCount: subjectCompleted,
      progressRate: rate(subjectCompleted, ids.size),
      progressPercent: percent(subjectCompleted, ids.size),
      rounds: subjectRounds,
    };
  });

  const lctTargetIds = new Set(includedTargets.filter(unitHasLct).map(unitIdOfTarget));
  const lctCompletedCount = targetProgress.filter((row) =>
    lctTargetIds.has(text(row.unit_id)) && Boolean(text(row.lct_result))
  ).length;
  const visibleHomework = homework.filter(isActiveHomework);
  const uninputCount = visibleHomework.filter((row) => text(row.status) === "UNINPUT").length;

  return {
    targetCount: targetIds.size,
    completedCount,
    progressRate: rate(completedCount, targetIds.size),
    progressPercent: percent(completedCount, targetIds.size),
    uninputCount,
    rounds,
    subjects,
    lct: {
      targetCount: lctTargetIds.size,
      completedCount: lctCompletedCount,
      progressRate: rate(lctCompletedCount, lctTargetIds.size),
      progressPercent: percent(lctCompletedCount, lctTargetIds.size),
    },
    homework: {
      totalCount: visibleHomework.length,
      uninputCount,
    },
  };
};
