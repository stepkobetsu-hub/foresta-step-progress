import fs from 'node:fs';

const file = process.argv[2] || 'public/index.html';
let html = fs.readFileSync(file, 'utf8');
const before = html;

// A connector truncation notice was accidentally prepended to the HTML source
// during V3 preparation. Remove only that known prefix; do not touch app data.
html = html
  .replace(/^\uFEFF?Warning: truncated output \(original token count: \d+\)\r?\nTotal output lines: \d+\r?\n\r?\n/, '')
  .replaceAll('setTimeout(flushProgressBatch_,800)', 'setTimeout(flushProgressBatch_,300)')
  .replaceAll('queue.timer=setTimeout(flush,800)', 'queue.timer=setTimeout(flush,350)')
  .replaceAll("status.textContent='変更あり'", "status.textContent='自動保存待ち…'")
  .replaceAll("setGlobalSave_('保存する','pending')", "setGlobalSave_('自動保存待ち…','pending')");

// Homework is mutable state. Do not restore a stale homework list from
// localStorage after a reload; always ask the V3 API for the current list.
const loadHomeworkNeedle = 'state.dashboardCache=cached.dashboard||null;state.homeworkCache=cached.homework||null';
if (!html.includes(loadHomeworkNeedle)) throw new Error('student homework cache load point not found');
html = html.replace(loadHomeworkNeedle, 'state.dashboardCache=cached.dashboard||null;state.homeworkCache=null');

const saveHomeworkNeedle = 'dashboard:state.dashboardCache,homework:state.homeworkCache';
if (!html.includes(saveHomeworkNeedle)) throw new Error('student homework cache save point not found');
html = html.replace(saveHomeworkNeedle, 'dashboard:state.dashboardCache,homework:null');

const declareSuccessNeedle = "await call('declareHomework',{homeworkId,studentStatus:status});state.homeworkCache=null;endSave_();await renderStudentHomework_()";
if (!html.includes(declareSuccessNeedle)) throw new Error('student homework success point not found');
html = html.replace(declareSuccessNeedle, "await call('declareHomework',{homeworkId,studentStatus:status});state.homeworkCache=null;clearStudentViewCache_();endSave_();await renderStudentHomework_()");

if (html === before) throw new Error('V3 autosave/sanitize patch did not match the current UI');
if (!html.trimStart().toLowerCase().startsWith('<!doctype html>')) throw new Error('V3 HTML still has an unexpected prefix');
if (html.includes('Warning: truncated output')) throw new Error('Truncation warning still present in V3 HTML');
if (!html.includes('setTimeout(flushProgressBatch_,300)')) throw new Error('progress debounce patch missing');
if (!html.includes('queue.timer=setTimeout(flush,350)')) throw new Error('target debounce patch missing');
if (!html.includes('state.dashboardCache=cached.dashboard||null;state.homeworkCache=null')) throw new Error('stale homework cache restore still enabled');
if (!html.includes('dashboard:state.dashboardCache,homework:null')) throw new Error('homework is still persisted in student view cache');
if (!html.includes('state.homeworkCache=null;clearStudentViewCache_();endSave_()')) throw new Error('homework save does not clear stale local cache');

fs.writeFileSync(file, html);
console.log('Sanitized V3 HTML; autosave progress=300ms target=350ms; disabled stale homework cache');
