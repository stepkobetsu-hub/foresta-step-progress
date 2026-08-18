import fs from "node:fs";

const CACHE_PREFIX = "forestaProgress.viewCache:goalCloudSave20260818:";

export function applyTargetCloudReliability(html) {
  const start = html.indexOf("  function bindTargetAutoSave_(units){");
  const end = html.indexOf("\n  function formatShortDate_", start);
  if (start < 0 || end < 0) throw new Error("target auto-save function was not found");

  let block = html.slice(start, end);
  if (!block.includes("const targetSubject=state.subject,targetSeries=state.series;")) {
    block = block
      .replaceAll("state.subject", "targetSubject")
      .replaceAll("state.series", "targetSeries")
      .replace(
        /(  function bindTargetAutoSave_\(units\)\{\r?\n)(    const choices=)/,
        "$1    const targetSubject=state.subject,targetSeries=state.series;\n$2",
      )
      .replace(
        "const out=await call('setOwnTargetChanges',{subject:targetSubject,series:targetSeries,changes:Array.from(sent,([unitId,selected])=>({unitId,selected})),clientRevision:revision});",
        "const out=await callApi_('setOwnTargetChanges',{subject:targetSubject,series:targetSeries,changes:Array.from(sent,([unitId,selected])=>({unitId,selected})),clientRevision:revision},{attempts:3,timeoutMs:120000,onRetry:()=>{status.textContent='クラウドへ再送中…';status.className='saveState saving';setGlobalSave_('クラウドへ再送中…','saving')}});",
      )
      .replace(
        "updateCache(out);status.textContent=",
        "updateCache(out);saveStudentViewCache_();status.textContent=",
      );
  }
  const required = [
    "const targetSubject=state.subject,targetSeries=state.series;",
    "callApi_('setOwnTargetChanges'",
    "attempts:3,timeoutMs:120000",
    "updateCache(out);saveStudentViewCache_();",
  ];
  for (const marker of required) if (!block.includes(marker)) throw new Error(`target cloud reliability patch failed: ${marker}`);

  let output = html.slice(0, start) + block + html.slice(end);
  output = output.replace(
    /const STUDENT_VIEW_CACHE_PREFIX='[^']*';/,
    `const STUDENT_VIEW_CACHE_PREFIX='${CACHE_PREFIX}';`,
  );
  if (!output.includes(CACHE_PREFIX)) throw new Error("target cache version replacement failed");
  return output;
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const path = process.argv[2] || "public/index.html";
  fs.writeFileSync(path, applyTargetCloudReliability(fs.readFileSync(path, "utf8")));
}
