export interface Env {
  DB: D1Database;
  PRODUCTION_WRITE_APPROVED: string;
  ADMIN_API_ENABLED: string;
  EMERGENCY_STOP: string;
  MIRROR_READ_ENABLED: string;
  MIRROR_COMPARE_TOKEN?: string;
}

const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });

const disabled = (env: Env) =>
  env.EMERGENCY_STOP === "true" || env.MIRROR_READ_ENABLED !== "true";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/health" && request.method === "GET") {
      return json({
        ok: !disabled(env),
        service: "step-progress-api",
        mode: "phase1-read-only",
        productionWriteApproved: false,
        adminApiEnabled: false,
      }, disabled(env) ? 503 : 200);
    }

    if (disabled(env)) return json({ error: "SERVICE_DISABLED" }, 503);
    if (request.method !== "GET") return json({ error: "READ_ONLY_PHASE" }, 405);

    const match = url.pathname.match(/^\/mirror\/students\/([^/]+)$/);
    if (!match) return json({ error: "NOT_FOUND" }, 404);

    const expectedToken = env.MIRROR_COMPARE_TOKEN || "";
    const suppliedToken = (request.headers.get("authorization") || "").replace(/^Bearer\\s+/i, "");
    if (!expectedToken || suppliedToken !== expectedToken) {
      return json({ error: "UNAUTHORIZED" }, 401);
    }

    const studentId = decodeURIComponent(match[1]).trim();
    if (!studentId || studentId.length > 64) return json({ error: "INVALID_STUDENT_ID" }, 400);

    const student = await env.DB.prepare(
      "SELECT student_id, display_name, school, grade, status, updated_at, version FROM students WHERE student_id = ?"
    ).bind(studentId).first();

    if (!student) return json({ error: "STUDENT_NOT_FOUND" }, 404);

    const [targets, progress, homework] = await Promise.all([
      env.DB.prepare("SELECT target_id, material_id, subject, target_start, target_end, target_period, included, updated_at, version FROM student_targets WHERE student_id = ? ORDER BY subject, material_id")
        .bind(studentId).all(),
      env.DB.prepare("SELECT record_id, material_id, subject, grade, unit_id, round, point_confirmed, warmup_confirmed, try_completed, memorization_completed, exercise_completed, lct_result, learning_date, updated_at, version FROM progress_records WHERE student_id = ? ORDER BY subject, material_id, unit_id, round")
        .bind(studentId).all(),
      env.DB.prepare("SELECT homework_id, material_id, subject, unit_id, assigned_date, due_date, completed_date, correction_date, review_date, archived_at, restored_at, status, updated_at, version FROM homework_records WHERE student_id = ? ORDER BY updated_at DESC")
        .bind(studentId).all(),
    ]);

    return json({
      student,
      targets: targets.results,
      progress: progress.results,
      homework: homework.results,
      source: "d1-mirror",
    });
  },
} satisfies ExportedHandler<Env>;
