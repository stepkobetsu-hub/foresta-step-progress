import fs from 'node:fs';

const [,, serverFile = 'src/v3.ts', htmlFile = 'public/index.html'] = process.argv;
const server = fs.readFileSync(serverFile, 'utf8');
let html = fs.readFileSync(htmlFile, 'utf8');

const requiredNative = [
  'async function handleStudentHomework_(action)',
  'function editableHomeworkHtml_',
  'paintHomeworkOptimistic_(item,homeworkId,type,status)',
  "callApi_('declareHomework'",
  'applyHomeworkCheckToCache_(out.homework)',
  'await renderStudentHomework_()',
];
for (const needle of requiredNative) {
  if (!html.includes(needle)) throw new Error(`native homework UI contract missing: ${needle}`);
}
if (!server.includes('homework,elapsedMs:elapsed(started)')) {
  throw new Error('V3 homework save response does not expose homework object');
}

const css = `.homeDoneCheck{display:inline-flex;align-items:center;gap:8px;min-height:38px;padding:6px 10px;border:1px solid #cfd9e6;border-radius:9px;background:#fff;color:#3f506b;font-size:11px;font-weight:900;cursor:pointer;user-select:none}.homeDoneCheck input{width:22px;height:22px;margin:0;accent-color:var(--green);cursor:pointer}.homeDoneCheck:has(input:checked){border-color:#9fd8c5;background:#e8f7f1;color:#126b52}.homeDoneDate{font-size:10px;color:var(--muted);font-weight:800}`;
if (!html.includes(css)) html = html.replace('</style>', `${css}</style>`);

const marker = 'HOMEWORK_CHECKBOX_UI_V1';
const patchScript = `<script>
/* ${marker} */
(()=>{
  const nativeEditable=editableHomeworkHtml_;
  editableHomeworkHtml_=function(homeworkId,type,status,date,group){
    let out=nativeEditable(homeworkId,type,status,date,group);
    if(status==='NO_TARGET_CLAIM')return out;
    const id=esc(homeworkId),kind=esc(type),done=status==='DECLARED_DONE';
    const dateHtml=done&&date?\`<span class="homeDoneDate">\${formatShortDate_(date)}</span>\`:'';
    const control=\`<label class="homeDoneCheck"><input type="checkbox" data-home-check data-home="\${id}" data-home-type="\${kind}" \${done?'checked':''}><span>\${done?'宿題済み':'チェック'}</span>\${dateHtml}</label>\`;
    if(done)out=out.replace(/<button class="homeDone"[\\s\\S]*?<\\/button>/,control);
    else out=out.replace(/<button([^>]*)>やりました<\\/button>/,control);
    return out;
  };

  const nativeHandle=handleStudentHomework_;
  handleStudentHomework_=async function(action){
    if(!action?.matches?.('[data-home-check]'))return nativeHandle(action);
    const status=action.checked?'DECLARED_DONE':'UNINPUT';
    const homeworkId=action.dataset.home,type=action.dataset.homeType||action.closest('.homeItem')?.dataset.homeType||'TRY_REDO';
    const item=action.closest('.homeItem');
    paintHomeworkOptimistic_(item,homeworkId,type,status);
    beginSave_();
    try{
      await call('declareHomework',{homeworkId,studentStatus:status});
      state.homeworkCache=null;
      if(typeof clearStudentViewCache_==='function')clearStudentViewCache_();
      endSave_();
      await renderStudentHomework_();
    }catch(error){
      failSave_();toast(error.message);await renderStudentHomework_();
    }
  };
})();
</script>`;
if (!html.includes(marker)) {
  if (!html.includes('</body>')) throw new Error('HTML body end not found');
  html = html.replace('</body>', `${patchScript}</body>`);
}

for (const needle of [marker,'data-home-check','type="checkbox"','チェック','宿題済み',"action.checked?'DECLARED_DONE':'UNINPUT'"]) {
  if (!html.includes(needle)) throw new Error(`homework checkbox patch missing: ${needle}`);
}

fs.writeFileSync(htmlFile, html);
console.log('Injected student homework checkbox UI; unchecked label=チェック checked label=宿題済み');
