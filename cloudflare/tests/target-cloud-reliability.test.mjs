import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { applyTargetCloudReliability } from "../scripts/apply-target-cloud-reliability.mjs";

test("goal target saves keep their subject and series and retry the cloud", () => {
  const html = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  const patched = applyTargetCloudReliability(html);
  const start = patched.indexOf("  function bindTargetAutoSave_(units){");
  const end = patched.indexOf("\n  function formatShortDate_", start);
  const block = patched.slice(start, end);
  assert.match(block, /const targetSubject=state\.subject,targetSeries=state\.series/);
  assert.match(block, /subject:targetSubject,series:targetSeries/);
  assert.match(block, /attempts:3,timeoutMs:120000/);
  assert.match(block, /クラウドへ再送中/);
  assert.match(block, /saveStudentViewCache_\(\)/);
  assert.doesNotMatch(block, /subject:state\.subject,series:state\.series/);
  assert.match(patched, /viewCache:goalCloudSave20260818/);
});
