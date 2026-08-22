import fs from 'node:fs';

const file = process.argv[2] || 'src/v3.ts';
let src = fs.readFileSync(file, 'utf8');

const bootstrapMatches = src.match(/await ensureBootstrap\(env\);/g) || [];
if (bootstrapMatches.length < 7) throw new Error(`Expected V3 bootstrap calls, found ${bootstrapMatches.length}`);

// Bootstrap is a deployment/health responsibility. Rechecking schema on every
// user save adds several D1 round-trips and defeats the sub-2-second goal.
src = src.replaceAll('await ensureBootstrap(env);', '');
const healthNeedle = 'const started=performance.now();';
if (!src.includes(healthNeedle)) throw new Error('Health bootstrap insertion point not found');
src = src.replace(healthNeedle, 'const started=performance.now();await ensureBootstrap(env);');

const cacheNeedle = 'if (!token) return;\n  await ensureSchema(env);\n  const profile';
if (!src.includes(cacheNeedle)) throw new Error('cacheSession schema fast-path point not found');
src = src.replace(cacheNeedle, 'if (!token) return;\n  const profile');

const localNeedle = 'if (!token) return null;\n  await ensureSchema(env);\n  const hash';
if (!src.includes(localNeedle)) throw new Error('localSession schema fast-path point not found');
src = src.replace(localNeedle, 'if (!token) return null;\n  const hash');

// Progress must carry the material series into dashboard/summary identity.
const progressQueryNeedle = `    env.DB.prepare(\`SELECT p.record_id,p.material_id,p.subject,p.grade,p.unit_id,p.round,p.point_confirmed,p.warmup_confirmed,p.try_completed,p.memorization_completed,p.exercise_completed,p.lct_result,p.learning_date,p.updated_at,p.version,u.title AS unit_title,u.unit_order
      FROM v3_progress_records p LEFT JOIN units u ON u.unit_id=p.unit_id WHERE p.student_id=? ORDER BY p.subject,u.unit_order,p.round\`).bind(studentId),`;
if (!src.includes(progressQueryNeedle)) throw new Error('Progress dashboard query point not found');
const progressQueryReplacement = `    env.DB.prepare(\`SELECT p.record_id,p.material_id,p.subject,p.grade,p.unit_id,p.round,p.point_confirmed,p.warmup_confirmed,p.try_completed,p.memorization_completed,p.exercise_completed,p.lct_result,p.learning_date,p.updated_at,p.version,u.title AS unit_title,u.unit_order,COALESCE(m.series,'FORESTA_STEP') AS series
      FROM v3_progress_records p LEFT JOIN units u ON u.unit_id=p.unit_id LEFT JOIN materials m ON m.material_id=u.material_id WHERE p.student_id=? ORDER BY p.subject,m.series,u.unit_order,p.round\`).bind(studentId),`;
src = src.replace(progressQueryNeedle, progressQueryReplacement);

// Snapshot target rows can contain duplicates/legacy series values. Apply one
// V3 override to every matching subject+unit row and force the current series,
// so no stale included row can make a target look restored after reload.
const targetNeedle = `  const targets = targetResult.results.filter(isRow).map((row) => ({ ...row }));
  const targetByKey = new Map(targets.map((row) => [\`${'${text(row.series)}|${text(row.subject)}|${text(row.unit_id)}'}\`, row]));
  for (const override of overrideResult.results.filter(isRow)) {
    const key = \`${'${text(override.series)}|${text(override.subject)}|${text(override.unit_id)}'}\`;
    const current = targetByKey.get(key);
    if (current) current.included = bool(override.included) ? 1 : 0;
    else targets.push({ target_id:\`V3:${'${studentId}'}:${'${text(override.series)}'}:${'${text(override.unit_id)}'}\`, material_id:"", subject:text(override.subject), unit_id:text(override.unit_id), target_start:text(override.unit_id), target_end:text(override.unit_id), target_period:"V3_OVERRIDE", included:bool(override.included)?1:0, series:text(override.series) });
  }
  const selectableResult =`;
if (!src.includes(targetNeedle)) throw new Error('Target override merge point not found');
const targetReplacement = `  const targets = targetResult.results.filter(isRow).map((row) => ({ ...row }));
  for (const override of overrideResult.results.filter(isRow)) {
    const unitId = text(override.unit_id);
    const subject = text(override.subject);
    const series = text(override.series) || "FORESTA_STEP";
    const included = bool(override.included);
    const matching = targets.filter((row) => text(row.unit_id) === unitId && text(row.subject) === subject);
    if (matching.length) matching.forEach((row) => { row.included = included ? 1 : 0; row.series = series; });
    else if (included) targets.push({ target_id:\`V3:${'${studentId}'}:${'${series}'}:${'${unitId}'}\`, material_id:"", subject, unit_id:unitId, target_start:unitId, target_end:unitId, target_period:"V3_OVERRIDE", included:1, series });
  }
  const selectableResult =`;
src = src.replace(targetNeedle, targetReplacement);

fs.writeFileSync(file, src);
console.log(`Applied V3 runtime fast path; removed ${bootstrapMatches.length - 1} per-request bootstrap calls; aligned target/progress identity`);
