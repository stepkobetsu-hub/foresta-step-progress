type Row=Record<string,unknown>;
type SmokeEnv=Env&{SMOKE_TOKEN:string};
const H={"content-type":"application/json; charset=utf-8","cache-control":"no-store"};
const json=(v:unknown,s=200)=>new Response(JSON.stringify(v),{status:s,headers:H});
const text=(v:unknown)=>String(v??"").trim();
const isRow=(v:unknown):v is Row=>typeof v==="object"&&v!==null&&!Array.isArray(v);
const authorized=(q:Request,e:SmokeEnv)=>Boolean(e.SMOKE_TOKEN)&&((q.headers.get("authorization")||"").replace(/^Bearer\s+/i,""))===e.SMOKE_TOKEN;
const EXPORT_URL="https://wisedgcgwaebtkprdhth.supabase.co/functions/v1/export-learning-progress-20260822";
const ANON="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Indpc2VkZ2Nnd2FlYnRrcHJkaHRoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU0NzYyMjEsImV4cCI6MjEwMTA1MjIyMX0.pY60s9J8tjx8d9E6LFHmjmuP186YYyfahdLsXYa6I7Q";

const auditSix=async(e:SmokeEnv)=>{
  const data=await e.DB.prepare(`WITH b AS(
    SELECT t.student_id,t.subject,t.target_start unit_id,COALESCE(m.series,'FORESTA_STEP') series,COALESCE(o.included,t.included) included
    FROM v3_target_snapshot t LEFT JOIN units u ON u.unit_id=t.target_start LEFT JOIN materials m ON m.material_id=u.material_id
    LEFT JOIN v3_target_overrides o ON o.student_id=t.student_id AND o.unit_id=t.target_start AND o.subject=t.subject AND o.series=COALESCE(m.series,'FORESTA_STEP')
    WHERE t.student_id IN ('1100','1097','1214','1257','1276','1312')
  ),x AS(
    SELECT o.student_id,o.subject,o.unit_id,o.series,o.included FROM v3_target_overrides o
    WHERE o.student_id IN ('1100','1097','1214','1257','1276','1312') AND NOT EXISTS(
      SELECT 1 FROM v3_target_snapshot t LEFT JOIN units u ON u.unit_id=t.target_start LEFT JOIN materials m ON m.material_id=u.material_id
      WHERE t.student_id=o.student_id AND t.target_start=o.unit_id AND t.subject=o.subject AND COALESCE(m.series,'FORESTA_STEP')=o.series)
  ),eff AS(SELECT * FROM b UNION ALL SELECT * FROM x),sub AS(
    SELECT student_id,subject,COUNT(*) target_count FROM eff WHERE included=1 GROUP BY student_id,subject
  ),comp AS(
    SELECT eff.student_id,eff.subject,COUNT(*) completed_count FROM eff
    JOIN v3_progress_records p ON p.student_id=eff.student_id AND p.unit_id=eff.unit_id AND p.subject=eff.subject
    WHERE eff.included=1 AND p.round BETWEEN 1 AND 3 AND p.try_completed=1 GROUP BY eff.student_id,eff.subject
  ),tot AS(
    SELECT s.student_id,s.display_name,SUM(sub.target_count) target_count,SUM(COALESCE(comp.completed_count,0)) completed_count
    FROM students s JOIN sub ON sub.student_id=s.student_id LEFT JOIN comp ON comp.student_id=sub.student_id AND comp.subject=sub.subject
    GROUP BY s.student_id,s.display_name)
  SELECT * FROM tot ORDER BY student_id`).all();
  return data.results;
};

const mergeProgress=async(e:SmokeEnv)=>{
  const beforeRow=await e.DB.prepare(`SELECT COUNT(*) count FROM v3_progress_records`).first<Row>();
  const before=Number(beforeRow?.count||0);
  await e.DB.prepare(`CREATE TABLE IF NOT EXISTS v3_progress_records_backup_pre_supabase_merge_20260822 AS SELECT * FROM v3_progress_records`).run();
  const res=await fetch(EXPORT_URL,{headers:{authorization:`Bearer ${ANON}`,apikey:ANON}});
  const payload:unknown=await res.json().catch(()=>null);
  if(!res.ok||!isRow(payload)||payload.ok!==true||!Array.isArray(payload.rows))return json({ok:false,stage:'export',status:res.status},502);
  const rows=payload.rows.filter(isRow);
  if(rows.length!==3536)return json({ok:false,stage:'count_guard',expected:3536,actual:rows.length},409);
  for(let i=0;i<rows.length;i+=80){
    const chunk=rows.slice(i,i+80);
    const stmts=chunk.map((r)=>e.DB.prepare(`INSERT OR IGNORE INTO v3_progress_records(
      record_id,student_id,material_id,subject,grade,unit_id,round,point_confirmed,warmup_confirmed,try_completed,
      memorization_completed,exercise_completed,lct_result,learning_date,updated_at,updated_by,version,request_id)
      VALUES(?,?,(SELECT material_id FROM units WHERE unit_id=?),?,COALESCE((SELECT grade FROM units WHERE unit_id=?),''),?,?,?,?,?,0,0,?,?,?, ?,1,?)`)
      .bind(text(r.progress_id)||`RESTORE:${text(r.student_id)}:${text(r.unit_id)}:${Number(r.round_number)||1}`,
        text(r.student_id),text(r.unit_id),text(r.subject),text(r.unit_id),text(r.unit_id),Number(r.round_number)||1,
        r.point_confirmed?1:0,r.warmup_confirmed?1:0,r.try_completed?1:0,text(r.lct_result),text(r.learning_date)||null,
        text(r.updated_at)||new Date().toISOString(),text(r.updated_by)||'SYSTEM_SUPABASE_RESTORE',text(r.client_mutation_id)||null));
    await e.DB.batch(stmts);
  }
  const afterRow=await e.DB.prepare(`SELECT COUNT(*) count FROM v3_progress_records`).first<Row>();
  const after=Number(afterRow?.count||0);
  const six=await auditSix(e);
  return json({ok:true,sourceRows:rows.length,before,after,added:after-before,six});
};

export default{async fetch(q:Request,e:SmokeEnv){
  if(!authorized(q,e))return json({error:'NOT_FOUND'},404);
  if(q.method!=='POST')return json({error:'METHOD_NOT_ALLOWED'},405);
  const v:unknown=await q.json().catch(()=>null);if(!isRow(v))return json({error:'INVALID_JSON'},400);
  if(text(v.action)==='inspectRecent1320')return mergeProgress(e);
  return json({error:'NOT_FOUND'},404);
}} satisfies ExportedHandler<SmokeEnv>;
