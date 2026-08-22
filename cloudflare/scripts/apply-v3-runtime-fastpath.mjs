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

// A snapshot target row can have a blank/legacy series value even when the
// selectable unit has the current series. Merge V3 overrides by unit+subject,
// otherwise an old included row survives next to a new excluded override and
// the dashboard appears to revert after reload.
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
    const included = bool(override.included);
    const matching = targets.filter((row) => text(row.unit_id) === unitId && text(row.subject) === subject);
    if (matching.length) matching.forEach((row) => { row.included = included ? 1 : 0; });
    else if (included) targets.push({ target_id:\`V3:${'${studentId}'}:${'${text(override.series)}'}:${'${unitId}'}\`, material_id:"", subject, unit_id:unitId, target_start:unitId, target_end:unitId, target_period:"V3_OVERRIDE", included:1, series:text(override.series) });
  }
  const selectableResult =`;
src = src.replace(targetNeedle, targetReplacement);

fs.writeFileSync(file, src);
console.log(`Applied V3 runtime fast path; removed ${bootstrapMatches.length - 1} per-request bootstrap calls; fixed target reload merge`);
