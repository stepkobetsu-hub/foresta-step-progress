import fs from "node:fs";

const CACHE_PREFIX = "forestaProgress.viewCache:homeworkCheckCloudSave20260821:";

export function applyHomeworkCheckReliability(html) {
  const newline = html.includes("\r\n") ? "\r\n" : "\n";
  let output = html;

  if (!output.includes("'declareHomework','confirmHomework'")) {
    output = output.replace("'confirmHomework','confirmHomeworkGroup'", "'declareHomework','confirmHomework','confirmHomeworkGroup'");
  }
  if (!output.includes("'declareHomework','confirmHomework'")) throw new Error("declareHomework save-action registration failed");

  const start = output.indexOf("  async function handleStudentHomework_(action){");
  const end = output.indexOf(newline + "  async function renderStudentHomework_()", start);
  if (start < 0 || end < 0) throw new Error("student homework handler was not found");

  const replacement = [
    "  function applyHomeworkCheckToCache_(saved){",
    "    if(!saved||!state.homeworkCache)return;",
    "    const update=rows=>{if(!Array.isArray(rows))return;for(let index=0;index<rows.length;index+=1){if(String(rows[index]?.homeworkId)===String(saved.homeworkId))rows[index]={...rows[index],...saved}}};",
    "    update(state.homeworkCache.homework);",
    "    if(Array.isArray(state.homeworkCache.groups))state.homeworkCache.groups.forEach(group=>update(group.items));",
    "  }",
    "  async function handleStudentHomework_(action){",
    "    const status=action.dataset.status,homeworkId=action.dataset.home,type=action.dataset.homeType||action.closest('.homeItem')?.dataset.homeType||'TRY_REDO',noTargetUndo=action.dataset.noTargetUndo==='true';",
    "    if(status==='UNINPUT'){const message=noTargetUndo?'対象なしを取り消して、未確認の状態へ戻しますか？':'この宿題の「やりました」を取り消しますか？';if(!confirm(message))return}",
    "    if(status==='NO_TARGET_CLAIM'&&!confirm('TRYの直しはありませんでしたか？'))return;",
    "    const item=action.closest('.homeItem');action.disabled=true;paintHomeworkOptimistic_(item,homeworkId,type,status);beginSave_();",
    "    try{",
    "      const out=await callApi_('declareHomework',{homeworkId,studentStatus:status},{attempts:3,timeoutMs:120000,onRetry:()=>setGlobalSave_('宿題チェックをクラウドへ再送中…','saving')});",
    "      applyHomeworkCheckToCache_(out.homework);saveStudentViewCache_();endSave_('宿題チェックをクラウド保存しました');",
    "      await renderStudentHomework_();",
    "    }catch(error){",
    "      state.homeworkCache=null;saveStudentViewCache_();failSave_();toast(error.message);",
    "      try{await renderStudentHomework_()}catch(refreshError){renderHomeworkLoadError_(refreshError)}",
    "    }",
    "  }",
  ].join(newline);
  if (!output.includes("  function applyHomeworkCheckToCache_(saved){")) {
    output = output.slice(0, start) + replacement + output.slice(end);
  }

  output = output.replace(
    /const STUDENT_VIEW_CACHE_PREFIX='[^']*';/,
    `const STUDENT_VIEW_CACHE_PREFIX='${CACHE_PREFIX}';`,
  );

  const required = [
    "function applyHomeworkCheckToCache_",
    "callApi_('declareHomework'",
    "attempts:3,timeoutMs:120000",
    "applyHomeworkCheckToCache_(out.homework);saveStudentViewCache_();endSave_",
    CACHE_PREFIX,
  ];
  for (const marker of required) if (!output.includes(marker)) throw new Error(`homework check reliability patch failed: ${marker}`);
  return output;
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const path = process.argv[2] || "public/index.html";
  fs.writeFileSync(path, applyHomeworkCheckReliability(fs.readFileSync(path, "utf8")));
}
