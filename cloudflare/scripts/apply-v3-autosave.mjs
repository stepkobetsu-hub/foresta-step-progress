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

// The progress hero must not wait for the Google-backed homework list. On the
// first student screen start the D1 dashboard request immediately in parallel.
// If the dashboard wins the race, render the graph at once and let homework
// continue loading underneath it.
const landingNeedle = 'let needsHomework=state.studentLandingPending&&!state.homeworkCache,needsDashboard=!state.dashboardCache;';
const landingPatch = `${landingNeedle}\n    if(state.studentLandingPending&&needsHomework&&needsDashboard){scheduleBackground_(()=>loadDashboardInBackground_(),0);needsDashboard=false}\n    if(state.studentLandingPending&&state.dashboardCache&&!state.homeworkCache){state.studentLandingPending=false;needsHomework=false}`;
if (html.includes(landingNeedle) && !html.includes('scheduleBackground_(()=>loadDashboardInBackground_(),0);needsDashboard=false')) {
  html = html.replace(landingNeedle, landingPatch);
}
if (!html.includes('scheduleBackground_(()=>loadDashboardInBackground_(),0);needsDashboard=false')) {
  throw new Error('parallel dashboard start patch missing');
}

// A slower homework request may finish just after the graph has rendered. Do
// not replace the graph with the temporary homework-only shell in that race.
const homeworkRaceNeedle = `      if(state.homeworkCache){\n        state.studentLandingPending=false;await renderStudentHomeworkOnly_();`;
const homeworkRacePatch = `      if(state.homeworkCache){\n        if(state.dashboardCache){state.studentLandingPending=false;await renderStudent();return}\n        state.studentLandingPending=false;await renderStudentHomeworkOnly_();`;
if (html.includes(homeworkRaceNeedle) && !html.includes('if(state.dashboardCache){state.studentLandingPending=false;await renderStudent();return}')) {
  html = html.replace(homeworkRaceNeedle, homeworkRacePatch);
}
if (!html.includes('if(state.dashboardCache){state.studentLandingPending=false;await renderStudent();return}')) {
  throw new Error('dashboard/homework race patch missing');
}

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
console.log('Sanitized V3 HTML; graph loads in parallel with homework; autosave progress=300ms target=350ms');
