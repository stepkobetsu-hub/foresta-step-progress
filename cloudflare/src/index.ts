Exit code: 0
Wall time: 1.4 seconds
Output:
const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
} as const;

const json = (value: unknown, status = 200, extraHeaders: Record<string, string> = {}) =>
  new Response(JSON.stringify(value), { status, headers: { ...JSON_HEADERS, ...extraHeaders } });

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

const replay = async (env: Env, requestId: string, entityType: string, entityId: string) => {
  const row = await env.DB.prepare(
    "SELECT operation_id FROM operation_logs WHERE request_id = ? AND entity_type = ? AND entity_id = ? AND outcome = 'SUCCESS'"
  ).bind(requestId, entityType, entityId).first();
  return Boolean(row);
};

const recordSuccess = async (
  env: Env,
  requestId: string,
  action: string,
  entityType: string,
  entityId: string,
  detail: Record<string, unknown>,
) => {
  await env.DB.prepare(
    "INSERT OR IGNORE INTO operation_logs (operation_id, request_id, actor_id, actor_role, action, entity_type, entity_id, outcome, detail_json, created_at) VALUES (?, ?, ?, 'TEST_STUDENT', ?, ?, ?, 'SUCCESS', ?, datetime('now'))"
  ).bind(crypto.randomUUID(), requestId, env.TEST_STUDENT_ID, action, entityType, entityId, JSON.stringify(detail)).run();
};

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

const conflictOrMissing = async (current: Record<string, unknown> | null) =>
  current ? json({ error: "VERSION_CONFLICT", current }, 409) : json({ error: "NOT_FOUND" }, 404);

const handleProgressWrite = async (request: Request, env: Env, studentId: string, recordId: string) => {
  const body = await parseBody(request);
  const { expectedVersion, requestId } = mutationFields(body);
  if (await replay(env, requestId, "progress", recordId)) return json({ ok: true, replayed: true, progress: await progressRow(env, studentId, recordId) });
  const allowed = ["pointConfirmed", "warmupConfirmed", "tryCompleted"] as const;
  const values = allowed.map((key) => body[key]);
  if (values.every((value) => typeof value !== "boolean")) return json({ error: "NO_CHANGES" }, 400);
  const current = await progressRow(env, studentId, recordId);
  if (!current) return json({ error: "NOT_FOUND" }, 404);
  const next = {
    point: typeof body.pointConfirmed === "boolean" ? Number(body.pointConfirmed) : Number(current.point_confirmed),
    warmup: typeof body.warmupConfirmed === "boolean" ? Number(body.warmupConfirmed) : Number(current.warmup_confirmed),
    tried: typeof body.tryCompleted === "boolean" ? Number(body.tryCompleted) : Number(current.try_completed),
  };
  const result = await env.DB.prepare(
    "UPDATE progress_records SET point_confirmed = ?, warmup_confirmed = ?, try_completed = ?, updated_at = datetime('now'), updated_by = ?, version = version + 1, request_id = ? WHERE student_id = ? AND record_id = ? AND version = ?"
  ).bind(next.point, next.warmup, next.tried, studentId, requestId, studentId, recordId, expectedVersion).run();
  if (result.meta.changes !== 1) return conflictOrMissing(await progressRow(env, studentId, recordId));
  await recordSuccess(env, requestId, "SAVE_PROGRESS", "progress", recordId, next);
  return json({ ok: true, replayed: false, progress: await progressRow(env, studentId, recordId) });
};

const handleHomeworkDates = async (request: Request, env: Env, studentId: string, homeworkId: string) => {
  const body = await parseBody(request);
  const { expectedVersion, requestId } = mutationFields(body);
  if (await replay(env, requestId, "homework", homeworkId)) return json({ ok: true, replayed: true, homework: await homeworkRow(env, studentId, homeworkId) });
  const dueDate = body.dueDate === null || typeof body.dueDate === "string" ? body.dueDate : undefined;
  const completedDate = body.completedDate === null || typeof body.completedDate === "string" ? body.completedDate : undefined;
  if (dueDate === undefined && completedDate === undefined) return json({ error: "NO_CHANGES" }, 400);
  const current = await homeworkRow(env, studentId, homeworkId);
  if (!current) return json({ error: "NOT_FOUND" }, 404);
  const nextDue = dueDate === undefined ? current.due_date : dueDate;
  const nextCompleted = completedDate === undefined ? current.completed_date : completedDate;
  const result = await env.DB.prepare(
    "UPDATE homework_records SET due_date = ?, completed_date = ?, updated_at = datetime('now'), updated_by = ?, version = version + 1, request_id = ? WHERE student_id = ? AND homework_id = ? AND version = ?"
  ).bind(nextDue, nextCompleted, studentId, requestId, studentId, homeworkId, expectedVersion).run();
  if (result.meta.changes !== 1) return conflictOrMissing(await homeworkRow(env, studentId, homeworkId));
  await recordSuccess(env, requestId, "SAVE_HOMEWORK_DATES", "homework", homeworkId, { dueDate: nextDue, completedDate: nextCompleted });
  return json({ ok: true, replayed: false, homework: await homeworkRow(env, studentId, homeworkId) });
};

const handleHomeworkArchive = async (request: Request, env: Env, studentId: string, homeworkId: string, restore: boolean) => {
  const body = await parseBody(request);
  const { expectedVersion, requestId } = mutationFields(body);
  const action = restore ? "RESTORE_HOMEWORK" : "ARCHIVE_HOMEWORK";
  if (await replay(env, requestId, "homework", homeworkId)) return json({ ok: true, replayed: true, homework: await homeworkRow(env, studentId, homeworkId) });
  const timestamp = new Date().toISOString();
  const sql = restore
    ? "UPDATE homework_records SET archived_at = NULL, restored_at = ?, updated_at = datetime('now'), updated_by = ?, version = version + 1, request_id = ? WHERE student_id = ? AND homework_id = ? AND version = ?"
    : "UPDATE homework_records SET archived_at = ?, restored_at = NULL, updated_at = datetime('now'), updated_by = ?, version = version + 1, request_id = ? WHERE student_id = ? AND homework_id = ? AND version = ?";
  const result = await env.DB.prepare(sql).bind(timestamp, studentId, requestId, studentId, homeworkId, expectedVersion).run();
  if (result.meta.changes !== 1) return conflictOrMissing(await homeworkRow(env, studentId, homeworkId));
  if (restore) {
    await env.DB.prepare("UPDATE homework_archives SET restored_at = ?, restored_by = ?, version = version + 1, request_id = ? WHERE homework_id = ?").bind(timestamp, studentId, requestId, homeworkId).run();
  } else {
    await env.DB.prepare("INSERT INTO homework_archives (archive_id, homework_id, student_id, archived_at, archived_by, version, request_id) VALUES (?, ?, ?, ?, ?, 1, ?) ON CONFLICT(archive_id) DO UPDATE SET archived_at=excluded.archived_at, restored_at=NULL, archived_by=excluded.archived_by, version=homework_archives.version+1, request_id=excluded.request_id").bind("ARCHIVE-"+homeworkId, homeworkId, studentId, timestamp, studentId, requestId).run();
  }
  await recordSuccess(env, requestId, action, "homework", homeworkId, { timestamp });
  return json({ ok: true, replayed: false, homework: await homeworkRow(env, studentId, homeworkId) });
};

const handleTargetWrite = async (request: Request, env: Env, studentId: string, targetId: string) => {
  const body = await parseBody(request);
  const { expectedVersion, requestId } = mutationFields(body);
  if (typeof body.included !== "boolean") return json({ error: "INVALID_INCLUDED" }, 400);
  if (await replay(env, requestId, "target", targetId)) return json({ ok: true, replayed: true, target: await targetRow(env, studentId, targetId) });
  const result = await env.DB.prepare(
    "UPDATE student_targets SET included = ?, updated_at = datetime('now'), updated_by = ?, version = version + 1 WHERE student_id = ? AND target_id = ? AND version = ?"
  ).bind(Number(body.included), studentId, studentId, targetId, expectedVersion).run();
  if (result.meta.changes !== 1) return conflictOrMissing(await targetRow(env, studentId, targetId));
  await recordSuccess(env, requestId, "SAVE_TARGET_RANGE", "target", targetId, { included: body.included });
  return json({ ok: true, replayed: false, target: await targetRow(env, studentId, targetId) });
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
      if (!(await authorize(request, env))) return json({ error: "UNAUTHORIZED" }, 401);

      const readMatch = url.pathname.match(/^\/students\/([^/]+)(?:\/(materials|targets|progress|homework|summary|bundle))?$/);
      if (request.method === "GET" && readMatch) {
        return handleRead(env, decodeURIComponent(readMatch[1]).trim(), (readMatch[2] || "bundle") as Resource | "summary" | "bundle");
      }

      const writeMatch = url.pathname.match(/^\/students\/([^/]+)\/(progress|homework|targets)\/([^/]+)(?:\/(dates|archive|restore))?$/);
      if (!writeMatch) return json({ error: "NOT_FOUND" }, 404);
      const studentId = decodeURIComponent(writeMatch[1]).trim();
      if (writeDenied(env, studentId)) return json({ error: "TEST_STUDENT_ONLY" }, 403);
      const entity = writeMatch[2];
      const entityId = decodeURIComponent(writeMatch[3]).trim();
      const action = writeMatch[4] || "";

      if (request.method === "PATCH" && entity === "progress" && !action) return handleProgressWrite(request, env, studentId, entityId);
      if (request.method === "PATCH" && entity === "homework" && action === "dates") return handleHomeworkDates(request, env, studentId, entityId);
      if (request.method === "POST" && entity === "homework" && action === "archive") return handleHomeworkArchive(request, env, studentId, entityId, false);
      if (request.method === "POST" && entity === "homework" && action === "restore") return handleHomeworkArchive(request, env, studentId, entityId, true);
      if (request.method === "PATCH" && entity === "targets" && !action) return handleTargetWrite(request, env, studentId, entityId);
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

