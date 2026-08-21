import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { applyHomeworkCheckReliability } from "../scripts/apply-homework-check-reliability.mjs";

test("student homework checks persist the cloud response before the next login", () => {
  const html = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  const patched = applyHomeworkCheckReliability(html);
  assert.match(patched, /'declareHomework','confirmHomework'/);
  assert.match(patched, /callApi_\('declareHomework',[\s\S]*attempts:3,timeoutMs:120000/);
  assert.match(patched, /applyHomeworkCheckToCache_\(out\.homework\);saveStudentViewCache_\(\);endSave_/);
  assert.match(patched, /viewCache:homeworkCheckCloudSave20260821/);
  assert.doesNotMatch(patched, /await call\('declareHomework'/);
});

test("homework check patch is idempotent", () => {
  const html = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  const once = applyHomeworkCheckReliability(html);
  assert.equal(applyHomeworkCheckReliability(once), once);
});
