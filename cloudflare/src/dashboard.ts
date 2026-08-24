import { buildDashboardSummary } from "./summary.ts";

type Row = Record<string, unknown>;

const text = (value: unknown) => String(value ?? "").trim();
const truthy = (value: unknown) => value === true || value === 1 || text(value).toLowerCase() === "true";
const normalizeSeries = (value: unknown) => text(value) || "FORESTA_STEP";
const unitKey = (subject: unknown, series: unknown, unitId: unknown) =>
  `${text(subject)}|${normalizeSeries(series)}|${text(unitId)}`;
const seriesLabel = (series: string) => ({
  FORESTA_GOAL: "フォレスタゴール",
  VOCABULARY: "フォレスタ英単語",
  REQUIRED_TEXTBOOK: "必修テキスト",
}[series] || "フォレスタステップ");
const homeworkItems = (series: string, subject: string) => {
  if (series === "REQUIRED_TEXTBOOK") return ["REQUIRED_REMAINDER"];
  if (subject === "英語" && series === "FORESTA_GOAL") return ["TRY_REDO", "EXERCISE", "MY_VOCABULARY"];
  if (subject === "英語" && series === "FORESTA_STEP") return ["TRY_REDO", "EXERCISE", "MEMORIZATION_MARK"];
  return ["TRY_REDO", "EXERCISE"];
};

const progressState = (row: Row | undefined, roundNumber: number) => ({
  roundNumber,
  lctResult: text(row?.lct_result),
  lctRecordedAt: "",
  pointConfirmed: truthy(row?.point_confirmed),
  warmupConfirmed: truthy(row?.warmup_confirmed),
  tryCompleted: truthy(row?.try_completed),
  learningDate: text(row?.learning_date).slice(0, 10),
  pointCompletedAt: "",
  warmupCompletedAt: "",
  tryCompletedAt: "",
});

export const buildV83Dashboard = (student: Row, targets: Row[], progress: Row[], homework: Row[], selectable: Row[], generatedHomework: Row[] = []) => {
  const summary = buildDashboardSummary(targets, progress, homework);
  // unit_id is globally unique in the units table. Target inclusion therefore
  // uses only unit_id; mixing legacy series labels into target identity caused
  // a saved target to appear restored after reload.
  const targetIds = new Set(targets
    .filter((row) => truthy(row.included))
    .map((row) => text(row.unit_id))
    .filter(Boolean));
  const progressByKey = new Map(progress.map((row) => [`${text(row.unit_id)}:${Number(row.round) || 1}`, row]));
  const mapUnit = (unit: Row) => {
    const unitId = text(unit.unit_id);
    const series = normalizeSeries(unit.series);
    const subject = text(unit.subject);
    const key = unitKey(subject, series, unitId);
    const rounds = [1, 2, 3].map((round) => progressState(progressByKey.get(`${unitId}:${round}`), round));
    return {
      unitId,
      subject,
      stepCode: text(unit.step_code) || String(unit.unit_order ?? ""),
      unitTitle: text(unit.unit_title || unit.title),
      unitType: text(unit.unit_type) || "normal",
      series,
      seriesLabel: seriesLabel(series),
      hasLct: series === "FORESTA_STEP" || truthy(unit.has_lct),
      homeworkItems: homeworkItems(series, subject),
      ...rounds[0],
      rounds,
      chapterKey: text(unit.chapter_id) || "other",
      chapterLabel: text(unit.chapter_label) || "章未設定",
    };
  };
  const allUnits = selectable.map(mapUnit);
  const progressKeys = new Set(progress.map((row) => unitKey(row.subject, row.series, row.unit_id)));
  const newest = progress.map((row) => text(row.updated_at)).filter(Boolean).sort().pop() || "";
  const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
  const todayProgress = progress.filter((row) => text(row.learning_date).slice(0, 10) === today);
  const todayHomework = generatedHomework.filter((row) => text(row.assigned_date || row.assignedDate).slice(0, 10) === today);

  return {
    profile: {
      studentId: text(student.student_id),
      id: text(student.student_id),
      name: text(student.display_name),
      grade: text(student.grade),
      campus: text(student.campus),
      school: text(student.school || student.school_name),
      status: text(student.status),
    },
    overall: {
      targetCount: summary.targetCount,
      completedCount: summary.completedCount,
      progressRate: summary.progressRate,
      rounds: summary.rounds.map(({ progressPercent: _ignored, ...row }) => row),
    },
    subjects: summary.subjects.map(({ progressPercent: _ignored, ...subject }) => ({
      ...subject,
      rounds: subject.rounds.map(({ progressPercent: _roundPercent, ...round }) => round),
    })),
    lct: {
      completedCount: summary.lct.completedCount,
      targetCount: summary.lct.targetCount,
      progressRate: summary.lct.progressRate,
    },
    homeworkSummary: {
      totalCount: summary.homework.totalCount,
      verifiedCount: homework.filter((row) => ["VERIFIED", "NOT_APPLICABLE"].includes(text(row.teacher_status))).length,
      notDoneCount: homework.filter((row) => text(row.teacher_status) === "NOT_DONE").length,
      unconfirmedCount: homework.filter((row) => ["UNINPUT", "UNCONFIRMED"].includes(text(row.status || row.teacher_status))).length,
    },
    today: {
      learnedUnitCount: new Set(todayProgress.map((row) =>
        `${unitKey(row.subject, row.series, row.unit_id)}:${Number(row.round) || 1}`)).size,
      tryCompletedCount: todayProgress.filter((row) => truthy(row.try_completed)).length,
      homeworkUnitCount: new Set(todayHomework.map((row) => `${text(row.unit_id || row.unitId)}:${Number(row.round_number || row.roundNumber) || 1}`)).size,
      homeworkItemCount: todayHomework.length,
      materials: [],
      subjects: [],
    },
    newMilestone: null,
    units: allUnits.filter((unit) => targetIds.has(unit.unitId)),
    outsideTargetUnits: allUnits.filter((unit) => !targetIds.has(unit.unitId) && progressKeys.has(unitKey(unit.subject, unit.series, unit.unitId))),
    selectableUnits: allUnits.map((unit, displayOrder) => ({ ...unit, displayOrder, targetIncluded: targetIds.has(unit.unitId) })),
    lastStudentInputAt: newest,
    achievements: { earned: [], next: null },
  };
};
