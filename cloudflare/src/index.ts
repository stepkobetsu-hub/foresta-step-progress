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
  targets: envSql("SELECT t.target_id, t.material_id, t.subject, t.target_start AS unit_id, t.target_end, t.target_period, t.included, t.updated_at, t.version, u.unit_order, u.unit_type, u.title AS unit_title FROM student_targets t LEFT JOIN units u ON u.unit_id = t.target_start WHERE t.student_id = ? ORDER BY t.subject, u.unit_order, t.target_id", studentId),
  progress: envSql("SELECT p.record_id, p.material_id, p.subject, p.grade, p.unit_id, p.round, p.point_confirmed, p.warmup_confirmed, p.try_completed, p.memorization_completed, p.exercise_completed, p.lct_result, p.learning_date, p.updated_at, p.version, u.title AS unit_title, u.unit_order FROM progress_records p LEFT JOIN units u ON u.unit_id = p.unit_id WHERE p.student_id = ? ORDER BY p.subject, u.unit_order, p.round", studentId),
  homework: envSql("SELECT h.homework_id, h.material_id, h.subject, h.unit_id, h.assigned_date, h.due_date, h.completed_date, h.correction_date, h.review_date, h.archived_at, h.restored_at, h.status, h.updated_at, h.version, u.title AS unit_title, u.unit_order FROM homework_records h LEFT JOIN units u ON u.unit_id = h.unit_id WHERE h.student_id = ? ORDER BY h.updated_at DESC, h.homework_id", studentId),
});

type BoundSql = { sql: string; value: string };
const envSql = (sql: string, value: string): BoundSql => ({ sql, value });
type Resource = "materials" | "targets" | "progress" | "homework";

const runList = async (env: Env, bound: BoundSql) => {
  const startedAt = performance.now();
  const result = await env.DB.prepare(bound.sql).bind(bound.value).all();
  return { rows: result.results, durationMs: Number((performance.now() - startedAt).toFixed(3)) };
};

const buildSummary = (targets: Record<string, unknown>[], progress: Record<string, unknown>[], homework: Record<string, unknown>[]) => {
  const includedTargets = targets.filter((row) => Number(row.included) === 1);
  const completedCount = progress.filter((row) => Number(row.try_completed) === 1).length;
  return {
    targetCount: includedTargets.length,
    completedCount,
    progressRate: includedTargets.length ? completedCount / includedTargets.length : null,
    uninputCount: homework.filter((row) => String(row.status).startsWith("UNINPUT|")).length,
  };
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
    summary: buildSummary(targets, progress, homework),
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

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const trace = createTrace();
    try {
      if (url.pathname === "/health" && request.method === "GET") {
        return json({
          ok: !disabled(env),
          service: "step-progress-api",
          mode: "phase3-dummy-write",
          productionWriteApproved: String(env.PRODUCTION_WRITE_APPROVED) === "true",
          testWriteApproved: String(env.TEST_WRITE_APPROVED) === "true",
          testStudentId: env.TEST_STUDENT_ID,
        }, disabled(env) ? 503 : 200);
      }
      if (disabled(env)) return json({ error: "SERVICE_DISABLED" }, 503);
      if (!(await measured(trace, "auth", () => authorize(request, env)))) return withTrace(json({ error: "UNAUTHORIZED" }, 401), trace);

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

      if (request.method === "PATCH" && entity === "progress" && !action) return withTrace(await handleProgressWrite(request, env, studentId, entityId, trace), trace);
      if (request.method === "PATCH" && entity === "homework" && action === "dates") return withTrace(await handleHomeworkDates(request, env, studentId, entityId, trace), trace);
      if (request.method === "POST" && entity === "homework" && action === "archive") return withTrace(await handleHomeworkArchive(request, env, studentId, entityId, false, trace), trace);
      if (request.method === "POST" && entity === "homework" && action === "restore") return withTrace(await handleHomeworkArchive(request, env, studentId, entityId, true, trace), trace);
      if (request.method === "PATCH" && entity === "targets" && !action) return withTrace(await handleTargetWrite(request, env, studentId, entityId, trace), trace);
      return json({ error: "METHOD_NOT_ALLOWED" }, 405, { allow: "GET, PATCH, POST" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "UNKNOWN_ERROR";
      console.error(JSON.stringify({ message: "request failed", error: message, path: url.pathname }));
      if (message === "PAYLOAD_TOO_LARGE") return json({ error: message }, 413);
      if (message.startsWith("INVALID_")) return json({ error: message }, 400);
      return json({ error: "INTERNAL_ERROR" }, 500);
    }
  },
} satisfies ExportedHandler<Env>;

