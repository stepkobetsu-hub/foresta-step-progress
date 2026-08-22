type MergeEnv = { DB: D1Database; MERGE_TOKEN: string };
type Row = Record<string, unknown>;

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
  status,
  headers: {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  },
});

const numberValue = (row: Row | null, key = "n") => Number(row?.[key] ?? 0);

async function scalar(env: MergeEnv, sql: string) {
  const row = await env.DB.prepare(sql).first<Row>();
  return numberValue(row);
}

async function counts(env: MergeEnv) {
  const [
    students,
    oldProgress,
    v3Progress,
    oldTargets,
    v3Targets,
    targetOverrides,
    oldHomework,
    v3Homework,
    homeworkOverrides,
    homeworkArchives,
  ] = await Promise.all([
    scalar(env, "SELECT COUNT(*) n FROM students"),
    scalar(env, "SELECT COUNT(*) n FROM progress_records"),
    scalar(env, "SELECT COUNT(*) n FROM v3_progress_records"),
    scalar(env, "SELECT COUNT(*) n FROM student_targets"),
    scalar(env, "SELECT COUNT(*) n FROM v3_target_snapshot"),
    scalar(env, "SELECT COUNT(*) n FROM v3_target_overrides"),
    scalar(env, "SELECT COUNT(*) n FROM homework_records"),
    scalar(env, "SELECT COUNT(*) n FROM v3_homework_snapshot"),
    scalar(env, "SELECT COUNT(*) n FROM v3_homework_overrides"),
    scalar(env, "SELECT COUNT(*) n FROM v3_homework_group_archives"),
  ]);
  return { students, oldProgress, v3Progress, oldTargets, v3Targets, targetOverrides, oldHomework, v3Homework, homeworkOverrides, homeworkArchives };
}

async function missingCounts(env: MergeEnv) {
  const [progress, targets, homework] = await Promise.all([
    scalar(env, `SELECT COUNT(*) n FROM progress_records p
      WHERE NOT EXISTS (
        SELECT 1 FROM v3_progress_records v
        WHERE v.student_id=p.student_id AND v.unit_id=p.unit_id AND v.round=p.round
      )`),
    scalar(env, `SELECT COUNT(*) n FROM student_targets s
      WHERE NOT EXISTS (SELECT 1 FROM v3_target_snapshot v WHERE v.target_id=s.target_id)`),
    scalar(env, `SELECT COUNT(*) n FROM homework_records h
      WHERE NOT EXISTS (SELECT 1 FROM v3_homework_snapshot v WHERE v.homework_id=h.homework_id)`),
  ]);
  return { progress, targets, homework };
}

async function backupCounts(env: MergeEnv) {
  const [progress, targets, targetOverrides, homework, homeworkOverrides, homeworkArchives] = await Promise.all([
    scalar(env, "SELECT COUNT(*) n FROM v3_merge_backup_20260822_progress_records"),
    scalar(env, "SELECT COUNT(*) n FROM v3_merge_backup_20260822_target_snapshot"),
    scalar(env, "SELECT COUNT(*) n FROM v3_merge_backup_20260822_target_overrides"),
    scalar(env, "SELECT COUNT(*) n FROM v3_merge_backup_20260822_homework_snapshot"),
    scalar(env, "SELECT COUNT(*) n FROM v3_merge_backup_20260822_homework_overrides"),
    scalar(env, "SELECT COUNT(*) n FROM v3_merge_backup_20260822_homework_archives"),
  ]);
  return { progress, targets, targetOverrides, homework, homeworkOverrides, homeworkArchives };
}

async function completedMarker(env: MergeEnv) {
  const row = await env.DB.prepare("SELECT value FROM v3_meta WHERE key='student_data_merge_20260822'").first<{ value: string }>();
  return row?.value || "";
}

export default {
  async fetch(request: Request, env: MergeEnv) {
    if (request.method !== "POST") return json({ ok: false, error: "POST_ONLY" }, 405);
    const auth = request.headers.get("authorization") || "";
    if (!env.MERGE_TOKEN || auth !== `Bearer ${env.MERGE_TOKEN}`) return json({ ok: false, error: "UNAUTHORIZED" }, 401);

    const body = await request.json().catch(() => ({})) as Row;
    if (String(body.action || "") !== "merge") return json({ ok: false, error: "INVALID_ACTION" }, 400);

    const marker = await completedMarker(env);
    if (marker) {
      return json({
        ok: true,
        alreadyMerged: true,
        marker,
        counts: await counts(env),
        missing: await missingCounts(env),
        backups: await backupCounts(env),
      });
    }

    const before = await counts(env);
    const beforeMissing = await missingCounts(env);

    // Keep a complete pre-merge copy of every V3 table that this consolidation depends on.
    // Old source tables are never modified, so they remain an additional rollback source.
    await env.DB.batch([
      env.DB.prepare("CREATE TABLE IF NOT EXISTS v3_merge_backup_20260822_progress_records AS SELECT * FROM v3_progress_records"),
      env.DB.prepare("CREATE TABLE IF NOT EXISTS v3_merge_backup_20260822_target_snapshot AS SELECT * FROM v3_target_snapshot"),
      env.DB.prepare("CREATE TABLE IF NOT EXISTS v3_merge_backup_20260822_target_overrides AS SELECT * FROM v3_target_overrides"),
      env.DB.prepare("CREATE TABLE IF NOT EXISTS v3_merge_backup_20260822_homework_snapshot AS SELECT * FROM v3_homework_snapshot"),
      env.DB.prepare("CREATE TABLE IF NOT EXISTS v3_merge_backup_20260822_homework_overrides AS SELECT * FROM v3_homework_overrides"),
      env.DB.prepare("CREATE TABLE IF NOT EXISTS v3_merge_backup_20260822_homework_archives AS SELECT * FROM v3_homework_group_archives"),
    ]);

    // V3 wins. Preserved legacy data only fills rows that V3 does not already contain.
    // V3 override tables are intentionally left untouched and therefore remain the newest authority.
    await env.DB.batch([
      env.DB.prepare(`INSERT OR IGNORE INTO v3_progress_records(
        record_id,student_id,material_id,subject,grade,unit_id,round,
        point_confirmed,warmup_confirmed,try_completed,memorization_completed,exercise_completed,
        lct_result,learning_date,updated_at,updated_by,version,request_id
      ) SELECT
        record_id,student_id,material_id,subject,grade,unit_id,round,
        point_confirmed,warmup_confirmed,try_completed,memorization_completed,exercise_completed,
        lct_result,learning_date,updated_at,updated_by,version,request_id
      FROM progress_records`),
      env.DB.prepare(`INSERT OR IGNORE INTO v3_target_snapshot(
        target_id,student_id,material_id,subject,target_start,target_end,target_period,
        included,updated_at,updated_by,version
      ) SELECT
        target_id,student_id,material_id,subject,target_start,target_end,target_period,
        included,updated_at,updated_by,version
      FROM student_targets`),
      env.DB.prepare(`INSERT OR IGNORE INTO v3_homework_snapshot(
        homework_id,student_id,material_id,subject,unit_id,assigned_date,due_date,
        completed_date,correction_date,review_date,archived_at,restored_at,status,
        updated_at,updated_by,version,request_id
      ) SELECT
        homework_id,student_id,material_id,subject,unit_id,assigned_date,due_date,
        completed_date,correction_date,review_date,archived_at,restored_at,status,
        updated_at,updated_by,version,request_id
      FROM homework_records`),
    ]);

    const after = await counts(env);
    const missing = await missingCounts(env);
    const backups = await backupCounts(env);

    const backupOk =
      backups.progress === before.v3Progress &&
      backups.targets === before.v3Targets &&
      backups.targetOverrides === before.targetOverrides &&
      backups.homework === before.v3Homework &&
      backups.homeworkOverrides === before.homeworkOverrides &&
      backups.homeworkArchives === before.homeworkArchives;

    const sourceUntouched =
      after.oldProgress === before.oldProgress &&
      after.oldTargets === before.oldTargets &&
      after.oldHomework === before.oldHomework;

    const overridesUntouched =
      after.targetOverrides === before.targetOverrides &&
      after.homeworkOverrides === before.homeworkOverrides &&
      after.homeworkArchives === before.homeworkArchives;

    const noMissing = missing.progress === 0 && missing.targets === 0 && missing.homework === 0;
    const nonDecreasing =
      after.v3Progress >= before.v3Progress &&
      after.v3Targets >= before.v3Targets &&
      after.v3Homework >= before.v3Homework;

    if (!backupOk || !sourceUntouched || !overridesUntouched || !noMissing || !nonDecreasing) {
      return json({
        ok: false,
        error: "MERGE_VERIFICATION_FAILED",
        before,
        beforeMissing,
        after,
        missing,
        backups,
        checks: { backupOk, sourceUntouched, overridesUntouched, noMissing, nonDecreasing },
      }, 500);
    }

    const summary = {
      completedAt: new Date().toISOString(),
      inserted: {
        progress: after.v3Progress - before.v3Progress,
        targets: after.v3Targets - before.v3Targets,
        homework: after.v3Homework - before.v3Homework,
      },
      beforeMissing,
    };

    await env.DB.prepare(`INSERT INTO v3_meta(key,value,updated_at)
      VALUES('student_data_merge_20260822',?,datetime('now'))
      ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=datetime('now')`)
      .bind(JSON.stringify(summary)).run();

    return json({
      ok: true,
      alreadyMerged: false,
      summary,
      before,
      after,
      missing,
      backups,
      checks: { backupOk, sourceUntouched, overridesUntouched, noMissing, nonDecreasing },
    });
  },
};
