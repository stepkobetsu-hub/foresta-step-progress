import { buildDashboardSummary } from "./summary.ts";

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
} as const;

const json = (value: unknown, status = 200, extraHeaders: Record<string, string> = {}) =>
  new Response(JSON.stringify(value), { status, headers: { ...JSON_HEADERS, ...extraHeaders } });

type Trace = { startedAt: number; arrivalEpochMs: number; spans: Record<string, number> };
const createTrace = (): Trace => ({ startedAt: performance.now(), arrivalEpochMs: Date.now(), spans: {} });
const measured = async <T>(trace: Trace, name: string, work: () => Promise<T>): Promise<T> => {
  const startedAt = performance.now();
  try { return await work(); }
  finally { trace.spans[name] = Number((performance.now() - startedAt).toFixed(3)); }
};
const withTrace = (response: Response, trace: Trace) => {
  const totalMs = Number((performance.now() - trace.startedAt).toFixed(3));
  const timing = { ...trace.spans, workerTotal: totalMs };
  const headers = new Headers(response.headers);
  headers.set("server-timing", Object.entries(timing).map(([name, duration]) => `${name};dur=${duration}`).join(", "));
  headers.set("x-worker-arrival", String(trace.arrivalEpochMs));
  headers.set("x-worker-timing", JSON.stringify(timing));
  headers.set("timing-allow-origin", "*");
  headers.set("access-control-expose-headers", "server-timing,x-worker-arrival,x-worker-timing");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
};

const constantTimeTokenEqual = async (left: string, right: string) => {
  const encoder = new TextEncoder();
  const [leftHash, rightHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(left)),
    crypto.subtle.digest("SHA-256", encoder.encode(right)),
  ]);
  const leftBytes = new Uint8Array(leftHash);
  const rightBytes = new Uint8Array(rightHash);
  let difference = leftBytes.length ^ rightBytes.length;
  for (let index = 0; index < leftBytes.length; index += 1) difference |= leftBytes[index] ^ rightBytes[index];
  return difference === 0;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const parseBody = async (request: Request) => {
  const length = Number(request.headers.get("content-length") || "0");
  if (length > 16_384) throw new Error("PAYLOAD_TOO_LARGE");
  const value: unknown = await request.json();
  if (!isRecord(value)) throw new Error("INVALID_JSON");
  return value;
};

const disabled = (env: Env) =>
  String(env.EMERGENCY_STOP) === "true" || String(env.MIRROR_READ_ENABLED) !== "true";

const authorize = async (request: Request, env: Env) => {
  const expectedToken = env.MIRROR_COMPARE_TOKEN || "";
  const suppliedToken = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  return Boolean(expectedToken) && constantTimeTokenEqual(suppliedToken, expectedToken);
};

const querySet = (studentId: string) => ({
  student: envSql("SELECT s.student_id, s.display_name, p.campus, s.school, s.grade, s.status, s.source_updated_at, s.updated_at, s.version FROM students s LEFT JOIN student_profiles p ON p.student_id = s.student_id WHERE s.student_id = ?", studentId),
  materials: envSql("SELECT DISTINCT m.material_id, m.series, m.subject, m.grade, m.title, m.has_lct, m.active, m.updated_at, m.version FROM materials m JOIN student_targets t ON t.material_id = m.material_id WHERE t.student_id = ? AND t.included = 1 ORDER BY m.subject, m.material_id", studentId),
  targets: envSql("SELECT t.target_id, t.material_id, t.subject, t.target_start AS unit_id, t.target_end, t.target_period, t.included, t.updated_at, t.version, u.unit_order, u.unit_type, u.title AS unit_title, u.has_lct, m.series FROM student_targets t LEFT JOIN units u ON u.unit_id = t.target_start LEFT JOIN materials m ON m.material_id = u.material_id WHERE t.student_id = ? ORDER BY t.subject, u.unit_order, t.target_id", studentId),
  progress: envSql("SELECT p.record_id, p.material_id, p.subject, p.grade, p.unit_id, p.round, p.point_confirmed, p.warmup_confirmed, p.try_completed, p.memorization_completed, p.exercise_completed, p.lct_result, p.learning_date, p.updated_at, p.version, u.title AS unit_title, u.unit_order FROM progress_records p LEFT JOIN units u ON u.unit_id = p.unit_id WHERE p.student_id = ? ORDER BY p.subject, u.unit_order, p.round", studentId),
  homework: envSql("SELECT h.homework_id, h.material_id, h.subject, h.unit_id, h.assigned_date, h.due_date, h.completed_date, h.correction_date, h.review_date, h.archived_at, h.restored_at, h.status, h.updated_at, h.version, u.title AS unit_title, u.unit_order, CASE WHEN EXISTS (SELECT 1 FROM homework_archives a WHERE a.homework_id = h.homework_id AND a.student_id = h.student_id AND a.restored_at IS NULL) THEN 1 ELSE 0 END AS is_archived FROM homework_records h LEFT JOIN units u ON u.unit_id = h.unit_id WHERE h.student_id = ? ORDER BY h.updated_at DESC, h.homework_id", studentId),
});

type BoundSql = { sql: string; value: string };
const envSql = (sql: string, value: string): BoundSql => ({ sql, value });
type Resource = "materials" | "targets" | "progress" | "homework";

const runList = async (env: Env, bound: BoundSql) => {
  const startedAt = performance.now();
  const result = await env.DB.prepare(bound.sql).bind(bound.value).all();
  return { rows: result.results, durationMs: Number((performance.now() - startedAt).toFixed(3)) };
};

const readBundle = async (env: Env, studentId: string) => {
  const startedAt = performance.now();
  const q = querySet(studentId);
  const statements = [
    env.DB.prepare(q.student.sql).bind(studentId),
    env.DB.prepare(q.materials.sql).bind(studentId),
    env.DB.prepare(q.targets.sql).bind(studentId),
    env.DB.prepare(q.progress.sql).bind(studentId),
    env.DB.prepare(q.homework.sql).bind(studentId),
  ];
  const batchStartedAt = performance.now();
  const [studentResult, materialsResult, targetsResult, progressResult, homeworkResult] = await env.DB.batch(statements);
  const d1QueryMs = Number((performance.now() - batchStartedAt).toFixed(3));
  const student = studentResult.results[0];
  if (!student) return null;
  const materials = materialsResult.results.filter(isRecord);
  const targets = targetsResult.results.filter(isRecord);
  const progress = progressResult.results.filter(isRecord);
  const homework = homeworkResult.results.filter(isRecord);
  return {
    student,
    materials,
    targets,
    progress,
    homework,
    summary: buildDashboardSummary(targets, progress, homework),
    timing: { d1QueryMs, totalMs: Number((performance.now() - startedAt).toFixed(3)) },
    source: "cloudflare-d1-phase3-test-write",
  };
};

const writeDenied = (env: Env, studentId: string) =>
  String(env.TEST_WRITE_APPROVED) !== "true" || studentId !== env.TEST_STUDENT_ID;

const replayStatement = (env: Env, requestId: string, entityType: string, entityId: string) =>
  env.DB.prepare("SELECT operation_id FROM operation_logs WHERE request_id = ? AND entity_type = ? AND entity_id = ? AND outcome = 'SUCCESS'")
    .bind(requestId, entityType, entityId);

const operationStatement = (env: Env, requestId: string, action: string, entityType: string, entityId: string, detail: Record<string, unknown>, guardSql: string, guardValues: unknown[]) =>
  env.DB.prepare(
    `INSERT OR IGNORE INTO operation_logs (operation_id, request_id, actor_id, actor_role, action, entity_type, entity_id, outcome, detail_json, created_at)
     SELECT ?, ?, ?, 'TEST_STUDENT', ?, ?, ?, 'SUCCESS', ?, datetime('now') WHERE ${guardSql}`
  ).bind(crypto.randomUUID(), requestId, env.TEST_STUDENT_ID, action, entityType, entityId, JSON.stringify(detail), ...guardValues);

const d1Durations = (results: D1Result<unknown>[]) => results.map((result) => Number(result.meta.duration || 0));

const mutationFields = (body: Record<string, unknown>) => {
  const expectedVersion = Number(body.expectedVersion);
  const requestId = String(body.requestId || "").trim();
  if (!Number.isInteger(expectedVersion) || expectedVersion < 1 || !/^[A-Za-z0-9:_-]{8,128}$/.test(requestId)) {
    throw new Error("INVALID_MUTATION_METADATA");
  }
  return { expectedVersion, requestId };
};

const progressRow = (env: Env, studentId: string, recordId: string) =>
  env.DB.prepare("SELECT record_id, student_id, unit_id, round, point_confirmed, warmup_confirmed, try_completed, lct_result, learning_date, updated_at, version FROM progress_records WHERE student_id = ? AND record_id = ?").bind(studentId, recordId).first();

const homeworkRow = (env: Env, studentId: string, homeworkId: string) =>
  env.DB.prepare("SELECT homework_id, student_id, unit_id, assigned_date, due_date, completed_date, archived_at, restored_at, status, updated_at, version FROM homework_records WHERE student_id = ? AND homework_id = ?").bind(studentId, homeworkId).first();

const targetRow = (env: Env, studentId: string, targetId: string) =>
  env.DB.prepare("SELECT target_id, student_id, unit_id, included, updated_at, version FROM (SELECT target_id, student_id, target_start AS unit_id, included, updated_at, version FROM student_targets) WHERE student_id = ? AND target_id = ?").bind(studentId, targetId).first();

const conflictOrMissing = (current: Record<string, unknown> | null) =>
  current ? json({ error: "VERSION_CONFLICT", current }, 409) : json({ error: "NOT_FOUND" }, 404);

const handleProgressWrite = async (request: Request, env: Env, studentId: string, recordId: string, trace: Trace) => {
  const body = await measured(trace, "body", () => parseBody(request));
  const { expectedVersion, requestId } = mutationFields(body);
  const allowed = ["pointConfirmed", "warmupConfirmed", "tryCompleted"] as const;
  const values = allowed.map((key) => body[key]);
  if (values.every((value) => typeof value !== "boolean")) return json({ error: "NO_CHANGES" }, 400);
  const point = typeof body.pointConfirmed === "boolean" ? Number(body.pointConfirmed) : null;
  const warmup = typeof body.warmupConfirmed === "boolean" ? Number(body.warmupConfirmed) : null;
  const tried = typeof body.tryCompleted === "boolean" ? Number(body.tryCompleted) : null;
  const statements = [
    replayStatement(env, requestId, "progress", recordId),
    env.DB.prepare("UPDATE progress_records SET point_confirmed = COALESCE(?, point_confirmed), warmup_confirmed = COALESCE(?, warmup_confirmed), try_completed = COALESCE(?, try_completed), updated_at = datetime('now'), updated_by = ?, version = version + 1, request_id = ? WHERE student_id = ? AND record_id = ? AND version = ? AND request_id IS NOT ?")
      .bind(point, warmup, tried, studentId, requestId, studentId, recordId, expectedVersion, requestId),
    operationStatement(env, requestId, "SAVE_PROGRESS", "progress", recordId, { point, warmup, tried }, "EXISTS(SELECT 1 FROM progress_records WHERE student_id = ? AND record_id = ? AND request_id = ?)", [studentId, recordId, requestId]),
    env.DB.prepare("SELECT record_id, student_id, unit_id, round, point_confirmed, warmup_confirmed, try_completed, lct_result, learning_date, updated_at, version FROM progress_records WHERE student_id = ? AND record_id = ?").bind(studentId, recordId),
  ];
  const results = await measured(trace, "d1", () => env.DB.batch(statements));
  trace.spans.d1Replay = d1Durations(results)[0]; trace.spans.d1Update = d1Durations(results)[1]; trace.spans.d1Log = d1Durations(results)[2]; trace.spans.d1Read = d1Durations(results)[3];
  const current = (results[3].results[0] as Record<string, unknown> | undefined) || null;
  const replayed = results[0].results.length > 0;
  if (!replayed && results[1].meta.changes !== 1) return conflictOrMissing(current);
  return json({ ok: true, replayed, progress: current });
};

const handleHomeworkDates = async (request: Request, env: Env, studentId: string, homeworkId: string, trace: Trace) => {
  const body = await measured(trace, "body", () => parseBody(request));
  const { expectedVersion, requestId } = mutationFields(body);
  const dueDate = body.dueDate === null || typeof body.dueDate === "string" ? body.dueDate : undefined;
  const completedDate = body.completedDate === null || typeof body.completedDate === "string" ? body.completedDate : undefined;
  if (dueDate === undefined && completedDate === undefined) return json({ error: "NO_CHANGES" }, 400);
  const statements = [
    replayStatement(env, requestId, "homework", homeworkId),
    env.DB.prepare("UPDATE homework_records SET due_date = CASE WHEN ? = 1 THEN ? ELSE due_date END, completed_date = CASE WHEN ? = 1 THEN ? ELSE completed_date END, updated_at = datetime('now'), updated_by = ?, version = version + 1, request_id = ? WHERE student_id = ? AND homework_id = ? AND version = ? AND request_id IS NOT ?")
      .bind(Number(dueDate !== undefined), dueDate ?? null, Number(completedDate !== undefined), completedDate ?? null, studentId, requestId, studentId, homeworkId, expectedVersion, requestId),
    operationStatement(env, requestId, "SAVE_HOMEWORK_DATES", "homework", homeworkId, { dueDate, completedDate }, "EXISTS(SELECT 1 FROM homework_records WHERE student_id = ? AND homework_id = ? AND request_id = ?)", [studentId, homeworkId, requestId]),
    env.DB.prepare("SELECT homework_id, student_id, unit_id, assigned_date, due_date, completed_date, archived_at, restored_at, status, updated_at, version FROM homework_records WHERE student_id = ? AND homework_id = ?").bind(studentId, homeworkId),
  ];
  const results = await measured(trace, "d1", () => env.DB.batch(statements));
  trace.spans.d1Replay = d1Durations(results)[0]; trace.spans.d1Update = d1Durations(results)[1]; trace.spans.d1Log = d1Durations(results)[2]; trace.spans.d1Read = d1Durations(results)[3];
  const current = (results[3].results[0] as Record<string, unknown> | undefined) || null;
  const replayed = results[0].results.length > 0;
  if (!replayed && results[1].meta.changes !== 1) return conflictOrMissing(current);
  return json({ ok: true, replayed, homework: current });
};

const handleHomeworkArchive = async (request: Request, env: Env, studentId: string, homeworkId: string, restore: boolean, trace: Trace) => {
  const body = await measured(trace, "body", () => parseBody(request));
  const { expectedVersion, requestId } = mutationFields(body);
  const action = restore ? "RESTORE_HOMEWORK" : "ARCHIVE_HOMEWORK";
  const timestamp = new Date().toISOString();
  const sql = restore
    ? "UPDATE homework_records SET archived_at = NULL, restored_at = ?, updated_at = datetime('now'), updated_by = ?, version = version + 1, request_id = ? WHERE student_id = ? AND homework_id = ? AND version = ?"
    : "UPDATE homework_records SET archived_at = ?, restored_at = NULL, updated_at = datetime('now'), updated_by = ?, version = version + 1, request_id = ? WHERE student_id = ? AND homework_id = ? AND version = ?";
  const archiveStatement = restore
    ? env.DB.prepare("UPDATE homework_archives SET restored_at = ?, restored_by = ?, version = version + 1, request_id = ? WHERE homework_id = ? AND EXISTS(SELECT 1 FROM homework_records WHERE student_id = ? AND homework_id = ? AND request_id = ?)").bind(timestamp, studentId, requestId, homeworkId, studentId, homeworkId, requestId)
    : env.DB.prepare("INSERT INTO homework_archives (archive_id, homework_id, student_id, archived_at, archived_by, version, request_id) SELECT ?, ?, ?, ?, ?, 1, ? WHERE EXISTS(SELECT 1 FROM homework_records WHERE student_id = ? AND homework_id = ? AND request_id = ?) ON CONFLICT(archive_id) DO UPDATE SET archived_at=excluded.archived_at, restored_at=NULL, archived_by=excluded.archived_by, version=homework_archives.version+1, request_id=excluded.request_id").bind("ARCHIVE-"+homeworkId, homeworkId, studentId, timestamp, studentId, requestId, studentId, homeworkId, requestId);
  const statements = [
    replayStatement(env, requestId, "homework", homeworkId),
    env.DB.prepare(sql + " AND request_id IS NOT ?").bind(timestamp, studentId, requestId, studentId, homeworkId, expectedVersion, requestId),
    archiveStatement,
    operationStatement(env, requestId, action, "homework", homeworkId, { timestamp }, "EXISTS(SELECT 1 FROM homework_records WHERE student_id = ? AND homework_id = ? AND request_id = ?)", [studentId, homeworkId, requestId]),
    env.DB.prepare("SELECT homework_id, student_id, unit_id, assigned_date, due_date, completed_date, archived_at, restored_at, status, updated_at, version FROM homework_records WHERE student_id = ? AND homework_id = ?").bind(studentId, homeworkId),
  ];
  const results = await measured(trace, "d1", () => env.DB.batch(statements));
  const durations = d1Durations(results); trace.spans.d1Replay = durations[0]; trace.spans.d1Update = durations[1]; trace.spans.d1Archive = durations[2]; trace.spans.d1Log = durations[3]; trace.spans.d1Read = durations[4];
  const current = (results[4].results[0] as Record<string, unknown> | undefined) || null;
  const replayed = results[0].results.length > 0;
  if (!replayed && results[1].meta.changes !== 1) return conflictOrMissing(current);
  return json({ ok: true, replayed, homework: current });
};

const handleTargetWrite = async (request: Request, env: Env, studentId: string, targetId: string, trace: Trace) => {
  const body = await measured(trace, "body", () => parseBody(request));
  const { expectedVersion, requestId } = mutationFields(body);
  if (typeof body.included !== "boolean") return json({ error: "INVALID_INCLUDED" }, 400);
  const statements = [
    replayStatement(env, requestId, "target", targetId),
    env.DB.prepare("UPDATE student_targets SET included = ?, updated_at = datetime('now'), updated_by = ?, version = version + 1 WHERE student_id = ? AND target_id = ? AND version = ? AND NOT EXISTS(SELECT 1 FROM operation_logs WHERE request_id = ? AND entity_type = 'target' AND entity_id = ? AND outcome = 'SUCCESS')").bind(Number(body.included), studentId, studentId, targetId, expectedVersion, requestId, targetId),
    operationStatement(env, requestId, "SAVE_TARGET_RANGE", "target", targetId, { included: body.included }, "changes() = 1", []),
    env.DB.prepare("SELECT target_id, student_id, target_start AS unit_id, included, updated_at, version FROM student_targets WHERE student_id = ? AND target_id = ?").bind(studentId, targetId),
  ];
  const results = await measured(trace, "d1", () => env.DB.batch(statements));
  trace.spans.d1Replay = d1Durations(results)[0]; trace.spans.d1Update = d1Durations(results)[1]; trace.spans.d1Log = d1Durations(results)[2]; trace.spans.d1Read = d1Durations(results)[3];
  const current = (results[3].results[0] as Record<string, unknown> | undefined) || null;
  const replayed = results[0].results.length > 0;
  if (!replayed && results[1].meta.changes !== 1) return conflictOrMissing(current);
  return json({ ok: true, replayed, target: current });
};

const handleRead = async (env: Env, studentId: string, resource: Resource | "summary" | "bundle") => {
  if (resource === "bundle" || resource === "summary") {
    const bundle = await readBundle(env, studentId);
    if (!bundle) return json({ error: "STUDENT_NOT_FOUND" }, 404);
    if (resource === "summary") return json({ studentId, summary: bundle.summary, timing: bundle.timing, source: bundle.source });
    return json(bundle);
  }
  const q = querySet(studentId);
  const student = await env.DB.prepare(q.student.sql).bind(studentId).first();
  if (!student) return json({ error: "STUDENT_NOT_FOUND" }, 404);
  const result = await runList(env, q[resource]);
  return json({ studentId, [resource]: result.rows, timing: { d1QueryMs: result.durationMs }, source: "cloudflare-d1-phase3-test-write" });
};

type SyncQueueRow = {
  sync_id: string; student_id: string; operation_type: string; record_id: string;
  payload: string; request_id: string; attempt_count: number; status: string;
  google_status: string; google_version: number; google_updated_at: string | null;
  lock_token: string | null; locked_at: string | null; batch_id: string | null;
  test_run_id: string | null;
};

const syncOperation = (entity: string, action: string) => {
  if (entity === "progress") return "PROGRESS_SAVE";
  if (entity === "targets") return "TARGET_RANGE_SAVE";
  if (action === "dates") return "HOMEWORK_DATE_SAVE";
  if (action === "archive") return "HOMEWORK_ARCHIVE";
  return "HOMEWORK_RESTORE";
};

const syncRecordState = (operationType: string, payload: Record<string, unknown>) =>
  operationType === "HOMEWORK_ARCHIVE" ? "ARCHIVED" :
  operationType === "HOMEWORK_RESTORE" ? "ACTIVE" : String(payload.status || "ACTIVE");

type UpstreamErrorMeta = {
  code: string;
  httpStatus: number;
  contentType: string;
  urlCategory: string;
  redirected: boolean;
  responseMs: number;
  bodySummary: string;
};

class UpstreamResponseError extends Error {
  meta: UpstreamErrorMeta;
  constructor(meta: UpstreamErrorMeta) {
    super(meta.code);
    this.name = "UpstreamResponseError";
    this.meta = meta;
  }
}

const upstreamUrlCategory = (response: Response) => {
  try {
    const host = new URL(response.url).hostname;
    if (host === "script.google.com" || host === "script.googleusercontent.com") return "GOOGLE_APPS_SCRIPT";
    if (host.endsWith(".google.com") || host.endsWith(".googleusercontent.com")) return "GOOGLE_OTHER";
    return "OTHER";
  } catch { return "UNKNOWN"; }
};

const readUpstreamJson = async (response: Response, startedAt: number, allowRedirect: boolean) => {
  const contentType = response.headers.get("content-type") || "";
  const body = await response.text();
  const responseMs = Number((performance.now() - startedAt).toFixed(3));
  const redirected = response.redirected;
  const code = !response.ok ? "GOOGLE_HTTP_ERROR" :
    (!allowRedirect && redirected) ? "GOOGLE_UNEXPECTED_REDIRECT" :
    !contentType.toLowerCase().includes("application/json") ? "GOOGLE_NON_JSON_RESPONSE" : "";
  if (code) {
    throw new UpstreamResponseError({
      code,
      httpStatus: response.status,
      contentType: contentType.slice(0, 100),
      urlCategory: upstreamUrlCategory(response),
      redirected,
      responseMs,
      bodySummary: body.replace(/\s+/g, " ").slice(0, 200),
    });
  }
  try { return JSON.parse(body) as unknown; }
  catch {
    throw new UpstreamResponseError({
      code: "GOOGLE_INVALID_JSON",
      httpStatus: response.status,
      contentType: contentType.slice(0, 100),
      urlCategory: upstreamUrlCategory(response),
      redirected,
      responseMs,
      bodySummary: body.replace(/\s+/g, " ").slice(0, 200),
    });
  }
};

const postGoogleBatch = async (env: Env, batchId: string, rows: SyncQueueRow[]) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort("GOOGLE_TIMEOUT"), 30_000);
  try {
    const started = performance.now();
    const response = await fetch(env.GOOGLE_DUAL_WRITE_URL, {
      method: "POST",
      headers: { "content-type": "text/plain;charset=utf-8" },
      body: JSON.stringify({
        action: "batchWrite", token: env.GOOGLE_DUAL_WRITE_TOKEN, batchId,
        operations: rows.map((row) => ({
          syncId: row.sync_id, studentId: row.student_id, operationType: row.operation_type,
          recordId: row.record_id, payload: JSON.parse(row.payload), requestId: row.request_id,
          recordState: syncRecordState(row.operation_type, JSON.parse(row.payload)),
        })),
      }),
      signal: controller.signal,
    });
    const result: unknown = await readUpstreamJson(response, started, true);
    if (!isRecord(result) || result.serviceVersion !== "phase46-v2" || !Array.isArray(result.results)) {
      const code = isRecord(result) ? String(result.code || "GOOGLE_REJECTED") : "GOOGLE_INVALID_RESPONSE";
      throw new Error(code);
    }
    return result;
  } finally { clearTimeout(timeout); }
};

const postGoogleRead = async (env: Env, rows: SyncQueueRow[]) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort("GOOGLE_READ_TIMEOUT"), 30_000);
  try {
    const started = performance.now();
    const response = await fetch(env.GOOGLE_DUAL_WRITE_URL, {
      method: "POST", headers: { "content-type": "text/plain;charset=utf-8" }, signal: controller.signal,
      body: JSON.stringify({ action:"batchRead", token:env.GOOGLE_DUAL_WRITE_TOKEN,
        studentId:env.TEST_STUDENT_ID, requestIds:rows.map(row=>row.request_id) }),
    });
    const result: unknown = await readUpstreamJson(response,started,false);
    if (!isRecord(result) || result.serviceVersion !== "phase46-v2" || !Array.isArray(result.rows)) throw new Error("GOOGLE_READ_INVALID_VERSION");
    return result.rows.filter(isRecord);
  } finally { clearTimeout(timeout); }
};

const handleGoogleSchema = async (env: Env) => {
  const started=performance.now();
  const response=await fetch(env.GOOGLE_DUAL_WRITE_URL,{method:"POST",headers:{"content-type":"text/plain;charset=utf-8"},body:JSON.stringify({action:"schema",token:env.GOOGLE_DUAL_WRITE_TOKEN})});
  const result:unknown=await readUpstreamJson(response,started,false);
  const expected=["sync_id","student_id","operation_type","record_id","payload","request_id","attempt_count","last_error","next_retry_at","status","created_at","updated_at","version","record_state"];
  if(!isRecord(result)||result.serviceVersion!=="phase46-v2"||result.success!==true||Number(result.columnCount)!==14||!Array.isArray(result.headers)||!sameJson(result.headers,expected)||!Array.isArray(result.blanks)||result.blanks.length||!Array.isArray(result.duplicates)||result.duplicates.length||result.namesAndOrderMatch!==true) return json({ok:false,error:"SCHEMA_MISMATCH"},409);
  return json({ok:true,serviceVersion:result.serviceVersion,headers:result.headers});
};

const stable = (value: unknown): unknown => Array.isArray(value) ? value.map(stable) : isRecord(value)
  ? Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])])) : value;
const sameJson = (left: unknown,right: unknown) => JSON.stringify(stable(left))===JSON.stringify(stable(right));
const reconcileBatch = async (env: Env, rows: SyncQueueRow[]) => {
  const googleRows=await postGoogleRead(env,rows); const grouped=new Map<string,Record<string,unknown>[]>();
  for(const googleRow of googleRows){const key=String(googleRow.request_id||""); grouped.set(key,[...(grouped.get(key)||[]),googleRow]);}
  return rows.map(row=>{const matches=grouped.get(row.request_id)||[]; const google=matches[0]; const payload=JSON.parse(row.payload); const fields:string[]=[];
    if(matches.length>1) fields.push("duplicate");
    if(!google) fields.push("missing"); else {
      if(String(google.student_id)!==row.student_id)fields.push("student_id");
      if(String(google.operation_type)!==row.operation_type)fields.push("operation_type");
      if(String(google.record_id)!==row.record_id)fields.push("record_id");
      if(String(google.request_id)!==row.request_id)fields.push("request_id");
      if(!sameJson(google.payload,payload))fields.push("payload");
      if(String(google.record_state)!==syncRecordState(row.operation_type,payload))fields.push("record_state");
    }
    return {row,google,fields,ok:fields.length===0};
  });
};

type GoogleBatchResult = { requestId?: unknown; ok?: unknown; version?: unknown; updatedAt?: unknown; error?: unknown };

const claimBatch = async (env: Env) => {
  await env.DB.prepare("UPDATE sync_queue SET status='RETRY_WAIT', lock_token=NULL, locked_at=NULL, batch_id=NULL, updated_at=datetime('now') WHERE status='PROCESSING' AND locked_at<datetime('now','-2 minutes')").run();
  const limit = Math.max(1, Math.min(25, Number(env.SYNC_BATCH_SIZE || 25)));
  const candidates = await env.DB.prepare("SELECT * FROM sync_queue WHERE status IN ('PENDING','RETRY_WAIT') AND attempt_count<3 AND (next_retry_at IS NULL OR next_retry_at<=datetime('now')) ORDER BY rowid LIMIT ?").bind(limit).all<SyncQueueRow>();
  if (!candidates.results.length) return null;
  const lockToken = crypto.randomUUID();
  const batchId = crypto.randomUUID();
  await env.DB.batch(candidates.results.map((row) => env.DB.prepare("UPDATE sync_queue SET status='PROCESSING',lock_token=?,locked_at=datetime('now'),batch_id=?,updated_at=datetime('now') WHERE sync_id=? AND status IN ('PENDING','RETRY_WAIT')").bind(lockToken,batchId,row.sync_id)));
  const claimed = await env.DB.prepare("SELECT * FROM sync_queue WHERE lock_token=? ORDER BY rowid").bind(lockToken).all<SyncQueueRow>();
  if (!claimed.results.length) return null;
  await env.DB.prepare("INSERT INTO sync_batches(batch_id,item_count) VALUES(?,?)").bind(batchId,claimed.results.length).run();
  return { batchId, rows: claimed.results };
};

const failBatch = async (env: Env, batchId: string, rows: SyncQueueRow[], message: string, elapsed: number) => {
  await env.DB.batch(rows.map((row) => {
    const attempt = Number(row.attempt_count || 0) + 1;
    const terminal = attempt >= 3;
    return env.DB.prepare("UPDATE sync_queue SET attempt_count=?,last_error=?,next_retry_at=datetime('now',?),status=?,google_status='ERROR',lock_token=NULL,locked_at=NULL,sync_duration_ms=?,updated_at=datetime('now') WHERE sync_id=?")
      .bind(attempt,message.slice(0,500),`+${2 ** attempt} seconds`,terminal ? "FAILED" : "RETRY_WAIT",elapsed,row.sync_id);
  }));
  await env.DB.prepare("UPDATE sync_batches SET failed_count=?,duration_ms=?,status='FAILED',last_error=?,completed_at=datetime('now') WHERE batch_id=?").bind(rows.length,elapsed,message.slice(0,500),batchId).run();
};

const recordUnknownBatch = async (env: Env, batchId: string, rows: SyncQueueRow[], error: UpstreamResponseError, elapsed: number) => {
  await env.DB.batch(rows.map(row=>env.DB.prepare("UPDATE sync_queue SET attempt_count=attempt_count+1,last_error=?,next_retry_at=NULL,status='UPSTREAM_RESULT_UNKNOWN',google_status='UNKNOWN',lock_token=NULL,locked_at=NULL,sync_duration_ms=?,reconciliation_status='PENDING',updated_at=datetime('now') WHERE sync_id=?")
    .bind(error.meta.code,elapsed,row.sync_id)));
  await env.DB.prepare("UPDATE sync_batches SET failed_count=?,duration_ms=?,status='UPSTREAM_RESULT_UNKNOWN',last_error=?,upstream_error_code=?,upstream_http_status=?,upstream_content_type=?,upstream_url_category=?,upstream_redirected=?,upstream_response_ms=?,upstream_body_summary=?,completed_at=datetime('now') WHERE batch_id=?")
    .bind(rows.length,elapsed,error.meta.code,error.meta.code,error.meta.httpStatus,error.meta.contentType,error.meta.urlCategory,error.meta.redirected?1:0,error.meta.responseMs,error.meta.bodySummary,batchId).run();
};

const reconcileUnknown = async (env: Env) => {
  const unknown=await env.DB.prepare("SELECT * FROM sync_queue WHERE status='UPSTREAM_RESULT_UNKNOWN' ORDER BY rowid LIMIT 25").all<SyncQueueRow>();
  if(!unknown.results.length)return 0;
  let checked;
  try{checked=await reconcileBatch(env,unknown.results);}catch{return unknown.results.length;}
  await env.DB.batch(checked.map(item=>{
    const resultStatus=item.fields.includes("duplicate")?"DUPLICATE_IN_GOOGLE":item.fields.includes("missing")?"NOT_FOUND_IN_GOOGLE":item.ok?"RECONCILED_SAVED":"RECONCILIATION_MISMATCH";
    const queueStatus=item.ok?"SAVED":item.fields.includes("missing")?"RETRY_WAIT":"FAILED";
    return env.DB.prepare("UPDATE sync_queue SET status=?,google_status=?,last_error=?,next_retry_at=CASE WHEN ?='RETRY_WAIT' THEN datetime('now','+2 seconds') ELSE NULL END,reconciliation_status=?,updated_at=datetime('now') WHERE sync_id=?")
      .bind(queueStatus,item.ok?"SAVED":"ERROR",item.ok?"UPSTREAM_RESULT_UNKNOWN_RECONCILED":resultStatus,queueStatus,item.ok?"MATCHED":"ERROR",item.row.sync_id);
  }));
  await env.DB.batch(checked.map(item=>{
    const resultStatus=item.fields.includes("duplicate")?"DUPLICATE_IN_GOOGLE":item.fields.includes("missing")?"NOT_FOUND_IN_GOOGLE":item.ok?"RECONCILED_SAVED":"RECONCILIATION_MISMATCH";
    return env.DB.prepare("INSERT OR REPLACE INTO reconciliation_results(reconciliation_id,test_run_id,sync_id,student_id,operation_type,record_id,request_id,status,mismatch_fields,d1_value,google_value) VALUES(?,?,?,?,?,?,?,?,?,?,?)")
      .bind(crypto.randomUUID(),item.row.test_run_id,item.row.sync_id,item.row.student_id,item.row.operation_type,item.row.record_id,item.row.request_id,resultStatus,JSON.stringify(item.fields),JSON.stringify(JSON.parse(item.row.payload)),JSON.stringify(item.google||null));
  }));
  return unknown.results.length;
};

const processOneBatch = async (env: Env) => {
  const claimed = await claimBatch(env);
  if (!claimed) return 0;
  const started = performance.now();
  try {
    const google = await postGoogleBatch(env, claimed.batchId, claimed.rows);
    const elapsed = Number((performance.now()-started).toFixed(3));
    const results = (google.results as GoogleBatchResult[]);
    const byRequest = new Map(results.map((result) => [String(result.requestId || ""),result]));
    const writeFailures=claimed.rows.filter(row=>byRequest.get(row.request_id)?.ok!==true);
    const reconciliation=writeFailures.length ? [] : await reconcileBatch(env,claimed.rows);
    const reconciliationByRequest=new Map(reconciliation.map(item=>[item.row.request_id,item]));
    let saved = 0; let failed = 0;
    await env.DB.batch(claimed.rows.map((row) => {
      const result = byRequest.get(row.request_id);
      const attempt = Number(row.attempt_count || 0)+1;
      const checked=reconciliationByRequest.get(row.request_id);
      if (result?.ok === true && checked?.ok === true) {
        saved += 1;
        return env.DB.prepare("UPDATE sync_queue SET attempt_count=?,last_error='',next_retry_at=NULL,status='SAVED',google_status='SAVED',google_version=?,google_updated_at=?,lock_token=NULL,locked_at=NULL,sync_duration_ms=(julianday('now')-julianday(created_at))*86400000,reconciliation_status='MATCHED',updated_at=datetime('now') WHERE sync_id=?")
          .bind(attempt,Number(result.version || 0),String(result.updatedAt || new Date().toISOString()),row.sync_id);
      }
      failed += 1;
      const terminal=attempt>=3;
      const mismatch=checked && !checked.ok;
      return env.DB.prepare("UPDATE sync_queue SET attempt_count=?,last_error=?,next_retry_at=datetime('now',?),status=?,google_status='ERROR',lock_token=NULL,locked_at=NULL,sync_duration_ms=(julianday('now')-julianday(created_at))*86400000,reconciliation_status='ERROR',updated_at=datetime('now') WHERE sync_id=?")
        .bind(attempt,String(mismatch?`RECONCILIATION_ERROR:${checked.fields.join(',')}`:result?.error || "MISSING_BATCH_RESULT").slice(0,500),`+${2 ** attempt} seconds`,mismatch||terminal?"FAILED":"RETRY_WAIT",row.sync_id);
    }));
    if(reconciliation.length) await env.DB.batch(reconciliation.map(item=>env.DB.prepare("INSERT OR REPLACE INTO reconciliation_results(reconciliation_id,test_run_id,sync_id,student_id,operation_type,record_id,request_id,status,mismatch_fields,d1_value,google_value) VALUES(?,?,?,?,?,?,?,?,?,?,?)").bind(crypto.randomUUID(),item.row.test_run_id,item.row.sync_id,item.row.student_id,item.row.operation_type,item.row.record_id,item.row.request_id,item.ok?"MATCHED":"RECONCILIATION_ERROR",JSON.stringify(item.fields),JSON.stringify(JSON.parse(item.row.payload)),JSON.stringify(item.google||null))));
    await env.DB.prepare("UPDATE sync_batches SET saved_count=?,failed_count=?,apps_script_ms=?,duration_ms=?,status=?,completed_at=datetime('now') WHERE batch_id=?").bind(saved,failed,elapsed,elapsed,failed?"PARTIAL":"SAVED",claimed.batchId).run();
    return claimed.rows.length;
  } catch (error) {
    const elapsed=Number((performance.now()-started).toFixed(3));
    if(error instanceof UpstreamResponseError) await recordUnknownBatch(env,claimed.batchId,claimed.rows,error,elapsed);
    else await failBatch(env,claimed.batchId,claimed.rows,error instanceof Error?error.message:"GOOGLE_SYNC_ERROR",elapsed);
    return claimed.rows.length;
  }
};

const dualWrite = async (request: { json<T>(): Promise<T> }, response: Response, env: Env, ctx: ExecutionContext, studentId: string, entity: string, entityId: string, action: string, trace: Trace) => {
  if (!response.ok || String(env.DUAL_WRITE_ENABLED) !== "true") return response;
  const [requestBody, responseBodyValue] = await Promise.all([request.json<Record<string, unknown>>(), response.clone().json()]);
  const responseBody = responseBodyValue as Record<string, unknown>;
  const requestId = String(requestBody.requestId || "");
  const testRunId = String(requestBody.testRunId || "").trim() || null;
  if (testRunId && !/^[A-Za-z0-9:_-]{8,128}$/.test(testRunId)) return json({error:"INVALID_TEST_RUN_ID"},400);
  const payload = (responseBody.progress || responseBody.homework || responseBody.target) as Record<string, unknown> | undefined;
  if (!requestId || !payload) return response;
  const operationType = syncOperation(entity, action);
  const syncId = crypto.randomUUID();
  await measured(trace, "syncQueue", async () => env.DB.prepare(
    "INSERT OR IGNORE INTO sync_queue (sync_id,student_id,operation_type,record_id,payload,request_id,test_run_id,status,cloudflare_status,google_status) VALUES (?,?,?,?,?,?,?,'PENDING','SAVED','PENDING')"
  ).bind(syncId, studentId, operationType, entityId, JSON.stringify(payload), requestId, testRunId).run());
  const row = await env.DB.prepare("SELECT * FROM sync_queue WHERE request_id=?").bind(requestId).first<SyncQueueRow>();
  if (!row) return json({ ...responseBody, sync: { status: "SYNC_ERROR", error: "QUEUE_INSERT_FAILED" } }, 207);
  if (row.status === "SAVED") return json({ ...responseBody, sync: { syncId: row.sync_id, status: "SAVED", replayed: true } });
  return json({ ...responseBody, sync: { syncId: row.sync_id, status: "BACKUP_PENDING", cloudflareStatus: "SAVED", googleStatus: row.google_status } }, 202);
};

const handleSyncStatus = async (env: Env, syncId: string) => {
  const row = await env.DB.prepare("SELECT sync_id,student_id,operation_type,record_id,request_id,attempt_count,last_error,status,cloudflare_status,google_status,google_version,google_updated_at,created_at,updated_at FROM sync_queue WHERE sync_id=?")
    .bind(syncId).first();
  return row ? json({ sync: row }) : json({ error: "SYNC_NOT_FOUND" }, 404);
};

const runDueSyncs = async (env: Env) => {
  if (String(env.DUAL_WRITE_ENABLED) !== "true") return;
  const processingControl = await env.DB.prepare(
    "SELECT status FROM sync_status WHERE sync_key='PHASE46_GOOGLE_QUEUE_PROCESSING'"
  ).first<{ status: string }>();
  if (processingControl?.status === "PAUSED") return;
  await reconcileUnknown(env);
  for (let batch=0;batch<2;batch+=1) if ((await processOneBatch(env))===0) break;
};

const handleSyncMetrics = async (env: Env) => {
  const row = await env.DB.prepare("SELECT SUM(CASE WHEN status IN ('PENDING','RETRY_WAIT') THEN 1 ELSE 0 END) pending_count,SUM(CASE WHEN status='PROCESSING' THEN 1 ELSE 0 END) processing_count,SUM(CASE WHEN status='FAILED' THEN 1 ELSE 0 END) failed_count,MIN(CASE WHEN status IN ('PENDING','RETRY_WAIT','PROCESSING') THEN created_at END) oldest_unsynced_at,MAX(CASE WHEN status='SAVED' THEN updated_at END) last_success_at,AVG(CASE WHEN status='SAVED' THEN sync_duration_ms END) avg_sync_ms,MAX(CASE WHEN status='SAVED' THEN sync_duration_ms END) max_sync_ms FROM sync_queue").first<Record<string,unknown>>();
  const pending=Number(row?.pending_count||0); const oldest=String(row?.oldest_unsynced_at||"");
  const oldestMinutes=oldest ? (Date.now()-Date.parse(oldest.replace(" ","T")+"Z"))/60000 : 0;
  return json({ ...row, warning: pending>=10 || oldestMinutes>=10, warningReasons:[pending>=10?"PENDING_10_OR_MORE":null,oldestMinutes>=10?"OLDEST_10_MINUTES_OR_MORE":null].filter(Boolean) });
};

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const trace = createTrace();
    try {
      if (url.pathname === "/health" && request.method === "GET") {
        return json({
          ok: !disabled(env),
          service: "step-progress-api",
          mode: "phase4.5-batched-google-backup",
          productionWriteApproved: String(env.PRODUCTION_WRITE_APPROVED) === "true",
          testWriteApproved: String(env.TEST_WRITE_APPROVED) === "true",
          dualWriteEnabled: String(env.DUAL_WRITE_ENABLED) === "true",
          testStudentId: env.TEST_STUDENT_ID,
        }, disabled(env) ? 503 : 200);
      }
      if (disabled(env)) return json({ error: "SERVICE_DISABLED" }, 503);
      if (!(await measured(trace, "auth", () => authorize(request, env)))) return withTrace(json({ error: "UNAUTHORIZED" }, 401), trace);

      if (request.method === "GET" && url.pathname === "/admin/sync/status") return withTrace(await handleSyncMetrics(env), trace);
      if (request.method === "GET" && url.pathname === "/admin/sync/schema") return withTrace(await handleGoogleSchema(env), trace);

      const syncMatch = url.pathname.match(/^\/sync\/([^/]+)$/);
      if (request.method === "GET" && syncMatch) return withTrace(await handleSyncStatus(env, decodeURIComponent(syncMatch[1])), trace);

      const readMatch = url.pathname.match(/^\/students\/([^/]+)(?:\/(materials|targets|progress|homework|summary|bundle))?$/);
      if (request.method === "GET" && readMatch) {
        return withTrace(await handleRead(env, decodeURIComponent(readMatch[1]).trim(), (readMatch[2] || "bundle") as Resource | "summary" | "bundle"), trace);
      }

      const writeMatch = url.pathname.match(/^\/students\/([^/]+)\/(progress|homework|targets)\/([^/]+)(?:\/(dates|archive|restore))?$/);
      if (!writeMatch) return json({ error: "NOT_FOUND" }, 404);
      const studentId = decodeURIComponent(writeMatch[1]).trim();
      if (writeDenied(env, studentId)) return withTrace(json({ error: "TEST_STUDENT_ONLY" }, 403), trace);
      const entity = writeMatch[2];
      const entityId = decodeURIComponent(writeMatch[3]).trim();
      const action = writeMatch[4] || "";

      const requestCopy = request.clone();
      let mutationResponse: Response | null = null;
      if (request.method === "PATCH" && entity === "progress" && !action) mutationResponse = await handleProgressWrite(request, env, studentId, entityId, trace);
      if (request.method === "PATCH" && entity === "homework" && action === "dates") mutationResponse = await handleHomeworkDates(request, env, studentId, entityId, trace);
      if (request.method === "POST" && entity === "homework" && action === "archive") mutationResponse = await handleHomeworkArchive(request, env, studentId, entityId, false, trace);
      if (request.method === "POST" && entity === "homework" && action === "restore") mutationResponse = await handleHomeworkArchive(request, env, studentId, entityId, true, trace);
      if (request.method === "PATCH" && entity === "targets" && !action) mutationResponse = await handleTargetWrite(request, env, studentId, entityId, trace);
      if (mutationResponse) return withTrace(await dualWrite(requestCopy, mutationResponse, env, ctx, studentId, entity, entityId, action, trace), trace);
      return json({ error: "METHOD_NOT_ALLOWED" }, 405, { allow: "GET, PATCH, POST" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "UNKNOWN_ERROR";
      console.error(JSON.stringify({ message: "request failed", error: message, path: url.pathname }));
      if (message === "PAYLOAD_TOO_LARGE") return json({ error: message }, 413);
      if (message.startsWith("INVALID_")) return json({ error: message }, 400);
      return json({ error: "INTERNAL_ERROR" }, 500);
    }
  },
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runDueSyncs(env));
  },
} satisfies ExportedHandler<Env>;

