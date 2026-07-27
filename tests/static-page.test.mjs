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
  assert.doesNotMatch(html, /SPREADSHEET_ID|API_KEY|SCRIPT_PROP|kase|password\s*[:=]\s*['"][^'"]+/i);
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
