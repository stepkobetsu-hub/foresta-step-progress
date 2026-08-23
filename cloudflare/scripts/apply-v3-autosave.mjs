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

// Keep the login screen hidden while remembered student credentials perform the
// existing automatic sign-in. Inject this independently of the legacy head code
// so changes in the old HTML cannot break the patch point.
const studentPrehideMarker = 'v3-student-resume-prehide';
if (!html.includes(studentPrehideMarker)) {
  const studentPrehide = `<script id="${studentPrehideMarker}">\ntry{\n  const rememberedStudent=localStorage.getItem('forestaProgress.rememberLogin.student')==='true'\n    && !!localStorage.getItem('forestaProgress.savedId.student')\n    && !!localStorage.getItem('forestaProgress.savedPassword.student');\n  if(rememberedStudent)document.documentElement.classList.add('auth-resume-pending');\n}catch(error){}\n</script>\n`;
  if (!html.includes('</head>')) throw new Error('head end not found for remembered student prehide');
  html = html.replace('</head>', studentPrehide + '</head>');
}
if (!html.includes(studentPrehideMarker)) throw new Error('remembered student prehide injection missing');

const loadHomeworkNeedle = 'state.dashboardCache=cached.dashboard||null;state.homeworkCache=cached.homework||null';
if (!html.includes(loadHomeworkNeedle) && !html.includes('state.dashboardCache=cached.dashboard||null;state.homeworkCache=null')) throw new Error('student homework cache load point not found');
html = html.replace(loadHomeworkNeedle, 'state.dashboardCache=cached.dashboard||null;state.homeworkCache=null');

const saveHomeworkNeedle = 'dashboard:state.dashboardCache,homework:state.homeworkCache';
if (!html.includes(saveHomeworkNeedle) && !html.includes('dashboard:state.dashboardCache,homework:null')) throw new Error('student homework cache save point not found');
html = html.replace(saveHomeworkNeedle, 'dashboard:state.dashboardCache,homework:null');

const renderStudentNeedle = '  async function renderStudent(){';
const fastHeroHelper = `  function renderProgressHeroFast_(d){\n    if(!d||state.loggingOut)return false;\n    const main=$('main');if(!main)return false;\n    let mount=main.querySelector('[data-fast-progress-hero]');\n    if(!mount){mount=document.createElement('div');mount.dataset.fastProgressHero='1';const welcome=main.querySelector('.studentWelcome');if(welcome)welcome.after(mount);else main.prepend(mount)}\n    try{mount.innerHTML=studentProgressHero_(d);return true}catch(error){console.warn('[dashboard-cache-invalid] '+String(error?.message||error));mount.remove();return false}\n  }\n`;
if (html.includes(renderStudentNeedle) && !html.includes('function renderProgressHeroFast_')) html = html.replace(renderStudentNeedle, fastHeroHelper + renderStudentNeedle);
else if (html.includes('function renderProgressHeroFast_') && !html.includes("console.warn('[dashboard-cache-invalid]")) {
  const oldHelperPattern = /  function renderProgressHeroFast_\(d\)\{[\s\S]*?\n  \}\n(?=  async function renderStudent\(\)\{)/;
  if (!oldHelperPattern.test(html)) throw new Error('existing fast progress hero helper not recognized');
  html = html.replace(oldHelperPattern, fastHeroHelper);
}
if (!html.includes("console.warn('[dashboard-cache-invalid]")) throw new Error('stale dashboard cache guard missing');

const landingNeedle = 'let needsHomework=state.studentLandingPending&&!state.homeworkCache,needsDashboard=!state.dashboardCache;';
const oldLandingCached = `${landingNeedle}\n    if(state.dashboardCache)renderProgressHeroFast_(state.dashboardCache);`;
const landingPatched = `${landingNeedle}\n    if(state.dashboardCache&&!renderProgressHeroFast_(state.dashboardCache)){state.dashboardCache=null;clearStudentViewCache_();needsDashboard=true;}`;
if (html.includes(oldLandingCached)) html = html.replace(oldLandingCached, landingPatched);
else if (html.includes(landingNeedle) && !html.includes('state.dashboardCache&&!renderProgressHeroFast_')) html = html.replace(landingNeedle, landingPatched);
if (!html.includes('state.dashboardCache&&!renderProgressHeroFast_(state.dashboardCache)')) throw new Error('invalid cached dashboard recovery patch missing');

// Cache is only for instant paint. Always refresh the dashboard once from D1 so
// old browser state can never suppress the real graph request.
const conditionalEager = "const eagerDashboardPromise=needsDashboard?call('getStudentDashboard').then(out=>{if(out?.data){state.dashboardCache=out.data;saveStudentViewCache_();renderProgressHeroFast_(out.data)}return out}):null;";
const veryOldEager = "const eagerDashboardPromise=needsDashboard?call('getStudentDashboard'):null;";
const eagerNeedle = "const eagerDashboardPromise=call('getStudentDashboard').then(out=>{if(out?.data){state.dashboardCache=out.data;saveStudentViewCache_();renderProgressHeroFast_(out.data)}return out});";
if (html.includes(conditionalEager)) html = html.replace(conditionalEager, eagerNeedle);
else if (html.includes(veryOldEager)) html = html.replace(veryOldEager, eagerNeedle);
else if (html.includes(landingPatched) && !html.includes(eagerNeedle)) html = html.replace(landingPatched, `${landingPatched}\n    ${eagerNeedle}`);
if (!html.includes(eagerNeedle)) throw new Error('always-revalidate dashboard request patch missing');

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

// Prefer a still-valid app session over the shared common-session token on refresh.
const resumePattern = /let saved=null;\s*const common=readCommonSession_\(\);\s*try\{\s*if\(common\)\{\s*const verified=await rpc\(\{action:'getCommonStudentSession',token:common\.token\},\{attempts:1,timeoutMs:30000\}\);\s*if\(!verified\.success\|\|verified\.role!=='STUDENT'\|\|!verified\.profile\)throw new Error\('COMMON_SESSION_INVALID'\);\s*saved=\{token:common\.token,role:'STUDENT',profile:verified\.profile,expiresAt:common\.expiresAt\};\s*clearStoredSession_\(\);\s*saveStoredSession_\(saved,false\);\s*\}else saved=readStoredSession_\(\);/;
const resumePatch = `let saved=readStoredSession_();\n    const common=readCommonSession_();\n    try{\n      const storedValid=!!(saved&&saved.token&&saved.profile&&(!saved.expiresAt||new Date(saved.expiresAt).getTime()>Date.now()));\n      if(!storedValid&&common){\n        const verified=await rpc({action:'getCommonStudentSession',token:common.token},{attempts:1,timeoutMs:8000});\n        if(!verified.success||verified.role!=='STUDENT'||!verified.profile)throw new Error('COMMON_SESSION_INVALID');\n        saved={token:common.token,role:'STUDENT',profile:verified.profile,expiresAt:common.expiresAt};\n        clearStoredSession_();\n        saveStoredSession_(saved,false);\n      }`;
if (resumePattern.test(html)) html = html.replace(resumePattern, resumePatch);
if (!html.includes('const storedValid=!!(saved&&saved.token&&saved.profile')) throw new Error('stored-session-first refresh patch missing');
if (!html.includes("if(!storedValid&&common){")) throw new Error('common session is still preferred over valid stored session');

const declarePatterns = [
  ["state.homeworkCache=null;endSave_();await renderStudentHomework_()", "state.homeworkCache=null;clearStudentViewCache_();endSave_();await renderStudentHomework_()"],
  ["endSave_();await renderStudentHomework_()", "state.homeworkCache=null;clearStudentViewCache_();endSave_();await renderStudentHomework_()"],
];
for (const [needle,replacement] of declarePatterns) { if (html.includes(needle)) { html = html.replace(needle,replacement); break; } }

if (html === before) throw new Error('V3 autosave/sanitize patch did not match the current UI');
if (!html.trimStart().toLowerCase().startsWith('<!doctype html>')) throw new Error('V3 HTML still has an unexpected prefix');
if (html.includes('Warning: truncated output')) throw new Error('Truncation warning still present in V3 HTML');
if (!html.includes('setTimeout(flushProgressBatch_,300)')) throw new Error('progress debounce patch missing');
if (!html.includes('queue.timer=setTimeout(flush,350)')) throw new Error('target debounce patch missing');
if (!html.includes('state.dashboardCache=cached.dashboard||null;state.homeworkCache=null')) throw new Error('stale homework cache restore still enabled');
if (!html.includes('dashboard:state.dashboardCache,homework:null')) throw new Error('homework is still persisted in student view cache');
if (!html.includes('renderProgressHeroFast_(out.data)')) throw new Error('dashboard response does not paint graph immediately');
if (!html.includes("const eagerDashboardPromise=call('getStudentDashboard')")) throw new Error('dashboard is not revalidated on every app open');
if (!html.includes(studentPrehideMarker)) throw new Error('remembered student resume prehide missing');

fs.writeFileSync(file, html);
console.log('Sanitized V3 HTML; student refresh stays visually inside app; dashboard cache is guarded and always revalidated; autosave progress=300ms target=350ms');
