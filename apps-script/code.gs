
// ===== Config.gs =====
const APP_NAME = '学習進捗管理';
const MASTER_VERSION = '2026FS';
const SESSION_HOURS = 8;
const STUDENT_AUTH_CACHE_SECONDS = 600;
const STUDENT_AUTH_NOT_FOUND_SECONDS = 120;
const STUDENT_AUTH_CACHE_VERSION_KEY = 'FS:AUTH:VERSION';
let requestDb_ = null;
let requestFilteredRowsCache_ = null;
const SCHOOL_YEAR = 2026;
const STUDY_ROUNDS = Object.freeze([1, 2, 3]);
// 期限日の何日後から未完了一覧へ表示するか。1 は「期限日の翌日から」を表す。
const HOMEWORK_OVERDUE_RULE = Object.freeze({
  showFromDaysAfterDueDate: 1
});
const MATERIAL_SERIES = Object.freeze({
  STEP: 'FORESTA_STEP',
  GOAL: 'FORESTA_GOAL',
  VOCABULARY: 'FORESTA_VOCABULARY',
  REQUIRED_TEXTBOOK: 'REQUIRED_TEXTBOOK'
});
const HOMEWORK_TYPES = Object.freeze({
  TRY_REDO: 'TRY_REDO',
  EXERCISE: 'EXERCISE',
  MEMORIZATION_MARK: 'MEMORIZATION_MARK',
  MY_VOCABULARY: 'MY_VOCABULARY',
  VOCABULARY_REVIEW: 'VOCABULARY_REVIEW',
  REQUIRED_REMAINDER: 'REQUIRED_REMAINDER'
});
const HOMEWORK_LABELS = Object.freeze({
  TRY_REDO: 'TRY赤×直し',
  EXERCISE: 'Exercise',
  MEMORIZATION_MARK: '暗記マーク（基本文の暗記）',
  MY_VOCABULARY: 'My単語帳（英語→日本語テスト）',
  VOCABULARY_REVIEW: '赤×なおしや見直し',
  REQUIRED_REMAINDER: '赤×なおしとその単元の残り'
});

const VOCABULARY_LEVELS = Object.freeze(
  Array.from({length: 20}, (_, index) => (20 - index) + '級')
    .concat(['初段'])
    .concat(Array.from({length: 14}, (_, index) => (index + 2) + '段'))
);
const VOCABULARY_UNIT_PREFIX = 'FORESTA_VOCABULARY:';

const PROP = Object.freeze({
  PROGRESS_DB_SS_ID: 'PROGRESS_DB_SS_ID',
  STUDENT_MASTER_SS_ID: 'STUDENT_MASTER_SS_ID',
  STUDENT_MASTER_SHEET_NAME: 'STUDENT_MASTER_SHEET_NAME',
  STAFF_MASTER_SS_ID: 'STAFF_MASTER_SS_ID',
  STAFF_MASTER_SHEET_NAME: 'STAFF_MASTER_SHEET_NAME',
  APP_ENV: 'APP_ENV',
  SESSION_SECRET: 'SESSION_SECRET',
  DEV_TEST_STUDENT_PASSWORD: 'DEV_TEST_STUDENT_PASSWORD',
  DEV_TEST_STAFF_PASSWORD: 'DEV_TEST_STAFF_PASSWORD'
});

const ROLE = Object.freeze({
  STUDENT: 'STUDENT',
  TEACHER: 'TEACHER',
  ADMIN: 'ADMIN'
});

const PERMISSIONS = Object.freeze({
  STUDENT: ['READ_SELF', 'UPDATE_SELF_PROGRESS', 'DECLARE_SELF_HOMEWORK'],
  TEACHER: ['READ_ALL_ACTIVE_STUDENTS', 'READ_PROGRESS', 'CONFIRM_HOMEWORK', 'WRITE_CONFIRMATION_MEMO'],
  ADMIN: [
    'READ_ALL_STUDENTS',
    'READ_PROGRESS',
    'CONFIRM_HOMEWORK',
    'WRITE_CONFIRMATION_MEMO',
    'MANAGE_TARGETS',
    'EDIT_PROGRESS',
    'EDIT_HOMEWORK',
    'MANAGE_UNIT_MASTER',
    'READ_AUDIT_LOG'
  ]
});

function getRequiredProperty_(name) {
  const value = PropertiesService.getScriptProperties().getProperty(name);
  if (!value) throw new Error('Script Property が未設定です: ' + name);
  return value;
}

function getDb_() {
  if (!requestDb_) requestDb_ = SpreadsheetApp.openById(getRequiredProperty_(PROP.PROGRESS_DB_SS_ID));
  return requestDb_;
}

function nowIso_() {
  return new Date().toISOString();
}

function normalizeGrade_(value) {
  const raw = String(value || '').trim()
    .replace(/[１２３]/g, c => ({'１':'1','２':'2','３':'3'})[c]);
  const compact = raw.replace(/\s+/g, '');
  if (/^(中学)?1年$/.test(compact) || compact === '中1') return '中1';
  if (/^(中学)?2年$/.test(compact) || compact === '中2') return '中2';
  if (/^(中学)?3年$/.test(compact) || compact === '中3') return '中3';
  return '';
}

function studentStatusFromMaster_(flag) {
  const value = String(flag == null ? '' : flag).trim();
  if (value === '1') return 'ACTIVE';
  if (value === '0') return 'HOLD';
  return 'INACTIVE';
}

function roleFromPermissionLevel_(level) {
  const value = String(level || '').trim();
  if (value === '1') return ROLE.TEACHER;
  if (['2', '3', '4'].includes(value)) return ROLE.ADMIN;
  return '';
}

function requireRole_(session, allowedRoles) {
  if (!session || !allowedRoles.includes(session.role)) {
    throw publicError_('この操作を行う権限がありません。', 'FORBIDDEN');
  }
}

function publicError_(message, code) {
  const error = new Error(message);
  error.isPublic = true;
  error.code = code || 'BAD_REQUEST';
  return error;
}

function isDevelopment_() {
  return getRequiredProperty_(PROP.APP_ENV) === 'development';
}

function normalizeRoundNumber_(value) {
  const roundNumber = Number(value == null || value === '' ? 1 : value);
  if (!STUDY_ROUNDS.includes(roundNumber)) {
    throw publicError_('周回は1～3から選択してください。', 'INVALID_ROUND_NUMBER');
  }
  return roundNumber;
}

function rowRoundNumber_(row) {
  const value = Number(row && row.roundNumber || 1);
  return STUDY_ROUNDS.includes(value) ? value : 1;
}

function rowSchoolYear_(row) {
  return Number(row && row.schoolYear || SCHOOL_YEAR);
}

function normalizeSeries_(value) {
  const series = String(value || '');
  if (series === MATERIAL_SERIES.GOAL) return MATERIAL_SERIES.GOAL;
  if (series === MATERIAL_SERIES.VOCABULARY) return MATERIAL_SERIES.VOCABULARY;
  if (series === MATERIAL_SERIES.REQUIRED_TEXTBOOK) return MATERIAL_SERIES.REQUIRED_TEXTBOOK;
  return MATERIAL_SERIES.STEP;
}

function seriesLabel_(value) {
  const series = normalizeSeries_(value);
  if (series === MATERIAL_SERIES.GOAL) return 'フォレスタゴール';
  if (series === MATERIAL_SERIES.VOCABULARY) return 'フォレスタ英単語';
  if (series === MATERIAL_SERIES.REQUIRED_TEXTBOOK) return '必修テキスト';
  return 'フォレスタステップ';
}

function normalizeVocabularyDirection_(value) {
  const direction = String(value || '').trim();
  if (direction === '英→日' || direction === 'EN_JA') return '英→日';
  if (direction === '日→英' || direction === 'JA_EN') return '日→英';
  return '';
}

function vocabularyDirectionCode_(direction) {
  return normalizeVocabularyDirection_(direction) === '日→英' ? 'JA_EN' : 'EN_JA';
}

function vocabularyUnitId_(level, direction) {
  return VOCABULARY_UNIT_PREFIX + vocabularyDirectionCode_(direction) + ':' + String(level || '');
}

function vocabularyLevelFromUnitId_(unitId) {
  const value = String(unitId || '');
  if (value.indexOf(VOCABULARY_UNIT_PREFIX) !== 0) return '';
  const tail = value.slice(VOCABULARY_UNIT_PREFIX.length);
  return /^(EN_JA|JA_EN):/.test(tail) ? tail.replace(/^(EN_JA|JA_EN):/, '') : tail;
}

function vocabularyDirectionFromUnitId_(unitId, legacyRoundNumber) {
  const tail = String(unitId || '').slice(VOCABULARY_UNIT_PREFIX.length);
  if (tail.indexOf('JA_EN:') === 0) return '日→英';
  if (tail.indexOf('EN_JA:') === 0) return '英→日';
  return Number(legacyRoundNumber) % 2 === 0 ? '日→英' : '英→日';
}

function unitHasLct_(unit) {
  if (normalizeSeries_(unit && unit.series) === MATERIAL_SERIES.STEP) return true;
  return isTrue_(unit && unit.hasLct);
}

function homeworkTypesForUnit_(unit) {
  const series = normalizeSeries_(unit && unit.series);
  const subject = String(unit && unit.subject || '');
  if (series === MATERIAL_SERIES.REQUIRED_TEXTBOOK) {
    return [HOMEWORK_TYPES.REQUIRED_REMAINDER];
  }
  if (subject === '英語' && series === MATERIAL_SERIES.GOAL) {
    return [HOMEWORK_TYPES.TRY_REDO, HOMEWORK_TYPES.EXERCISE, HOMEWORK_TYPES.MY_VOCABULARY];
  }
  if (subject === '英語' && series === MATERIAL_SERIES.STEP) {
    return [HOMEWORK_TYPES.TRY_REDO, HOMEWORK_TYPES.EXERCISE, HOMEWORK_TYPES.MEMORIZATION_MARK];
  }
  return [HOMEWORK_TYPES.TRY_REDO, HOMEWORK_TYPES.EXERCISE];
}

function resolveStudentId_(session, requestedStudentId, allowedStaffRoles) {
  const requested = String(requestedStudentId || '').trim();
  if (session.role === ROLE.STUDENT) {
    if (requested && requested !== session.userId) {
      throw publicError_('他の生徒の情報にはアクセスできません。', 'FORBIDDEN_STUDENT_SCOPE');
    }
    return session.userId;
  }
  requireRole_(session, allowedStaffRoles || [ROLE.TEACHER, ROLE.ADMIN]);
  if (!requested) throw publicError_('生徒を選択してください。', 'STUDENT_REQUIRED');
  return requested;
}

// ===== Database.gs =====
const DB_SCHEMAS = Object.freeze({
  AppConfig: ['key','value','updatedAt','updatedBy'],
  Units: [
    'unitId','masterVersion','subject','gradeScope','section','chapter','difficulty',
    'stepCode','unitTitle','unitType','standardEligible','displayOrder',
    'sourceFile','sourceSheet','sourceBlock','sourceRow','active','createdAt','updatedAt',
    'sourceSheetOrder','sourceRowNumber','originalDisplayOrder','sectionOrder','unitOrder',
    'chapterId','chapterLabel','series','hasLct','homeworkProfile'
  ],
  StudentProfiles: [
    'studentId','name','campus','grade','gradeJRaw','gradeKRaw','gradeConflict',
    'school','enrollmentStatus','lastSyncedAt'
  ],
  StandardRanges: [
    'standardRangeId','masterVersion','grade','subject','unitId','included',
    'createdAt','updatedAt','updatedBy','series'
  ],
  StudentTargets: [
    'studentTargetId','studentId','masterVersion','subject','unitId','included',
    'source','createdAt','updatedAt','updatedBy','series'
  ],
  UnitProgress: [
    'progressId','studentId','unitId','pointConfirmed','warmupConfirmed',
    'tryCompleted','tryResult','studentUpdatedAt','updatedAt','updatedBy',
    'lctResult','lctDate','learningDate',
    'pointCompletedAt','warmupCompletedAt','tryCompletedAt',
    'clientRevision','clientMutationId','schoolYear','roundNumber','series'
  ],
  Homework: [
    'homeworkId','studentId','unitId','homeworkType','studentStatus','teacherStatus',
    'studentUpdatedAt','teacherUpdatedAt','confirmedBy','confirmationMemo',
    'createdAt','updatedAt','schoolYear','roundNumber','assignedDate',
    'studentCompletedAt','studentCompletedDate','studentNoTargetAt','studentNoTargetDate','series',
    'dueDate'
  ],
  Sessions: [
    'tokenHash','userType','userId','role','permissionLevel','issuedAt','expiresAt','revokedAt'
  ],
  AuditLog: [
    'auditId','actorType','actorId','actorRole','action','entityType','entityId',
    'beforeJson','afterJson','createdAt'
  ],
  GradeConflicts: [
    'conflictId','studentId','name','campus','gradeJRaw','gradeKRaw',
    'displayGrade','detectedAt','resolvedAt','resolvedBy'
  ],
  ErrorLog: [
    'errorId','action','actorType','actorId','errorCode','message','createdAt'
  ],
  Milestones: [
    'milestoneId','studentId','schoolYear','scopeType','subject','percent',
    'reachedAt','characterId','rarity','messageId','shownAt','acknowledgedAt'
  ]
});

const SHEET_NAMES = Object.freeze({
  AppConfig: '設定',
  Units: '単元マスタ',
  StudentProfiles: '生徒プロフィール',
  StandardRanges: '標準範囲',
  StudentTargets: '生徒別目標',
  UnitProgress: '学習進捗',
  Homework: '宿題',
  Sessions: 'セッション',
  AuditLog: '操作履歴',
  GradeConflicts: '学年要確認',
  ErrorLog: 'エラーログ',
  Milestones: '達成節目'
});

function setupDatabase() {
  const db = getDb_();
  Object.keys(DB_SCHEMAS).forEach(name => ensureSheet_(db, SHEET_NAMES[name], DB_SCHEMAS[name]));
  const unitResult = seedUnitMaster_();
  const requiredTextbookResult = seedRequiredTextbookUnits_();
  const rangeResult = seedStandardRanges_();
  seedAppConfig_();
  removeBlankDefaultSheet_(db);
  return {
    success: true,
    sheets: Object.keys(DB_SCHEMAS).map(name => SHEET_NAMES[name]),
    unitCount: UNIT_MASTER_SEED.length + requiredTextbookResult.total,
    insertedUnits: unitResult.inserted + requiredTextbookResult.inserted,
    insertedRequiredTextbookUnits: requiredTextbookResult.inserted,
    insertedStandardRanges: rangeResult.inserted
  };
}

function ensureSheet_(db, name, headers) {
  let sheet = db.getSheetByName(name);
  if (!sheet) sheet = db.insertSheet(name);
  const current = sheet.getLastColumn()
    ? sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), headers.length)).getValues()[0]
    : [];
  headers.forEach((header, index) => {
    if (current[index] !== header) sheet.getRange(1, index + 1).setValue(header);
  });
  sheet.setFrozenRows(1);
  return sheet;
}

function getSheet_(name) {
  const actualName = SHEET_NAMES[name] || name;
  const sheet = getDb_().getSheetByName(actualName);
  if (!sheet) throw new Error('DBシートが見つかりません: ' + actualName);
  return sheet;
}

function getRowsAsObjects_(sheetName) {
  const sheet = getSheet_(sheetName);
  const values = sheet.getDataRange().getValues();
  if (!values.length) return [];
  const headers = values[0].map(String);
  return values.slice(1).filter(row => row.some(v => v !== '')).map((row, rowIndex) => {
    const object = {_rowNumber: rowIndex + 2};
    headers.forEach((header, index) => object[header] = row[index]);
    return object;
  });
}

function rowsFromValues_(headers, values, firstRowNumber) {
  return (values || []).filter(row => row.some(value => value !== '')).map((row, index) => {
    const object = {_rowNumber: Number(firstRowNumber || 2) + index};
    headers.forEach((header, columnIndex) => object[header] = row[columnIndex]);
    return object;
  });
}

function getRowsByFieldValue_(sheetName, fieldName, fieldValue) {
  const cacheKey = sheetName + '|' + fieldName + '|' + String(fieldValue);
  if (requestFilteredRowsCache_ && requestFilteredRowsCache_.has(cacheKey)) return requestFilteredRowsCache_.get(cacheKey);
  const startedAt = Date.now();
  const sheet = getSheet_(sheetName);
  const headers = DB_SCHEMAS[sheetName] || [];
  const fieldColumn = headers.indexOf(fieldName) + 1;
  if (!fieldColumn) throw new Error(sheetName + '.' + fieldName + '列が見つかりません。');
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  const matches = sheet.getRange(2, fieldColumn, lastRow - 1, 1)
    .createTextFinder(String(fieldValue))
    .matchEntireCell(true)
    .findAll()
    .map(range => range.getRow())
    .sort((a, b) => a - b);
  if (!matches.length) {
    perfTrace_('sheet.filteredRead', startedAt, {sheet: sheetName, rows: 0});
    if (requestFilteredRowsCache_) requestFilteredRowsCache_.set(cacheKey, []);
    return [];
  }
  const groups = [];
  matches.forEach(rowNumber => {
    const last = groups[groups.length - 1];
    if (last && rowNumber === last.end + 1) last.end = rowNumber;
    else groups.push({start: rowNumber, end: rowNumber});
  });
  const result = groups.flatMap(group => rowsFromValues_(
    headers,
    sheet.getRange(group.start, 1, group.end - group.start + 1, headers.length).getValues(),
    group.start
  ));
  perfTrace_('sheet.filteredRead', startedAt, {sheet: sheetName, rows: result.length, ranges: groups.length});
  if (requestFilteredRowsCache_) requestFilteredRowsCache_.set(cacheKey, result);
  return result;
}

function getFirstRowByFieldValue_(sheetName, fieldName, fieldValue) {
  const startedAt = Date.now();
  const sheet = getSheet_(sheetName);
  const headers = DB_SCHEMAS[sheetName] || [];
  const fieldColumn = headers.indexOf(fieldName) + 1;
  if (!fieldColumn) throw new Error(sheetName + '.' + fieldName + '列が見つかりません。');
  const lastRow = sheet.getLastRow();
  const match = lastRow > 1
    ? sheet.getRange(2, fieldColumn, lastRow - 1, 1)
      .createTextFinder(String(fieldValue)).matchEntireCell(true).findNext()
    : null;
  if (!match) {
    perfTrace_('sheet.singleRead', startedAt, {sheet: sheetName, found: false});
    return null;
  }
  const rowNumber = match.getRow();
  const row = rowsFromValues_(
    headers,
    sheet.getRange(rowNumber, 1, 1, headers.length).getValues(),
    rowNumber
  )[0] || null;
  perfTrace_('sheet.singleRead', startedAt, {sheet: sheetName, found: !!row});
  return row;
}

function appendObject_(sheetName, object) {
  const sheet = getSheet_(sheetName);
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  sheet.appendRow(headers.map(header => object[header] == null ? '' : object[header]));
}

function updateObjectRow_(sheetName, rowNumber, object) {
  const sheet = getSheet_(sheetName);
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const current = sheet.getRange(rowNumber, 1, 1, headers.length).getValues()[0];
  const next = headers.map((header, index) =>
    Object.prototype.hasOwnProperty.call(object, header) ? object[header] : current[index]
  );
  sheet.getRange(rowNumber, 1, 1, next.length).setValues([next]);
}

function syncFilteredRowsCache_(sheetName, rows) {
  if (!requestFilteredRowsCache_) return;
  requestFilteredRowsCache_.forEach((cached, key) => {
    if (!key.startsWith(sheetName + '|')) return;
    const parts = key.split('|'), fieldName = parts[1], fieldValue = parts.slice(2).join('|');
    rows.forEach(row => {
      const index = cached.findIndex(item => Number(item._rowNumber) === Number(row._rowNumber));
      const matches = String(row[fieldName] == null ? '' : row[fieldName]) === fieldValue;
      if (index >= 0 && matches) cached[index] = row;
      else if (index >= 0) cached.splice(index, 1);
      else if (matches) cached.push(row);
    });
  });
}

function appendObjectsFast_(sheetName, objects) {
  if (!objects || !objects.length) return;
  const sheet = getSheet_(sheetName);
  const headers = DB_SCHEMAS[sheetName];
  const values = objects.map(object =>
    headers.map(header => object[header] == null ? '' : object[header])
  );
  const startRow = sheet.getLastRow() + 1;
  sheet.getRange(startRow, 1, values.length, headers.length).setValues(values);
  syncFilteredRowsCache_(sheetName, objects.map((object, index) => Object.assign({}, object, {_rowNumber: startRow + index})));
}

function updateObjectRowFast_(sheetName, current, changes) {
  const sheet = getSheet_(sheetName);
  const headers = DB_SCHEMAS[sheetName];
  const next = Object.assign({}, current || {}, changes || {});
  sheet.getRange(Number(current._rowNumber), 1, 1, headers.length)
    .setValues([headers.map(header => next[header] == null ? '' : next[header])]);
  syncFilteredRowsCache_(sheetName, [Object.assign({}, next, {_rowNumber: Number(current._rowNumber)})]);
}

function replaceAllObjectRowsFast_(sheetName, rows, previousCount) {
  const sheet = getSheet_(sheetName);
  const headers = DB_SCHEMAS[sheetName];
  const writeCount = Math.max(Number(previousCount || 0), rows.length);
  if (!writeCount) return;
  const values = Array.from({length: writeCount}, (_, index) => {
    const row = rows[index];
    return headers.map(header => row && row[header] != null ? row[header] : '');
  });
  sheet.getRange(2, 1, writeCount, headers.length).setValues(values);
}

function appendAuditFast_(session, action, entityType, entityId, beforeValue, afterValue) {
  appendObjectsFast_('AuditLog', [{
    auditId: Utilities.getUuid(),
    actorType: session.userType,
    actorId: session.userId,
    actorRole: session.role,
    action,
    entityType,
    entityId,
    beforeJson: JSON.stringify(beforeValue || null),
    afterJson: JSON.stringify(afterValue || null),
    createdAt: nowIso_()
  }]);
}

function cacheGetLargeJson_(cache, key) {
  const direct = cache.get(key);
  if (direct) return JSON.parse(direct);
  const chunkCount = Number(cache.get(key + ':CHUNKS') || 0);
  if (!chunkCount) return null;
  const keys = Array.from({length: chunkCount}, (_, index) => key + ':CHUNK:' + index);
  const chunks = cache.getAll(keys);
  if (keys.some(chunkKey => typeof chunks[chunkKey] !== 'string')) return null;
  return JSON.parse(keys.map(chunkKey => chunks[chunkKey]).join(''));
}

function cachePutLargeJson_(cache, key, value, expirationSeconds) {
  const serialized = JSON.stringify(value);
  if (serialized.length < 95000) {
    cache.put(key, serialized, expirationSeconds);
    return {chunks: 1, bytes: serialized.length};
  }
  const chunkSize = 80000;
  const chunks = [];
  for (let offset = 0; offset < serialized.length; offset += chunkSize) {
    chunks.push(serialized.slice(offset, offset + chunkSize));
  }
  const entries = {};
  chunks.forEach((chunk, index) => entries[key + ':CHUNK…195867 tokens truncated…,
    token: studentA.token,
    homeworkId: redo.homeworkId,
    studentStatus: 'DECLARED_DONE'
  });
  const declaredRedo = getRowsAsObjects_('Homework').find(row => String(row.homeworkId) === String(redo.homeworkId));
  const undoDeclare = api({
    action: 'declareHomework',
    token: studentA.token,
    homeworkId: redo.homeworkId,
    studentStatus: 'UNINPUT'
  });
  const redeclare = api({
    action: 'declareHomework',
    token: studentA.token,
    homeworkId: redo.homeworkId,
    studentStatus: 'DECLARED_DONE'
  });
  const confirm = api({
    action: 'confirmHomework',
    token: teacher.token,
    homeworkId: redo.homeworkId,
    teacherStatus: 'VERIFIED',
    confirmationMemo: '開発テスト'
  });
  const undoAfterConfirm = api({
    action: 'declareHomework',
    token: studentA.token,
    homeworkId: redo.homeworkId,
    studentStatus: 'UNINPUT'
  });
  const savedRedo = getRowsAsObjects_('Homework').find(row => String(row.homeworkId) === String(redo.homeworkId));
  record('生徒の宿題申告日時と日付を保存',
    declare.success && !!declaredRedo.studentCompletedAt &&
    dateOnly_(declaredRedo.studentCompletedDate) === testDate);
  record('講師確認前は宿題申告を取り消して再申告可能',
    undoDeclare.success && redeclare.success);
  record('講師の宿題確認を保存', confirm.success && String(savedRedo.confirmedBy) === 'TEST-TEACHER-01');
  record('講師確認後は生徒による宿題取消を拒否',
    !undoAfterConfirm.success && undoAfterConfirm.code === 'HOMEWORK_ALREADY_CONFIRMED');
  record('生徒申告と講師確認を別項目で保持',
    savedRedo.studentStatus === 'DECLARED_DONE' && savedRedo.teacherStatus === 'VERIFIED');

  const noErrors = api({
    action: 'saveStudentProgress',
    token: studentA.token,
    unitId: secondUnitId,
    lctResult: 'PASS',
    lctDate: testDate,
    pointConfirmed: true,
    warmupConfirmed: true,
    tryCompleted: true,
    tryResult: 'NO_ERRORS',
    learningDate: testDate
  });
  const noTargetRedo = getRowsAsObjects_('Homework').find(row =>
    String(row.studentId) === 'TEST-STUDENT-01' &&
    String(row.unitId) === String(secondUnitId) &&
    String(row.homeworkType) === 'TRY_REDO'
  );
  const declareNoTarget = api({
    action: 'declareHomework',
    token: studentA.token,
    homeworkId: noTargetRedo.homeworkId,
    studentStatus: 'NO_TARGET_CLAIM'
  });
  const declaredNoTargetRedo = getRowsAsObjects_('Homework').find(row =>
    String(row.homeworkId) === String(noTargetRedo.homeworkId)
  );
  record('TRY赤×直しは未入力で自動作成',
    noErrors.success && noTargetRedo.studentStatus === 'UNINPUT');
  record('生徒が赤×直し対象なしを保存',
    declareNoTarget.success && declaredNoTargetRedo.studentStatus === 'NO_TARGET_CLAIM');
  const undoNoTarget = api({
    action: 'declareHomework',
    token: studentA.token,
    homeworkId: noTargetRedo.homeworkId,
    studentStatus: 'UNINPUT'
  });
  const undoneNoTargetRedo = getRowsAsObjects_('Homework').find(row =>
    String(row.homeworkId) === String(noTargetRedo.homeworkId)
  );
  record('講師確認前は対象なしを取り消して未確認へ戻せる',
    undoNoTarget.success &&
    undoneNoTargetRedo.studentStatus === 'UNINPUT' &&
    !undoneNoTargetRedo.studentNoTargetAt &&
    !undoneNoTargetRedo.studentNoTargetDate);
  const redeclareNoTarget = api({
    action: 'declareHomework',
    token: studentA.token,
    homeworkId: noTargetRedo.homeworkId,
    studentStatus: 'NO_TARGET_CLAIM'
  });
  const redeclaredNoTargetRedo = getRowsAsObjects_('Homework').find(row =>
    String(row.homeworkId) === String(noTargetRedo.homeworkId)
  );
  record('対象なしと宿題済みを排他的に保存',
    redeclareNoTarget.success &&
    redeclaredNoTargetRedo.studentStatus === 'NO_TARGET_CLAIM' &&
    !!redeclaredNoTargetRedo.studentNoTargetAt &&
    !redeclaredNoTargetRedo.studentCompletedAt &&
    !redeclaredNoTargetRedo.studentCompletedDate);
  const secondHomework = api({action: 'listHomework', token: studentA.token}).homework
    .filter(row => String(row.unitId) === String(secondUnitId));
  const declareBoth = api({
    action: 'declareHomeworkGroup',
    token: studentA.token,
    homeworkIds: secondHomework.map(row => row.homeworkId)
  });
  const afterDeclareBoth = getRowsAsObjects_('Homework').filter(row =>
    secondHomework.some(item => String(item.homeworkId) === String(row.homeworkId))
  );
  record('教材別の全宿題項目を1回のAPIで生徒申告',
    declareBoth.success &&
    afterDeclareBoth.find(row => row.homeworkType === 'TRY_REDO').studentStatus === 'NO_TARGET_CLAIM' &&
    afterDeclareBoth.find(row => row.homeworkType === 'EXERCISE').studentStatus === 'DECLARED_DONE');
  const confirmBoth = api({
    action: 'confirmHomeworkGroup',
    token: teacher.token,
    homeworkIds: secondHomework.map(row => row.homeworkId),
    confirmationMemo: '一括確認テスト'
  });
  const afterConfirmBoth = getRowsAsObjects_('Homework').filter(row =>
    secondHomework.some(item => String(item.homeworkId) === String(row.homeworkId))
  );
  record('教材別の全宿題項目を1回のAPIで講師確認',
    confirmBoth.success &&
    afterConfirmBoth.find(row => row.homeworkType === 'TRY_REDO').teacherStatus === 'NOT_APPLICABLE' &&
    afterConfirmBoth.find(row => row.homeworkType === 'EXERCISE').teacherStatus === 'VERIFIED');
  const undoNoTargetAfterConfirm = api({
    action: 'declareHomework',
    token: studentA.token,
    homeworkId: noTargetRedo.homeworkId,
    studentStatus: 'UNINPUT'
  });
  record('講師確認後は生徒による対象なし解除を拒否',
    !undoNoTargetAfterConfirm.success &&
    undoNoTargetAfterConfirm.code === 'HOMEWORK_ALREADY_CONFIRMED');
  const mixedGroup = api({
    action: 'confirmHomeworkGroup',
    token: teacher.token,
    homeworkIds: [firstUnitHomework[0].homeworkId, secondHomework[0].homeworkId]
  });
  record('異なる単元を混ぜた宿題一括更新を拒否',
    !mixedGroup.success && mixedGroup.code === 'MIXED_HOMEWORK_GROUP');

  const normalUnit = getRowsAsObjects_('Units').find(row => String(row.unitType) === 'NORMAL');
  const teacherAdminCall = api({
    action: 'setStandardRange',
    token: teacher.token,
    grade: '中2',
    unitId: normalUnit.unitId,
    included: true
  });
  record('講師による管理設定APIを拒否', !teacherAdminCall.success && teacherAdminCall.code === 'FORBIDDEN');

  const summaries = getRowsAsObjects_('Units').filter(row => String(row.unitType) === 'SUMMARY');
  const preSteps = getRowsAsObjects_('Units').filter(row => String(row.unitType) === 'PRE_STEP');
  const standardIds = new Set(getRowsAsObjects_('StandardRanges')
    .filter(row => String(row.included).toLowerCase() !== 'false')
    .map(row => String(row.unitId)));
  record('まとめ30件を単元マスタへ登録', summaries.length === 30);
  record('プレステップ65件を単元マスタへ登録', preSteps.length === 65);
  record('まとめを標準範囲へ初期登録',
    summaries.every(row => standardIds.has(String(row.unitId))));
  record('プレステップを標準範囲から除外',
    preSteps.every(row => !standardIds.has(String(row.unitId))));

  const allMasterUnits = getRowsAsObjects_('Units');
  const goalUnits = allMasterUnits.filter(row => normalizeSeries_(row.series) === MATERIAL_SERIES.GOAL);
  const goalCountBySubject = goalUnits.reduce((result, row) => {
    result[String(row.subject)] = Number(result[String(row.subject)] || 0) + 1;
    return result;
  }, {});
  record('フォレスタゴール288単元を5教科分登録',
    goalUnits.length === 288 &&
    goalCountBySubject['英語'] === 54 &&
    goalCountBySubject['数学'] === 62 &&
    goalCountBySubject['国語'] === 57 &&
    goalCountBySubject['理科'] === 59 &&
    goalCountBySubject['社会'] === 56);
  record('ゴールのLCT対象を数学・理科・社会の単元別ファイナルだけに限定',
    goalUnits.every(row =>
      unitHasLct_(row) === (
        ['数学','理科','社会'].indexOf(String(row.subject)) >= 0 &&
        String(row.sourceBlock) === 'unit-final'
      )
    ));
  record('英語宿題を教材別の3項目構成に設定',
    homeworkTypesForUnit_({subject: '英語', series: MATERIAL_SERIES.STEP}).join(',') ===
      'TRY_REDO,EXERCISE,MEMORIZATION_MARK' &&
    homeworkTypesForUnit_({subject: '英語', series: MATERIAL_SERIES.GOAL}).join(',') ===
      'TRY_REDO,EXERCISE,MY_VOCABULARY');
  record('全単元に確定済み章IDと章名を保持',
    allMasterUnits.every(row => String(row.chapterId) && String(row.chapterLabel)));
  record('不自然なその他・第まとめ章が存在しない',
    allMasterUnits.every(row =>
      String(row.chapterLabel) !== 'その他' &&
      String(row.chapterLabel) !== '第まとめ章'
    ));
  const masterGroups = {};
  allMasterUnits.forEach(row => {
    const key = normalizeSeries_(row.series) + '|' + String(row.subject) + '|' + String(row.gradeScope);
    if (!masterGroups[key]) masterGroups[key] = [];
    masterGroups[key].push(row);
  });
  const preStepFirst = Object.keys(masterGroups).every(key => {
    const group = masterGroups[key].slice().sort((a, b) =>
      Number(a.displayOrder || 0) - Number(b.displayOrder || 0)
    );
    const preCount = group.filter(row => String(row.unitType) === 'PRE_STEP').length;
    return group.slice(0, preCount).every(row => String(row.unitType) === 'PRE_STEP');
  });
  record('プレステップを教材先頭へ配置', preStepFirst);
  const regularOrderPreserved = Object.keys(masterGroups).every(key => {
    const regular = masterGroups[key]
      .filter(row => String(row.unitType) !== 'PRE_STEP')
      .sort((a, b) => Number(a.displayOrder || 0) - Number(b.displayOrder || 0));
    return regular.every((row, index) =>
      index === 0 ||
      Number(row.originalDisplayOrder) >= Number(regular[index - 1].originalDisplayOrder)
    );
  });
  record('通常・まとめのExcel原本順を保持', regularOrderPreserved);
  const mathG1Chapter2 = allMasterUnits.filter(row =>
    String(row.subject) === '数学' &&
    String(row.gradeScope) === '中1' &&
    String(row.chapterLabel) === '第2章'
  );
  record('数学中1第2章はまとめを含む12単元',
    mathG1Chapter2.length === 12 &&
    mathG1Chapter2.some(row =>
      String(row.stepCode) === '2-11' && String(row.unitType) === 'SUMMARY'
    ));

  const mathCandidates = ownDashboard.data.selectableUnits
    .filter(row =>
      String(row.subject) === '数学' &&
      normalizeSeries_(row.series) === MATERIAL_SERIES.STEP
    )
    .map(row => String(row.unitId));
  const originalMathTargets = getStudentTargetUnitIds_(
    'TEST-STUDENT-01',
    '数学',
    MATERIAL_SERIES.STEP
  ).map(String);
  const oneMathUnit = mathCandidates[0];
  const originalOneSelected = originalMathTargets.indexOf(oneMathUnit) >= 0;
  const oneTargetStartedAt = Date.now();
  const changeOneMath = api({
    action: 'setOwnTargetChanges',
    token: studentA.token,
    subject: '数学',
    changes: [{unitId: oneMathUnit, selected: !originalOneSelected}],
    clientRevision: 1
  });
  performance.singleTargetSaveMs = Date.now() - oneTargetStartedAt;
  const restoreOneMath = api({
    action: 'setOwnTargetChanges',
    token: studentA.token,
    subject: '数学',
    changes: [{unitId: oneMathUnit, selected: originalOneSelected}],
    clientRevision: 2
  });
  record('夏期範囲の差分を1回のAPI・1回の一括書込みで保存',
    changeOneMath.success && restoreOneMath.success &&
    Number(restoreOneMath.clientRevision) === 2);
  const benchmarkTargetChanges = (label, unitIds, revision) => {
    const original = unitIds.map(unitId => ({
      unitId,
      selected: originalMathTargets.indexOf(unitId) >= 0
    }));
    const startedAt = Date.now();
    const changed = api({
      action: 'setOwnTargetChanges',
      token: studentA.token,
      subject: '数学',
      changes: original.map(item => ({unitId: item.unitId, selected: !item.selected})),
      clientRevision: revision
    });
    const elapsedMs = Date.now() - startedAt;
    const restored = api({
      action: 'setOwnTargetChanges',
      token: studentA.token,
      subject: '数学',
      changes: original,
      clientRevision: revision + 1
    });
    record(label, changed.success && restored.success);
    return elapsedMs;
  };
  performance.chapter12TargetSaveMs = benchmarkTargetChanges(
    '章12単元を1回の差分APIで保存して元へ復元',
    mathCandidates.slice(0, 12),
    10
  );
  performance.range20TargetSaveMs = benchmarkTargetChanges(
    '指定範囲20単元を1回の差分APIで保存して元へ復元',
    mathCandidates.slice(0, 20),
    20
  );
  performance.fullSubjectTargetSaveMs = benchmarkTargetChanges(
    '科目全件を1回の差分APIで保存して元へ復元',
    mathCandidates,
    30
  );
  const selectAllMath = api({
    action: 'setOwnTargetSelection',
    token: studentA.token,
    subject: '数学',
    unitIds: mathCandidates
  });
  const repeatSelectAllMath = api({
    action: 'setOwnTargetSelection',
    token: studentA.token,
    subject: '数学',
    unitIds: mathCandidates
  });
  const mathOverrideRows = getRowsAsObjects_('StudentTargets').filter(row =>
    String(row.studentId) === 'TEST-STUDENT-01' &&
    String(row.subject) === '数学' &&
    normalizeSeries_(row.series) === MATERIAL_SERIES.STEP
  );
  record('科目内の全単元を1回のAPIで一括選択',
    selectAllMath.success && selectAllMath.targetCount === mathCandidates.length);
  record('同じ一括選択の再送で重複記録を作らない',
    repeatSelectAllMath.success &&
    mathOverrideRows.length === mathCandidates.length &&
    new Set(mathOverrideRows.map(row => String(row.unitId))).size === mathCandidates.length);
  const clearAllMath = api({
    action: 'setOwnTargetSelection',
    token: studentA.token,
    subject: '数学',
    unitIds: []
  });
  record('科目内の全単元を1回のAPIで一括解除',
    clearAllMath.success && clearAllMath.targetCount === 0);
  const restoreMath = api({
    action: 'setOwnTargetSelection',
    token: studentA.token,
    subject: '数学',
    unitIds: originalMathTargets
  });
  const restoredMathTargets = getStudentTargetUnitIds_('TEST-STUDENT-01', '数学').map(String).sort();
  record('一括試験後に元の実効選択状態を復元',
    restoreMath.success &&
    JSON.stringify(restoredMathTargets) === JSON.stringify(originalMathTargets.slice().sort()));

  const audit = api({action: 'listAuditLog', token: admin.token, limit: 200});
  record('操作履歴を作成', audit.success && audit.auditLog.some(row => row.actorId === 'TEST-STUDENT-01'));

  const adminListStartedAt = Date.now();
  const activeDefault = api({action: 'getAdminStudentList', token: admin.token, filters: {}});
  performance.adminStudentListMs = Date.now() - adminListStartedAt;
  record('管理者一覧の初期値は在籍生のみ',
    activeDefault.success && activeDefault.students.every(row => row.enrollmentStatus === 'ACTIVE'));
  record('管理者一覧へ完了数・対象数を返す',
    activeDefault.success && activeDefault.students.every(row =>
      typeof row.completedCount === 'number' && typeof row.targetCount === 'number'
    ));

  const secretValues = [
    getRequiredProperty_(PROP.SESSION_SECRET),
    studentPassword,
    staffPassword,
    getRequiredProperty_(PROP.PROGRESS_DB_SS_ID),
    getRequiredProperty_(PROP.STUDENT_MASTER_SS_ID),
    getRequiredProperty_(PROP.STAFF_MASTER_SS_ID)
  ];
  const serializedResponses = JSON.stringify({
    studentA: studentA,
    teacher: teacher,
    admin: admin,
    dashboard: ownDashboard
  });
  record('API応答へ秘密情報・Spreadsheet IDを含めない',
    secretValues.every(value => serializedResponses.indexOf(value) < 0));

  api({action: 'logout', token: studentB.token});
  const afterLogout = api({action: 'getSession', token: studentB.token});
  record('ログアウト後のセッションを無効化',
    !afterLogout.success && afterLogout.code === 'SESSION_EXPIRED');

  const result = {
    success: tests.every(test => test.success),
    passed: tests.filter(test => test.success).length,
    failed: tests.filter(test => !test.success).length,
    tests: tests,
    performance: Object.assign(performance, {
      measurement: 'Apps Script server-side wall clock',
      spreadsheetAccessModel: {
        progressWithoutNewHomework: {reads: 2, writes: 2},
        progressWithNewHomework: {reads: 3, writes: 3},
        targetBatch: {reads: 1, writes: 2}
      }
    }),
    checkedAt: nowIso_()
  };
  console.log(JSON.stringify(result));
  return result;
}

function verifyMasterConnections_() {
  const studentBook = SpreadsheetApp.openById(getRequiredProperty_(PROP.STUDENT_MASTER_SS_ID));
  const studentSheet = studentBook.getSheetByName(getRequiredProperty_(PROP.STUDENT_MASTER_SHEET_NAME));
  const staffBook = SpreadsheetApp.openById(getRequiredProperty_(PROP.STAFF_MASTER_SS_ID));
  const staffSheet = staffBook.getSheetByName(getRequiredProperty_(PROP.STAFF_MASTER_SHEET_NAME));
  if (!studentSheet || !staffSheet) throw new Error('マスタシートが見つかりません。');
  if (studentSheet.getLastColumn() < 16) throw new Error('生徒マスタの列数が不足しています。');
  if (staffSheet.getLastColumn() < 37) throw new Error('講師マスタの列数が不足しています。');
  return {
    studentFileName: studentBook.getName(),
    studentSheetName: studentSheet.getName(),
    studentRows: studentSheet.getLastRow(),
    staffFileName: staffBook.getName(),
    staffSheetName: staffSheet.getName(),
    staffRows: staffSheet.getLastRow()
  };
}

function runHomeworkOverdueSmokeTest() {
  if (!isDevelopment_()) throw new Error('開発環境以外では実行できません。');
  const today = todayInJapan_();
  const yesterday = dateFromDayNumber_(dateDayNumber_(today) - 1);
  const base = {studentStatus: 'UNINPUT', teacherStatus: 'UNCONFIRMED'};
  const aggregation = listOverdueHomeworkStudents_({
    role: ROLE.ADMIN,
    userId: 'SYSTEM-SMOKE-TEST'
  });
  const checks = {
    dueDateItselfExcluded: !isOverdueHomework_(Object.assign({}, base, {dueDate: today}), today),
    followingDayIncluded: isOverdueHomework_(Object.assign({}, base, {dueDate: yesterday}), today),
    missingDueDateExcluded: !isOverdueHomework_(base, today),
    completedExcluded: !isOverdueHomework_(
      Object.assign({}, base, {dueDate: yesterday, studentStatus: 'DECLARED_DONE'}),
      today
    ),
    confirmedExcluded: !isOverdueHomework_(
      Object.assign({}, base, {dueDate: yesterday, teacherStatus: 'VERIFIED'}),
      today
    ),
    aggregationReturned: Array.isArray(aggregation.students) &&
      aggregation.totalStudents === aggregation.students.length &&
      aggregation.rule.timezone === 'Asia/Tokyo'
  };
  const result = {
    success: Object.keys(checks).every(key => checks[key]),
    checks: checks,
    totalStudents: aggregation.totalStudents,
    today: today,
    checkedAt: nowIso_()
  };
  console.log(JSON.stringify(result));
  if (!result.success) throw new Error('宿題未完了一覧スモークテストに失敗しました。');
  return result;
}

function resetDevelopmentTestUnitData_(studentId, unitIds) {
  if (!isDevelopment_()) throw new Error('開発環境以外では実行できません。');
  const targetIds = new Set(unitIds.map(String));
  ['UnitProgress', 'Homework'].forEach(sheetName => {
    const rows = getRowsAsObjects_(sheetName)
      .filter(row =>
        String(row.studentId) === String(studentId) &&
        targetIds.has(String(row.unitId))
      )
      .map(row => row._rowNumber)
      .sort((a, b) => b - a);
    const sheet = getSheet_(sheetName);
    rows.forEach(rowNumber => sheet.deleteRow(rowNumber));
  });
}



