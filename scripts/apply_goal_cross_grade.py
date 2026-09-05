from pathlib import Path

v3 = Path('cloudflare/src/v3.ts')
s = v3.read_text()
old = """  const selectableResult = await env.DB.prepare(`SELECT u.unit_id,u.subject,u.grade,u.unit_order,u.unit_type,u.title AS unit_title,u.has_lct,m.series,m.active FROM units u JOIN materials m ON m.material_id=u.material_id WHERE m.active=1 AND (u.grade='' OR u.grade=? OR u.grade='中1～中3共通' OR m.grade='' OR m.grade=? OR m.grade='中1～中3共通') ORDER BY u.subject,m.series,u.unit_order,u.unit_id`)\n    .bind(text(student.grade), text(student.grade)).all();"""
new = """  const selectableResult = await env.DB.prepare(`SELECT u.unit_id,u.subject,u.grade,u.unit_order,u.unit_type,u.title AS unit_title,u.has_lct,m.series,m.active FROM units u JOIN materials m ON m.material_id=u.material_id WHERE m.active=1 AND (u.grade='' OR u.grade=? OR u.grade='中1～中3共通' OR m.grade='' OR m.grade=? OR m.grade='中1～中3共通' OR (m.series='FORESTA_GOAL' AND ? IN ('中1','中2','中3') AND (u.grade='中3' OR m.grade='中3'))) ORDER BY u.subject,m.series,u.unit_order,u.unit_id`)\n    .bind(text(student.grade), text(student.grade), text(student.grade)).all();"""
if old not in s:
    raise SystemExit('selectable query anchor missing')
s = s.replace(old, new, 1)
old = """  const changes=Array.isArray(body.changes)?body.changes.filter(isRow).slice(0,500):[];\n  if(!studentId||!subject||!changes.length)return json({success:false,error:\"目標範囲を特定できません。\"},400);\n  await env.DB.batch(changes.map((change)=>env.DB.prepare(`INSERT INTO v3_target_overrides(student_id,series,subject,unit_id,included,updated_at,updated_by) VALUES(?,?,?,?,?,datetime('now'),?) ON CONFLICT(student_id,series,subject,unit_id) DO UPDATE SET included=excluded.included,updated_at=datetime('now'),updated_by=excluded.updated_by`).bind(studentId,series,subject,text(change.unitId),bool(change.selected)?1:0,session.userId)));\n  const dashboard=await readDashboardV3(env,studentId);"""
new = """  const changes=Array.isArray(body.changes)?body.changes.filter(isRow).slice(0,500):[];\n  if(!studentId||!subject||!changes.length)return json({success:false,error:\"目標範囲を特定できません。\"},400);\n  const beforeDashboard=await readDashboardV3(env,studentId);\n  const selectableBefore=beforeDashboard&&Array.isArray((beforeDashboard as Row).selectableUnits)?((beforeDashboard as Row).selectableUnits as unknown[]).filter(isRow):[];\n  const allowedUnitIds=new Set(selectableBefore.filter((unit)=>text(unit.subject)===subject&&text(unit.series)===series).map((unit)=>text(unit.unitId||unit.unit_id)).filter(Boolean));\n  if(changes.some((change)=>!allowedUnitIds.has(text(change.unitId))))return json({success:false,error:\"選択できない単元が含まれています。\"},400);\n  await env.DB.batch(changes.map((change)=>env.DB.prepare(`INSERT INTO v3_target_overrides(student_id,series,subject,unit_id,included,updated_at,updated_by) VALUES(?,?,?,?,?,datetime('now'),?) ON CONFLICT(student_id,series,subject,unit_id) DO UPDATE SET included=excluded.included,updated_at=datetime('now'),updated_by=excluded.updated_by`).bind(studentId,series,subject,text(change.unitId),bool(change.selected)?1:0,session.userId)));\n  const dashboard=await readDashboardV3(env,studentId);"""
if old not in s:
    raise SystemExit('save target anchor missing')
s = s.replace(old, new, 1)
v3.write_text(s)

dash = Path('cloudflare/src/dashboard.ts')
s = dash.read_text()
old = """  // unit_id is globally unique in the units table. Target inclusion therefore\n  // uses only unit_id; mixing legacy series labels into target identity caused\n  // a saved target to appear restored after reload.\n  const targetIds = new Set(targets\n    .filter((row) => truthy(row.included))\n    .map((row) => text(row.unit_id))\n    .filter(Boolean));"""
new = """  // Goal and Step targets are independent. Keep series + subject + unit id\n  // in the target identity so one series can never restore or clear the other.\n  const targetKeys = new Set(targets\n    .filter((row) => truthy(row.included))\n    .map((row) => unitKey(row.subject, row.series, row.unit_id))\n    .filter(Boolean));"""
if old not in s:
    raise SystemExit('dashboard target anchor missing')
s = s.replace(old, new, 1)
s = s.replace('    units: allUnits.filter((unit) => targetIds.has(unit.unitId)),', '    units: allUnits.filter((unit) => targetKeys.has(unitKey(unit.subject, unit.series, unit.unitId))),', 1)
s = s.replace('    selectableUnits: allUnits.map((unit, displayOrder) => ({ ...unit, displayOrder, targetIncluded: targetIds.has(unit.unitId) })),', '    selectableUnits: allUnits.map((unit, displayOrder) => ({ ...unit, displayOrder, targetIncluded: targetKeys.has(unitKey(unit.subject, unit.series, unit.unitId)) })),', 1)
if 'targetIds.has' in s:
    raise SystemExit('stale targetIds reference remains')
dash.write_text(s)

gas = Path('apps-script/code.gs')
s = gas.read_text()
anchor = "function getCachedSelectableUnits_(grade, subject, series) {"
helper = """function isMiddleSchoolGradeForGoal_(grade) {
  const normalized = String(grade || '').normalize('NFKC').replace(/年$/u, '');
  return ['中1', '中2', '中3'].includes(normalized);
}

function isGoalCatalogUnitForGrade_(grade, unit) {
  return isMiddleSchoolGradeForGoal_(grade) &&
    normalizeSeries_(unit && unit.series) === MATERIAL_SERIES.GOAL &&
    String(unit && unit.gradeScope || '').normalize('NFKC').replace(/年$/u, '') === '中3';
}

function getCachedSelectableUnits_(grade, subject, series) {"""
if anchor not in s:
    raise SystemExit('GAS helper anchor missing')
s = s.replace(anchor, helper, 1)
old = """      (
        isDevelopment_() &&
        normalizeSeries_(unit.series) === MATERIAL_SERIES.GOAL &&
        String(unit.gradeScope) === '中3'
      )"""
if old not in s:
    raise SystemExit('cached Goal dev-only condition missing')
s = s.replace(old, "isGoalCatalogUnitForGrade_(grade, unit)", 1)
old = """      (
        isDevelopment_() &&
        normalizeSeries_(unit && unit.series) === MATERIAL_SERIES.GOAL &&
        gradeScope === '中3'
      );"""
if old not in s:
    raise SystemExit('profile Goal dev-only condition missing')
s = s.replace(old, "      isGoalCatalogUnitForGrade_(grade, unit);", 1)
old = """      (
        isDevelopment_() &&
        normalizeSeries_(unit.series) === MATERIAL_SERIES.GOAL &&
        String(unit.gradeScope) === '中3'
      )"""
if old not in s:
    raise SystemExit('selectable profile Goal dev-only condition missing')
s = s.replace(old, "isGoalCatalogUnitForGrade_(profile.grade, unit)", 1)
gas.write_text(s)

test = Path('cloudflare/tests/goal-cross-grade-selection.test.mjs')
test.write_text('''import test from "node:test";\nimport assert from "node:assert/strict";\nimport fs from "node:fs";\nimport { buildV83Dashboard } from "../src/dashboard.ts";\n\nconst v3 = fs.readFileSync(new URL("../src/v3.ts", import.meta.url), "utf8");\nconst gas = fs.readFileSync(new URL("../../apps-script/code.gs", import.meta.url), "utf8");\n\ntest("Goal is explicitly cross-grade for middle school only", () => {\n  assert.match(v3, /m\\.series='FORESTA_GOAL'.*\\? IN \\('中1','中2','中3'\\)/s);\n  assert.match(gas, /function isMiddleSchoolGradeForGoal_/);\n  assert.match(gas, /\\['中1', '中2', '中3'\\]\\.includes/);\n  assert.match(gas, /isGoalCatalogUnitForGrade_\\(grade, unit\\)/);\n});\n\ntest("Goal and Step target inclusion remain independent", () => {\n  const student = { student_id: "1320", display_name: "加瀬智子", grade: "中2", campus: "大手", school: "南城中", status: "ACTIVE" };\n  const selectable = [\n    { unit_id: "SAME", subject: "英語", series: "FORESTA_STEP", unit_order: 1, title: "Step" },\n    { unit_id: "SAME", subject: "英語", series: "FORESTA_GOAL", unit_order: 1, title: "Goal" },\n  ];\n  const targets = [{ unit_id: "SAME", subject: "英語", series: "FORESTA_GOAL", included: 1 }];\n  const dashboard = buildV83Dashboard(student, targets, [], [], selectable, []);\n  const step = dashboard.selectableUnits.find((u) => u.series === "FORESTA_STEP");\n  const goal = dashboard.selectableUnits.find((u) => u.series === "FORESTA_GOAL");\n  assert.equal(step.targetIncluded, false);\n  assert.equal(goal.targetIncluded, true);\n  assert.deepEqual(dashboard.units.map((u) => u.series), ["FORESTA_GOAL"]);\n});\n\ntest("Goal writes validate against subject and series selectable candidates", () => {\n  assert.match(v3, /allowedUnitIds=new Set/);\n  assert.match(v3, /選択できない単元が含まれています/);\n});\n''')

Path('.github/workflows/verify-goal-catalog-20260905.yml').unlink(missing_ok=True)
Path('.github/workflows/apply-goal-cross-grade-20260905.yml').unlink(missing_ok=True)
Path('scripts/apply_goal_cross_grade.py').unlink(missing_ok=True)
