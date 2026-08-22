import { buildV83Dashboard } from "./dashboard.ts";

type Row = Record<string, unknown>;
type V3Env = Env & { GOOGLE_API_URL: string };
type Session = { userId: string; role: string; expiresAt: string; profile: Row };

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
} as const;

const json = (value: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(value), { status, headers: { ...JSON_HEADERS, ...headers } });
const isRow = (value: unknown): value is Row => typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown) => String(value ?? "").trim();
const bool = (value: unknown) => value === true || value === 1 || text(value).toLowerCase() === "true";
const jstDate = () => new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
const elapsed = (started: number) => Math.round(performance.now() - started);

const parseBody = async (request: Request) => {
  const length = Number(request.headers.get("content-length") || "0");
  if (length > 65_536) throw new Error("PAYLOAD_TOO_LARGE");
  const value: unknown = await request.json();
  if (!isRow(value)) throw new Error("INVALID_JSON");
  return value;
};

const tokenHash = async (token: string) => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
};

const proxyGoogle = async (env: V3Env, body: Row) => fetch(env.GOOGLE_API_URL, {
  method: "POST",
  headers: { "content-type": "text/plain;charset=utf-8" },
  body: JSON.stringify(body),
  redirect: "follow",
});

const readJson = async (response: Response): Promise<Row | null> => {
  const value: unknown = await response.clone().json().catch(() => null);
  return isRow(value) ? value : null;
};

const cacheSession = async (env: V3Env, token: string, value: Row, fallbackUserId = "") => {
  if (!token) return;
  const profile = isRow(value.profile) ? value.profile : {};
  const role = text(value.role).toUpperCase();
  const userId = text(value.userId || profile.studentId || profile.id || fallbackUserId);
  if (!role || !userId) return;
  const parsedExpiry = Date.parse(text(value.expiresAt));
  const expiresAt = Number.isFinite(parsedExpiry) && parsedExpiry > Date.now()
    ? new Date(parsedExpiry).toISOString()
    : new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString();
  await env.DB.prepare(
    `INSERT INTO v3_sessions(token_hash,user_id,role,profile_json,expires_at,created_at,last_seen_at)
     VALUES(?,?,?,?,datetime(?),datetime('now'),datetime('now'))
     ON CONFLICT(token_hash) DO UPDATE SET
       user_id=excluded.user_id, role=excluded.role, profile_json=excluded.profile_json,
       expires_at=excluded.expires_at, last_seen_at=datetime('now')`
  ).bind(await tokenHash(token), userId, role, JSON.stringify(profile), expiresAt).run();
};

const localSession = async (env: V3Env, token: string): Promise<Session | null> => {
  if (!token) return null;
  const row = await env.DB.prepare(
    `SELECT user_id,role,profile_json,expires_at FROM v3_sessions
     WHERE token_hash=? AND expires_at>datetime('now')`
  ).bind(await tokenHash(token)).first<{ user_id: string; role: string; profile_json: string; expires_at: string }>();
  if (!row) return null;
  env.DB.prepare("UPDATE v3_sessions SET last_seen_at=datetime('now') WHERE token_hash=?")
    .bind(await tokenHash(token)).run().catch(() => undefined);
  let profile: Row = {};
  try { const parsed: unknown = JSON.parse(row.profile_json || "{}"); if (isRow(parsed)) profile = parsed; } catch {}
  return {
    userId: text(row.user_id),
    role: text(row.role).toUpperCase(),
    profile,
    expiresAt: row.expires_at ? row.expires_at.replace(" ", "T") + "Z" : "",
  };
};

const resolveSession = async (env: V3Env, token: string): Promise<Session | null> => {
  const cached = await localSession(env, token);
  if (cached) return cached;
  if (!token) return null;
  const response = await proxyGoogle(env, { action: "getSession", token });
  const value = await readJson(response);
  if (!value || value.success !== true) return null;
  await cacheSession(env, token, value);
  return localSession(env, token);
};

const requestedStudentId = (session: Session, requested = "") => {
  const wanted = text(requested);
  if (session.role === "STUDENT") return wanted && wanted !== session.userId ? "" : session.userId;
  if (["ADMIN", "TEACHER"].includes(session.role)) return wanted;
  return "";
};

const readDashboardV3 = async (env: V3Env, studentId: string) => {
  const statements = [
    env.DB.prepare(`SELECT s.student_id,s.display_name,p.campus,s.school,s.grade,s.status
      FROM students s LEFT JOIN student_profiles p ON p.student_id=s.student_id WHERE s.student_id=?`).bind(studentId),
    env.DB.prepare(`SELECT t.target_id,t.material_id,t.subject,t.target_start AS unit_id,t.target_end,t.target_period,t.included,
      t.updated_at,t.version,u.unit_order,u.unit_type,u.title AS unit_title,u.has_lct,m.series
      FROM student_targets t LEFT JOIN units u ON u.unit_id=t.target_start LEFT JOIN materials m ON m.material_id=u.material_id
      WHERE t.student_id=? ORDER BY t.subject,u.unit_order,t.target_id`).bind(studentId),
    env.DB.prepare(`SELECT p.record_id,p.material_id,p.subject,p.grade,p.unit_id,p.round,p.point_confirmed,p.warmup_confirmed,
      p.try_completed,p.memorization_completed,p.exercise_completed,p.lct_result,p.learning_date,p.updated_at,p.version,
      u.title AS unit_title,u.unit_order
      FROM progress_records p LEFT JOIN units u ON u.unit_id=p.unit_id WHERE p.student_id=?
      ORDER BY p.subject,u.unit_order,p.round`).bind(studentId),
    env.DB.prepare(`SELECT h.homework_id,h.material_id,h.subject,h.unit_id,h.assigned_date,h.due_date,h.completed_date,
      h.correction_date,h.review_date,h.archived_at,h.restored_at,h.status,h.updated_at,h.version,
      u.title AS unit_title,u.unit_order
      FROM homework_records h LEFT JOIN units u ON u.unit_id=h.unit_id WHERE h.student_id=? ORDER BY h.updated_at DESC`).bind(studentId),
    env.DB.prepare(`SELECT student_id,series,subject,unit_id,included FROM v3_target_overrides WHERE student_id=?`).bind(studentId),
  ];
  const [studentResult, targetResult, progressResult, homeworkResult, overrideResult] = await env.DB.batch(statements);
  const student = studentResult.results[0] as Row | undefined;
  if (!student) return null;

  const targets = targetResult.results.filter(isRow).map((row) => ({ ...row }));
  const targetByKey = new Map(targets.map((row) => [`${text(row.series)}|${text(row.subject)}|${text(row.unit_id)}`, row]));
  for (const override of overrideResult.results.filter(isRow)) {
    const key = `${text(override.series)}|${text(override.subject)}|${text(override.unit_id)}`;
    const current = targetByKey.get(key);
    if (current) current.included = bool(override.included) ? 1 : 0;
    else {
      const synthetic: Row = {
        target_id: `V3:${studentId}:${text(override.series)}:${text(override.unit_id)}`,
        material_id: "",
        subject: text(override.subject),
        unit_id: text(override.unit_id),
        target_start: text(override.unit_id),
        target_end: text(override.unit_id),
        target_period: "V3_OVERRIDE",
        included: bool(override.included) ? 1 : 0,
        series: text(override.series),
      };
      targets.push(synthetic);
      targetByKey.set(key, synthetic);
    }
  }

  const selectableResult = await env.DB.prepare(
    `SELECT u.unit_id,u.subject,u.grade,u.unit_order,u.unit_type,u.title AS unit_title,u.has_lct,m.series,m.active
     FROM units u JOIN materials m ON m.material_id=u.material_id
     WHERE m.active=1 AND (u.grade='' OR u.grade=? OR u.grade='中1～中3共通' OR m.grade='' OR m.grade=? OR m.grade='中1～中3共通')
     ORDER BY u.subject,m.series,u.unit_order,u.unit_id`
  ).bind(text(student.grade), text(student.grade)).all();

  return buildV83Dashboard(
    student,
    targets,
    progressResult.results.filter(isRow),
    homeworkResult.results.filter(isRow),
    selectableResult.results.filter(isRow),
  );
};

const browserProgress = (row: Row) => ({
  unitId: text(row.unit_id),
  roundNumber: Number(row.round) || 1,
  lctResult: text(row.lct_result),
  pointConfirmed: bool(row.point_confirmed),
  warmupConfirmed: bool(row.warmup_confirmed),
  tryCompleted: bool(row.try_completed),
  learningDate: text(row.learning_date).slice(0, 10),
});

const saveProgressBatch = async (env: V3Env, session: Session, body: Row, ctx: ExecutionContext) => {
  const started = performance.now();
  const rawChanges = Array.isArray(body.changes) ? body.changes.filter(isRow).slice(0, 100) : [];
  if (!rawChanges.length) return json({ success: false, error: "変更内容がありません。" }, 400);

  const prepared = rawChanges.map((change) => {
    const studentId = requestedStudentId(session, text(change.studentId || body.studentId));
    return {
      source: change,
      studentId,
      unitId: text(change.unitId),
      round: Math.min(3, Math.max(1, Number(change.roundNumber) || 1)),
      lctResult: text(change.lctResult),
      point: bool(change.pointConfirmed),
      warmup: bool(change.warmupConfirmed),
      tried: bool(change.tryCompleted),
      mutationId: text(change.clientMutationId) || crypto.randomUUID(),
      revision: Number(change.clientRevision) || 0,
    };
  });
  if (prepared.some((item) => !item.studentId || !item.unitId)) return json({ success: false, error: "保存対象を特定できません。" }, 403);

  const unitResults = await env.DB.batch(prepared.map((item) => env.DB.prepare(
    "SELECT unit_id,material_id,subject,grade FROM units WHERE unit_id=?"
  ).bind(item.unitId)));

  const valid = prepared.map((item, index) => ({ item, unit: unitResults[index].results[0] as Row | undefined }));
  const writes = valid.filter((entry) => entry.unit).map(({ item, unit }) => {
    const learningDate = item.point || item.warmup || item.tried ? jstDate() : null;
    return env.DB.prepare(
      `INSERT INTO progress_records(record_id,student_id,material_id,subject,grade,unit_id,round,point_confirmed,warmup_confirmed,try_completed,lct_result,learning_date,updated_at,updated_by,version,request_id)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'),?,1,?)
       ON CONFLICT(student_id,unit_id,round) DO UPDATE SET
         material_id=excluded.material_id,subject=excluded.subject,grade=excluded.grade,
         point_confirmed=excluded.point_confirmed,warmup_confirmed=excluded.warmup_confirmed,try_completed=excluded.try_completed,
         lct_result=excluded.lct_result,
         learning_date=CASE WHEN excluded.learning_date IS NOT NULL THEN COALESCE(progress_records.learning_date,excluded.learning_date) ELSE progress_records.learning_date END,
         updated_at=datetime('now'),updated_by=excluded.updated_by,version=progress_records.version+1,request_id=excluded.request_id`
    ).bind(
      `V3P:${item.studentId}:${item.unitId}:${item.round}`,
      item.studentId,
      text(unit?.material_id),
      text(unit?.subject),
      text(unit?.grade),
      item.unitId,
      item.round,
      item.point ? 1 : 0,
      item.warmup ? 1 : 0,
      item.tried ? 1 : 0,
      item.lctResult,
      learningDate,
      session.userId,
      item.mutationId,
    );
  });
  if (writes.length) await env.DB.batch(writes);

  const reads = await env.DB.batch(prepared.map((item) => env.DB.prepare(
    `SELECT unit_id,round,lct_result,point_confirmed,warmup_confirmed,try_completed,learning_date
     FROM progress_records WHERE student_id=? AND unit_id=? AND round=?`
  ).bind(item.studentId, item.unitId, item.round)));

  const results = prepared.map((item, index) => {
    const row = reads[index].results[0] as Row | undefined;
    return row ? {
      success: true,
      clientMutationId: item.mutationId,
      clientRevision: item.revision,
      progress: browserProgress(row),
    } : {
      success: false,
      clientMutationId: item.mutationId,
      clientRevision: item.revision,
      error: "単元が見つかりません。",
    };
  });

  ctx.waitUntil(proxyGoogle(env, body).then((response) => response.arrayBuffer()).then(() => undefined).catch(() => undefined));
  return json({ success: true, results, elapsedMs: elapsed(started), source: "D1_V3" }, 200, { "x-data-source": "cloudflare-d1-v3" });
};

const saveTargetChanges = async (env: V3Env, session: Session, body: Row, ctx: ExecutionContext) => {
  const started = performance.now();
  const studentId = requestedStudentId(session, text(body.studentId));
  const subject = text(body.subject);
  const series = text(body.series) || "FORESTA_STEP";
  const changes = Array.isArray(body.changes) ? body.changes.filter(isRow).slice(0, 500) : [];
  if (!studentId || !subject || !changes.length) return json({ success: false, error: "目標範囲を特定できません。" }, 400);

  await env.DB.batch(changes.map((change) => env.DB.prepare(
    `INSERT INTO v3_target_overrides(student_id,series,subject,unit_id,included,updated_at,updated_by)
     VALUES(?,?,?,?,?,datetime('now'),?)
     ON CONFLICT(student_id,series,subject,unit_id) DO UPDATE SET
       included=excluded.included,updated_at=datetime('now'),updated_by=excluded.updated_by`
  ).bind(studentId, series, subject, text(change.unitId), bool(change.selected) ? 1 : 0, session.userId)));

  const dashboard = await readDashboardV3(env, studentId);
  const selectable = dashboard && Array.isArray((dashboard as Row).selectableUnits)
    ? ((dashboard as Row).selectableUnits as unknown[]).filter(isRow)
    : [];
  const targetCount = selectable.filter((unit) => text(unit.subject) === subject && text(unit.series) === series && bool(unit.targetIncluded)).length;
  ctx.waitUntil(proxyGoogle(env, body).then((response) => response.arrayBuffer()).then(() => undefined).catch(() => undefined));
  return json({ success: true, targetCount, clientRevision: Number(body.clientRevision) || 0, elapsedMs: elapsed(started), source: "D1_V3" }, 200, { "x-data-source": "cloudflare-d1-v3" });
};

const homeworkStudentIds = async (env: V3Env, session: Session, ids: string[]) => {
  if (session.role === "STUDENT") return new Map(ids.map((id) => [id, session.userId]));
  const results = await env.DB.batch(ids.map((id) => env.DB.prepare(
    "SELECT student_id FROM homework_records WHERE homework_id=?"
  ).bind(id)));
  return new Map(ids.map((id, index) => [id, text((results[index].results[0] as Row | undefined)?.student_id)]));
};

const saveHomeworkOverride = async (env: V3Env, session: Session, body: Row, action: string, ctx: ExecutionContext) => {
  const started = performance.now();
  const ids = action === "confirmHomeworkGroup"
    ? (Array.isArray(body.homeworkIds) ? body.homeworkIds.map(text).filter(Boolean).slice(0, 100) : [])
    : [text(body.homeworkId)].filter(Boolean);
  if (!ids.length) return json({ success: false, error: "宿題を特定できません。" }, 400);
  const byId = await homeworkStudentIds(env, session, ids);
  if (Array.from(byId.values()).some((studentId) => !studentId)) return json({ success: false, error: "宿題の生徒を特定できません。" }, 400);

  if (action === "declareHomework") {
    const status = text(body.studentStatus) || "UNINPUT";
    const completedDate = status === "DECLARED_DONE" ? jstDate() : null;
    await env.DB.batch(ids.map((homeworkId) => env.DB.prepare(
      `INSERT INTO v3_homework_overrides(student_id,homework_id,student_status,student_completed_date,updated_at,updated_by)
       VALUES(?,?,?,?,datetime('now'),?)
       ON CONFLICT(student_id,homework_id) DO UPDATE SET
         student_status=excluded.student_status,student_completed_date=excluded.student_completed_date,
         updated_at=datetime('now'),updated_by=excluded.updated_by`
    ).bind(byId.get(homeworkId), homeworkId, status, completedDate, session.userId)));
  } else {
    const teacherStatus = action === "confirmHomeworkGroup" ? "VERIFIED" : (text(body.teacherStatus) || "VERIFIED");
    const memo = text(body.confirmationMemo).slice(0, 500);
    await env.DB.batch(ids.map((homeworkId) => env.DB.prepare(
      `INSERT INTO v3_homework_overrides(student_id,homework_id,teacher_status,confirmation_memo,updated_at,updated_by)
       VALUES(?,?,?,?,datetime('now'),?)
       ON CONFLICT(student_id,homework_id) DO UPDATE SET
         teacher_status=excluded.teacher_status,confirmation_memo=excluded.confirmation_memo,
         updated_at=datetime('now'),updated_by=excluded.updated_by`
    ).bind(byId.get(homeworkId), homeworkId, teacherStatus, memo, session.userId)));
  }

  ctx.waitUntil(proxyGoogle(env, body).then((response) => response.arrayBuffer()).then(() => undefined).catch(() => undefined));
  return json({ success: true, elapsedMs: elapsed(started), source: "D1_V3" }, 200, { "x-data-source": "cloudflare-d1-v3" });
};

const overlayHomework = (value: Row, overrides: Row[]) => {
  const byId = new Map(overrides.map((row) => [text(row.homework_id), row]));
  const patchItem = (item: unknown) => {
    if (!isRow(item)) return item;
    const override = byId.get(text(item.homeworkId));
    if (!override) return item;
    const patched: Row = { ...item };
    if (override.student_status !== null && override.student_status !== undefined) patched.studentStatus = text(override.student_status);
    if (override.student_completed_date !== null && override.student_completed_date !== undefined) patched.studentCompletedDate = text(override.student_completed_date);
    if (override.teacher_status !== null && override.teacher_status !== undefined) patched.teacherStatus = text(override.teacher_status);
    if (override.confirmation_memo !== null && override.confirmation_memo !== undefined) patched.confirmationMemo = text(override.confirmation_memo);
    return patched;
  };
  const out: Row = { ...value };
  if (Array.isArray(value.homework)) out.homework = value.homework.map(patchItem);
  if (Array.isArray(value.groups)) out.groups = value.groups.map((group) => {
    if (!isRow(group)) return group;
    return { ...group, items: Array.isArray(group.items) ? group.items.map(patchItem) : group.items };
  });
  return out;
};

const listHomeworkV3 = async (env: V3Env, body: Row) => {
  const upstream = await proxyGoogle(env, body);
  const value = await readJson(upstream);
  if (!value || value.success !== true) return upstream;
  const session = await resolveSession(env, text(body.token));
  if (!session) return upstream;
  const filters = isRow(body.filters) ? body.filters : {};
  const studentId = requestedStudentId(session, text(filters.studentId || body.studentId));
  if (!studentId) return upstream;
  const [overrideResult, archiveResult] = await env.DB.batch([
    env.DB.prepare(`SELECT homework_id,student_status,student_completed_date,teacher_status,confirmation_memo
      FROM v3_homework_overrides WHERE student_id=?`).bind(studentId),
    env.DB.prepare("SELECT group_key FROM homework_group_archives WHERE student_id=? AND archived=1").bind(studentId),
  ]);
  const patched = overlayHomework(value, overrideResult.results.filter(isRow));
  patched.archivedGroupKeys = archiveResult.results.filter(isRow).map((row) => text(row.group_key));
  patched.source = "GOOGLE_STRUCTURE_D1_V3_STATE";
  return json(patched, upstream.status, { "x-data-source": "google-structure+d1-v3-state" });
};

const saveArchive = async (env: V3Env, session: Session, body: Row) => {
  const studentId = requestedStudentId(session, text(body.studentId));
  const groupKey = text(body.groupKey);
  if (!studentId || !groupKey || typeof body.archived !== "boolean") return json({ success: false, error: "アーカイブ対象を特定できません。" }, 400);
  await env.DB.prepare(
    `INSERT INTO homework_group_archives(student_id,group_key,archived,updated_at,updated_by)
     VALUES(?,?,?,datetime('now'),?)
     ON CONFLICT(student_id,group_key) DO UPDATE SET archived=excluded.archived,updated_at=datetime('now'),updated_by=excluded.updated_by`
  ).bind(studentId, groupKey, body.archived ? 1 : 0, session.userId).run();
  const rows = await env.DB.prepare("SELECT group_key FROM homework_group_archives WHERE student_id=? AND archived=1 ORDER BY updated_at DESC").bind(studentId).all();
  return json({ success: true, archivedGroupKeys: rows.results.filter(isRow).map((row) => text(row.group_key)) }, 200, { "x-data-source": "cloudflare-d1-v3" });
};

const handleApi = async (request: Request, env: V3Env, ctx: ExecutionContext) => {
  const body = await parseBody(request);
  const action = text(body.action);

  if (["studentLogin", "staffLogin"].includes(action)) {
    const upstream = await proxyGoogle(env, body);
    const value = await readJson(upstream);
    if (value?.success === true && text(value.token)) {
      await cacheSession(env, text(value.token), value, action === "studentLogin" ? text(body.studentId) : text(body.code));
    }
    return upstream;
  }

  const token = text(body.token);
  if (action === "getSession") {
    const session = await resolveSession(env, token);
    return session
      ? json({ success: true, userId: session.userId, role: session.role, profile: session.profile, expiresAt: session.expiresAt, source: "D1_V3_SESSION" })
      : json({ success: false, error: "セッションが切れました。もう一度ログインしてください。", code: "SESSION_EXPIRED" });
  }

  if (action === "logout") {
    if (token) await env.DB.prepare("DELETE FROM v3_sessions WHERE token_hash=?").bind(await tokenHash(token)).run();
    ctx.waitUntil(proxyGoogle(env, body).then((response) => response.arrayBuffer()).then(() => undefined).catch(() => undefined));
    return json({ success: true });
  }

  const session = await resolveSession(env, token);
  if (!session) return json({ success: false, error: "セッションが切れました。もう一度ログインしてください。", code: "SESSION_EXPIRED" });

  if (action === "getStudentDashboard") {
    const studentId = requestedStudentId(session, text(body.studentId));
    if (!studentId) return json({ success: false, error: "生徒を選択してください。" }, 403);
    const dashboard = await readDashboardV3(env, studentId);
    return dashboard
      ? json({ success: true, data: dashboard, source: "D1_V3" }, 200, { "x-data-source": "cloudflare-d1-v3" })
      : json({ success: false, error: "生徒データが見つかりません。" }, 404);
  }

  if (action === "saveStudentProgressBatch") return saveProgressBatch(env, session, body, ctx);
  if (action === "setOwnTargetChanges") return saveTargetChanges(env, session, body, ctx);
  if (["declareHomework", "confirmHomework", "confirmHomeworkGroup"].includes(action)) return saveHomeworkOverride(env, session, body, action, ctx);
  if (action === "setHomeworkGroupArchived") return saveArchive(env, session, body);
  if (action === "listHomework") return listHomeworkV3(env, body);

  return proxyGoogle(env, body);
};

export default {
  async fetch(request: Request, env: V3Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    try {
      if (url.pathname === "/health" && request.method === "GET") {
        const count = await env.DB.prepare("SELECT COUNT(*) AS count FROM students").first<{ count: number }>();
        return json({ ok: true, service: "step-progress-v3-staging", mode: "d1-first-autosave", studentCount: Number(count?.count || 0) });
      }
      if (url.pathname === "/api" && request.method === "POST") return handleApi(request, env, ctx);
      return json({ error: "NOT_FOUND" }, 404);
    } catch (error) {
      const message = error instanceof Error ? error.message : "UNKNOWN_ERROR";
      console.error(JSON.stringify({ event: "v3_request_error", path: url.pathname, message }));
      if (message === "PAYLOAD_TOO_LARGE") return json({ success: false, error: "送信量が大きすぎます。" }, 413);
      if (message.startsWith("INVALID_")) return json({ success: false, error: message }, 400);
      return json({ success: false, error: "保存処理でエラーが発生しました。", detail: message }, 500);
    }
  },
} satisfies ExportedHandler<V3Env>;
