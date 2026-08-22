type Row = Record<string, unknown>;
type SmokeEnv = Env & { SMOKE_TOKEN: string };
const headers = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers });
const text = (value: unknown) => String(value ?? "").trim();
const isRow = (value: unknown): value is Row => typeof value === "object" && value !== null && !Array.isArray(value);
const authorized = (request: Request, env: SmokeEnv) => {
  const supplied = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  return Boolean(env.SMOKE_TOKEN) && supplied === env.SMOKE_TOKEN;
};
const SUPABASE_EXPORT = "https://wisedgcgwaebtkprdhth.supabase.co/functions/v1/export-effective-targets-20260822";
const SUPABASE_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Indpc2VkZ2Nnd2FlYnRrcHJkaHRoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU0NzYyMjEsImV4cCI6MjEwMTA1MjIyMX0.pY60s9J8tjx8d9E6LFHmjmuP186YYyfahdLsXYa6I7Q";
const restoreTargets = async (env: SmokeEnv) => {
  const response = await fetch(SUPABASE_EXPORT, { headers: { authorization: `Bearer ${SUPABASE_ANON}`, apikey: SUPABASE_ANON } });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok || !isRow(payload) || payload.ok !== true || !Array.isArray(payload.rows)) return json({ok:false,stage:"export",status:response.status},502);
  const rows = payload.rows.filter(isRow).map((r) => ({ studentId:text(r.student_id), subject:text(r.subject), series:text(r.series)||"FORESTA_STEP", unitId:text(r.unit_id) })).filter((r)=>r.studentId&&r.subject&&r.unitId);
  if (rows.length !== 6555) return json({ok:false,stage:"count_guard",expected:6555,actual:rows.length},409);
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS v3_target_snapshot_backup_pre_restore_20260822 AS SELECT * FROM v3_target_snapshot`).run();
  await env.DB.prepare(`DELETE FROM v3_target_snapshot`).run();
  try {
    const packed = JSON.stringify(rows);
    await env.DB.prepare(`INSERT OR REPLACE INTO v3_target_snapshot(target_id,student_id,material_id,subject,target_start,target_end,target_period,included,updated_at,updated_by,version)
      SELECT 'RESTORE:'||json_extract(j.value,'$.studentId')||':'||json_extract(j.value,'$.series')||':'||json_extract(j.value,'$.subject')||':'||json_extract(j.value,'$.unitId'),
             json_extract(j.value,'$.studentId'),u.material_id,json_extract(j.value,'$.subject'),json_extract(j.value,'$.unitId'),json_extract(j.value,'$.unitId'),
             'RESTORED_LEGACY_EFFECTIVE',1,datetime('now'),'SYSTEM_TARGET_RESTORE',1
      FROM json_each(?) j LEFT JOIN units u ON u.unit_id=json_extract(j.value,'$.unitId')`).bind(packed).run();
    const countRow=await env.DB.prepare(`SELECT COUNT(*) AS count FROM v3_target_snapshot`).first<Row>();
    const inserted=Number(countRow?.count||0);
    if(inserted!==rows.length) throw new Error(`TARGET_COUNT_MISMATCH:${inserted}/${rows.length}`);
  } catch(error) {
    await env.DB.batch([env.DB.prepare(`DELETE FROM v3_target_snapshot`),env.DB.prepare(`INSERT INTO v3_target_snapshot SELECT * FROM v3_target_snapshot_backup_pre_restore_20260822`)]);
    return json({ok:false,stage:"insert_rollback",error:String(error)},500);
  }
  const five=await env.DB.prepare(`SELECT t.student_id,s.display_name,t.subject,COUNT(*) AS target_count FROM v3_target_snapshot t JOIN students s ON s.student_id=t.student_id WHERE t.student_id IN ('1097','1214','1257','1276','1312') AND t.included=1 GROUP BY t.student_id,s.display_name,t.subject ORDER BY t.student_id,t.subject`).all();
  const missing=await env.DB.prepare(`SELECT COUNT(*) AS count FROM v3_target_snapshot WHERE material_id IS NULL`).first<Row>();
  const overrides=await env.DB.prepare(`SELECT COUNT(*) AS count FROM v3_target_overrides`).first<Row>();
  const progress=await env.DB.prepare(`SELECT COUNT(*) AS count FROM v3_progress_records`).first<Row>();
  const homework=await env.DB.prepare(`SELECT COUNT(*) AS count FROM v3_homework_snapshot`).first<Row>();
  return json({ok:true,restoredTargetCount:rows.length,missingUnitMasterCount:Number(missing?.count||0),targetOverrideCount:Number(overrides?.count||0),progressCount:Number(progress?.count||0),homeworkCount:Number(homework?.count||0),five:five.results});
};
export default { async fetch(request:Request,env:SmokeEnv):Promise<Response>{ if(!authorized(request,env))return json({error:"NOT_FOUND"},404); if(request.method!=="POST")return json({error:"METHOD_NOT_ALLOWED"},405); const value:unknown=await request.json().catch(()=>null); if(!isRow(value))return json({error:"INVALID_JSON"},400); if(text(value.action)==="inspectRecent1320")return restoreTargets(env); return json({error:"NOT_FOUND"},404); } } satisfies ExportedHandler<SmokeEnv>;
