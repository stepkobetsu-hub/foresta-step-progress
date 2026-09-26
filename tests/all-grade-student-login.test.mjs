import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const gas = fs.readFileSync(new URL('../apps-script/code.gs', import.meta.url), 'utf8');

test('common login normalizes every supported elementary, middle, and high-school grade', () => {
  const source = gas.match(/function normalizeGrade_\(value\) \{[\s\S]*?\n\}/)?.[0];
  assert.ok(source, 'normalizeGrade_ should exist');
  const context = vm.createContext({String});
  vm.runInContext(source, context);

  const cases = new Map([
    ['小１', '小1'], ['小学2年', '小2'], ['小3年', '小3'],
    ['小学４年', '小4'], ['小5', '小5'], ['小学６年', '小6'],
    ['中１', '中1'], ['中学2年', '中2'], ['中3年', '中3'],
    ['高１', '高1'], ['高校2年', '高2'], ['高等学校３年', '高3']
  ]);
  for (const [input, expected] of cases) {
    assert.equal(vm.runInContext(`normalizeGrade_(${JSON.stringify(input)})`, context), expected, input);
  }
});

test('student authentication searches through the current final master row', () => {
  const source = gas.match(/function getStudentAuthRecord_\(studentId\) \{[\s\S]*?\n\}/)?.[0];
  assert.ok(source, 'getStudentAuthRecord_ should exist');
  assert.match(source, /const lastRow = sheet\.getLastRow\(\)/);
  assert.match(source, /sheet\.getRange\(2, 1, lastRow - 1, 1\)/);
  assert.doesNotMatch(source, /getRange\(2,\s*1,\s*(?:328|335|1000)\b/);
});

test('unsupported grades fail without reintroducing middle-school-only wording', () => {
  assert.match(gas, /if \(!grade\) throw publicError_\('学年を確認できません。教室へお問い合わせください。'/);
  assert.doesNotMatch(gas, /中学生の学年を確認できません/);
});
