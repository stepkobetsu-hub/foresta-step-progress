interface Env { DB: D1Database; SMOKE_TOKEN: string }
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json","cache-control":"no-store"}});
export default {async fetch(req:Request,env:Env){
  if(req.headers.get('authorization')!==`Bearer ${env.SMOKE_TOKEN}`) return json({ok:false},403);
  const students=await env.DB.prepare("SELECT s.student_id,s.display_name,s.grade,s.status,p.campus,p.school_name FROM students s LEFT JOIN student_profiles p ON p.student_id=s.student_id WHERE s.student_id IN ('1320','1331') ORDER BY s.student_id").all();
  const out=[];
  for(const s of students.results as any[]){
    const units=await env.DB.prepare(`SELECT u.subject,m.series,COUNT(*) AS count FROM units u JOIN materials m ON m.material_id=u.material_id WHERE m.active=1 AND (u.grade='' OR u.grade=? OR u.grade='中1～中3共通' OR m.grade='' OR m.grade=? OR m.grade='中1～中3共通' OR (m.series='FORESTA_GOAL' AND ? IN ('中1','中2','中3') AND (u.grade='中3' OR m.grade='中3'))) GROUP BY u.subject,m.series ORDER BY u.subject,m.series`).bind(s.grade,s.grade,s.grade).all();
    out.push({student:s,counts:units.results});
  }
  return json({ok:true,students:out});
}} satisfies ExportedHandler<Env>;
