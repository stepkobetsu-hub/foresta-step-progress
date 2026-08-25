import fs from 'node:fs';

const file = process.argv[2] || 'public/index.html';
let html = fs.readFileSync(file, 'utf8');
const before = html;

const resumePrehideMarker = 'v3-resume-prehide';
if (!html.includes(resumePrehideMarker)) {
  const resumePrehide = `<style id="v3-auth-resume-hide">html.auth-resume-pending #login{visibility:hidden!important}</style>\n<script id="${resumePrehideMarker}">\ntry{\n  const now=Date.now();\n  let stored=null;\n  const raw=sessionStorage.getItem('fsSession')||localStorage.getItem('forestaProgress.rememberedSession')||'';\n  try{stored=raw?JSON.parse(raw):null}catch(error){}\n  const storedValid=!!(stored&&stored.token&&stored.profile&&(!stored.expiresAt||new Date(stored.expiresAt).getTime()>now));\n  const commonExpires=new Date(localStorage.getItem('stepCommonStudentSessionExpiresAt')||'').getTime();\n  const commonValid=!!localStorage.getItem('stepCommonStudentSessionToken')&&commonExpires>now;\n  const rememberedStudent=localStorage.getItem('forestaProgress.rememberLogin.student')==='true'&&!!localStorage.getItem('forestaProgress.savedId.student')&&!!localStorage.getItem('forestaProgress.savedPassword.student');\n  const rememberedStaff=localStorage.getItem('forestaProgress.rememberLogin.staff')==='true'&&!!localStorage.getItem('forestaProgress.savedId.staff')&&!!localStorage.getItem('forestaProgress.savedPassword.staff');\n  const manualLogout=localStorage.getItem('forestaProgress.manualLogout')==='true';\n  if(!manualLogout&&(storedValid||commonValid||rememberedStudent||rememberedStaff))document.documentElement.classList.add('auth-resume-pending');\n}catch(error){}\n</script>\n`;
  if (!html.includes('</head>')) throw new Error('head end not found for auth resume prehide');
  html = html.replace('</head>', resumePrehide + '</head>');
}

const renderStudentNeedle = '  async function renderStudent(){';
const fastHeroHelper = `  function renderProgressHeroFast_(d){\n    if(!d||state.loggingOut)return false;\n    const main=$('main');if(!main)return false;\n    let mount=main.querySelector('[data-fast-progress-hero]');\n    const heroes=Array.from(main.querySelectorAll('.progressHero'));\n    if(mount){\n      const canonicalHero=heroes.find(hero=>!mount.contains(hero));\n      if(canonicalHero){mount.remove();return true}\n    }\n    if(!mount&&heroes.length){\n      heroes.slice(1).forEach(hero=>hero.remove());\n      return true;\n    }\n    if(!mount){mount=document.createElement('div');mount.dataset.fastProgressHero='1';const welcome=main.querySelector('.studentWelcome');if(welcome)welcome.after(mount);else main.prepend(mount)}\n    try{mount.innerHTML=studentProgressHero_(d);return true}catch(error){console.warn('[dashboard-cache-invalid] '+String(error?.message||error));mount.remove();return false}\n  }\n`;
if (html.includes(renderStudentNeedle) && !html.includes('function renderProgressHeroFast_')) {
  html = html.replace(renderStudentNeedle, fastHeroHelper + renderStudentNeedle);
}
if (!html.includes('function renderProgressHeroFast_')) throw new Error('fast progress hero helper missing');

const landingNeedle = 'let needsHomework=state.studentLandingPending&&!state.homeworkCache,needsDashboard=!state.dashboardCache;';
const landingPatch = `${landingNeedle}\n    if(state.dashboardCache&&!renderProgressHeroFast_(state.dashboardCache)){state.dashboardCache=null;clearStudentViewCache_();needsDashboard=true;}`;
if (html.includes(landingNeedle) && !html.includes('state.dashboardCache&&!renderProgressHeroFast_')) {
  html = html.replace(landingNeedle, landingPatch);
}
if (!html.includes('state.dashboardCache&&!renderProgressHeroFast_(state.dashboardCache)')) throw new Error('cached dashboard immediate render patch missing');

const conditionalEager = "const eagerDashboardPromise=needsDashboard?call('getStudentDashboard').then(out=>{if(out?.data){state.dashboardCache=out.data;saveStudentViewCache_();renderProgressHeroFast_(out.data)}return out}):null;";
const simpleEager = "const eagerDashboardPromise=needsDashboard?call('getStudentDashboard'):null;";
const eagerNeedle = "const eagerDashboardPromise=call('getStudentDashboard').then(out=>{if(out?.data){state.dashboardCache=out.data;saveStudentViewCache_();renderProgressHeroFast_(out.data)}return out});";
if (html.includes(conditionalEager)) html = html.replace(conditionalEager, eagerNeedle);
else if (html.includes(simpleEager)) html = html.replace(simpleEager, eagerNeedle);
else if (html.includes(landingPatch) && !html.includes(eagerNeedle)) html = html.replace(landingPatch, `${landingPatch}\n    ${eagerNeedle}`);
if (!html.includes(eagerNeedle)) throw new Error('dashboard eager revalidation patch missing');

const earlyBackgroundNeedle = "if(needsDashboard)scheduleBackground_(()=>loadDashboardInBackground_(),0);";
const previousEarly = "if(eagerDashboardPromise)eagerDashboardPromise.then(out=>{state.dashboardCache=out.data;saveStudentViewCache_();return renderStudent()}).catch(error=>console.error('[dashboard-load-failed] '+String(error?.message||error)));";
const oldEarlyPatch = "if(eagerDashboardPromise)eagerDashboardPromise.then(()=>renderStudent()).catch(error=>console.error('[dashboard-load-failed] '+String(error?.message||error)));";
const earlyPatch = "if(eagerDashboardPromise)eagerDashboardPromise.then(async()=>{await renderStudent();if(state.dashboardCache)renderProgressHeroFast_(state.dashboardCache)}).catch(error=>console.error('[dashboard-load-failed] '+String(error?.message||error)));";
html = html.replaceAll(previousEarly, earlyPatch);
html = html.replaceAll(oldEarlyPatch, earlyPatch);
html = html.replaceAll(earlyBackgroundNeedle, earlyPatch);
const settledNeedle = "needsDashboard?call('getStudentDashboard'):Promise.resolve(null)";
if (html.includes(settledNeedle)) html = html.replace(settledNeedle, 'eagerDashboardPromise||Promise.resolve(null)');
if (!html.includes(earlyPatch)) throw new Error('dashboard completion render/dedupe patch missing');

const resumePattern = /let saved=null;\s*const common=readCommonSession_\(\);\s*try\{\s*if\(common\)\{\s*const verified=await rpc\(\{action:'getCommonStudentSession',token:common\.token\},\{attempts:1,timeoutMs:30000\}\);\s*if\(!verified\.success\|\|verified\.role!=='STUDENT'\|\|!verified\.profile\)throw new Error\('COMMON_SESSION_INVALID'\);\s*saved=\{token:common\.token,role:'STUDENT',profile:verified\.profile,expiresAt:common\.expiresAt\};\s*clearStoredSession_\(\);\s*saveStoredSession_\(saved,false\);\s*\}else saved=readStoredSession_\(\);/;
const resumePatch = `let saved=readStoredSession_();\n    const common=readCommonSession_();\n    try{\n      const storedValid=!!(saved&&saved.token&&saved.profile&&(!saved.expiresAt||new Date(saved.expiresAt).getTime()>Date.now()));\n      if(!storedValid&&common){\n        const verified=await rpc({action:'getCommonStudentSession',token:common.token},{attempts:1,timeoutMs:8000});\n        if(!verified.success||verified.role!=='STUDENT'||!verified.profile)throw new Error('COMMON_SESSION_INVALID');\n        saved={token:common.token,role:'STUDENT',profile:verified.profile,expiresAt:common.expiresAt};\n        clearStoredSession_();\n        saveStoredSession_(saved,false);\n      }`;
if (resumePattern.test(html)) html = html.replace(resumePattern, resumePatch);
if (!html.includes('const storedValid=!!(saved&&saved.token&&saved.profile')) throw new Error('stored-session-first refresh patch missing');

const homeworkHeroMarker = 'v3-homework-preserve-progress-hero';
if (!html.includes(homeworkHeroMarker)) {
  const teacherNeedle = '  async function renderTeacher(){';
  if (!html.includes(teacherNeedle)) throw new Error('renderTeacher patch point missing');
  const wrapper = `  // ${homeworkHeroMarker}\n  const renderStudentHomeworkBase_=renderStudentHomework_;\n  renderStudentHomework_=async function(...args){const result=await renderStudentHomeworkBase_(...args);if(state.dashboardCache)renderProgressHeroFast_(state.dashboardCache);return result};\n  if(typeof renderStudentHomeworkOnly_==='function'){const renderStudentHomeworkOnlyBase_=renderStudentHomeworkOnly_;renderStudentHomeworkOnly_=async function(...args){const result=await renderStudentHomeworkOnlyBase_(...args);if(state.dashboardCache)renderProgressHeroFast_(state.dashboardCache);return result}}\n`;
  html = html.replace(teacherNeedle, wrapper + teacherNeedle);
}

if (html === before) throw new Error('graph/session hotfix did not match current UI');
if (!html.includes(resumePrehideMarker)) throw new Error('resume prehide missing');
if (!html.includes("const eagerDashboardPromise=call('getStudentDashboard')")) throw new Error('dashboard is not revalidated on app open');
if (!html.includes("main.querySelectorAll('.progressHero')")) throw new Error('DOM-based duplicate progress hero cleanup missing');
if (!html.includes('await renderStudent();if(state.dashboardCache)renderProgressHeroFast_')) throw new Error('full-render dedupe call missing');
if (!html.includes('const storedValid=!!(saved&&saved.token&&saved.profile')) throw new Error('valid stored session is not preferred');
if (!html.includes(homeworkHeroMarker)) throw new Error('homework render does not preserve graph');
if (!html.includes("forestaProgress.manualLogout")) throw new Error('manual logout protection disappeared');

fs.writeFileSync(file, html);
console.log('Applied V3 graph/session hotfix; fast graph dedupes after full render; refresh keeps valid session');
