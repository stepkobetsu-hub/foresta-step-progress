// ===== 通常授業用 フォレスタ進捗管理 =====
// 既存のステップ＆ゴール用データとは別シートへ保存する。
const FORESTA_APP_NAME = 'フォレスタ進捗管理';
const FORESTA_TIMETABLE_SHEET_NAME = '時間割マスタ';
const FORESTA_SETTINGS_SHEET = 'フォレスタ設定';
const FORESTA_RANGE_SETTINGS_SHEET = 'フォレスタ学校別予想範囲';
const FORESTA_LESSONS_SHEET = 'フォレスタ授業記録';
const FORESTA_SETTINGS_HEADERS = Object.freeze([
  'settingId','studentId','subject','schoolProgressUnitId','predictedRangeEndUnitId',
  'nextTestDate','updatedAt','updatedBy'
]);
const FORESTA_LESSONS_HEADERS = Object.freeze([
  'lessonId','studentId','lessonDate','subject','instructorName','schoolProgressUnitId',
  'startUnitId','endUnitId','predictedRangeEndUnitId','homeworkCompleted','ctUnitId',
  'ctResult','progressedUnits','nextCtUnitId','homeworkItemsJson','trainingRequired',
  'notificationText','memo','createdAt','createdBy'
]);
const FORESTA_RANGE_SETTINGS_HEADERS = Object.freeze([
  'rangeId','school','grade','subject','predictedRangeStartUnitId','predictedRangeEndUnitId','updatedAt','updatedBy'
]);

function forestaEnsureSheet_(name, headers) {
  const db = getDb_();
  let sheet = db.getSheetByName(name);
  if (!sheet) sheet = db.insertSheet(name);
  if (sheet.getLastRow() === 0) sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  else headers.forEach((header, index) => {
    if (String(sheet.getRange(1, index + 1).getValue() || '') !== header) sheet.getRange(1, index + 1).setValue(header);
  });
  sheet.setFrozenRows(1);
  return sheet;
}

function forestaRows_(name, headers) {
  const values = forestaEnsureSheet_(name, headers).getDataRange().getValues();
  return values.slice(1).map((row, index) => ({row, rowNumber: index + 2}))
    .filter(item => item.row.some(value => value !== '')).map(item => {
    const row = item.row;
    const object = {_rowNumber: item.rowNumber};
    headers.forEach((header, column) => object[header] = row[column]);
    return object;
  });
}

function forestaAppend_(name, headers, item) {
  forestaEnsureSheet_(name, headers).appendRow(headers.map(header => item[header] == null ? '' : item[header]));
}

function forestaUpdate_(name, headers, rowNumber, item) {
  forestaEnsureSheet_(name, headers).getRange(rowNumber, 1, 1, headers.length)
    .setValues([headers.map(header => item[header] == null ? '' : item[header])]);
}

function forestaNormalizeDifficulty_(value) {
  return String(value || '').replace(/！/g, '!').trim();
}

function forestaCanSkip_(level, difficulty) {
  const mark = forestaNormalizeDifficulty_(difficulty);
  if (Number(level) === 1) return mark === '!' || mark === '!!';
  if (Number(level) === 2) return mark === '!!';
  return false;
}

function forestaLevelMap_() {
  const book = SpreadsheetApp.openById(getRequiredProperty_(PROP.STUDENT_MASTER_SS_ID));
  const sheet = book.getSheetByName(FORESTA_TIMETABLE_SHEET_NAME);
  if (!sheet || sheet.getLastRow() < 3) return {};
  const rows = sheet.getRange(3, 1, sheet.getLastRow() - 2, Math.max(42, sheet.getLastColumn())).getValues();
  return rows.reduce((map, row) => {
    const studentId = String(row[0] || '').trim();
    if (studentId) map[studentId] = {english: Number(row[40] || 3), math: Number(row[41] || 3)};
    return map;
  }, {});
}

function forestaInstructorsForCampus_(campus) {
  const book = SpreadsheetApp.openById(getRequiredProperty_(PROP.STAFF_MASTER_SS_ID));
  const sheet = book.getSheetByName(getRequiredProperty_(PROP.STAFF_MASTER_SHEET_NAME));
  if (!sheet) return [];
  const rows = sheet.getDataRange().getValues();
  const normalizedCampus = String(campus || '').replace(/校$/, '').trim();
  return rows.slice(1).map(row => ({name: String(row[1] || '').trim(), campus: String(row[17] || '').trim()}))
    .filter(item => item.name && (!normalizedCampus || item.campus.split(/[・,、／/]/).map(v => v.replace(/校$/, '').trim()).includes(normalizedCampus)));
}

function forestaUnitsFor_(student, subject, levelMap) {
  const level = subject === '英語' ? Number(levelMap.english || 3) : Number(levelMap.math || 3);
  return getRowsAsObjects_('Units').filter(unit =>
    String(unit.active).toLowerCase() !== 'false' &&
    String(unit.subject) === subject &&
    normalizeSeries_(unit.series) === MATERIAL_SERIES.STEP &&
    (!String(unit.gradeScope || '').trim() || String(unit.gradeScope).includes(String(student.grade || '').replace('中','')) || String(unit.gradeScope).includes(String(student.grade || '')))
  ).sort((a, b) => Number(a.displayOrder || a.originalDisplayOrder || 0) - Number(b.displayOrder || b.originalDisplayOrder || 0))
    .map((unit, index) => ({
      unitId: String(unit.unitId), subject, stepCode: String(unit.stepCode || ''), unitTitle: String(unit.unitTitle || ''),
      difficulty: forestaNormalizeDifficulty_(unit.difficulty), skippable: forestaCanSkip_(level, unit.difficulty), order: index
    }));
}

function forestaSetting_(studentId, subject) {
  return forestaRows_(FORESTA_SETTINGS_SHEET, FORESTA_SETTINGS_HEADERS)
    .find(row => String(row.studentId) === String(studentId) && String(row.subject) === String(subject)) || null;
}

function forestaJuniorGrade_(value) {
  const text = String(value || '').normalize('NFKC').trim();
  if (!text.includes('中')) return '';
  const match = text.match(/[1-3]/);
  return match ? '中' + match[0] : '';
}

function forestaRangeSettings_() {
  return forestaRows_(FORESTA_RANGE_SETTINGS_SHEET, FORESTA_RANGE_SETTINGS_HEADERS);
}

function forestaSchoolRangeSetting_(student, subject, knownRows) {
  const school = String(student && student.school || '').trim();
  const grade = forestaJuniorGrade_(student && student.grade);
  return (knownRows || forestaRangeSettings_()).find(row =>
    String(row.school || '').trim() === school &&
    forestaJuniorGrade_(row.grade) === grade &&
    String(row.subject || '').trim() === String(subject || '').trim()
  ) || null;
}

function forestaEffectiveSetting_(student, subject, personalSetting, knownRangeRows) {
  const schoolSetting = forestaSchoolRangeSetting_(student, subject, knownRangeRows);
  if (!personalSetting && !schoolSetting) return null;
  const effective = Object.assign({}, schoolSetting || {}, personalSetting || {});
  if (schoolSetting && schoolSetting.predictedRangeEndUnitId) {
    effective.predictedRangeStartUnitId = schoolSetting.predictedRangeStartUnitId || '';
    effective.predictedRangeEndUnitId = schoolSetting.predictedRangeEndUnitId;
    effective.predictedRangeSource = 'SCHOOL_GRADE';
  } else {
    effective.predictedRangeSource = personalSetting ? 'STUDENT' : '';
  }
  return effective;
}

function forestaLessons_(studentId) {
  return forestaRows_(FORESTA_LESSONS_SHEET, FORESTA_LESSONS_HEADERS)
    .filter(row => String(row.studentId) === String(studentId))
    .sort((a, b) => String(b.lessonDate).localeCompare(String(a.lessonDate)) || String(b.createdAt).localeCompare(String(a.createdAt)));
}

function forestaGradeRequest_(action, payload) {
  const response = UrlFetchApp.fetch(resolveCommonGradeEndpoint_(), {
    method: 'post', contentType: 'text/plain;charset=utf-8',
    payload: JSON.stringify(Object.assign({action}, payload || {})),
    muteHttpExceptions: true, followRedirects: true
  });
  try { return JSON.parse(response.getContentText()); } catch (error) { return {success: false}; }
}

function forestaSchools_() {
  const cache = CacheService.getScriptCache();
  const key = 'FORESTA:SCHOOLS';
  const cached = cache.get(key);
  if (cached) {
    try { return JSON.parse(cached); } catch (error) {}
  }
  const schools = forestaGradeRequest_('getSchools', {}).schools || [];
  cache.put(key, JSON.stringify(schools), 300);
  return schools;
}

function forestaParseDate_(value) {
  const text = String(value || '').trim();
  if (!text || /^(なし|無し|テストなし|実施なし|中止)$/.test(text)) return null;
  const normalized = text.replace(/[年月]/g, '/').replace(/日/g, '').replace(/-/g, '/');
  const parts = normalized.match(/(?:(\d{4})\/)?(\d{1,2})\/(\d{1,2})/);
  if (!parts) return null;
  const today = new Date();
  let year = Number(parts[1] || today.getFullYear());
  let date = new Date(year, Number(parts[2]) - 1, Number(parts[3]));
  if (!parts[1] && date < new Date(today.getFullYear(), today.getMonth(), today.getDate() - 30)) date = new Date(year + 1, Number(parts[2]) - 1, Number(parts[3]));
  return isNaN(date.getTime()) ? null : date;
}

function forestaNextTest_(student, setting) {
  if (setting && setting.nextTestDate) {
    const forced = forestaParseDate_(setting.nextTestDate);
    if (forced) return {name: '次回定期テスト', date: Utilities.formatDate(forced, 'Asia/Tokyo', 'yyyy-MM-dd')};
  }
  const school = forestaSchools_().find(item => String(item.name).trim() === String(student.school || '').trim());
  if (!school) return {name: '次回定期テスト', date: ''};
  const gradeKey = String(student.grade || '').includes('3') ? 'g3' : String(student.grade || '').includes('2') ? 'g2' : 'g1';
  const today = new Date(); today.setHours(0,0,0,0);
  const dates = ((school.testSchedule || {})[gradeKey] || []).map((value, index) => ({date: forestaParseDate_(value), index})).filter(item => item.date && item.date >= today).sort((a,b) => a.date - b.date);
  if (!dates.length) return {name: '次回定期テスト', date: ''};
  return {name: '第' + (dates[0].index + 1) + '回定期テスト', date: Utilities.formatDate(dates[0].date, 'Asia/Tokyo', 'yyyy-MM-dd')};
}

function forestaUnitIndex_(units, unitId) {
  return units.findIndex(unit => String(unit.unitId) === String(unitId || ''));
}

function forestaPace_(units, setting, latest, student, nextTest) {
  const eligible = units.filter(unit => !unit.skippable);
  const currentId = latest && latest.endUnitId || '';
  const currentIndex = eligible.findIndex(unit => unit.unitId === currentId);
  const endIndex = eligible.findIndex(unit => unit.unitId === String(setting && setting.predictedRangeEndUnitId || ''));
  const remainingUnits = endIndex < 0 ? null : Math.max(0, endIndex - currentIndex);
  let remainingLessons = null;
  if (nextTest.date) {
    const deadline = new Date(nextTest.date + 'T00:00:00'); deadline.setDate(deadline.getDate() - 14);
    const today = new Date(); today.setHours(0,0,0,0);
    remainingLessons = Math.max(0, Math.ceil((deadline - today) / 604800000));
  }
  const requiredPerLesson = remainingUnits == null || remainingLessons == null ? null : remainingLessons > 0 ? Math.ceil(remainingUnits / remainingLessons) : remainingUnits > 0 ? '至急' : 0;
  return {remainingUnits, remainingLessons, requiredPerLesson};
}

function forestaStatus_(units, setting, latest, student) {
  const schoolIndex = forestaUnitIndex_(units, setting && setting.schoolProgressUnitId);
  const currentIndex = forestaUnitIndex_(units, latest && latest.endUnitId);
  const rangeEndIndex = forestaUnitIndex_(units, setting && setting.predictedRangeEndUnitId);
  if (schoolIndex < 0 || currentIndex < 0) return {status: 'NO_DATA', aheadUnits: 0};
  if (rangeEndIndex >= 0 && currentIndex >= rangeEndIndex) return {status: String(student.grade).includes('3') ? 'RANGE_COMPLETE' : 'REPEAT', aheadUnits: currentIndex - schoolIndex};
  if (currentIndex > schoolIndex) return {status: 'AHEAD', aheadUnits: currentIndex - schoolIndex};
  if (currentIndex === schoolIndex) return {status: 'AT_SCHOOL', aheadUnits: 0};
  return {status: 'BEHIND', aheadUnits: currentIndex - schoolIndex};
}

function forestaLessonClient_(row, units) {
  if (!row) return {};
  const byId = id => units.find(unit => unit.unitId === String(id || '')) || {};
  let homeworkItems = [];
  try { homeworkItems = JSON.parse(String(row.homeworkItemsJson || '[]')); } catch (error) {}
  return Object.assign({}, row, {
    startCode: byId(row.startUnitId).stepCode || '', endCode: byId(row.endUnitId).stepCode || '',
    nextCtCode: byId(row.nextCtUnitId).stepCode || '', homeworkItems
  });
}

function forestaStudentData_(student, includeInstructors) {
  const levelMap = forestaLevelMap_()[String(student.studentId)] || {english: 3, math: 3};
  const lessons = forestaLessons_(student.studentId);
  const latestRaw = lessons[0] || null;
  const subject = latestRaw && latestRaw.subject || '数学';
  const unitsBySubject = {
    '英語': forestaUnitsFor_(student, '英語', levelMap),
    '数学': forestaUnitsFor_(student, '数学', levelMap)
  };
  const units = unitsBySubject[subject];
  const personalSetting = forestaSetting_(student.studentId, subject);
  const setting = forestaEffectiveSetting_(student, subject, personalSetting);
  const nextTest = forestaNextTest_(student, setting);
  const pace = forestaPace_(units, setting, latestRaw, student, nextTest);
  const position = forestaStatus_(units, setting, latestRaw, student);
  const scoreResult = forestaGradeRequest_('getStudentScores', {studentId: student.studentId});
  return {
    student, subject, level: subject === '英語' ? levelMap.english : levelMap.math,
    units: unitsBySubject['英語'].concat(unitsBySubject['数学']),
    lessons: lessons.slice(0, 12).map(row => forestaLessonClient_(row, unitsBySubject[row.subject] || units)),
    latestLesson: forestaLessonClient_(latestRaw, units),
    schoolProgressUnitId: setting && setting.schoolProgressUnitId || '',
    predictedRangeStartUnitId: setting && setting.predictedRangeStartUnitId || '',
    predictedRangeEndUnitId: setting && setting.predictedRangeEndUnitId || '',
    schoolProgressCode: (units[forestaUnitIndex_(units, setting && setting.schoolProgressUnitId)] || {}).stepCode || '',
    forestaProgressCode: (units[forestaUnitIndex_(units, latestRaw && latestRaw.endUnitId)] || {}).stepCode || '',
    nextTest, pace, status: position.status, aheadUnits: position.aheadUnits,
    scores: scoreResult.scores || [], instructors: includeInstructors ? forestaInstructorsForCampus_(student.campus) : []
  };
}

function getForestaDashboard_(session) {
  requireRole_(session, [ROLE.STUDENT]);
  return forestaStudentData_(getCommonStudentProfile_(session), false);
}

function getForestaStudent_(session, studentId) {
  requireRole_(session, [ROLE.TEACHER, ROLE.ADMIN]);
  const profile = getRowsAsObjects_('StudentProfiles').find(row => String(row.studentId) === String(studentId));
  if (!profile) throw publicError_('生徒情報が見つかりません。', 'STUDENT_NOT_FOUND');
  return forestaStudentData_(profile, true);
}

function getForestaAdminDashboard_(session) {
  requireRole_(session, [ROLE.TEACHER, ROLE.ADMIN]);
  const students = getRowsAsObjects_('StudentProfiles').filter(row => String(row.enrollmentStatus) === 'ACTIVE');
  const levelMap = forestaLevelMap_();
  const allLessons = forestaRows_(FORESTA_LESSONS_SHEET, FORESTA_LESSONS_HEADERS);
  const settings = forestaRows_(FORESTA_SETTINGS_SHEET, FORESTA_SETTINGS_HEADERS);
  const rangeSettings = forestaRangeSettings_();
  const today = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd');
  const rows = students.map(student => {
    const studentLessons = allLessons.filter(row => String(row.studentId) === String(student.studentId)).sort((a,b) => String(b.lessonDate).localeCompare(String(a.lessonDate)));
    const latest = studentLessons[0] || null;
    const subject = latest && latest.subject || '数学';
    const units = forestaUnitsFor_(student, subject, levelMap[String(student.studentId)] || {english:3,math:3});
    const personalSetting = settings.find(row => String(row.studentId) === String(student.studentId) && String(row.subject) === subject) || null;
    const setting = forestaEffectiveSetting_(student, subject, personalSetting, rangeSettings);
    const nextTest = forestaNextTest_(student, setting);
    const pace = forestaPace_(units, setting, latest, student, nextTest);
    const position = forestaStatus_(units, setting, latest, student);
    const kana = getAdminStudentKana_(student.studentId);
    return {
      studentId: String(student.studentId), name: student.name, kana, furigana: kana, campus: student.campus, grade: student.grade, school: student.school,
      subject, status: position.status, homeworkCompleted: latest && latest.homeworkCompleted || '', ctResult: latest && latest.ctResult || '',
      todayRecorded: !!(latest && String(latest.lessonDate) === today), todayProgressedUnits: latest && String(latest.lessonDate) === today ? Number(latest.progressedUnits || 0) : 0,
      remainingUnits: pace.remainingUnits, remainingLessons: pace.remainingLessons, requiredPerLesson: pace.requiredPerLesson,
      instructorName: latest && latest.instructorName || ''
    };
  });
  const severity = {BEHIND:0,AT_SCHOOL:1,NO_DATA:2,AHEAD:3,REPEAT:4,RANGE_COMPLETE:5};
  rows.sort((a,b) => (severity[a.status] ?? 9) - (severity[b.status] ?? 9) || String(a.campus).localeCompare(String(b.campus),'ja') || String(a.name).localeCompare(String(b.name),'ja'));
  return {success: true, students: rows, generatedAt: nowIso_()};
}

function forestaRangeUnitsByGrade_() {
  const result = {};
  ['中1','中2','中3'].forEach(grade => {
    ['英語','数学'].forEach(subject => {
      result[grade + '|' + subject] = forestaUnitsFor_({grade}, subject, {english: 3, math: 3});
    });
  });
  return result;
}

function getForestaRangeAdminData_(session) {
  requireRole_(session, [ROLE.ADMIN]);
  const profiles = getRowsAsObjects_('StudentProfiles').filter(row =>
    String(row.enrollmentStatus) === 'ACTIVE' && forestaJuniorGrade_(row.grade) && String(row.school || '').trim()
  );
  const schoolNames = new Set(profiles.map(row => String(row.school || '').trim()));
  forestaSchools_().forEach(row => {
    const name = String(row && row.name || '').trim();
    if (name) schoolNames.add(name);
  });
  const schools = Array.from(schoolNames).sort((a,b) => a.localeCompare(b, 'ja')).map(name => {
    const tests = {};
    ['中1','中2','中3'].forEach(grade => tests[grade] = forestaNextTest_({school: name, grade}, null));
    return {name, tests};
  });
  const units = forestaRangeUnitsByGrade_();
  const settings = forestaRangeSettings_().filter(row =>
    schoolNames.has(String(row.school || '').trim()) && forestaJuniorGrade_(row.grade) && ['英語','数学'].includes(String(row.subject || ''))
  ).map(row => {
    const grade = forestaJuniorGrade_(row.grade);
    const subject = String(row.subject || '');
    const gradeUnits = units[grade + '|' + subject] || [];
    const startUnit = gradeUnits.find(item => item.unitId === String(row.predictedRangeStartUnitId || '')) || {};
    const endUnit = gradeUnits.find(item => item.unitId === String(row.predictedRangeEndUnitId || '')) || {};
    return Object.assign({}, row, {
      grade,
      predictedRangeStartCode: startUnit.stepCode || '', predictedRangeStartTitle: startUnit.unitTitle || '',
      predictedRangeEndCode: endUnit.stepCode || '', predictedRangeEndTitle: endUnit.unitTitle || ''
    });
  }).sort((a,b) => String(a.school).localeCompare(String(b.school),'ja') || String(a.grade).localeCompare(String(b.grade),'ja') || String(a.subject).localeCompare(String(b.subject),'ja'));
  return {success: true, schools, settings, units, generatedAt: nowIso_()};
}

function saveForestaRangeSetting_(session, input) {
  requireRole_(session, [ROLE.ADMIN]);
  const school = String(input && input.school || '').trim();
  const grade = forestaJuniorGrade_(input && input.grade);
  const subject = String(input && input.subject || '').trim();
  const predictedRangeStartUnitId = String(input && input.predictedRangeStartUnitId || '').trim();
  const predictedRangeEndUnitId = String(input && input.predictedRangeEndUnitId || '').trim();
  if (!school || !grade || !['英語','数学'].includes(subject)) {
    throw publicError_('中学校・学年・科目を確認してください。', 'INVALID_RANGE_GROUP');
  }
  const knownSchools = new Set(getRowsAsObjects_('StudentProfiles').map(row => String(row.school || '').trim()).filter(Boolean));
  forestaSchools_().forEach(row => { const name = String(row && row.name || '').trim(); if (name) knownSchools.add(name); });
  if (!knownSchools.has(school)) throw publicError_('登録されている中学校を選択してください。', 'SCHOOL_NOT_FOUND');
  const units = forestaUnitsFor_({grade}, subject, {english: 3, math: 3});
  const startUnit = units.find(item => item.unitId === predictedRangeStartUnitId);
  const endUnit = units.find(item => item.unitId === predictedRangeEndUnitId);
  if (!startUnit || !endUnit) throw publicError_('予想テスト範囲の開始単元と最終単元を選択してください。', 'RANGE_UNIT_REQUIRED');
  if (startUnit.order > endUnit.order) throw publicError_('予想テスト範囲の開始単元と最終単元の順序を確認してください。', 'INVALID_TEST_RANGE');
  const rows = forestaRangeSettings_();
  const current = rows.find(row =>
    String(row.school || '').trim() === school && forestaJuniorGrade_(row.grade) === grade && String(row.subject || '') === subject
  );
  const next = {
    rangeId: current && current.rangeId || Utilities.getUuid(), school, grade, subject,
    predictedRangeStartUnitId: startUnit.unitId, predictedRangeEndUnitId: endUnit.unitId,
    updatedAt: nowIso_(), updatedBy: session.userId
  };
  if (current) forestaUpdate_(FORESTA_RANGE_SETTINGS_SHEET, FORESTA_RANGE_SETTINGS_HEADERS, current._rowNumber, next);
  else forestaAppend_(FORESTA_RANGE_SETTINGS_SHEET, FORESTA_RANGE_SETTINGS_HEADERS, next);
  writeAudit_(session, 'SAVE_FORESTA_RANGE_SETTING', FORESTA_RANGE_SETTINGS_SHEET, next.rangeId, current, next);
  return {success: true, setting: Object.assign({}, next, {
    predictedRangeStartCode: startUnit.stepCode, predictedRangeStartTitle: startUnit.unitTitle,
    predictedRangeEndCode: endUnit.stepCode, predictedRangeEndTitle: endUnit.unitTitle
  })};
}

function saveForestaLesson_(session, input) {
  requireRole_(session, [ROLE.TEACHER, ROLE.ADMIN]);
  const studentId = String(input.studentId || '').trim();
  const subject = String(input.subject || '').trim();
  if (!studentId || !['英語','数学'].includes(subject)) throw publicError_('生徒と科目を確認してください。', 'INVALID_INPUT');
  const student = getRowsAsObjects_('StudentProfiles').find(row => String(row.studentId) === studentId);
  if (!student) throw publicError_('生徒情報が見つかりません。', 'STUDENT_NOT_FOUND');
  const instructors = forestaInstructorsForCampus_(student.campus);
  const instructorName = String(input.instructorName || '').trim();
  if (!instructors.some(item => item.name === instructorName)) throw publicError_('教室に合う担当者を選択してください。', 'INVALID_INSTRUCTOR');
  const levelMap = forestaLevelMap_()[studentId] || {english:3,math:3};
  const units = forestaUnitsFor_(student, subject, levelMap);
  const byId = id => units.find(unit => unit.unitId === String(id || ''));
  const schoolUnit = byId(input.schoolProgressUnitId), startUnit = byId(input.startUnitId), endUnit = byId(input.endUnitId), rangeEndUnit = byId(input.predictedRangeEndUnitId);
  if (!schoolUnit || !startUnit || !endUnit || !rangeEndUnit) throw publicError_('学校進度・今回範囲・予想テスト範囲をすべて選択してください。', 'UNIT_REQUIRED');
  if (startUnit.order > endUnit.order) throw publicError_('今回の開始単元と到達単元の順序を確認してください。', 'INVALID_RANGE');
  if (!String(student.grade || '').includes('3') && endUnit.order > rangeEndUnit.order) {
    throw publicError_('中学1・2年生は予想テスト範囲を超えて進めません。範囲内を繰り返してください。', 'TEST_RANGE_LIMIT');
  }
  const eligibleProgress = units.filter(unit => unit.order >= startUnit.order && unit.order <= endUnit.order && !unit.skippable);
  const eligibleForCt = eligibleProgress.length ? eligibleProgress : units.filter(unit => unit.order >= startUnit.order && unit.order <= endUnit.order);
  const nextCt = eligibleForCt[Math.floor((eligibleForCt.length - 1) / 2)] || endUnit;
  const ctResult = String(input.ctResult || '').replace('○','〇');
  if (ctResult && !['◎','〇','×'].includes(ctResult)) throw publicError_('CTは◎・〇・×から選択してください。', 'INVALID_CT');
  const now = nowIso_();
  const settings = forestaRows_(FORESTA_SETTINGS_SHEET, FORESTA_SETTINGS_HEADERS);
  const currentSetting = settings.find(row => String(row.studentId) === studentId && String(row.subject) === subject);
  const nextSetting = {
    settingId: currentSetting && currentSetting.settingId || Utilities.getUuid(), studentId, subject,
    schoolProgressUnitId: schoolUnit.unitId, predictedRangeEndUnitId: rangeEndUnit.unitId,
    nextTestDate: currentSetting && currentSetting.nextTestDate || '', updatedAt: now, updatedBy: session.userId
  };
  if (currentSetting) forestaUpdate_(FORESTA_SETTINGS_SHEET, FORESTA_SETTINGS_HEADERS, currentSetting._rowNumber, nextSetting);
  else forestaAppend_(FORESTA_SETTINGS_SHEET, FORESTA_SETTINGS_HEADERS, nextSetting);
  const homeworkItems = subject === '英語'
    ? ['Key Words「☆日→英」暗記','Exercise「暗記マーク」暗記','TRY赤×直し','Exercise','前回宿題の赤×直し']
    : ['TRY赤×直し','Exercise','前回宿題の赤×直し'];
  const trainingRequired = ctResult === '×';
  const notificationText = trainingRequired
    ? `${student.name}さんのクリアテストが不合格（2問以上不正解）でした。\n理解を確実にするため、特訓部屋で学習のし直しを行います。本日または別日に教室へ来ていただく日時を、改めてご案内します。`
    : '';
  const lesson = {
    lessonId: Utilities.getUuid(), studentId, lessonDate: String(input.lessonDate || Utilities.formatDate(new Date(),'Asia/Tokyo','yyyy-MM-dd')),
    subject, instructorName, schoolProgressUnitId: schoolUnit.unitId, startUnitId: startUnit.unitId, endUnitId: endUnit.unitId,
    predictedRangeEndUnitId: rangeEndUnit.unitId, homeworkCompleted: String(input.homeworkCompleted || ''),
    ctUnitId: String(input.ctUnitId || ''), ctResult, progressedUnits: eligibleProgress.length,
    nextCtUnitId: nextCt.unitId, homeworkItemsJson: JSON.stringify(homeworkItems), trainingRequired,
    notificationText, memo: String(input.memo || '').slice(0,300), createdAt: now, createdBy: session.userId
  };
  forestaAppend_(FORESTA_LESSONS_SHEET, FORESTA_LESSONS_HEADERS, lesson);
  writeAudit_(session, 'SAVE_FORESTA_LESSON', 'ForestaLessons', lesson.lessonId, null, lesson);
  return {success: true, lessonId: lesson.lessonId, progressedUnits: lesson.progressedUnits, nextCtUnitId: lesson.nextCtUnitId, ctTrainingRequired: trainingRequired, notificationText};
}
