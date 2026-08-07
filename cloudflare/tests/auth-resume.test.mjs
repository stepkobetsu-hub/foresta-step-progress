import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const page = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8");

test("a stored session hides the login screen before the first paint", () => {
  assert.match(page, /document\.documentElement\.classList\.add\('auth-resume-pending'\)/);
  assert.match(page, /html\.auth-resume-pending #login\{visibility:hidden\}/);
  assert.match(page, /stepCommonStudentSessionToken/);
  assert.match(page, /sessionStorage\.getItem\('fsSession'\)/);
});

test("the login screen is revealed only when automatic authentication cannot continue", () => {
  assert.match(page, /function finishAuthResume_\(\)/);
  assert.match(page, /classList\.remove\('auth-resume-pending'\)/);
  assert.match(page, /classList\.remove\('hidden'\);finishAuthResume_\(\)/);
});
