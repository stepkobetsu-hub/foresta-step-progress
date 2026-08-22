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

fs.writeFileSync(file, src);
console.log(`Applied V3 runtime fast path; removed ${bootstrapMatches.length - 1} per-request bootstrap calls`);
