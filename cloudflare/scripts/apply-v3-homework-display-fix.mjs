import fs from 'node:fs';

const [,, serverFile = 'src/v3.ts', htmlFile = 'public/index.html'] = process.argv;
const server = fs.readFileSync(serverFile, 'utf8');
let html = fs.readFileSync(htmlFile, 'utf8');

const newEditable = `function editableHomeworkHtml_(homeworkId,type,status,date,group){const title=homeworkTypeLabel_(type),note=homeworkTypeNote_(type),noteHtml=note?\`<span class=\"homeNote\">\${esc(note)}</span>\`:'',id=esc(homeworkId);if(status==='NO_TARGET_CLAIM')return \`<div class=\"homeItem noTarget\" data-home=\"\${id}\" data-status=\"UNINPUT\" data-no-target-undo=\"true\" data-home-type=\"\${type}\" role=\"button\" tabindex=\"0\"><span class=\"noTargetUndo\"><b>\${title}</b><span>対象なし</span></span></div>\`;const done=status==='DECLARED_DONE',dateHtml=done&&date?\`<span class=\"homeDoneDate\">\${formatShortDate_(date)}</span>\`:'',encourage=done?goodHtml_(group,type,date,homeworkId):'';return \`<div class=\"homeItem\" data-home-type=\"\${type}\"><b>\${title}</b>\${noteHtml}<div class=\"homeActions\"><label class=\"homeDoneCheck\"><input type=\"checkbox\" data-home-check data-home=\"\${id}\" data-home-type=\"\${type}\" \${done?'checked':''}><span>宿題済み</span>\${dateHtml}</label>\${encourage}\${!done&&type==='TRY_REDO'?\`<button data-home=\"\${id}\" data-status=\"NO_TARGET_CLAIM\" data-home-type=\"\${type}\">対象なし</button>\`:''}</div></div>\`}`;

const editablePattern = /function editableHomeworkHtml_\(homeworkId,type,status,date,group\)\{[\s\S]*?\}\n\s*function homeworkArchiveKey_/;
if (!editablePattern.test(html)) throw new Error('student homework editable renderer not found');
html = html.replace(editablePattern, `${newEditable}\n  function homeworkArchiveKey_`);

const newHandler = `async function handleStudentHomework_(action){const isCheck=action.matches('[data-home-check]'),status=isCheck?(action.checked?'DECLARED_DONE':'UNINPUT'):action.dataset.status,homeworkId=action.dataset.home,type=action.dataset.homeType||action.closest('.homeItem')?.dataset.homeType||'TRY_REDO',noTargetUndo=action.dataset.noTargetUndo==='true';if(!isCheck&&status==='UNINPUT'&&noTargetUndo){if(!confirm('対象なしを取り消して、未確認の状態へ戻しますか？'))return}if(status==='NO_TARGET_CLAIM'&&!confirm('TRYの直しはありませんでしたか？'))return;const item=action.closest('.homeItem');paintHomeworkOptimistic_(item,homeworkId,type,status);beginSave_();try{await call('declareHomework',{homeworkId,studentStatus:status});state.homeworkCache=null;endSave_();await renderStudentHomework_()}catch(error){failSave_();toast(error.message);await renderStudentHomework_()}}`;

const handlerPattern = /async function handleStudentHomework_\(action\)\{[\s\S]*?\}\n\s*async function renderStudentHomework_/;
if (!handlerPattern.test(html)) throw new Error('student homework handler not found');
html = html.replace(handlerPattern, `${newHandler}\n  async function renderStudentHomework_`);

const css = `.homeDoneCheck{display:inline-flex;align-items:center;gap:8px;min-height:38px;padding:6px 10px;border:1px solid #cfd9e6;border-radius:9px;background:#fff;color:#3f506b;font-size:11px;font-weight:900;cursor:pointer;user-select:none}.homeDoneCheck input{width:22px;height:22px;margin:0;accent-color:var(--green);cursor:pointer}.homeDoneCheck:has(input:checked){border-color:#9fd8c5;background:#e8f7f1;color:#126b52}.homeDoneDate{font-size:10px;color:var(--muted);font-weight:800}`;
if (!html.includes(css)) html = html.replace('</style>', `${css}</style>`);

const required = [
  'async function handleStudentHomework_(action)',
  'paintHomeworkOptimistic_(item,homeworkId,type,status)',
  "callApi_('declareHomework'",
  'applyHomeworkCheckToCache_(out.homework)',
  'await renderStudentHomework_()',
  'data-home-check',
  'type="checkbox"',
  "action.checked?'DECLARED_DONE':'UNINPUT'",
  '宿題済み',
];
for (const needle of required) {
  if (!html.includes(needle)) throw new Error(`homework checkbox UI contract missing: ${needle}`);
}
if (!server.includes('homework,elapsedMs:elapsed(started)')) {
  throw new Error('V3 homework save response does not expose homework object');
}

fs.writeFileSync(htmlFile, html);
console.log('Converted student homework done control to checkbox; checked=DECLARED_DONE unchecked=UNINPUT');
