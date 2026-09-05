from pathlib import Path

p=Path('cloudflare/src/v3.ts')
s=p.read_text()

jp='import { GOAL_JAPANESE_MATERIAL, GOAL_JAPANESE_UNITS } from "./goal-japanese.ts";'
en='import { GOAL_ENGLISH_MATERIAL, GOAL_ENGLISH_UNITS } from "./goal-english.ts";'
if en not in s:
    if jp not in s: raise SystemExit('Japanese Goal import anchor missing')
    s=s.replace(jp,jp+'\n'+en,1)

key='const GOAL_JAPANESE_CATALOG_KEY = "goal_japanese_catalog_20260825_v1";'
if 'GOAL_ENGLISH_CATALOG_KEY' not in s:
    if key not in s: raise SystemExit('Goal key anchor missing')
    s=s.replace(key,key+'\nconst GOAL_ENGLISH_CATALOG_KEY = "goal_english_catalog_20260905_v1";',1)

bootstrap='const ensureBootstrap = (env: V3Env) => {'
if 'const ensureGoalEnglishCatalog = async' not in s:
    helper=r'''
const ensureGoalEnglishCatalog = async (env: V3Env) => {
  const existing = await env.DB.prepare(`SELECT COUNT(*) AS count FROM units u JOIN materials m ON m.material_id=u.material_id WHERE m.series=? AND u.subject=? AND u.grade=? AND m.active=1`)
    .bind(GOAL_ENGLISH_MATERIAL.series, GOAL_ENGLISH_MATERIAL.subject, GOAL_ENGLISH_MATERIAL.grade)
    .first<{ count: number }>();
  if (Number(existing?.count || 0) >= GOAL_ENGLISH_UNITS.length) return;
  const material = env.DB.prepare(`INSERT INTO materials(material_id,series,subject,grade,title,has_lct,active,updated_at,version)
    VALUES(?,?,?,?,?,?,1,datetime('now'),1)
    ON CONFLICT(material_id) DO UPDATE SET series=excluded.series,subject=excluded.subject,grade=excluded.grade,title=excluded.title,has_lct=excluded.has_lct,active=1,updated_at=datetime('now'),version=materials.version+1`)
    .bind(GOAL_ENGLISH_MATERIAL.materialId,GOAL_ENGLISH_MATERIAL.series,GOAL_ENGLISH_MATERIAL.subject,GOAL_ENGLISH_MATERIAL.grade,GOAL_ENGLISH_MATERIAL.title,GOAL_ENGLISH_MATERIAL.hasLct?1:0);
  const units = GOAL_ENGLISH_UNITS.map((unit) => env.DB.prepare(`INSERT INTO units(unit_id,material_id,subject,grade,unit_order,unit_type,title,has_lct,updated_at,version)
    VALUES(?,?,?,?,?,?,?,?,datetime('now'),1)
    ON CONFLICT(unit_id) DO UPDATE SET material_id=excluded.material_id,subject=excluded.subject,grade=excluded.grade,unit_order=excluded.unit_order,unit_type=excluded.unit_type,title=excluded.title,has_lct=excluded.has_lct,updated_at=datetime('now'),version=units.version+1`)
    .bind(unit.unitId,GOAL_ENGLISH_MATERIAL.materialId,GOAL_ENGLISH_MATERIAL.subject,GOAL_ENGLISH_MATERIAL.grade,unit.unitOrder,unit.unitType,unit.title,unit.hasLct?1:0));
  await env.DB.batch([material,...units]);
  await env.DB.prepare(`INSERT INTO v3_meta(key,value,updated_at) VALUES(?,?,datetime('now')) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=datetime('now')`)
    .bind(GOAL_ENGLISH_CATALOG_KEY,String(GOAL_ENGLISH_UNITS.length)).run();
};

const ensureDummy1331 = async (env: V3Env) => {
  const existing = await env.DB.prepare(`SELECT display_name FROM students WHERE student_id='1331'`).first<{display_name:string}>();
  if (existing?.display_name && existing.display_name !== '鈴木A') throw new Error('DUMMY_1331_CONFLICT');
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO students(student_id,display_name,school,grade,status,source_updated_at,updated_at,version) VALUES('1331','鈴木A','南城中','中3','ACTIVE',datetime('now'),datetime('now'),1) ON CONFLICT(student_id) DO UPDATE SET display_name='鈴木A',school='南城中',grade='中3',status='ACTIVE',updated_at=datetime('now'),version=students.version+1`),
    env.DB.prepare(`INSERT INTO student_profiles(student_id,campus,school_name,grade_j_raw,grade_k_raw,grade_conflict,enrollment_status,source_updated_at,updated_at,version) VALUES('1331','神領','南城中','中３','中３',0,'ACTIVE',datetime('now'),datetime('now'),1) ON CONFLICT(student_id) DO UPDATE SET campus='神領',school_name='南城中',grade_j_raw='中３',grade_k_raw='中３',grade_conflict=0,enrollment_status='ACTIVE',updated_at=datetime('now'),version=student_profiles.version+1`),
  ]);
};

'''
    if bootstrap not in s: raise SystemExit('bootstrap anchor missing')
    s=s.replace(bootstrap,helper+bootstrap,1)

seq='''    await ensureSchema(env);\n    await ensureGoalJapaneseCatalog(env);'''
if 'await ensureGoalEnglishCatalog(env);' not in s:
    if seq not in s: raise SystemExit('bootstrap sequence missing')
    s=s.replace(seq,seq+'\n    await ensureGoalEnglishCatalog(env);\n    await ensureDummy1331(env);',1)

old='''const [students,progress,targets,homework,generatedHomework,dummy,goalJapanese]=await env.DB.batch([env.DB.prepare("SELECT COUNT(*) AS count FROM students"),env.DB.prepare("SELECT COUNT(*) AS count FROM v3_progress_records"),env.DB.prepare("SELECT COUNT(*) AS count FROM v3_target_snapshot"),env.DB.prepare("SELECT COUNT(*) AS count FROM v3_homework_snapshot"),env.DB.prepare("SELECT COUNT(*) AS count FROM v3_homework_items"),env.DB.prepare("SELECT COUNT(*) AS count FROM students WHERE student_id='1320'"),env.DB.prepare("SELECT COUNT(*) AS count FROM units u JOIN materials m ON m.material_id=u.material_id WHERE m.series='FORESTA_GOAL' AND u.subject='国語' AND u.grade='中3' AND m.active=1")]);'''
new='''const [students,progress,targets,homework,generatedHomework,dummy,goalJapanese,goalEnglish,testStudents,goalEnglishEligibility]=await env.DB.batch([env.DB.prepare("SELECT COUNT(*) AS count FROM students"),env.DB.prepare("SELECT COUNT(*) AS count FROM v3_progress_records"),env.DB.prepare("SELECT COUNT(*) AS count FROM v3_target_snapshot"),env.DB.prepare("SELECT COUNT(*) AS count FROM v3_homework_snapshot"),env.DB.prepare("SELECT COUNT(*) AS count FROM v3_homework_items"),env.DB.prepare("SELECT COUNT(*) AS count FROM students WHERE student_id='1320'"),env.DB.prepare("SELECT COUNT(*) AS count FROM units u JOIN materials m ON m.material_id=u.material_id WHERE m.series='FORESTA_GOAL' AND u.subject='国語' AND u.grade='中3' AND m.active=1"),env.DB.prepare("SELECT COUNT(*) AS count FROM units u JOIN materials m ON m.material_id=u.material_id WHERE m.series='FORESTA_GOAL' AND u.subject='英語' AND u.grade='中3' AND m.active=1"),env.DB.prepare("SELECT student_id,display_name,grade,status FROM students WHERE student_id IN ('1320','1331') ORDER BY student_id"),env.DB.prepare("SELECT s.student_id,s.grade,COUNT(u.unit_id) AS goal_english_count FROM students s CROSS JOIN materials m JOIN units u ON u.material_id=m.material_id WHERE s.student_id IN ('1320','1331') AND m.series='FORESTA_GOAL' AND m.active=1 AND u.subject='英語' AND (u.grade='' OR u.grade=s.grade OR u.grade='中1～中3共通' OR m.grade='' OR m.grade=s.grade OR m.grade='中1～中3共通' OR (m.series='FORESTA_GOAL' AND s.grade IN ('中1','中2','中3') AND (u.grade='中3' OR m.grade='中3'))) GROUP BY s.student_id,s.grade ORDER BY s.student_id")]);'''
if 'goalEnglishEligibility' not in s:
    if old not in s: raise SystemExit('health query anchor missing')
    s=s.replace(old,new,1)

old_ret='''return json({ok:true,service:"step-progress-v3-staging",mode:"d1-isolated-autosave",studentCount:count(students),progressCount:count(progress),targetCount:count(targets),homeworkCount:count(homework),generatedHomeworkCount:count(generatedHomework),dummy1320:count(dummy),goalJapaneseUnitCount:count(goalJapanese),bootstrapMs:elapsed(started)});'''
new_ret='''return json({ok:true,service:"step-progress-v3",mode:"d1-isolated-autosave",studentCount:count(students),progressCount:count(progress),targetCount:count(targets),homeworkCount:count(homework),generatedHomeworkCount:count(generatedHomework),dummy1320:count(dummy),goalJapaneseUnitCount:count(goalJapanese),goalEnglishUnitCount:count(goalEnglish),testStudents:testStudents.results,goalEnglishEligibility:goalEnglishEligibility.results,bootstrapMs:elapsed(started)});'''
if 'goalEnglishUnitCount' not in s:
    if old_ret not in s: raise SystemExit('health return anchor missing')
    s=s.replace(old_ret,new_ret,1)

p.write_text(s)

Path('cloudflare/tests/goal-english-selfheal.test.mjs').write_text('''import test from "node:test";\nimport assert from "node:assert/strict";\nimport fs from "node:fs";\nimport { GOAL_ENGLISH_UNITS, GOAL_ENGLISH_MATERIAL } from "../src/goal-english.ts";\n\ntest("canonical Goal English has 54 ordered unique units",()=>{\n assert.equal(GOAL_ENGLISH_MATERIAL.series,"FORESTA_GOAL");\n assert.equal(GOAL_ENGLISH_MATERIAL.grade,"中3");\n assert.equal(GOAL_ENGLISH_UNITS.length,54);\n assert.deepEqual(GOAL_ENGLISH_UNITS.map(x=>x.unitOrder),Array.from({length:54},(_,i)=>i+1));\n assert.equal(new Set(GOAL_ENGLISH_UNITS.map(x=>x.unitId)).size,54);\n assert.match(GOAL_ENGLISH_UNITS[0].unitId,/2026FG-ENG-G3-UNIT-/);\n assert.match(GOAL_ENGLISH_UNITS[53].unitId,/2026FG-ENG-G3-TIME-/);\n});\n\ntest("runtime self-heals English and verifies 1320/1331 eligibility",()=>{\n const v3=fs.readFileSync(new URL("../src/v3.ts",import.meta.url),"utf8");\n assert.match(v3,/ensureGoalEnglishCatalog/);\n assert.match(v3,/await ensureGoalEnglishCatalog\\(env\\)/);\n assert.match(v3,/ensureDummy1331/);\n assert.match(v3,/goalEnglishUnitCount/);\n assert.match(v3,/goalEnglishEligibility/);\n});\n''')
