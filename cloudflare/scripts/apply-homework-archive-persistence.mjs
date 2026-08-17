import fs from "node:fs";

export function applyHomeworkArchivePersistence(html) {
  const replacements = [
    [
      "'confirmHomework','confirmHomeworkGroup','setStudentTarget'",
      "'confirmHomework','confirmHomeworkGroup','setStudentTarget','setHomeworkGroupArchived'",
    ],
    [
      "function archivedHomeworkGroups_(studentId=''){try{return new Set(JSON.parse(localStorage.getItem(homeworkArchiveKey_(studentId))||'[]'))}catch(_){return new Set()}}",
      "function archivedHomeworkGroups_(studentId='',home=state.homeworkCache){if(Array.isArray(home?.archivedGroupKeys))return new Set(home.archivedGroupKeys.map(String));try{return new Set(JSON.parse(localStorage.getItem(homeworkArchiveKey_(studentId))||'[]'))}catch(_){return new Set()}}",
    ],
    [
      "function setHomeworkArchived_(groupKey,archived,studentId=''){const groups=archivedHomeworkGroups_(studentId);archived?groups.add(String(groupKey)):groups.delete(String(groupKey));localStorage.setItem(homeworkArchiveKey_(studentId),JSON.stringify(Array.from(groups)))}",
      "async function setHomeworkArchived_(groupKey,archived,studentId='',home=state.homeworkCache){beginSave_();try{const out=await call('setHomeworkGroupArchived',{groupKey:String(groupKey),archived:!!archived,...(studentId?{studentId:String(studentId)}:{})}),keys=Array.isArray(out.archivedGroupKeys)?out.archivedGroupKeys.map(String):[];if(home)home.archivedGroupKeys=keys;localStorage.setItem(homeworkArchiveKey_(studentId),JSON.stringify(keys));saveStudentViewCache_();endSave_(archived?'アーカイブへ保存しました':'宿題一覧へ戻しました');return true}catch(error){failSave_();toast(error.message);return false}}",
    ],
    ["const home=state.homeworkCache,body=$('studentBody'),archivedKeys=archivedHomeworkGroups_(),", "const home=state.homeworkCache,body=$('studentBody'),archivedKeys=archivedHomeworkGroups_('',home),"],
    [
      "body.onclick=event=>{const archive=event.target.closest('[data-archive-group]');if(archive&&body.contains(archive)){setHomeworkArchived_(archive.dataset.archiveGroup,archive.dataset.archived==='true');renderStudentHomework_();return}",
      "body.onclick=async event=>{const archive=event.target.closest('[data-archive-group]');if(archive&&body.contains(archive)){archive.disabled=true;if(await setHomeworkArchived_(archive.dataset.archiveGroup,archive.dataset.archived==='true','',home))await renderStudentHomework_();else archive.disabled=false;return}",
    ],
    ["const body=$('studentBody'),archivedKeys=archivedHomeworkGroups_(studentId),", "const body=$('studentBody'),archivedKeys=archivedHomeworkGroups_(studentId,home),"],
    [
      "body.onclick=event=>{const archive=event.target.closest('[data-admin-archive-group]');if(archive&&body.contains(archive)){setHomeworkArchived_(archive.dataset.adminArchiveGroup,archive.dataset.archived==='true',studentId);renderAdminStudentDashboard_(d,studentId);return}",
      "body.onclick=async event=>{const archive=event.target.closest('[data-admin-archive-group]');if(archive&&body.contains(archive)){archive.disabled=true;if(await setHomeworkArchived_(archive.dataset.adminArchiveGroup,archive.dataset.archived==='true',studentId,home))await renderAdminStudentDashboard_(d,studentId);else archive.disabled=false;return}",
    ],
  ];
  let output = html.replace(
    "async function setHomeworkArchived_(groupKey,archived,studentId='',home=state.homeworkCache){beginSave_();try{const out=await call('setHomeworkGroupArchived',{groupKey:String(groupKey),archived:!!archived,...(studentId?{studentId:String(studentId)}:{})}),keys=Array.isArray(out.archivedGroupKeys)?out.archivedGroupKeys.map(String):[];if(home)home.archivedGroupKeys=keys;localStorage.setItem(homeworkArchiveKey_(studentId),JSON.stringify(keys));endSave_(archived?'アーカイブへ保存しました':'宿題一覧へ戻しました');return true}catch(error){failSave_();toast(error.message);return false}}",
    "async function setHomeworkArchived_(groupKey,archived,studentId='',home=state.homeworkCache){beginSave_();try{const out=await call('setHomeworkGroupArchived',{groupKey:String(groupKey),archived:!!archived,...(studentId?{studentId:String(studentId)}:{})}),keys=Array.isArray(out.archivedGroupKeys)?out.archivedGroupKeys.map(String):[];if(home)home.archivedGroupKeys=keys;localStorage.setItem(homeworkArchiveKey_(studentId),JSON.stringify(keys));saveStudentViewCache_();endSave_(archived?'アーカイブへ保存しました':'宿題一覧へ戻しました');return true}catch(error){failSave_();toast(error.message);return false}}",
  );
  for (const [before, after] of replacements) {
    if (output.includes(before)) output = output.replace(before, after);
    else if (!output.includes(after)) throw new Error(`archive persistence patch target not found: ${before.slice(0, 80)}`);
  }
  output = output
    .replaceAll("'fsAdminDashboard:storageConsistencyFix20260817:'", "'fsAdminDashboard:archivePersistence20260817:'")
    .replaceAll("'fsAdminDashboard:'", "'fsAdminDashboard:archivePersistence20260817:'")
    .replace(
      /const STUDENT_VIEW_CACHE_PREFIX='[^']*';/,
      "const STUDENT_VIEW_CACHE_PREFIX='forestaProgress.viewCache:archivePersistence20260817:';",
    );
  if (!output.includes("fsAdminDashboard:archivePersistence20260817:") ||
      !output.includes("forestaProgress.viewCache:archivePersistence20260817:")) {
    throw new Error("archive persistence cache version replacement failed");
  }
  return output;
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const path = process.argv[2] || "public/index.html";
  fs.writeFileSync(path, applyHomeworkArchivePersistence(fs.readFileSync(path, "utf8")));
}
