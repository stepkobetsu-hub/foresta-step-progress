import fs from 'node:fs';

const [,, serverFile = 'src/v3.ts', htmlFile = 'public/index.html'] = process.argv;
let server = fs.readFileSync(serverFile, 'utf8');
let html = fs.readFileSync(htmlFile, 'utf8');

const serverNeedle = 'const patched=overlayHomework(value,overrideResult.results.filter(isRow));\n  const archivedGroupKeys=archiveResult.results.filter(isRow).map((row)=>text(row.group_key));\n  patched.archivedGroupKeys=archivedGroupKeys;patched.source="GOOGLE_STRUCTURE_D1_V3_STATE";\n  if(isRow(patched.data)){patched.data={...patched.data,archivedGroupKeys,source:"GOOGLE_STRUCTURE_D1_V3_STATE"};}\n  return json(patched,upstream.status,{"x-data-source":"google-structure+d1-v3-state"});';
if (!server.includes(serverNeedle)) throw new Error('server homework list return point not found');
const serverReplacement = 'const v3HomeworkOverrides=overrideResult.results.filter(isRow);\n  const patched=overlayHomework(value,v3HomeworkOverrides);\n  const archivedGroupKeys=archiveResult.results.filter(isRow).map((row)=>text(row.group_key));\n  patched.archivedGroupKeys=archivedGroupKeys;patched.v3HomeworkOverrides=v3HomeworkOverrides;patched.source="GOOGLE_STRUCTURE_D1_V3_STATE";\n  if(isRow(patched.data)){patched.data={...patched.data,archivedGroupKeys,v3HomeworkOverrides,source:"GOOGLE_STRUCTURE_D1_V3_STATE"};}\n  return json(patched,upstream.status,{"x-data-source":"google-structure+d1-v3-state"});';
server = server.replace(serverNeedle, serverReplacement);

// IMPORTANT: replace the REAL student click handler before inserting the helper.
// The previous version inserted the helper first, then replaced the first matching
// declareHomework call, which accidentally changed the helper itself and left the
// real click handler untouched.
const directCall = "await call('declareHomework',{homeworkId,studentStatus:status})";
const directCount = html.split(directCall).length - 1;
if (directCount !== 1) throw new Error(`expected exactly one real student declareHomework call before helper insertion, found ${directCount}`);
const rawIndex = html.indexOf(directCall);
console.log('REAL_HOMEWORK_HANDLER_CONTEXT_START');
console.log(html.slice(Math.max(0,rawIndex-1000),rawIndex+1800));
console.log('REAL_HOMEWORK_HANDLER_CONTEXT_END');
html = html.replace(directCall, "await optimisticDeclareHomework_(homeworkId,status)");

// Do not throw away the locally-updated homework state immediately after save.
const realOptimisticIndex=html.indexOf("await optimisticDeclareHomework_(homeworkId,status)");
if (realOptimisticIndex < 0) throw new Error('real optimistic homework call missing');
const realTail=html.slice(realOptimisticIndex,realOptimisticIndex+900);
const nullOffset=realTail.indexOf('state.homeworkCache=null;');
if (nullOffset >= 0) {
  const absolute=realOptimisticIndex+nullOffset;
  html=html.slice(0,absolute)+html.slice(absolute+'state.homeworkCache=null;'.length);
}

const renderNeedle = "async function renderStudentHomework_(){if(!state.homeworkCache)state.homeworkCache=await call('listHomework');const home=state.homeworkCache";
if (!html.includes(renderNeedle)) throw new Error('student homework render point not found');

const helper = `function applyV3HomeworkOverridesClient_(home){\n    const rows=Array.isArray(home?.v3HomeworkOverrides)?home.v3HomeworkOverrides:[];\n    if(!rows.length)return home;\n    const byId=new Map(rows.map(row=>[String(row.homework_id||row.homeworkId||''),row]));\n    const visit=node=>{\n      if(Array.isArray(node))return node.map(visit);\n      if(!node||typeof node!=='object')return node;\n      const out={};for(const [key,value] of Object.entries(node))out[key]=visit(value);\n      const id=String(out.homeworkId||out.homework_id||'');const row=id?byId.get(id):null;\n      if(row){\n        if(row.student_status!=null)out.studentStatus=String(row.student_status);\n        if(row.student_completed_date!=null)out.studentCompletedDate=String(row.student_completed_date);\n        if(row.teacher_status!=null)out.teacherStatus=String(row.teacher_status);\n        if(row.confirmation_memo!=null)out.confirmationMemo=String(row.confirmation_memo);\n      }\n      return out;\n    };\n    return visit(home);\n  }\n\n  function patchHomeworkStatusLocal_(home,homeworkId,status){\n    if(!home)return home;\n    const completedDate=status==='DECLARED_DONE'?new Date().toISOString().slice(0,10):null;\n    const visit=node=>{\n      if(Array.isArray(node))return node.map(visit);\n      if(!node||typeof node!=='object')return node;\n      const out={};for(const [key,value] of Object.entries(node))out[key]=visit(value);\n      const id=String(out.homeworkId||out.homework_id||'');\n      if(id===String(homeworkId)){out.studentStatus=status;out.studentCompletedDate=completedDate;}\n      return out;\n    };\n    const next=visit(home);\n    const rows=Array.isArray(next?.v3HomeworkOverrides)?next.v3HomeworkOverrides.map(row=>({...row})):[];\n    const found=rows.find(row=>String(row.homework_id||row.homeworkId||'')===String(homeworkId));\n    if(found){found.student_status=status;found.student_completed_date=completedDate;}\n    else rows.push({homework_id:String(homeworkId),student_status:status,student_completed_date:completedDate});\n    next.v3HomeworkOverrides=rows;\n    return next;\n  }\n\n  async function optimisticDeclareHomework_(homeworkId,status){\n    const before=state.homeworkCache?JSON.parse(JSON.stringify(state.homeworkCache)):null;\n    state.homeworkCache=patchHomeworkStatusLocal_(state.homeworkCache,homeworkId,status);\n    await renderStudentHomework_();\n    try{return await call('declareHomework',{homeworkId,studentStatus:status});}\n    catch(error){state.homeworkCache=before;await renderStudentHomework_();throw error;}\n  }\n  `;

const renderReplacement = helper + "async function renderStudentHomework_(){if(!state.homeworkCache)state.homeworkCache=applyV3HomeworkOverridesClient_(await call('listHomework'));const home=state.homeworkCache";
html = html.replace(renderNeedle, renderReplacement);
html = html.replaceAll("state.homeworkCache=await call('listHomework')", "state.homeworkCache=applyV3HomeworkOverridesClient_(await call('listHomework'))");

// Validate that the real handler is optimistic AND the helper still performs the
// actual API call. This catches the exact bug that caused the previous false fix.
if (!html.includes('await optimisticDeclareHomework_(homeworkId,status)')) throw new Error('real student homework click is not optimistic');
if (!html.includes("try{return await call('declareHomework',{homeworkId,studentStatus:status});}")) throw new Error('optimistic helper lost its real API call');
const finalDirectCount = html.split(directCall).length - 1;
if (finalDirectCount !== 1) throw new Error(`expected only helper API call after patch, found ${finalDirectCount}`);
if (!server.includes('v3HomeworkOverrides=v3HomeworkOverrides')) throw new Error('server override exposure missing');
if (!html.includes('function applyV3HomeworkOverridesClient_')) throw new Error('browser override helper missing');
if (!html.includes('function patchHomeworkStatusLocal_')) throw new Error('local homework patch helper missing');
if (!html.includes('async function optimisticDeclareHomework_')) throw new Error('optimistic homework helper missing');

fs.writeFileSync(serverFile, server);
fs.writeFileSync(htmlFile, html);
console.log('Fixed real student homework click handler: optimistic UI now targets the actual click path');
