import fs from 'node:fs';

const file = process.argv[2] || 'src/v3.ts';
let src = fs.readFileSync(file, 'utf8');

const alreadyApplied = src.includes('CREATE TABLE IF NOT EXISTS v3_homework_items') &&
  src.includes('generatedHomeworkCount') &&
  src.includes('mergeHomeworkPayload(value,generatedResult.results.filter(isRow))');
if (alreadyApplied) {
  console.log('V3 runtime fast path already applied; generated-homework support preserved');
  process.exit(0);
}

const bootstrapMatches = src.match(/await ensureBootstrap\(env\);/g) || [];
if (bootstrapMatches.length < 7) throw new Error(`Expected V3 bootstrap calls, found ${bootstrapMatches.length}`);

src = src.replaceAll('await ensureBootstrap(env);', '');
const healthNeedle = 'const started=performance.now();';
if (!src.includes(healthNeedle)) throw new Error('Health bootstrap insertion point not found');
src = src.replace(healthNeedle, 'const started=performance.now();await ensureBootstrap(env);');

const cacheNeedle = 'if (!token) return;\n  await ensureSchema(env);\n  const profile';
if (!src.includes(cacheNeedle)) throw new Error('cacheSession schema fast-path point not found');
src = src.replace(cacheNeedle, 'if (!token) return;\n  const profile');

const localNeedle = 'if (!token) return null;\n  await ensureSchema(env);\n  const hash';
if (!src.includes(localNeedle)) throw new Error('localSession schema fast-path point not found');
src = src.replace(localNeedle, 'if (!token) return null;\n  const hash');

const progressQueryNeedle = `    env.DB.prepare(\`SELECT p.record_id,p.material_id,p.subject,p.grade,p.unit_id,p.round,p.point_confirmed,p.warmup_confirmed,p.try_completed,p.memorization_completed,p.exercise_completed,p.lct_result,p.learning_date,p.updated_at,p.version,u.title AS unit_title,u.unit_order
      FROM v3_progress_records p LEFT JOIN units u ON u.unit_id=p.unit_id WHERE p.student_id=? ORDER BY p.subject,u.unit_order,p.round\`).bind(studentId),`;
if (!src.includes(progressQueryNeedle)) throw new Error('Progress dashboard query point not found');
const progressQueryReplacement = `    env.DB.prepare(\`SELECT p.record_id,p.material_id,p.subject,p.grade,p.unit_id,p.round,p.point_confirmed,p.warmup_confirmed,p.try_completed,p.memorization_completed,p.exercise_completed,p.lct_result,p.learning_date,p.updated_at,p.version,u.title AS unit_title,u.unit_order,COALESCE(m.series,'FORESTA_STEP') AS series
      FROM v3_progress_records p LEFT JOIN units u ON u.unit_id=p.unit_id LEFT JOIN materials m ON m.material_id=u.material_id WHERE p.student_id=? ORDER BY p.subject,m.series,u.unit_order,p.round\`).bind(studentId),`;
src = src.replace(progressQueryNeedle, progressQueryReplacement);

const targetNeedle = `  const targets = targetResult.results.filter(isRow).map((row) => ({ ...row }));
  const targetByKey = new Map(targets.map((row) => [\`${'${text(row.series)}|${text(row.subject)}|${text(row.unit_id)}'}\`, row]));
  for (const override of overrideResult.results.filter(isRow)) {
    const key = \`${'${text(override.series)}|${text(override.subject)}|${text(override.unit_id)}'}\`;
    const current = targetByKey.get(key);
    if (current) current.included = bool(override.included) ? 1 : 0;
    else targets.push({ target_id:\`V3:${'${studentId}'}:${'${text(override.series)}'}:${'${text(override.unit_id)}'}\`, material_id:"", subject:text(override.subject), unit_id:text(override.unit_id), target_start:text(override.unit_id), target_end:text(override.unit_id), target_period:"V3_OVERRIDE", included:bool(override.included)?1:0, series:text(override.series) });
  }
  const selectableResult =`;
if (!src.includes(targetNeedle)) throw new Error('Target override merge point not found');
const targetReplacement = `  const targets = targetResult.results.filter(isRow).map((row) => ({ ...row }));
  for (const override of overrideResult.results.filter(isRow)) {
    const unitId = text(override.unit_id);
    const subject = text(override.subject);
    const series = text(override.series) || "FORESTA_STEP";
    const included = bool(override.included);
    const matching = targets.filter((row) => text(row.unit_id) === unitId && text(row.subject) === subject);
    if (matching.length) matching.forEach((row) => { row.included = included ? 1 : 0; row.series = series; });
    else if (included) targets.push({ target_id:\`V3:${'${studentId}'}:${'${series}'}:${'${unitId}'}\`, material_id:"", subject, unit_id:unitId, target_start:unitId, target_end:unitId, target_period:"V3_OVERRIDE", included:1, series });
  }
  const selectableResult =`;
src = src.replace(targetNeedle, targetReplacement);

const homeworkOwnerNeedle = `  const byId=await homeworkStudentIds(env,ids);
  for(const id of ids){const owner=byId.get(id)||"";if(!owner||(session.role==="STUDENT"&&owner!==session.userId))return json({success:false,error:"宿題の生徒を特定できません。"},403);}`;
if (!src.includes(homeworkOwnerNeedle)) throw new Error('Homework owner validation point not found');
const homeworkOwnerReplacement = `  const byId=await homeworkStudentIds(env,ids);
  if(session.role==="STUDENT"&&action==="declareHomework"){
    for(const id of ids){if(!byId.get(id))byId.set(id,session.userId);}
  }
  for(const id of ids){const owner=byId.get(id)||"";if(!owner||(session.role==="STUDENT"&&owner!==session.userId))return json({success:false,error:"宿題の生徒を特定できません。"},403);}`;
src = src.replace(homeworkOwnerNeedle, homeworkOwnerReplacement);

const homeworkReturnNeedle = `  }
  return json({success:true,elapsedMs:elapsed(started),source:"D1_V3_ISOLATED"},200,{"x-data-source":"cloudflare-d1-v3-isolated"});
};

const overlayHomework=`;
if (!src.includes(homeworkReturnNeedle)) throw new Error('Homework save return point not found');
const homeworkReturnReplacement = `  }
  const verifyResults=await env.DB.batch(ids.map((id)=>env.DB.prepare("SELECT student_status,student_completed_date,teacher_status,confirmation_memo FROM v3_homework_overrides WHERE student_id=? AND homework_id=?").bind(byId.get(id),id)));
  for(let index=0;index<ids.length;index++){
    const row=verifyResults[index].results[0] as Row|undefined;
    if(!row)return json({success:false,error:"宿題の保存確認に失敗しました。",code:"HOMEWORK_WRITE_NOT_FOUND"},500);
    if(action==="declareHomework"){
      const expected=text(body.studentStatus)||"UNINPUT";
      if(text(row.student_status)!==expected)return json({success:false,error:"宿題の保存内容が一致しません。",code:"HOMEWORK_WRITE_MISMATCH"},500);
    }else{
      const expected=action==="confirmHomeworkGroup"?"VERIFIED":text(body.teacherStatus)||"VERIFIED";
      if(text(row.teacher_status)!==expected)return json({success:false,error:"宿題確認の保存内容が一致しません。",code:"HOMEWORK_WRITE_MISMATCH"},500);
    }
  }
  const savedRow=verifyResults[0].results[0] as Row;
  const homework={
    homeworkId:ids[0],
    studentStatus:text(savedRow.student_status)||"UNINPUT",
    studentCompletedDate:text(savedRow.student_completed_date),
    teacherStatus:text(savedRow.teacher_status),
    confirmationMemo:text(savedRow.confirmation_memo),
  };
  return json({success:true,verified:true,homework,elapsedMs:elapsed(started),source:"D1_V3_ISOLATED"},200,{"x-data-source":"cloudflare-d1-v3-isolated"});
};

const overlayHomework=`;
src = src.replace(homeworkReturnNeedle, homeworkReturnReplacement);

const overlayNeedle = `const overlayHomework=(value:Row,overrides:Row[])=>{
  const byId=new Map(overrides.map((row)=>[text(row.homework_id),row]));
  const patch=(item:unknown)=>{if(!isRow(item))return item;const o=byId.get(text(item.homeworkId));if(!o)return item;const out:Row={...item};if(o.student_status!=null)out.studentStatus=text(o.student_status);if(o.student_completed_date!=null)out.studentCompletedDate=text(o.student_completed_date);if(o.teacher_status!=null)out.teacherStatus=text(o.teacher_status);if(o.confirmation_memo!=null)out.confirmationMemo=text(o.confirmation_memo);return out;};
  const out:Row={...value};if(Array.isArray(value.homework))out.homework=value.homework.map(patch);if(Array.isArray(value.groups))out.groups=value.groups.map((group)=>isRow(group)?{...group,items:Array.isArray(group.items)?group.items.map(patch):group.items}:group);return out;
};`;
if (!src.includes(overlayNeedle)) throw new Error('Homework overlay point not found');
const overlayReplacement = `const overlayHomework=(value:Row,overrides:Row[])=>{
  const byId=new Map(overrides.map((row)=>[text(row.homework_id),row]));
  const visit=(node:unknown):unknown=>{
    if(Array.isArray(node))return node.map(visit);
    if(!isRow(node))return node;
    const out:Row={};
    for(const [key,child] of Object.entries(node))out[key]=visit(child);
    const id=text(out.homeworkId||out.homework_id);
    const o=id?byId.get(id):undefined;
    if(o){
      if(o.student_status!=null)out.studentStatus=text(o.student_status);
      if(o.student_completed_date!=null)out.studentCompletedDate=text(o.student_completed_date);
      if(o.teacher_status!=null)out.teacherStatus=text(o.teacher_status);
      if(o.confirmation_memo!=null)out.confirmationMemo=text(o.confirmation_memo);
    }
    return out;
  };
  return visit(value) as Row;
};`;
src = src.replace(overlayNeedle, overlayReplacement);

const listReturnNeedle = `  const patched=overlayHomework(value,overrideResult.results.filter(isRow));patched.archivedGroupKeys=archiveResult.results.filter(isRow).map((row)=>text(row.group_key));patched.source="GOOGLE_STRUCTURE_D1_V3_STATE";return json(patched,upstream.status,{"x-data-source":"google-structure+d1-v3-state"});`;
if (!src.includes(listReturnNeedle)) throw new Error('Homework list return point not found');
const listReturnReplacement = `  const patched=overlayHomework(value,overrideResult.results.filter(isRow));
  const archivedGroupKeys=archiveResult.results.filter(isRow).map((row)=>text(row.group_key));
  patched.archivedGroupKeys=archivedGroupKeys;patched.source="GOOGLE_STRUCTURE_D1_V3_STATE";
  if(isRow(patched.data)){patched.data={...patched.data,archivedGroupKeys,source:"GOOGLE_STRUCTURE_D1_V3_STATE"};}
  return json(patched,upstream.status,{"x-data-source":"google-structure+d1-v3-state"});`;
src = src.replace(listReturnNeedle, listReturnReplacement);

fs.writeFileSync(file, src);
console.log(`Applied V3 runtime fast path; homework save now returns browser-compatible homework object`);
