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

// Draw the progress hero as soon as D1 returns the dashboard. This is a small
// partial render that is intentionally independent of homework rendering and
// the large progress-input DOM. The later full render replaces this mount.
const renderStudentNeedle = '  async function renderStudent(){';
const fastHeroHelper = `  function renderProgressHeroFast_(d){\n    if(!d||state.loggingOut)return;\n    const main=$('main');if(!main)return;\n    let mount=main.querySelector('[data-fast-progress-hero]');\n    if(!mount){mount=document.createElement('div');mount.dataset.fastProgressHero='1';const welcome=main.querySelector('.studentWelcome');if(welcome)welcome.after(mount);else main.prepend(mount)}\n    mount.innerHTML=studentProgressHero_(d);\n  }\n`;
if (html.includes(renderStudentNeedle) && !html.includes('function renderProgressHeroFast_')) {
  html = html.replace(renderStudentNeedle, fastHeroHelper + renderStudentNeedle);
}
if (!html.includes('function renderProgressHeroFast_')) throw new Error('fast progress hero helper missing');

// Start the D1 dashboard request immediately and paint the graph on resolution,
// rather than merely starting the network request early and waiting for the
// homework/full-page path before any graph is drawn.
const landingNeedle = 'let needsHomework=state.studentLandingPending&&!state.homeworkCache,needsDashboard=!state.dashboardCache;';
const oldEagerNeedle = "const eagerDashboardPromise=needsDashboard?call('getStudentDashboard'):null;";
const eagerNeedle = "const eagerDashboardPromise=needsDashboard?call('getStudentDashboard').then(out=>{if(out?.data){state.dashboardCache=out.data;saveStudentViewCache_();renderProgressHeroFast_(out.data)}return out}):null;";
if (html.includes(oldEagerNeedle)) html = html.replace(oldEagerNeedle, eagerNeedle);
else if (html.includes(landingNeedle) && !html.includes(eagerNeedle)) html = html.replace(landingNeedle, `${landingNeedle}\n    ${eagerNeedle}`);
if (!html.includes(eagerNeedle)) throw new Error('eager dashboard request/paint patch missing');

const earlyBackgroundNeedle = "if(needsDashboard)scheduleBackground_(()=>loadDashboardInBackground_(),0);";
const oldEarlyBackgroundPatch = "if(eagerDashboardPromise)eagerDashboardPromise.then(out=>{state.dashboardCache=out.data;saveStudentViewCache_();return renderStudent()}).catch(error=>console.error('[dashboard-load-failed] '+String(error?.message||error)));";
const earlyBackgroundPatch = "if(eagerDashboardPromise)eagerDashboardPromise.then(()=>renderStudent()).catch(error=>console.error('[dashboard-load-failed] '+String(error?.message||error)));";
html = html.replaceAll(oldEarlyBackgroundPatch, earlyBackgroundPatch);
html = html.replaceAll(earlyBackgroundNeedle, earlyBackgroundPatch);

const settledNeedle = "needsDashboard?call('getStudentDashboard'):Promise.resolve(null)";
if (html.includes(settledNeedle)) html = html.replace(settledNeedle, 'eagerDashboardPromise||Promise.resolve(null)');

if (!html.includes(earlyBackgroundPatch)) throw new Error('dashboard completion render patch missing');
if (html.includes(earlyBackgroundNeedle)) throw new Error('old delayed dashboard scheduling still present in student landing path');
if (html.includes(settledNeedle)) throw new Error('duplicate dashboard request path still present');

// A stale common student token must not discard a still-valid app session. The
// old code chose the common token first and, if its verification failed the next
// day, cleared the stored app session too. Fall back to the app session instead.
const commonSessionPatch = `if(common){\n        try{\n          const verified=await rpc({action:'getCommonStudentSession',token:common.token},{attempts:1,timeoutMs:8000});\n          if(!verified.success||verified.role!=='STUDENT'||!verified.profile)throw new Error('COMMON_SESSION_INVALID');\n          saved={token:common.token,role:'STUDENT',profile:verified.profile,expiresAt:common.expiresAt};\n          clearStoredSession_();\n          saveStoredSession_(saved,false);\n        }catch(commonError){\n          clearCommonSession_();\n          saved=readStoredSession_();\n        }\n      }else saved=readStoredSession_();`;
const commonSessionPattern = /if\(common\)\{\s*const verified=await rpc\(\{action:'getCommonStudentSession',token:common\.token\},\{attempts:1,timeoutMs:30000\}\);\s*if\(!verified\.success\|\|verified\.role!=='STUDENT'\|\|!verified\.profile\)throw new Error\('COMMON_SESSION_INVALID'\);\s*saved=\{token:common\.token,role:'STUDENT',profile:verified\.profile,expiresAt:common\.expiresAt\};\s*clearStoredSession_\(\);\s*saveStoredSession_\(saved,false\);\s*\}else saved=readStoredSession_\(\);/;
if (commonSessionPattern.test(html)) html = html.replace(commonSessionPattern, commonSessionPatch);
if (!html.includes("action:'getCommonStudentSession',token:common.token},{attempts:1,timeoutMs:8000}")) throw new Error('common-session timeout patch missing');
if (!html.includes('catch(commonError)')) throw new Error('common-session fallback catch missing');
if (!html.includes('clearCommonSession_();\n          saved=readStoredSession_();')) throw new Error('common-session stored-session fallback missing');

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
if (!html.includes('renderProgressHeroFast_(out.data)')) throw new Error('dashboard response does not paint graph immediately');

fs.writeFileSync(file, html);
console.log('Sanitized V3 HTML; progress hero paints immediately from D1; common-session fallback enabled; autosave progress=300ms target=350ms');
