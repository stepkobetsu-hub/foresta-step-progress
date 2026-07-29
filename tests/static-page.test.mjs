import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Script } from "node:vm";
import test from "node:test";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");

test("Apps Scriptの画面を埋め込まない", () => {
  assert.doesNotMatch(html, /<iframe\b/i);
  assert.doesNotMatch(html, /google\.script\.run/);
  assert.doesNotMatch(html, /\/macros\/u\/\d+\/s\//);
});

test("JSON APIをPOSTで呼び出す", () => {
  assert.match(html, /https:\/\/script\.google\.com\/macros\/s\/[^'"]+\/exec/);
  assert.match(html, /method:\s*'POST'/);
  assert.match(html, /JSON\.stringify\(payload\)/);
  assert.match(html, /Content-Type':\s*'text\/plain;charset=utf-8'/);
});

test("公開画面に秘密情報を含めない", () => {
  assert.doesNotMatch(html, /SPREADSHEET_ID|API_KEY|SCRIPT_PROP|KNOWN_TEST_PASSWORD|password\s*[:=]\s*['"][^'"]+/i);
});

test("生徒・講師・管理者の既存画面を維持する", () => {
  assert.match(html, /生徒ログイン/);
  assert.match(html, /講師・管理者ログイン/);
  assert.match(html, /宿題チェック/);
  assert.match(html, /進捗入力/);
  assert.match(html, /管理者/);
});

test("五科目の色と共通カード・ボタンを統一する", () => {
  assert.match(html, /--subject-english:#e53935/);
  assert.match(html, /--subject-math:#fb8c00/);
  assert.match(html, /--subject-science:#43a047/);
  assert.match(html, /--subject-social:#1e88e5/);
  assert.match(html, /--subject-japanese:#8e24aa/);
  assert.match(html, /--card-radius:17px/);
  assert.match(html, /--control-radius:11px/);
  assert.match(html, /subjectBadge_/);
  assert.match(html, /subjectClass_/);
});

test("埋込みJavaScriptを構文解析できる", () => {
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/gi)].map((match) => match[1]);
  assert.ok(scripts.length > 0);
  for (const source of scripts) new Script(source);
});

test("mobile target rows stay horizontal and clamp titles to two lines", () => {
  assert.match(html, /\.targetChoice\{display:flex;align-items:center/);
  assert.match(html, /\.targetTitleText\{[^}]*-webkit-line-clamp:2/);
  assert.match(html, /<span class="unitStep">.*?<span class="targetTitle">/);
  assert.match(html, /\.targetRow\{min-height:34px;padding:3px 6px\}/);
});

test("progress rows group the unit identity and show LCT only for eligible units", () => {
  assert.match(html, /class="unitIdentity"><span class="unitStep">/);
  assert.match(html, /class="unitTitle unitName"/);
  assert.match(html, /unit\.hasLct\?/);
  assert.match(html, /LCTなし/);
  assert.match(html, /\.unitIdentity\{display:flex;align-items:center;gap:\.75em/);
  assert.doesNotMatch(html, /LCT実施日/);
});

test("remembered login is opt-in, separated by login type, and does not auto-login", () => {
  assert.match(html, /id="rememberLogin" type="checkbox"/);
  assert.doesNotMatch(html, /id="rememberLogin"[^>]*checked/);
  assert.match(html, /forestaProgress\.savedId\.student/);
  assert.match(html, /forestaProgress\.savedId\.staff/);
  assert.match(html, /forestaProgress\.savedPassword\.student/);
  assert.match(html, /forestaProgress\.savedPassword\.staff/);
  assert.match(html, /保存したログイン情報を消す/);
  assert.match(html, /共有タブレットでは、チェックを入れないでください。/);
  assert.match(html, /updateRememberedLogin_\(loginType,enteredId,enteredPassword,\$\('rememberLogin'\)\.checked\)/);
  assert.doesNotMatch(html, /restoreRememberedLogin_[\s\S]{0,200}\.submit\(/);
});

test("student homework renders every material-specific item in one compact card", () => {
  assert.match(html, /class="home studentHomework/);
  assert.match(html, /group\.items\.map\(item\)\.join\(''\)/);
  assert.match(html, /MEMORIZATION_MARK:'暗記マーク（基本文の暗記）'/);
  assert.match(html, /MY_VOCABULARY:'My単語帳（英語→日本語テスト）'/);
  assert.match(html, /学習 \$\{formatShortDate_\(group\.learningDate\)\}　宿題 \$\{formatShortDate_\(group\.assignedDate\)\}/);
  assert.match(html, /-webkit-line-clamp:2/);
});

test("homework controls remain compact and preserve existing statuses", () => {
  assert.match(html, /data-status="DECLARED_DONE"[^>]*>やりました/);
  assert.match(html, /data-status="NO_TARGET_CLAIM"[^>]*>対象なし/);
  assert.match(html, /data-no-target-undo="true"/);
  assert.match(html, />済 \$\{formatShortDate_\(date\)\}<\/button>/);
  assert.match(html, /min-height:44px/);
  assert.match(html, /teacherStatus!=='UNCONFIRMED'/);
});

test("homework encouragement is deterministic and uses the fixed candidate list", () => {
  for (const message of ["🌟 GOOD!", "✨ GREAT!", "👏 その調子！", "🎉 ナイス！", "⭐ よくできました！", "💮 ばっちり！", "👍 いいね！", "🚩 一歩前進！", "🏆 すばらしい！", "😊 よくがんばったね！"]) {
    assert.match(html, new RegExp(message.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.match(html, /function stableHomeworkIndex_/);
  assert.match(html, /HOMEWORK_ENCOURAGEMENTS\[stableHomeworkIndex_\(key\)\]/);
  assert.doesNotMatch(html, /Math\.random\(\)/);
});

test("mobile homework encouragement fits inside the compact card", () => {
  assert.match(html, /\.goodMark\{gap:2px;font-size:10px;letter-spacing:0\}/);
  assert.match(html, /\.goodMark \.encourageSymbol\{font-size:11px\}/);
});

test("student navigation has only the three daily-use tabs", () => {
  assert.match(html, /data-page="homework"[^>]*>📚 次回の宿題<\/button>/);
  assert.match(html, /data-page="progress"[^>]*>✏️ 進捗入力<\/button>/);
  assert.match(html, /data-page="targets"[^>]*>🎯 目標範囲<\/button>/);
  assert.doesNotMatch(html, /data-page="history"/);
  assert.match(html, /getStudentInputHistory/);
});

test("student landing selects homework first and progress only when homework is empty", () => {
  assert.match(html, /studentLandingPending:true/);
  assert.match(html, /const homeworkCount=Array\.isArray\(state\.homeworkCache\?\.homework\)\?state\.homeworkCache\.homework\.length:0/);
  assert.match(html, /state\.studentPage=homeworkCount>0\?'homework':'progress'/);
  assert.match(html, /if\(out\.role==='STUDENT'\)\{state\.studentPage='homework';state\.studentLandingPending=true\}/);
});

test("mobile titles and three primary tabs remain readable on narrow Android screens", () => {
  assert.match(html, /\.hero h1\{font-size:28px;white-space:nowrap\}/);
  assert.match(html, /\.viewTabs button\{[^}]*font-size:clamp\(14px,4\.2vw,16px\)[^}]*white-space:nowrap/);
});

test("student dashboard shows rate-aware achievement, greeting, goal period, and encouragement", () => {
  assert.match(html, /class="studentWelcome"/);
  assert.match(html, /function greetingInfo_/);
  assert.match(html, /function goalPeriod_/);
  assert.match(html, /settings\.summerStartDate/);
  assert.match(html, /id="achievementIcon" class="achievementIcon"/);
  assert.match(html, /class="encourageCopy"/);
  assert.match(html, /const RATE_MESSAGES=/);
  assert.match(html, /min:0,icon:'start',items:\['まずは1周目をしっかりすすめよう！'/);
  assert.match(html, /min:100,icon:'trophy',items:\['1周目達成！/);
  assert.match(html, /min:300,icon:'trophy',items:\['3周達成！/);
  assert.match(html, /function messageIndex_/);
  assert.match(html, /function achievementMeta_/);
  assert.match(html, /const MILESTONES=\[300,250,200,150,100,75,50,25\]/);
  assert.match(html, /function maybeShowMilestone_/);
  assert.match(html, /class="todayPraise"/);
});

test("Step and Goal are selectable in parallel without overwriting each other", () => {
  assert.match(html, /series:'FORESTA_STEP'/);
  assert.match(html, /data-series="\$\{series\}"/);
  assert.match(html, /FORESTA_STEP','FORESTA_GOAL/);
  assert.doesNotMatch(html, /available\?'':'disabled'/);
  assert.match(html, /unit\.subject===state\.subject&&unit\.series===state\.series/);
  assert.match(html, /hasSelectableUnits=d\.selectableUnits\.some\(unit=>unit\.series===nextSeries\)/);
  assert.match(html, /if\(!hasSelectableUnits\)\{state\.dashboardCache=null;await renderStudent\(\);return\}/);
  assert.match(html, /hasSelectedUnits=d\.units\.some\(unit=>unit\.subject===state\.subject&&unit\.series===nextSeries\)/);
  assert.match(html, /state\.studentPage==='progress'&&!hasSelectedUnits\)state\.studentPage='targets'/);
  assert.match(html, /setOwnTargetChanges',\{subject:state\.subject,series:state\.series/);
  assert.match(html, /フォレスタゴールを選んでも、フォレスタステップの選択は変わりません/);
});

test("screen title is 学習進捗管理", () => {
  assert.match(html, /<title>学習進捗管理【開発】<\/title>/);
  assert.match(html, /<h1>学習進捗管理<\/h1>/);
  assert.match(html, /<span>学習進捗管理【開発】<\/span>/);
  assert.doesNotMatch(html, /自主学習進捗管理/);
});

test("achievement popups use stable server selections and remain responsive", () => {
  assert.match(html, /function achievementCharacterSvg_/);
  for (const id of ["flag_bear","book_cat","pencil_rabbit","star_bird","cheer_dog","glasses_owl","crown_friend"]) {
    assert.match(html, new RegExp(id));
  }
  assert.match(html, /function showPendingAchievement_/);
  assert.match(html, /acknowledgeMilestone/);
  assert.match(html, /scopeType:item\.scopeType/);
  assert.match(html, /achievementPopup/);
  assert.match(html, /width:calc\(100% - 16px\)/);
  assert.match(html, /RARE! レア応援キャラクター/);
  assert.match(html, /achievementBadgesHtml_/);
  assert.match(html, /data-admin="achievements"/);
  assert.match(html, /listAchievementHistory/);
});

test("admin-only tools are folded into the settings menu", () => {
  assert.match(html, /id="settingsToggle"/);
  assert.match(html, /aria-controls="adminSettings"/);
  assert.match(html, /id="adminSettings" class="adminSettings"/);
  assert.match(html, /進行表（範囲基準）/);
  assert.match(html, />総履歴</);
  assert.match(html, />セキュリティテスト</);
  assert.match(html, /state\.settingsOpen=!state\.settingsOpen/);
});

test("staff homework view renders one overdue card per student and opens filtered details", () => {
  assert.match(html, /call\('listOverdueHomeworkStudents'\)/);
  assert.match(html, /function overdueStudentCard_/);
  assert.match(html, /data-overdue-student/);
  assert.match(html, /宿題未完了の生徒/);
  assert.match(html, /期限日の翌日以降も未完了の宿題がある生徒/);
  assert.match(html, /現在、期限を過ぎた未完了宿題はありません。/);
  assert.match(html, /filters:\{studentId:state\.homeworkStudentId,overdueOnly:true\}/);
  assert.match(html, /最古の期限/);
  assert.match(html, /\.overdueStudent\{[^}]*grid-template-columns/);
});


test("student login is single-flight, uses one 45-second request, and renders before data hydration", () => {
  assert.match(html, /loginInFlight:false/);
  assert.match(html, /if\(state\.loginInFlight\)return/);
  assert.match(html, /button\.disabled=true;button\.textContent='ログインしています…'/);
  assert.match(html, /attempts:1,timeoutMs:45000/);
  assert.match(html, /timeoutMs=Number\(options\.timeoutMs\|\|45000\)/);
  assert.doesNotMatch(html, /attempts:3,timeoutMs:12000/);
  assert.match(html, /error\?\.authentication\?\(error\.message\|\|'入力内容が違います。'\)/);
  assert.match(html, /sessionStorage\.setItem\('fsSession'/);
  assert.match(html, /<h2>ログインしました<\/h2><p>学習データを読み込んでいます…<\/p>/);
  assert.match(html, /showApp\(\)\.then/);
});


test("authenticated student data retries never repeat authentication and allow partial rendering", () => {
  assert.match(html, /ログインは完了しています/);
  assert.match(html, /学習データを取得できませんでした。「再試行」を押してください。/);
  assert.match(html, /renderStudentHomeworkOnly_/);
  assert.match(html, /renderHomeworkLoadError_/);
  assert.match(html, /Promise\.allSettled\(\[/);
  assert.match(html, /needsHomework\?call\('listHomework'\):Promise\.resolve\(null\)/);
  assert.match(html, /needsDashboard\?call\('getStudentDashboard'\):Promise\.resolve\(null\)/);
  assert.match(html, /if\(homeworkResult\.status==='fulfilled'\)state\.homeworkCache=homeworkResult\.value/);
  assert.match(html, /if\(dashboardResult\.status==='fulfilled'\)state\.dashboardCache=dashboardResult\.value\.data/);
  assert.match(html, /retryLoad'\)\.onclick=\(\)=>showApp\(\)/);
  assert.doesNotMatch(html, /retryLoad[^\n]+studentLogin/);
});

test("student initial homework and dashboard requests run in parallel", () => {
  const renderStudent = html.match(/async function renderStudent\(\)\{([\s\S]*?)\n  \}/)?.[1] || "";
  assert.match(renderStudent, /Promise\.allSettled/);
  assert.match(renderStudent, /call\('listHomework'\)/);
  assert.match(renderStudent, /call\('getStudentDashboard'\)/);
  assert.doesNotMatch(renderStudent, /await call\('listHomework'\)[\s\S]*await call\('getStudentDashboard'\)/);
});

test("login timing diagnostics do not log credentials or tokens", () => {
  assert.match(html, /function loginTrace_/);
  for (const stage of ["button-pressed", "api-send", "api-response", "authentication-complete", "initial-screen-visible", "student-data-visible", "login-failed"]) {
    assert.match(html, new RegExp(stage));
  }
  assert.doesNotMatch(html, /loginTrace_\([^\n]*(password|token)/);
});
