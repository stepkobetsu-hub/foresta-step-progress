import fs from 'node:fs';

const [,, serverFile = 'src/v3.ts', htmlFile = 'public/index.html'] = process.argv;
const server = fs.readFileSync(serverFile, 'utf8');
const html = fs.readFileSync(htmlFile, 'utf8');

// The production UI already has the correct immediate-update flow:
// paintHomeworkOptimistic_() -> save -> applyHomeworkCheckToCache_(out.homework)
// -> renderStudentHomework_().  The V3 bug was that the save response omitted
// out.homework.  Keep the native UI path intact and only verify that this contract
// is present after the server patch.
const required = [
  'async function handleStudentHomework_(action)',
  'paintHomeworkOptimistic_(item,homeworkId,type,status)',
  "callApi_('declareHomework'",
  'applyHomeworkCheckToCache_(out.homework)',
  'await renderStudentHomework_()',
];
for (const needle of required) {
  if (!html.includes(needle)) throw new Error(`native homework UI contract missing: ${needle}`);
}
if (!server.includes('homework,elapsedMs:elapsed(started)')) {
  throw new Error('V3 homework save response does not expose homework object');
}

console.log('Verified native homework optimistic UI; V3 save response supplies out.homework');
