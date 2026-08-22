type Row = Record<string, unknown>;
type AuditEnv = Env & { AUDIT_TOKEN: string };
const text=(v:unknown)=>String(v??'').trim();
const headers={"content-type":"application/json; charset=utf-8","cache-control":"no-store"};
const json=(v:unknown,s=200)=>new Response(JSON.stringify(v),{status:s,headers});
const authorized=(req:Request,env:AuditEnv)=>((req.headers.get('authorization')||'').replace(/^Bearer\s+/i,''))===env.AUDIT_TOKEN;
export default {async fetch(req:Request,env:AuditEnv){
  if(!authorized(req,env))return json({error:'NOT_FOUND'},404);
  const [legacyCounts,snapshotCounts,mismatch,overrides,missingLegacy,missingV3]=await env.DB.batch([
    env.DB.prepare(`SELECT status,COUNT(*) AS count FROM homework_records GROUP BY status ORDER BY status`),
    env.DB.prepare(`SELECT status,COUNT(*) AS count FROM v3_homework_snapshot GROUP BY status ORDER BY status`),
    env.DB.prepare(`SELECT h.student_id,h.homework_id,h.status AS legacy_status,v.status AS v3_status FROM homework_records h JOIN v3_homework_snapshot v ON v.student_id=h.student_id AND v.homework_id=h.homework_id WHERE COALESCE(h.status,'')<>COALESCE(v.status,'') ORDER BY h.student_id,h.homework_id LIMIT 500`),
    env.DB.prepare(`SELECT o.student_id,o.homework_id,h.status AS legacy_status,v.status AS v3_status,o.student_status,o.teacher_status,o.updated_at,o.updated_by FROM v3_homework_overrides o LEFT JOIN homework_records h ON h.student_id=o.student_id AND h.homework_id=o.homework_id LEFT JOIN v3_homework_snapshot v ON v.student_id=o.student_id AND v.homework_id=o.homework_id ORDER BY o.student_id,o.updated_at,o.homework_id`),
    env.DB.prepare(`SELECT COUNT(*) AS count FROM homework_records h LEFT JOIN v3_homework_snapshot v ON v.student_id=h.student_id AND v.homework_id=h.homework_id WHERE v.homework_id IS NULL`),
    env.DB.prepare(`SELECT COUNT(*) AS count FROM v3_homework_snapshot v LEFT JOIN homework_records h ON h.student_id=v.student_id AND h.homework_id=v.homework_id WHERE h.homework_id IS NULL`),
  ]);
  const rows=overrides.results as Row[];
  const normalize=(v:unknown)=>text(v).toUpperCase();
  const doneLike=new Set(['DECLARED_DONE','VERIFIED','DONE','COMPLETED','NOT_APPLICABLE','NO_TARGET_CLAIM']);
  const undoneLike=new Set(['UNINPUT','NOT_DONE','UNCONFIRMED','']);
  const suspicious=rows.filter(r=>String(r.student_id)!=='1320' && doneLike.has(normalize(r.legacy_status||r.v3_status)) && undoneLike.has(normalize(r.student_status)));
  return json({ok:true,legacyCounts:legacyCounts.results,snapshotCounts:snapshotCounts.results,mismatchCount:mismatch.results.length,mismatches:mismatch.results,missingLegacy:Number((missingLegacy.results[0] as Row)?.count||0),missingV3:Number((missingV3.results[0] as Row)?.count||0),overrideCount:rows.length,overrides:rows,suspiciousRealStudentDowngrades:suspicious});
}} satisfies ExportedHandler<AuditEnv>;
