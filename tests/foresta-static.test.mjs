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

test('lesson form requires school progress, teacher, CT and homework status', () => {
  assert.match(js, /name="instructorName" required/);
  assert.match(js, /name="schoolProgressUnitId" required/);
  assert.match(js, /name="homeworkCompleted"/);
  assert.match(js, /name="ctResult"/);
  assert.match(js, /saveForestaLesson/);
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
  for (const action of ['getForestaDashboard','getForestaAdminDashboard','getForestaStudent','saveForestaLesson']) {
    assert.match(api, new RegExp(`case '${action}'`));
  }
});
