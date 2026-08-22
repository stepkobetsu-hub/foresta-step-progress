type Row = Record<string, unknown>;
type SmokeEnv = Env & { SMOKE_TOKEN: string };

const headers = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers });
const text = (value: unknown) => String(value ?? "").trim();
const isRow = (value: unknown): value is Row => typeof value === "object" && value !== null && !Array.isArray(value);

const tokenHash = async (token: string) => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
};

const authorized = (request: Request, env: SmokeEnv) => {
  const supplied = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  return Boolean(env.SMOKE_TOKEN) && supplied === env.SMOKE_TOKEN;
};

const prepare = async (env: SmokeEnv) => {
  const sessionToken = `v3-smoke-${crypto.randomUUID()}-${crypto.randomUUID()}`;
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
  await env.DB.prepare(`INSERT INTO v3_sessions(token_hash,user_id,role,profile_json,expires_at,created_at,last_seen_at)
    VALUES(?, '1320', 'STUDENT', ?, datetime(?), datetime('now'), datetime('now'))
    ON CONFLICT(token_hash) DO UPDATE SET expires_at=excluded.expires_at,last_seen_at=datetime('now')`)
    .bind(await tokenHash(sessionToken), JSON.stringify({ studentId: "1320", id: "1320", name: "V3 smoke 1320" }), expiresAt).run();

  const [progress, target, homework] = await env.DB.batch([
    env.DB.prepare(`SELECT p.unit_id,p.round,p.lct_result,p.point_confirmed,p.warmup_confirmed,p.try_completed,p.learning_date
      FROM v3_progress_records p
      JOIN units u ON u.unit_id=p.unit_id
      JOIN materials m ON m.material_id=u.material_id
      JOIN students s ON s.student_id=p.student_id
      WHERE p.student_id='1320' AND m.active=1
        AND (u.grade='' OR u.grade=s.grade OR u.grade='中1～中3共通' OR m.grade='' OR m.grade=s.grade OR m.grade='中1～中3共通')
      ORDER BY CASE WHEN p.learning_date IS NULL OR p.learning_date='' THEN 1 ELSE 0 END, p.updated_at DESC LIMIT 1`),
    env.DB.prepare(`SELECT t.target_start AS unit_id,t.subject,COALESCE(m.series,'FORESTA_STEP') AS series,
        COALESCE(o.included,t.included) AS included
      FROM v3_target_snapshot t
      JOIN students s ON s.student_id=t.student_id
      JOIN units u ON u.unit_id=t.target_start AND u.subject=t.subject
      JOIN materials m ON m.material_id=u.material_id AND m.active=1
      LEFT JOIN v3_target_overrides o
        ON o.student_id=t.student_id AND o.unit_id=t.target_start AND o.subject=t.subject AND o.series=COALESCE(m.series,'FORESTA_STEP')
      WHERE t.student_id='1320' AND t.target_start IS NOT NULL AND t.target_start<>''
        AND (u.grade='' OR u.grade=s.grade OR u.grade='中1～中3共通' OR m.grade='' OR m.grade=s.grade OR m.grade='中1～中3共通')
      ORDER BY COALESCE(o.included,t.included) DESC,u.unit_order,t.target_id LIMIT 1`),
    env.DB.prepare(`SELECT h.homework_id FROM v3_homework_snapshot h
      JOIN units u ON u.unit_id=h.unit_id
      JOIN materials m ON m.material_id=u.material_id
      JOIN students s ON s.student_id=h.student_id
      WHERE h.student_id='1320' AND m.active=1
        AND (u.grade='' OR u.grade=s.grade OR u.grade='中1～中3共通' OR m.grade='' OR m.grade=s.grade OR m.grade='中1～中3共通')
      ORDER BY h.updated_at DESC LIMIT 1`),
  ]);

  const progressRow = progress.results[0] as Row | undefined;
  const targetRow = target.results[0] as Row | undefined;
  const homeworkRow = homework.results[0] as Row | undefined;
  if (!progressRow || !targetRow || !homeworkRow) return json({ ok: false, error: "1320 smoke fixture is incomplete" }, 409);
  return json({ ok: true, sessionToken, progress: progressRow, target: targetRow, homework: homeworkRow });
};

const inspect = async (env: SmokeEnv, body: Row) => {
  const progressUnitId = text(body.progressUnitId), round = Number(body.round) || 1;
  const targetUnitId = text(body.targetUnitId), subject = text(body.subject), series = text(body.series);
  const homeworkId = text(body.homeworkId);
  const [progress, target, homework] = await env.DB.batch([
    env.DB.prepare(`SELECT unit_id,round,lct_result,point_confirmed,warmup_confirmed,try_completed,learning_date,updated_at
      FROM v3_progress_records WHERE student_id='1320' AND unit_id=? AND round=?`).bind(progressUnitId, round),
    env.DB.prepare(`SELECT unit_id,subject,series,included,updated_at FROM v3_target_overrides
      WHERE student_id='1320' AND unit_id=? AND subject=? AND series=?`).bind(targetUnitId, subject, series),
    env.DB.prepare(`SELECT homework_id,student_status,student_completed_date,teacher_status,updated_at FROM v3_homework_overrides
      WHERE student_id='1320' AND homework_id=?`).bind(homeworkId),
  ]);
  return json({ ok: true, progress: progress.results[0] || null, target: target.results[0] || null, homework: homework.results[0] || null });
};

const inspectRecent1320 = async (env: SmokeEnv) => {
  const names = `('渡辺悠一郎','高岡邦大','大渕ひかる','元永祐輔','上野心美')`;
  const current = await env.DB.prepare(`WITH wanted AS (
      SELECT student_id,display_name FROM students
      WHERE REPLACE(REPLACE(display_name,' ',''),'　','') IN ${names}
    ), eff AS (
      SELECT t.student_id,t.subject,t.target_start AS unit_id,COALESCE(m.series,'FORESTA_STEP') AS series,
             COALESCE(o.included,t.included) AS included
      FROM v3_target_snapshot t
      JOIN wanted w ON w.student_id=t.student_id
      LEFT JOIN units u ON u.unit_id=t.target_start
      LEFT JOIN materials m ON m.material_id=u.material_id
      LEFT JOIN v3_target_overrides o ON o.student_id=t.student_id AND o.unit_id=t.target_start
        AND o.subject=t.subject AND o.series=COALESCE(m.series,'FORESTA_STEP')
      WHERE t.target_start IS NOT NULL AND t.target_start<>''
      GROUP BY t.student_id,t.subject,t.target_start,COALESCE(m.series,'FORESTA_STEP')
    ), targets AS (
      SELECT student_id,subject,COUNT(*) AS target_count FROM eff WHERE included=1 GROUP BY student_id,subject
    ), completed AS (
      SELECT e.student_id,e.subject,COUNT(*) AS completed_count
      FROM eff e JOIN v3_progress_records p ON p.student_id=e.student_id AND p.unit_id=e.unit_id AND p.subject=e.subject
      WHERE e.included=1 AND p.round BETWEEN 1 AND 3 AND p.try_completed=1
      GROUP BY e.student_id,e.subject
    )
    SELECT 'V3' AS source,w.student_id,w.display_name,sub.subject,
           COALESCE(c.completed_count,0) AS completed_count,COALESCE(t.target_count,0) AS target_count
    FROM wanted w CROSS JOIN (SELECT '英語' subject UNION ALL SELECT '数学' UNION ALL SELECT '国語' UNION ALL SELECT '理科' UNION ALL SELECT '社会') sub
    LEFT JOIN targets t ON t.student_id=w.student_id AND t.subject=sub.subject
    LEFT JOIN completed c ON c.student_id=w.student_id AND c.subject=sub.subject
    ORDER BY w.display_name,sub.subject`).all();

  const legacy = await env.DB.prepare(`WITH wanted AS (
      SELECT student_id,display_name FROM students
      WHERE REPLACE(REPLACE(display_name,' ',''),'　','') IN ${names}
    ), eff AS (
      SELECT t.student_id,t.subject,t.target_start AS unit_id,COALESCE(m.series,'FORESTA_STEP') AS series,MAX(t.included) AS included
      FROM student_targets t
      JOIN wanted w ON w.student_id=t.student_id
      LEFT JOIN units u ON u.unit_id=t.target_start
      LEFT JOIN materials m ON m.material_id=u.material_id
      WHERE t.target_start IS NOT NULL AND t.target_start<>''
      GROUP BY t.student_id,t.subject,t.target_start,COALESCE(m.series,'FORESTA_STEP')
    ), targets AS (
      SELECT student_id,subject,COUNT(*) AS target_count FROM eff WHERE included=1 GROUP BY student_id,subject
    ), completed AS (
      SELECT e.student_id,e.subject,COUNT(*) AS completed_count
      FROM eff e JOIN progress_records p ON p.student_id=e.student_id AND p.unit_id=e.unit_id AND p.subject=e.subject
      WHERE e.included=1 AND p.round BETWEEN 1 AND 3 AND p.try_completed=1
      GROUP BY e.student_id,e.subject
    )
    SELECT 'LEGACY' AS source,w.student_id,w.display_name,sub.subject,
           COALESCE(c.completed_count,0) AS completed_count,COALESCE(t.target_count,0) AS target_count
    FROM wanted w CROSS JOIN (SELECT '英語' subject UNION ALL SELECT '数学' UNION ALL SELECT '国語' UNION ALL SELECT '理科' UNION ALL SELECT '社会') sub
    LEFT JOIN targets t ON t.student_id=w.student_id AND t.subject=sub.subject
    LEFT JOIN completed c ON c.student_id=w.student_id AND c.subject=sub.subject
    ORDER BY w.display_name,sub.subject`).all();

  const count = await env.DB.prepare(`SELECT COUNT(*) AS count FROM v3_target_overrides`).first<Row>();
  return json({ ok: true, overrides: [{ target_override_count: Number(count?.count || 0) }], snapshot: [...current.results, ...legacy.results] });
};

const publicStatus = async (env: SmokeEnv) => {
  const [meta, targetOverrides, homeworkOverrides, archives, sessions] = await env.DB.batch([
    env.DB.prepare(`SELECT value FROM v3_meta WHERE key='final_snapshot_at'`),
    env.DB.prepare(`SELECT COUNT(*) AS count FROM v3_target_overrides`),
    env.DB.prepare(`SELECT COUNT(*) AS count FROM v3_homework_overrides`),
    env.DB.prepare(`SELECT COUNT(*) AS count FROM v3_homework_group_archives`),
    env.DB.prepare(`SELECT COUNT(*) AS count FROM v3_sessions`),
  ]);
  const count = (result: D1Result<unknown>) => Number((result.results[0] as Row | undefined)?.count || 0);
  return json({
    ok: true,
    finalSnapshotAt: text((meta.results[0] as Row | undefined)?.value),
    targetOverrideCount: count(targetOverrides),
    homeworkOverrideCount: count(homeworkOverrides),
    archiveOverrideCount: count(archives),
    sessionCount: count(sessions),
  });
};

const finalize = async (env: SmokeEnv) => {
  const started = performance.now();
  const snapshotAt = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM v3_progress_records`),
    env.DB.prepare(`INSERT INTO v3_progress_records(record_id,student_id,material_id,subject,grade,unit_id,round,point_confirmed,warmup_confirmed,try_completed,memorization_completed,exercise_completed,lct_result,learning_date,updated_at,updated_by,version,request_id)
      SELECT record_id,student_id,material_id,subject,grade,unit_id,round,point_confirmed,warmup_confirmed,try_completed,memorization_completed,exercise_completed,lct_result,learning_date,updated_at,updated_by,version,request_id FROM progress_records`),
    env.DB.prepare(`DELETE FROM v3_target_snapshot`),
    env.DB.prepare(`INSERT INTO v3_target_snapshot(target_id,student_id,material_id,subject,target_start,target_end,target_period,included,updated_at,updated_by,version)
      SELECT target_id,student_id,material_id,subject,target_start,target_end,target_period,included,updated_at,updated_by,version FROM student_targets`),
    env.DB.prepare(`DELETE FROM v3_homework_snapshot`),
    env.DB.prepare(`INSERT INTO v3_homework_snapshot(homework_id,student_id,material_id,subject,unit_id,assigned_date,due_date,completed_date,correction_date,review_date,archived_at,restored_at,status,updated_at,updated_by,version,request_id)
      SELECT homework_id,student_id,material_id,subject,unit_id,assigned_date,due_date,completed_date,correction_date,review_date,archived_at,restored_at,status,updated_at,updated_by,version,request_id FROM homework_records`),
    env.DB.prepare(`DELETE FROM v3_target_overrides`),
    env.DB.prepare(`DELETE FROM v3_homework_overrides`),
    env.DB.prepare(`DELETE FROM v3_homework_group_archives`),
    env.DB.prepare(`DELETE FROM v3_sessions`),
    env.DB.prepare(`INSERT INTO v3_meta(key,value,updated_at) VALUES('bootstrap_complete','1',datetime('now')) ON CONFLICT(key) DO UPDATE SET value='1',updated_at=datetime('now')`),
    env.DB.prepare(`INSERT INTO v3_meta(key,value,updated_at) VALUES('final_snapshot_at',?,datetime('now')) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=datetime('now')`).bind(snapshotAt),
  ]);
  const [students, progress, targets, homework] = await env.DB.batch([
    env.DB.prepare(`SELECT COUNT(*) AS count FROM students`),
    env.DB.prepare(`SELECT COUNT(*) AS count FROM v3_progress_records`),
    env.DB.prepare(`SELECT COUNT(*) AS count FROM v3_target_snapshot`),
    env.DB.prepare(`SELECT COUNT(*) AS count FROM v3_homework_snapshot`),
  ]);
  const count = (result: D1Result<unknown>) => Number((result.results[0] as Row | undefined)?.count || 0);
  return json({
    ok: true,
    finalSnapshotAt: snapshotAt,
    studentCount: count(students),
    progressCount: count(progress),
    targetCount: count(targets),
    homeworkCount: count(homework),
    elapsedMs: Math.round(performance.now() - started),
  });
};

export default {
  async fetch(request: Request, env: SmokeEnv): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/status") return publicStatus(env);
    if (!authorized(request, env)) return json({ error: "NOT_FOUND" }, 404);
    if (request.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);
    const value: unknown = await request.json().catch(() => null);
    if (!isRow(value)) return json({ error: "INVALID_JSON" }, 400);
    const action = text(value.action);
    if (action === "prepare") return prepare(env);
    if (action === "inspect") return inspect(env, value);
    if (action === "inspectRecent1320") return inspectRecent1320(env);
    if (action === "finalize") return finalize(env);
    return json({ error: "NOT_FOUND" }, 404);
  },
} satisfies ExportedHandler<SmokeEnv>;
