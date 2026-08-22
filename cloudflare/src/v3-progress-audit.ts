type Row = Record<string, unknown>;
type AuditEnv = Env & { AUDIT_TOKEN: string };
const text=(v:unknown)=>String(v??'').trim();
const truthy=(v:unknown)=>v===true||v===1||text(v).toLowerCase()==='true';
const headers={"content-type":"application/json; charset=utf-8","cache-control":"no-store"};
const json=(v:unknown,s=200)=>new Response(JSON.stringify(v),{status:s,headers});
const authorized=(req:Request,env:AuditEnv)=>((req.headers.get('authorization')||'').replace(/^Bearer\s+/i,''))===env.AUDIT_TOKEN;
const key=(subject:unknown,series:unknown,unitId:unknown)=>`${text(subject)}|${text(series)||'FORESTA_STEP'}|${text(unitId)}`;
export default {async fetch(req:Request,env:AuditEnv){
  if(!authorized(req,env))return json({error:'NOT_FOUND'},404);
  const students=await env.DB.prepare(`SELECT student_id,display_name,grade,status FROM students WHERE display_name LIKE '田中%' ORDER BY student_id`).all<Row>();
  const output:Row[]=[];
  for(const student of students.results){
    const sid=text(student.student_id);
    const [targetsRes,overridesRes,progressRes]=await env.DB.batch([
      env.DB.prepare(`SELECT t.target_id,t.material_id,t.subject,t.target_start AS unit_id,t.target_period,t.included AS base_included,COALESCE(m.series,'FORESTA_STEP') AS series,u.title AS unit_title FROM v3_target_snapshot t LEFT JOIN units u ON u.unit_id=t.target_start LEFT JOIN materials m ON m.material_id=u.material_id WHERE t.student_id=? ORDER BY t.subject,t.target_period,t.target_id`).bind(sid),
      env.DB.prepare(`SELECT series,subject,unit_id,included FROM v3_target_overrides WHERE student_id=? ORDER BY subject,series,unit_id`).bind(sid),
      env.DB.prepare(`SELECT p.subject,p.unit_id,p.round,p.try_completed,p.lct_result,p.learning_date,COALESCE(m.series,'FORESTA_STEP') AS series FROM v3_progress_records p LEFT JOIN units u ON u.unit_id=p.unit_id LEFT JOIN materials m ON m.material_id=u.material_id WHERE p.student_id=? ORDER BY p.subject,p.unit_id,p.round`).bind(sid),
    ]);
    const targets:Row[]=(targetsRes.results as Row[]).map(r=>({...r,included:truthy(r.base_included)}));
    const overrides=overridesRes.results as Row[];
    for(const o of overrides){
      const matches=targets.filter(t=>text(t.unit_id)===text(o.unit_id)&&text(t.subject)===text(o.subject));
      if(matches.length)for(const t of matches){t.included=truthy(o.included);t.series=text(o.series)||'FORESTA_STEP';}
      else if(truthy(o.included))targets.push({target_id:`OVERRIDE:${sid}:${text(o.unit_id)}`,material_id:'',subject:text(o.subject),unit_id:text(o.unit_id),target_period:'V3_OVERRIDE',included:true,series:text(o.series)||'FORESTA_STEP'});
    }
    const included=targets.filter(t=>truthy(t.included));
    const unitIds=new Set(included.map(t=>text(t.unit_id)).filter(Boolean));
    const keys=new Set(included.map(t=>key(t.subject,t.series,t.unit_id)).filter(Boolean));
    const progress=progressRes.results as Row[];
    const completedByUnit=progress.filter(p=>unitIds.has(text(p.unit_id))&&[1,2,3].includes(Number(p.round))&&truthy(p.try_completed));
    const completedByKey=progress.filter(p=>keys.has(key(p.subject,p.series,p.unit_id))&&[1,2,3].includes(Number(p.round))&&truthy(p.try_completed));
    const byPeriod:Record<string,number>={};
    const bySeries:Record<string,number>={};
    const bySubject:Record<string,number>={};
    for(const t of included){const period=text(t.target_period)||'(blank)',series=text(t.series)||'FORESTA_STEP',subject=text(t.subject)||'(blank)';byPeriod[period]=(byPeriod[period]||0)+1;bySeries[series]=(bySeries[series]||0)+1;bySubject[subject]=(bySubject[subject]||0)+1;}
    const unitCounts=new Map<string,number>();for(const t of included){const id=text(t.unit_id);unitCounts.set(id,(unitCounts.get(id)||0)+1)}
    const duplicateUnitRows=Array.from(unitCounts.entries()).filter(([,count])=>count>1).sort((a,b)=>b[1]-a[1]).slice(0,30);
    output.push({student,rawIncludedRows:included.length,distinctUnitIds:unitIds.size,distinctSummaryKeys:keys.size,completedByUnit:completedByUnit.length,completedBySummaryKey:completedByKey.length,rateByUnit:unitIds.size?Math.round(completedByUnit.length/unitIds.size*1000)/10:null,rateBySummaryKey:keys.size?Math.round(completedByKey.length/keys.size*1000)/10:null,byPeriod,bySeries,bySubject,overrideCount:overrides.length,duplicateUnitRows});
  }
  return json({ok:true,students:output});
}} satisfies ExportedHandler<AuditEnv>;
