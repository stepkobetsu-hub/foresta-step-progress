interface Env { DB: D1Database; SMOKE_TOKEN: string }
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}});
export default {async fetch(req:Request,env:Env){
  if(req.headers.get('authorization')!==`Bearer ${env.SMOKE_TOKEN}`) return json({ok:false,error:'FORBIDDEN'},403);
  if(req.method!=='POST') return json({ok:false,error:'POST_ONLY'},405);
  const now=new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO students(student_id,display_name,name_kana,school,grade,status,source_updated_at,updated_at,version) VALUES('1331','鈴木A','スズキ','南城中','中3','ACTIVE',?,datetime('now'),1) ON CONFLICT(student_id) DO UPDATE SET display_name='鈴木A',name_kana='スズキ',school='南城中',grade='中3',status='ACTIVE',source_updated_at=excluded.source_updated_at,updated_at=datetime('now'),version=students.version+1`).bind(now),
    env.DB.prepare(`INSERT INTO student_profiles(student_id,campus,school_name,grade_j_raw,grade_k_raw,grade_conflict,enrollment_status,source_updated_at,updated_at,version) VALUES('1331','神領','南城中','中３','中３',0,'ACTIVE',?,datetime('now'),1) ON CONFLICT(student_id) DO UPDATE SET campus='神領',school_name='南城中',grade_j_raw='中３',grade_k_raw='中３',grade_conflict=0,enrollment_status='ACTIVE',source_updated_at=excluded.source_updated_at,updated_at=datetime('now'),version=student_profiles.version+1`).bind(now)
  ]);
  const student=await env.DB.prepare("SELECT student_id,display_name,name_kana,school,grade,status FROM students WHERE student_id='1331'").first();
  const profile=await env.DB.prepare("SELECT student_id,campus,school_name,grade_j_raw,grade_k_raw,grade_conflict,enrollment_status FROM student_profiles WHERE student_id='1331'").first();
  const progress=await env.DB.prepare("SELECT COUNT(*) AS count FROM v3_progress_records WHERE student_id='1331'").first<{count:number}>();
  const targets=await env.DB.prepare("SELECT COUNT(*) AS count FROM v3_target_overrides WHERE student_id='1331'").first<{count:number}>();
  return json({ok:true,student,profile,progressCount:Number(progress?.count||0),targetOverrideCount:Number(targets?.count||0)});
}} satisfies ExportedHandler<Env>;
