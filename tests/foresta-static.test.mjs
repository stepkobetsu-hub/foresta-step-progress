import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../foresta.html', import.meta.url), 'utf8');
const js = fs.readFileSync(new URL('../foresta.js', import.meta.url), 'utf8');
const server = fs.readFileSync(new URL('../apps-script/foresta-progress.gs', import.meta.url), 'utf8');
const api = fs.readFileSync(new URL('../apps-script/code.gs', import.meta.url), 'utf8');

test('normal-lesson app is separate from the summer step-and-goal screen', () => {
  assert.match(html, /<title>フォレスタ進捗管理<\/title>/);
  assert.match(html, /学校より、一歩先へ。/);
  assert.match(api, /const APP_NAME = 'ステップ＆ゴール進捗管理'/);
});

test('administrator overview covers the requested daily signals', () => {
  assert.match(js, /本日の進捗状況/);
  assert.match(js, /学校進度アラーム/);
  assert.match(js, /CT不合格/);
  assert.match(js, /予想範囲まで/);
  assert.match(js, /必要ペース/);
});

test('administrator search matches the delivery-system search behavior without losing focus', () => {
  assert.match(html, />ステップ＆ゴールへ<\/a>/);
  assert.match(js, /生徒コード・氏名・フリガナ・ローマ字で検索/);
  assert.match(js, /function normalizeStudentSearch_/);
  assert.match(js, /function kanaToRomaji_/);
  assert.match(js, /refreshAdminStudentRows_\(\)/);
  assert.doesNotMatch(js, /state\.filters\.query=e\.target\.value;renderAdmin\(\)/);
  assert.match(server, /kana: getAdminStudentKana_|const kana = getAdminStudentKana_/);
});

test('administrator can configure discontinuous predicted test ranges by checkbox', () => {
  assert.match(js, /予想テスト範囲設定/);
  assert.match(js, /name="school" required/);
  assert.match(js, /name="grade"/);
  assert.match(js, /name="subject"/);
  assert.match(js, /name="predictedRangeUnitIds"/);
  assert.match(js, /getAll\('predictedRangeUnitIds'\)/);
  assert.doesNotMatch(js, /name="predictedRangeStartUnitId"/);
  assert.doesNotMatch(js, /name="predictedRangeEndUnitId"/);
  assert.match(js, /saveForestaRangeSetting/);
  assert.match(server, /FORESTA_RANGE_SETTINGS_SHEET = 'フォレスタ学校別予想範囲'/);
  assert.match(server, /function getForestaRangeAdminData_/);
  assert.match(server, /function saveForestaRangeSetting_/);
  assert.match(server, /predictedRangeUnitIdsJson/);
  assert.match(server, /function forestaRangeUnitIds_/);
  assert.match(server, /predictedRangeSource = 'SCHOOL_GRADE'/);
});

test('lesson form records checked study units and previous homework items', () => {
  assert.match(js, /name="instructorName" required/);
  assert.match(js, /name="schoolProgressUnitId" required/);
  assert.match(js, /name="progressUnitIds"/);
  assert.match(js, /name="completedHomeworkIds"/);
  assert.match(js, /name="ctResult"/);
  assert.doesNotMatch(js, /今回の開始単元/);
  assert.doesNotMatch(js, /今回の到達単元/);
  assert.doesNotMatch(js, /CTで出した単元/);
  assert.match(js, /saveForestaLesson/);
});

test('lesson instructor list contains only active staff from column D', () => {
  assert.match(server, /active: String\(row\[3\] \|\| ''\)\.trim\(\) === '1'/);
  assert.match(server, /filter\(item => item\.active && item\.name/);
  assert.match(server, /campus: String\(row\[17\]/);
});

test('target scores appear for both roles and correction stays inside the staff screen', () => {
  assert.match(js, /今回の目標点と定期テスト履歴/);
  assert.match(js, /成績訂正/);
  assert.match(js, /saveForestaScoreCorrection/);
  assert.match(js, /score-edit-button/);
  assert.doesNotMatch(js, /admin\.html#scores/);
  assert.match(js, /saveForestaTargetScores/);
  assert.match(server, /targetScore/);
  assert.match(server, /function saveForestaScoreCorrection_/);
});

test('score history is loaded after the main student screen', () => {
  assert.match(js, /function loadScoresInto_/);
  assert.match(js, /renderStudent\(\);loadScoresInto_/);
  assert.match(js, /renderAdminStudent\(\);loadScoresInto_/);
  assert.match(server, /scores: \[\], scoresDeferred: true/);
  assert.match(server, /function getForestaScores_/);
});

test('homework completion is stored per item with a completion date', () => {
  assert.match(server, /FORESTA_HOMEWORK_SHEET = 'フォレスタ宿題状況'/);
  assert.match(server, /completedAt/);
  assert.match(server, /previousHomeworkIdsJson/);
  assert.match(server, /completedHomeworkIds/);
  assert.match(js, /完了日/);
});

test('subject-specific homework and CT rules are encoded on the server', () => {
  assert.match(server, /Key Words「☆日→英」暗記/);
  assert.match(server, /Exercise「暗記マーク」暗記/);
  assert.match(server, /TRY赤×直し/);
  assert.match(server, /前回宿題の赤×直し/);
  assert.match(server, /ctResult === '×'/);
  assert.match(server, /特訓部屋/);
});

test('level filtering and test-range stopping rules are server-side', () => {
  assert.match(server, /Number\(level\) === 1/);
  assert.match(server, /Number\(level\) === 2/);
  assert.match(server, /FORESTA_TIMETABLE_SHEET_NAME = '時間割マスタ'/);
  assert.match(server, /中学1・2年生は予想テスト範囲を超えて進めません/);
});

test('score history and school schedules come through the grade system API', () => {
  assert.match(server, /getStudentScores/);
  assert.match(server, /getSchools/);
  assert.match(server, /remainingLessons/);
  assert.match(server, /requiredPerLesson/);
});

test('new authenticated API routes are registered', () => {
  for (const action of ['getForestaDashboard','getForestaAdminDashboard','getForestaRangeAdminData','saveForestaRangeSetting','saveForestaTargetScores','getForestaStudent','getForestaScores','saveForestaScoreCorrection','saveForestaLesson']) {
    assert.match(api, new RegExp(`case '${action}'`));
  }
});
