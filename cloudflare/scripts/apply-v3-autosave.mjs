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
if (!html.includes(loadHomeworkNeedle)) throw new Error('student homework cache load point not found');
html = html.replace(loadHomeworkNeedle, 'state.dashboardCache=cached.dashboard||null;state.homeworkCache=null');

const saveHomeworkNeedle = 'dashboard:state.dashboardCache,homework:state.homeworkCache';
if (!html.includes(saveHomeworkNeedle)) throw new Error('student homework cache save point not found');
html = html.replace(saveHomeworkNeedle, 'dashboard:state.dashboardCache,homework:null');

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

// A deliberate logout must never be immediately undone by remembered staff
// credentials or a persisted staff session. Keep the remembered staff ID/pass
// for convenience, but after logout force the visible screen back to the
// student login tab. The marker survives reload and is cleared only by a new
// successful login.
const manualLogoutBootstrapNeedle = "if (hasCommonSession || hasStoredSession || hasRememberedStaff) document.documentElement.classList.add('auth-resume-pending');";
if (!html.includes(manualLogoutBootstrapNeedle)) throw new Error('auth resume bootstrap point not found');
html = html.replace(
  manualLogoutBootstrapNeedle,
  "const manualLogout = localStorage.getItem('forestaProgress.manualLogout') === 'true';\n      if (!manualLogout && (hasCommonSession || hasStoredSession || hasRememberedStaff)) document.documentElement.classList.add('auth-resume-pending');"
);

const loginSuccessNeedle = "updateRememberedLogin_(loginType,enteredId,enteredPassword,$('rememberLogin').checked);$('password').value='';";
if (!html.includes(loginSuccessNeedle)) throw new Error('login success point not found');
html = html.replace(
  loginSuccessNeedle,
  "updateRememberedLogin_(loginType,enteredId,enteredPassword,$('rememberLogin').checked);try{localStorage.removeItem('forestaProgress.manualLogout')}catch(error){}$('password').value='';"
);

const logoutSessionNeedle = "clearStudentViewCache_();clearStoredSession_();if(role==='STUDENT')clearCommonSession_();";
if (!html.includes(logoutSessionNeedle)) throw new Error('logout session cleanup point not found');
html = html.replace(
  logoutSessionNeedle,
  "clearStudentViewCache_();clearStoredSession_();clearCommonSession_();try{localStorage.setItem('forestaProgress.manualLogout','true')}catch(error){};"
);

const logoutScreenNeedle = "$('application').classList.add('hidden');$('login').classList.remove('hidden');restoreRememberedLogin_(state.loginType);button.disabled=false;";
if (!html.includes(logoutScreenNeedle)) throw new Error('logout screen restore point not found');
html = html.replace(
  logoutScreenNeedle,
  "$('application').classList.add('hidden');$('login').classList.remove('hidden');setLoginType('student');finishAuthResume_();button.disabled=false;"
);

const initialLoginNeedle = "let initialLoginType='student';try{const savedType=localStorage.getItem(REMEMBER_KEYS.type);if(!readCommonSession_()&&(savedType==='student'||savedType==='staff'))initialLoginType=savedType}catch(error){}setLoginType(initialLoginType);";
if (!html.includes(initialLoginNeedle)) throw new Error('initial login type point not found');
html = html.replace(
  initialLoginNeedle,
  "let initialLoginType='student';try{const manualLogout=localStorage.getItem('forestaProgress.manualLogout')==='true',savedType=localStorage.getItem(REMEMBER_KEYS.type);if(!manualLogout&&!readCommonSession_()&&(savedType==='student'||savedType==='staff'))initialLoginType=savedType}catch(error){}setLoginType(initialLoginType);"
);

const autoLoginNeedle = "if(!resumed){const remembered=readRememberedLogin_(state.loginType);if(remembered){restoreRememberedLogin_(state.loginType);$('loginForm').requestSubmit()}else{$('application').classList.add('hidden');$('login').classList.remove('hidden');finishAuthResume_()}}";
if (!html.includes(autoLoginNeedle)) throw new Error('remembered auto-login point not found');
html = html.replace(
  autoLoginNeedle,
  "if(!resumed){let manualLogout=false;try{manualLogout=localStorage.getItem('forestaProgress.manualLogout')==='true'}catch(error){}if(manualLogout){clearStoredSession_();clearCommonSession_();setLoginType('student');$('application').classList.add('hidden');$('login').classList.remove('hidden');finishAuthResume_()}else{const remembered=readRememberedLogin_(state.loginType);if(remembered){restoreRememberedLogin_(state.loginType);$('loginForm').requestSubmit()}else{$('application').classList.add('hidden');$('login').classList.remove('hidden');finishAuthResume_()}}}"
);

if (html === before) throw new Error('V3 autosave/sanitize patch did not match the current UI');
if (!html.trimStart().toLowerCase().startsWith('<!doctype html>')) throw new Error('V3 HTML still has an unexpected prefix');
if (html.includes('Warning: truncated output')) throw new Error('Truncation warning still present in V3 HTML');
if (!html.includes('setTimeout(flushProgressBatch_,300)')) throw new Error('progress debounce patch missing');
if (!html.includes('queue.timer=setTimeout(flush,350)')) throw new Error('target debounce patch missing');
if (!html.includes('state.dashboardCache=cached.dashboard||null;state.homeworkCache=null')) throw new Error('stale homework cache restore still enabled');
if (!html.includes('dashboard:state.dashboardCache,homework:null')) throw new Error('homework is still persisted in student view cache');
if (!html.includes("localStorage.setItem('forestaProgress.manualLogout','true')")) throw new Error('manual logout marker patch missing');
if (!html.includes("setLoginType('student');finishAuthResume_();button.disabled=false")) throw new Error('logout does not return to student login');
if (!html.includes("localStorage.removeItem('forestaProgress.manualLogout')")) throw new Error('manual logout marker is not cleared on successful login');

fs.writeFileSync(file, html);
console.log('Sanitized V3 HTML; autosave progress=300ms target=350ms; stale homework cache disabled; manual logout returns to student login');
