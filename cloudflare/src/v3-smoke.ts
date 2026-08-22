type Row = Record<string, unknown>;
type SmokeEnv = Env & { SMOKE_TOKEN: string };
const headers={"content-type":"application/json; charset=utf-8","cache-control":"no-store"};
const json=(v:unknown,s=200)=>new Response(JSON.stringify(v),{status:s,headers});
const text=(v:unknown)=>String(v??"").trim();
const isRow=(v:unknown):v is Row=>typeof v==="object"&&v!==null&&!Array.isArray(v);
const authorized=(request:Request,env:SmokeEnv)=>Boolean(env.SMOKE_TOKEN)&&((request.headers.get("authorization")||"").replace(/^Bearer\s+/i,""))===env.SMOKE_TOKEN;
const audit=async(env:SmokeEnv)=>{
  const ids=['1100','1097','1214','1257','1276','1312'];
  const base=await env.DB.prepare(`SELECT t.student_id,s.display_name,t.subject,COUNT(*) target_count FROM v3_target_snapshot t JOIN students s ON s.student_id=t.student_id WHERE t.student_id IN ('1100','1097','1214','1257','1276','1312') AND t.included=1 GROUP BY t.student_id,s.display_name,t.subject ORDER BY t.student_id,t.subject`).all();
  const effective=await env.DB.prepare(`WITH b AS (
    SELECT t.student_id,t.subject,t.target_start unit_id,COALESCE(m.series,'FORESTA_STEP') series,COALESCE(o.included,t.included) included
    FROM v3_target_snapshot t LEFT JOIN units u ON u.unit_id=t.target_start LEFT JOIN materials m ON m.material_id=u.material_id
    LEFT JOIN v3_target_overrides o ON o.student_id=t.student_id AND o.unit_id=t.target_start AND o.subject=t.subject AND o.series=COALESCE(m.series,'FORESTA_STEP')
    WHERE t.student_id IN ('1100','1097','1214','1257','1276','1312')
  ), extra AS (
    SELECT o.student_id,o.subject,o.unit_id,o.series,o.included FROM v3_target_overrides o
    WHERE o.student_id IN ('1100','1097','1214','1257','1276','1312') AND NOT EXISTS (
      SELECT 1 FROM v3_target_snapshot t LEFT JOIN units u ON u.unit_id=t.target_start LEFT JOIN materials m ON m.material_id=u.material_id
      WHERE t.student_id=o.student_id AND t.target_start=o.unit_id AND t.subject=o.subject AND COALESCE(m.series,'FORESTA_STEP')=o.series)
  ), e AS (SELECT * FROM b UNION ALL SELECT * FROM extra)
  SELECT e.student_id,s.display_name,e.subject,COUNT(*) target_count FROM e JOIN students s ON s.student_id=e.student_id WHERE e.included=1 GROUP BY e.student_id,s.display_name,e.subject ORDER BY e.student_id,e.subject`).all();
  const meta=await env.DB.prepare(`SELECT (SELECT COUNT(*) FROM v3_target_snapshot) restored_targets,(SELECT COUNT(*) FROM v3_target_snapshot WHERE material_id IS NULL) missing_units,(SELECT COUNT(*) FROM v3_target_overrides) overrides,(SELECT COUNT(*) FROM v3_progress_records) progress,(SELECT COUNT(*) FROM v3_homework_snapshot) homework`).first<Row>();
  return json({ok:true,overrides:[meta||{}],snapshot:[...base.results.map((r:any)=>({...r,source:'BASE'})),...effective.results.map((r:any)=>({...r,source:'EFFECTIVE'}))]});
};
export default{async fetch(request:Request,env:SmokeEnv):Promise<Response>{if(!authorized(request,env))return json({error:'NOT_FOUND'},404);if(request.method!=='POST')return json({error:'METHOD_NOT_ALLOWED'},405);const value:unknown=await request.json().catch(()=>null);if(!isRow(value))return json({error:'INVALID_JSON'},400);if(text(value.action)==='inspectRecent1320')return audit(env);return json({error:'NOT_FOUND'},404)}} satisfies ExportedHandler<SmokeEnv>;
