export const DASHBOARD_SUBJECTS = ["英語", "数学", "国語", "理科", "社会"] as const;
export const STUDY_ROUNDS = [1, 2, 3] as const;

type Row = Record<string, unknown>;

const truthy = (value: unknown) => value === true || value === 1 || String(value).toLowerCase() === "true";
const text = (value: unknown) => String(value ?? "").trim();
const normalizeSeries = (value: unknown) => text(value) || "FORESTA_STEP";
const rate = (completedCount: number, targetCount: number) => targetCount ? completedCount / targetCount : null;
const percent = (completedCount: number, targetCount: number) => targetCount
  ? Math.round(completedCount / targetCount * 100)
  : 0;

const unitIdOfTarget = (row: Row) => text(row.unit_id || row.target_start);
const unitKey = (row: Row) => `${text(row.subject)}|${normalizeSeries(row.series)}|${text(row.unit_id || row.target_start)}`;
const isIncludedTarget = (row: Row) => truthy(row.included);
const unitHasLct = (row: Row) => normalizeSeries(row.series) === "FORESTA_STEP" || truthy(row.has_lct);
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

export const buildDashboardSummary = (targets: Row[], progress: Row[], homework: Row[]): DashboardSummary => {
  const includedTargets = targets.filter(isIncludedTarget);
  const targetByUnit = new Map(includedTargets.map((row) => [unitKey(row), row]));
  const targetKeys = new Set(targetByUnit.keys());
  const targetProgress = progress.filter((row) => {
    const round = Number(row.round);
    return targetKeys.has(unitKey(row)) && STUDY_ROUNDS.includes(round as 1 | 2 | 3);
  });

  const summarizeRound = (roundNumber: number, keys: Set<string>) => {
    const completedCount = targetProgress.filter((row) =>
      Number(row.round) === roundNumber && keys.has(unitKey(row)) && truthy(row.try_completed)
    ).length;
    return {
      roundNumber,
      targetCount: keys.size,
      completedCount,
      progressRate: rate(completedCount, keys.size),
      progressPercent: percent(completedCount, keys.size),
    };
  };

  const rounds = STUDY_ROUNDS.map((roundNumber) => summarizeRound(roundNumber, targetKeys));
  const completedCount = rounds.reduce((sum, row) => sum + row.completedCount, 0);
  const subjects = DASHBOARD_SUBJECTS.map((subject) => {
    const keys = new Set(includedTargets
      .filter((row) => text(row.subject) === subject)
      .map(unitKey));
    const subjectRounds = STUDY_ROUNDS.map((roundNumber) => summarizeRound(roundNumber, keys));
    const subjectCompleted = subjectRounds.reduce((sum, row) => sum + row.completedCount, 0);
    return {
      subject,
      targetCount: keys.size,
      completedCount: subjectCompleted,
      progressRate: rate(subjectCompleted, keys.size),
      progressPercent: percent(subjectCompleted, keys.size),
      rounds: subjectRounds,
    };
  });

  const lctTargetKeys = new Set(includedTargets.filter(unitHasLct).map(unitKey));
  const lctCompletedCount = targetProgress.filter((row) =>
    lctTargetKeys.has(unitKey(row)) && Boolean(text(row.lct_result))
  ).length;
  const visibleHomework = homework.filter(isActiveHomework);
  const uninputCount = visibleHomework.filter((row) => text(row.status) === "UNINPUT").length;

  return {
    targetCount: targetKeys.size,
    completedCount,
    progressRate: rate(completedCount, targetKeys.size),
    progressPercent: percent(completedCount, targetKeys.size),
    uninputCount,
    rounds,
    subjects,
    lct: {
      targetCount: lctTargetKeys.size,
      completedCount: lctCompletedCount,
      progressRate: rate(lctCompletedCount, lctTargetKeys.size),
      progressPercent: percent(lctCompletedCount, lctTargetKeys.size),
    },
    homework: {
      totalCount: visibleHomework.length,
      uninputCount,
    },
  };
};
