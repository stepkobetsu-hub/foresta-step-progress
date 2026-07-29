import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Script } from "node:vm";
import test from "node:test";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const code = await readFile(new URL("../apps-script/code.gs", import.meta.url), "utf8");
const seed = await readFile(new URL("../apps-script/required-textbook.gs", import.meta.url), "utf8");
const units = JSON.parse(seed.match(/const REQUIRED_TEXTBOOK_UNIT_SEED = (\[[\s\S]*?\]);/)[1]);

test("six private TOCs produce the expected 309 public unit records", () => {
  assert.equal(units.length, 309);
  const byPrefix = Object.groupBy(units, (unit) => unit.unitId.split("-").slice(1, 3).join("-"));
  assert.equal(byPrefix["SCI-G1"].length, 37);
  assert.equal(byPrefix["SCI-G2"].length, 45);
  assert.equal(byPrefix["SCI-G3"].length, 46);
  assert.equal(byPrefix["SOC-GEO"].length, 61);
  assert.equal(byPrefix["SOC-HIS"].length, 59);
  assert.equal(byPrefix["SOC-G3"].length, 61);
});

test("unit IDs, order, chapters, and page ranges are stable and complete", () => {
  assert.equal(new Set(units.map((unit) => unit.unitId)).size, units.length);
  assert.equal(new Set(units.map((unit) => unit.displayOrder)).size, units.length);
  assert.ok(units.every((unit) => unit.chapterId && unit.chapterLabel));
  assert.ok(units.every((unit) => /（p\.\d+(?:–\d+)?）$/.test(unit.unitTitle)));
  assert.ok(units.every((unit) => unit.standardEligible === false));
});

test("the original ZIP and workbooks are not published", () => {
  assert.doesNotMatch(seed, /\.xlsx|\.zip|中学必修テキスト_.*もくじ/);
  assert.ok(units.every((unit) => unit.sourceFile === "private-toc-2026"));
});

test("required textbook is isolated from existing material series", () => {
  assert.match(code, /REQUIRED_TEXTBOOK:\s*'REQUIRED_TEXTBOOK'/);
  assert.match(code, /if \(series === MATERIAL_SERIES\.REQUIRED_TEXTBOOK\)/);
  assert.match(code, /return \[HOMEWORK_TYPES\.REQUIRED_REMAINDER\]/);
  assert.match(code, /filterUnitsForProfile_\(profile, getCachedSelectableUnits_\(profile\.grade\)\)/);
  assert.match(seed, /requiredTextbookAvailableForProfile_/);
  assert.match(seed, /isOtemachiCampus_/);
  assert.match(code, /MATERIAL_SERIES\.STEP, MATERIAL_SERIES\.GOAL, MATERIAL_SERIES\.REQUIRED_TEXTBOOK/);
});

test("homework remains one combined item and existing homework types remain", () => {
  assert.match(code, /REQUIRED_REMAINDER:\s*'赤×なおしとその単元の残り'/);
  assert.match(code, /TRY_REDO:\s*'TRY_REDO'/);
  assert.match(code, /MEMORIZATION_MARK:\s*'MEMORIZATION_MARK'/);
  assert.match(code, /MY_VOCABULARY:\s*'MY_VOCABULARY'/);
  assert.match(html, /REQUIRED_REMAINDER:'赤×なおしとその単元の残り'/);
});

test("the student UI is compact, campus-gated, and uses dedicated completion input", () => {
  assert.match(html, /label:'必修テキスト',purpose:'大手町校'/);
  assert.match(html, /requiredMaterialTab/);
  assert.match(html, /data-required-book/);
  assert.match(html, /取り組み・完了/);
  assert.match(html, /unit\.series==='REQUIRED_TEXTBOOK'/);
  assert.match(html, /requiredSocialBook:'地理'/);
});

test("science and social grade visibility matches Issue #5", () => {
  assert.ok(units.filter((unit) => unit.unitId.includes("SCI-G1")).every((unit) => unit.gradeScope === "中1"));
  assert.ok(units.filter((unit) => unit.unitId.includes("SCI-G2")).every((unit) => unit.gradeScope === "中2"));
  assert.ok(units.filter((unit) => unit.unitId.includes("SCI-G3")).every((unit) => unit.gradeScope === "中3"));
  assert.ok(units.filter((unit) => /SOC-(GEO|HIS)/.test(unit.unitId)).every((unit) => unit.gradeScope === "中1～中3共通"));
  assert.ok(units.filter((unit) => unit.unitId.includes("SOC-G3")).every((unit) => unit.gradeScope === "中3"));
});

test("all JavaScript sources parse", () => {
  const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/gi)].map((match) => match[1]).join("\n");
  new Script(script);
  new Script(code);
  new Script(seed);
});

