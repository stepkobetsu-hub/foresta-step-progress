export interface Env {
  DB: D1Database;
  PRODUCTION_WRITE_APPROVED: string;
  ADMIN_API_ENABLED: string;
  EMERGENCY_STOP: string;
  MIRROR_READ_ENABLED: string;
  MIRROR_COMPARE_TOKEN?: string;
}

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

const disabled = (env: Env) =>
  env.EMERGENCY_STOP === "true" || env.MIRROR_READ_ENABLED !== "true";

const queries = (studentId: string) => ({
  student: ["SELECT s.student_id, s.display_name, p.campus, s.school, s.grade, s.status, s.source_updated_at, s.updated_at, s.version FROM students s LEFT JOIN student_profiles p ON p.student_id = s.student_id WHERE s.student_id = ?", studentId],
  materials: ["SELECT DISTINCT m.material_id, m.series, m.subject, m.grade, m.title, m.has_lct, m.active, m.updated_at, m.version FROM materials m JOIN student_targets t ON t.material_id = m.material_id WHERE t.student_id = ? AND t.included = 1 ORDER BY m.subject, m.material_id", studentId],
  targets: ["SELECT t.target_id, t.material_id, t.subject, t.target_start AS unit_id, t.target_end, t.target_period, t.included, t.updated_at, t.version, u.unit_order, u.unit_type, u.title AS unit_title FROM student_targets t LEFT JOIN units u ON u.unit_id = t.target_start WHERE t.student_id = ? AND t.included = 1 ORDER BY t.subject, u.unit_order, t.target_id", studentId],
  progress: ["SELECT p.record_id, p.material_id, p.subject, p.grade, p.unit_id, p.round, p.point_confirmed, p.warmup_confirmed, p.try_completed, p.memorization_completed, p.exercise_completed, p.lct_result, p.learning_date, p.updated_at, p.version, u.title AS unit_title, u.unit_order FROM progress_records p LEFT JOIN units u ON u.unit_id = p.unit_id WHERE p.student_id = ? ORDER BY p.subject, u.unit_order, p.round", studentId],
  homework: ["SELECT h.homework_id, h.material_id, h.subject, h.unit_id, h.assigned_date, h.due_date, h.completed_date, h.correction_date, h.review_date, h.archived_at, h.restored_at, h.status, h.updated_at, h.version, u.title AS unit_title, u.unit_order FROM homework_records h LEFT JOIN units u ON u.unit_id = h.unit_id WHERE h.student_id = ? ORDER BY h.updated_at DESC, h.homework_id", studentId],
} as const);

type Resource = keyof ReturnType<typeof queries>;

const runList = async (env: Env, sql: string, studentId: string) => {
  const startedAt = performance.now();
  const result = await env.DB.prepare(sql).bind(studentId).all();
  return { rows: result.results, durationMs: Number((performance.now() - startedAt).toFixed(3)) };
};

const buildSummary = (targets: Record<string, unknown>[], progress: Record<string, unknown>[], homework: Record<string, unknown>[]) => {
  const completedCount = progress.filter((row) => Number(row.try_completed) === 1).length;
  const targetCount = targets.length;
  const homeworkUninputCount = homework.filter((row) => String(row.status).startsWith("UNINPUT|")).length;
  return {
    targetCount,
    completedCount,
    progressRate: targetCount ? completedCount / targetCount : null,
    uninputCount: homeworkUninputCount,
  };
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const requestStartedAt = performance.now();
    const url = new URL(request.url);

    if (url.pathname === "/health" && request.method === "GET") {
      return json({
        ok: !disabled(env),
        service: "step-progress-api",
        mode: "phase2-read-only",
        productionWriteApproved: env.PRODUCTION_WRITE_APPROVED === "true",
        adminApiEnabled: env.ADMIN_API_ENABLED === "true",
        allowedMethods: ["GET"],
      }, disabled(env) ? 503 : 200);
    }

    if (disabled(env)) return json({ error: "SERVICE_DISABLED" }, 503);
    if (request.method !== "GET") {
      return json({ error: "READ_ONLY_PHASE", allowedMethods: ["GET"] }, 405, { allow: "GET" });
    }

    const match = url.pathname.match(/^\/students\/([^/]+)(?:\/(materials|targets|progress|homework|summary|bundle))?$/);
    if (!match) return json({ error: "NOT_FOUND" }, 404);

    const expectedToken = env.MIRROR_COMPARE_TOKEN || "";
    const suppliedToken = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    if (!expectedToken || !(await constantTimeTokenEqual(suppliedToken, expectedToken))) {
      return json({ error: "UNAUTHORIZED" }, 401);
    }

    const studentId = decodeURIComponent(match[1]).trim();
    if (!studentId || studentId.length > 64) return json({ error: "INVALID_STUDENT_ID" }, 400);

    const querySet = queries(studentId);
    const studentTimingStartedAt = performance.now();
    const student = await env.DB.prepare(querySet.student[0]).bind(studentId).first();
    const studentDurationMs = Number((performance.now() - studentTimingStartedAt).toFixed(3));
    if (!student) return json({ error: "STUDENT_NOT_FOUND" }, 404);

    const resource = (match[2] || "bundle") as Resource | "summary" | "bundle";
    if (resource !== "bundle" && resource !== "summary") {
      const result = await runList(env, querySet[resource][0], studentId);
      return json({
        studentId,
        [resource]: result.rows,
        timing: { d1QueryMs: result.durationMs, totalMs: Number((performance.now() - requestStartedAt).toFixed(3)) },
        source: "cloudflare-d1-read-only",
      });
    }

    const [materials, targets, progress, homework] = await Promise.all([
      runList(env, querySet.materials[0], studentId),
      runList(env, querySet.targets[0], studentId),
      runList(env, querySet.progress[0], studentId),
      runList(env, querySet.homework[0], studentId),
    ]);
    const summary = buildSummary(targets.rows, progress.rows, homework.rows);
    const timing = {
      studentQueryMs: studentDurationMs,
      materialsQueryMs: materials.durationMs,
      targetsQueryMs: targets.durationMs,
      progressQueryMs: progress.durationMs,
      homeworkQueryMs: homework.durationMs,
      d1QueryMs: Number((studentDurationMs + materials.durationMs + targets.durationMs + progress.durationMs + homework.durationMs).toFixed(3)),
      totalMs: Number((performance.now() - requestStartedAt).toFixed(3)),
    };

    if (resource === "summary") return json({ studentId, summary, timing, source: "cloudflare-d1-read-only" });
    return json({
      student,
      materials: materials.rows,
      targets: targets.rows,
      progress: progress.rows,
      homework: homework.rows,
      summary,
      timing,
      source: "cloudflare-d1-read-only",
    });
  },
} satisfies ExportedHandler<Env>;
