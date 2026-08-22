import fs from 'node:fs';

const file = process.argv[2] || 'public/index.html';
let html = fs.readFileSync(file, 'utf8');
const before = html;

html = html
  .replace(/^\uFEFF?Warning: truncated output \(original token count: \d+\)\r?\nTotal output lines: \d+\r?\n\r?\n/, '')
  .replaceAll('setTimeout(flushProgressBatch_,800)', 'setTimeout(flushProgressBatch_,300)')
  .replaceAll('queue.timer=setTimeout(flush,800)', 'queue.timer=setTimeout(flush,350)')
  .replaceAll("status.textContent='変更あり'", "status.textContent='自動保存待ち…'")
  .replaceAll("setGlobalSave_('保存する','pending')", "setGlobalSave_('自動保存待ち…','pending')");

// Homework changes every time the student checks an item. Never restore a
// homework list from localStorage after reload; only dashboard data is cached.
const loadHomeworkNeedle = 'state.dashboardCache=cached.dashboard||null;state.homeworkCache=cached.homework||null';
if (!html.includes(loadHomeworkNeedle) && !html.includes('state.dashboardCache=cached.dashboard||null;state.homeworkCache=null')) {
  throw new Error('student homework cache load point not found');
}
html = html.replace(loadHomeworkNeedle, 'state.dashboardCache=cached.dashboard||null;state.homeworkCache=null');

const saveHomeworkNeedle = 'dashboard:state.dashboardCache,homework:state.homeworkCache';
if (!html.includes(saveHomeworkNeedle) && !html.includes('dashboard:state.dashboardCache,homework:null')) {
  throw new Error('student homework cache save point not found');
}
html = html.replace(saveHomeworkNeedle, 'dashboard:state.dashboardCache,homework:null');

// Start the D1 dashboard request immediately. The homework screen can keep its
// current fast path, but the progress graph no longer waits for that path to
// finish before the dashboard request begins.
const landingNeedle = 'let needsHomework=state.studentLandingPending&&!state.homeworkCache,needsDashboard=!state.dashboardCache;';
const eagerNeedle = "const eagerDashboardPromise=needsDashboard?call('getStudentDashboard'):null;";
if (html.includes(landingNeedle) && !html.includes(eagerNeedle)) {
  html = html.replace(landingNeedle, `${landingNeedle}\n    ${eagerNeedle}`);
}
if (!html.includes(eagerNeedle)) throw new Error('eager dashboard request patch missing');

const earlyBackgroundNeedle = "if(needsDashboard)scheduleBackground_(()=>loadDashboardInBackground_(),0);";
const earlyBackgroundPatch = "if(eagerDashboardPromise)eagerDashboardPromise.then(out=>{state.dashboardCache=out.data;saveStudentViewCache_();return renderStudent()}).catch(error=>console.error('[dashboard-load-failed] '+String(error?.message||error)));";
html = html.replaceAll(earlyBackgroundNeedle, earlyBackgroundPatch);

const settledNeedle = "needsDashboard?call('getStudentDashboard'):Promise.resolve(null)";
if (html.includes(settledNeedle)) html = html.replace(settledNeedle, 'eagerDashboardPromise||Promise.resolve(null)');

if (!html.includes(earlyBackgroundPatch)) throw new Error('dashboard early-render patch missing');
if (html.includes(earlyBackgroundNeedle)) throw new Error('old delayed dashboard scheduling still present in student landing path');
if (html.includes(settledNeedle)) throw new Error('duplicate dashboard request path still present');

// Clear any old persisted view cache after a homework declaration. Older UI
// revisions vary slightly here, so use a tolerant replacement and do not make
// deployment depend on the exact one-line formatting.
const declarePatterns = [
  ["state.homeworkCache=null;endSave_();await renderStudentHomework_()", "state.homeworkCache=null;clearStudentViewCache_();endSave_();await renderStudentHomework_()"],
  ["endSave_();await renderStudentHomework_()", "state.homeworkCache=null;clearStudentViewCache_();endSave_();await renderStudentHomework_()"],
];
for (const [needle,replacement] of declarePatterns) {
  if (html.includes(needle)) { html = html.replace(needle,replacement); break; }
}

if (html === before) throw new Error('V3 autosave/sanitize patch did not match the current UI');
if (!html.trimStart().toLowerCase().startsWith('<!doctype html>')) throw new Error('V3 HTML still has an unexpected prefix');
if (html.includes('Warning: truncated output')) throw new Error('Truncation warning still present in V3 HTML');
if (!html.includes('setTimeout(flushProgressBatch_,300)')) throw new Error('progress debounce patch missing');
if (!html.includes('queue.timer=setTimeout(flush,350)')) throw new Error('target debounce patch missing');
if (!html.includes('state.dashboardCache=cached.dashboard||null;state.homeworkCache=null')) throw new Error('stale homework cache restore still enabled');
if (!html.includes('dashboard:state.dashboardCache,homework:null')) throw new Error('homework is still persisted in student view cache');

fs.writeFileSync(file, html);
console.log('Sanitized V3 HTML; dashboard graph request starts immediately; autosave progress=300ms target=350ms');
