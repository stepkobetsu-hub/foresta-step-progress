import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const page = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const gas = fs.readFileSync(new URL('../apps-script/code.gs', import.meta.url), 'utf8');

test('student login persists only the revocable common token', () => {
  assert.match(page, /COMMON_TOKEN_KEY='stepCommonStudentSessionToken'/);
  assert.match(page, /COMMON_EXPIRES_KEY='stepCommonStudentSessionExpiresAt'/);
  assert.match(page, /if\(type==='student'\)\{\s*localStorage\.removeItem\(keys\.enabled\)/);
  assert.match(page, /out\.role!=='STUDENT'&&\$\('rememberLogin'\)\.checked/);
  assert.doesNotMatch(page, /type==='student'[^\n]+localStorage\.setItem\(keys\.passKey/);
});

test('an existing common token resumes without credentials', () => {
  assert.match(page, /readCommonSession_\(\)/);
  assert.match(page, /action:'getCommonStudentSession',token:common\.token/);
  assert.match(page, /saveStoredSession_\(saved,false\)/);
});

test('grade gateway binds every request to the verified session user', () => {
  assert.match(gas, /const profile = getCommonStudentProfile_\(session\)/);
  assert.match(gas, /studentId: profile\.studentId/);
  assert.match(gas, /COMMON_GRADE_ACTIONS\.indexOf\(requestedAction\) < 0/);
  assert.match(gas, /requireRole_\(session, \[ROLE\.STUDENT\]\)/);
  assert.doesNotMatch(gas, /studentId:\s*requested\.studentId/);
});

test('student A session overwrites an injected student B id before forwarding', () => {
  const source = gas.match(/function commonGradeRequest_\(session, input\) \{[\s\S]*?\n\}/)?.[0];
  assert.ok(source);
  let forwarded;
  const context = vm.createContext({
    COMMON_GRADE_ACTIONS: ['getStudentScores'],
    getCommonStudentProfile_: () => ({ studentId: 'STUDENT-A', name: 'A', campus: 'X', grade: 'G', school: 'S' }),
    resolveCommonGradeEndpoint_: () => 'https://private.invalid/exec',
    UrlFetchApp: { fetch: (_url, options) => { forwarded = JSON.parse(options.payload); return { getContentText: () => JSON.stringify({ success: true }) }; } },
    JSON, String, Object, Error
  });
  vm.runInContext(source, context);
  vm.runInContext("commonGradeRequest_({userId:'STUDENT-A'},{gradeAction:'getStudentScores',payload:{studentId:'STUDENT-B'}})", context);
  assert.equal(forwarded.studentId, 'STUDENT-A');
  assert.notEqual(forwarded.studentId, 'STUDENT-B');
});
