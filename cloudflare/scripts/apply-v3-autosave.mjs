import fs from 'node:fs';

const file = process.argv[2] || 'public/index.html';
let html = fs.readFileSync(file, 'utf8');
const before = html;

html = html
  .replaceAll('setTimeout(flushProgressBatch_,800)', 'setTimeout(flushProgressBatch_,300)')
  .replaceAll('queue.timer=setTimeout(flush,800)', 'queue.timer=setTimeout(flush,350)')
  .replaceAll("status.textContent='変更あり'", "status.textContent='自動保存待ち…'")
  .replaceAll("setGlobalSave_('保存する','pending')", "setGlobalSave_('自動保存待ち…','pending')");

if (html === before) throw new Error('V3 autosave patch did not match the current UI');
if (!html.includes('setTimeout(flushProgressBatch_,300)')) throw new Error('progress debounce patch missing');
if (!html.includes('queue.timer=setTimeout(flush,350)')) throw new Error('target debounce patch missing');

fs.writeFileSync(file, html);
console.log('Applied V3 autosave debounce: progress=300ms target=350ms');
