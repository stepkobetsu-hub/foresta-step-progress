import fs from 'node:fs';

const [,, serverFile = 'src/v3.ts', htmlFile = 'public/index.html'] = process.argv;
let server = fs.readFileSync(serverFile, 'utf8');
let html = fs.readFileSync(htmlFile, 'utf8');

// Expose the exact D1 homework overrides alongside the Google-derived structure.
// Put them both at the wrapper level and under data so this survives either
// response shape and whatever unwrapping the browser's call() helper performs.
const serverNeedle = 'const patched=overlayHomework(value,overrideResult.results.filter(isRow));\n  const archivedGroupKeys=archiveResult.results.filter(isRow).map((row)=>text(row.group_key));\n  patched.archivedGroupKeys=archivedGroupKeys;patched.source="GOOGLE_STRUCTURE_D1_V3_STATE";\n  if(isRow(patched.data)){patched.data={...patched.data,archivedGroupKeys,source:"GOOGLE_STRUCTURE_D1_V3_STATE"};}\n  return json(patched,upstream.status,{"x-data-source":"google-structure+d1-v3-state"});';
if (!server.includes(serverNeedle)) throw new Error('server homework list return point not found');
const serverReplacement = 'const v3HomeworkOverrides=overrideResult.results.filter(isRow);\n  const patched=overlayHomework(value,v3HomeworkOverrides);\n  const archivedGroupKeys=archiveResult.results.filter(isRow).map((row)=>text(row.group_key));\n  patched.archivedGroupKeys=archivedGroupKeys;patched.v3HomeworkOverrides=v3HomeworkOverrides;patched.source="GOOGLE_STRUCTURE_D1_V3_STATE";\n  if(isRow(patched.data)){patched.data={...patched.data,archivedGroupKeys,v3HomeworkOverrides,source:"GOOGLE_STRUCTURE_D1_V3_STATE"};}\n  return json(patched,upstream.status,{"x-data-source":"google-structure+d1-v3-state"});';
server = server.replace(serverNeedle, serverReplacement);

// Browser-side final authority: regardless of how Google nests the list, apply
// D1 state again by homeworkId immediately before rendering. This is deliberately
// redundant with the server overlay; the user's real clicks proved writes reach D1,
// so display must never be able to hide them.
const renderNeedle = "async function renderStudentHomework_(){if(!state.homeworkCache)state.homeworkCache=await call('listHomework');const home=state.homeworkCache";
if (!html.includes(renderNeedle)) throw new Error('student homework render point not found');
const helper = `function applyV3HomeworkOverridesClient_(home){\n    const rows=Array.isArray(home?.v3HomeworkOverrides)?home.v3HomeworkOverrides:[];\n    if(!rows.length)return home;\n    const byId=new Map(rows.map(row=>[String(row.homework_id||row.homeworkId||''),row]));\n    const visit=node=>{\n      if(Array.isArray(node))return node.map(visit);\n      if(!node||typeof node!=='object')return node;\n      const out={};for(const [key,value] of Object.entries(node))out[key]=visit(value);\n      const id=String(out.homeworkId||out.homework_id||'');const row=id?byId.get(id):null;\n      if(row){\n        if(row.student_status!=null)out.studentStatus=String(row.student_status);\n        if(row.student_completed_date!=null)out.studentCompletedDate=String(row.student_completed_date);\n        if(row.teacher_status!=null)out.teacherStatus=String(row.teacher_status);\n        if(row.confirmation_memo!=null)out.confirmationMemo=String(row.confirmation_memo);\n      }\n      return out;\n    };\n    return visit(home);\n  }\n  `;
const renderReplacement = helper + "async function renderStudentHomework_(){if(!state.homeworkCache)state.homeworkCache=applyV3HomeworkOverridesClient_(await call('listHomework'));const home=state.homeworkCache";
html = html.replace(renderNeedle, renderReplacement);

// Any later refresh of homeworkCache must also pass through the D1 overlay.
html = html.replaceAll("state.homeworkCache=await call('listHomework')", "state.homeworkCache=applyV3HomeworkOverridesClient_(await call('listHomework'))");

if (!server.includes('v3HomeworkOverrides=v3HomeworkOverrides')) throw new Error('server override exposure missing');
if (!html.includes('function applyV3HomeworkOverridesClient_')) throw new Error('browser override helper missing');
if (!html.includes("state.homeworkCache=applyV3HomeworkOverridesClient_(await call('listHomework'))")) throw new Error('browser homework fetch is not overlaying D1 state');

fs.writeFileSync(serverFile, server);
fs.writeFileSync(htmlFile, html);
console.log('Applied explicit D1 homework state overlay to server response and browser rendering');
