// ===== SupabaseStorage.gs =====
// Google Sheetを正本として残したまま、段階移行と件数照合を行う。
// SUPABASE_ENABLED が true になるまでは本番の読書き先を変更しない。

const SUPABASE_TABLES_ = Object.freeze({
  UnitProgress: 'learning_progress',
  StudentTargets: 'student_targets',
  StudentProfiles: 'student_profiles',
  Homework: 'homework'
});

function supabaseConfig_() {
  const properties = PropertiesService.getScriptProperties();
  const url = String(properties.getProperty('SUPABASE_URL') || '').replace(/\/+$/, '');
  const serviceRoleKey = String(properties.getProperty('SUPABASE_SERVICE_ROLE_KEY') || '');
  if (!url || !serviceRoleKey) {
    throw new Error('Supabase接続情報が設定されていません。');
  }
  return {
    url: url,
    serviceRoleKey: serviceRoleKey,
    enabled: String(properties.getProperty('SUPABASE_ENABLED') || '').toLowerCase() === 'true'
  };
}

function supabaseRequest_(path, method, payload, extraHeaders) {
  const config = supabaseConfig_();
  const options = {
    method: method || 'get',
    muteHttpExceptions: true,
    contentType: 'application/json',
    headers: Object.assign({
      apikey: config.serviceRoleKey,
      Authorization: 'Bearer ' + config.serviceRoleKey
    }, extraHeaders || {})
  };
  if (payload != null) options.payload = JSON.stringify(payload);
  const response = UrlFetchApp.fetch(config.url + '/rest/v1/' + path, options);
  const status = response.getResponseCode();
  const body = response.getContentText();
  if (status < 200 || status >= 300) {
    throw new Error('Supabase API error (' + status + '): ' + body.slice(0, 500));
  }
  return {status: status, body: body, headers: response.getAllHeaders()};
}

function nullableIso_(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  const text = String(value).trim();
  return text || null;
}

function nullableDate_(value) {
  if (!value) return null;
  if (value instanceof Date) {
    return Utilities.formatDate(value, 'Asia/Tokyo', 'yyyy-MM-dd');
  }
  const text = String(value).trim();
  return text ? text.slice(0, 10) : null;
}

function progressRowForSupabase_(row) {
  return {
    progress_id: String(row.progressId || Utilities.getUuid()),
    student_id: String(row.studentId || ''),
    unit_id: String(row.unitId || ''),
    point_confirmed: isTrue_(row.pointConfirmed),
    warmup_confirmed: isTrue_(row.warmupConfirmed),
    try_completed: isTrue_(row.tryCompleted),
    try_result: String(row.tryResult || ''),
    student_updated_at: nullableIso_(row.studentUpdatedAt),
    updated_at: nullableIso_(row.updatedAt) || new Date().toISOString(),
    updated_by: String(row.updatedBy || ''),
    lct_result: String(row.lctResult || ''),
    lct_date: nullableIso_(row.lctDate),
    learning_date: nullableDate_(row.learningDate),
    point_completed_at: nullableIso_(row.pointCompletedAt),
    warmup_completed_at: nullableIso_(row.warmupCompletedAt),
    try_completed_at: nullableIso_(row.tryCompletedAt),
    client_revision: Number(row.clientRevision || 0),
    client_mutation_id: String(row.clientMutationId || '').slice(0, 80),
    school_year: String(row.schoolYear || SCHOOL_YEAR),
    round_number: normalizeRoundNumber_(row.roundNumber),
    series: normalizeSeries_(row.series)
  };
}

function targetRowForSupabase_(row) {
  return {
    student_target_id: String(row.studentTargetId || Utilities.getUuid()),
    student_id: String(row.studentId || ''),
    master_version: String(row.masterVersion || MASTER_VERSION),
    subject: String(row.subject || ''),
    unit_id: String(row.unitId || ''),
    included: isTrue_(row.included),
    source: String(row.source || ''),
    created_at: nullableIso_(row.createdAt) || new Date().toISOString(),
    updated_at: nullableIso_(row.updatedAt) || new Date().toISOString(),
    updated_by: String(row.updatedBy || ''),
    series: normalizeSeries_(row.series)
  };
}

function profileRowForSupabase_(row) {
  return {
    student_id: String(row.studentId || ''),
    name: String(row.name || ''),
    campus: String(row.campus || ''),
    grade: String(row.grade || ''),
    grade_j_raw: String(row.gradeJRaw || ''),
    grade_k_raw: String(row.gradeKRaw || ''),
    grade_conflict: isTrue_(row.gradeConflict),
    school: String(row.school || ''),
    enrollment_status: String(row.enrollmentStatus || ''),
    last_synced_at: nullableIso_(row.lastSyncedAt) || new Date().toISOString()
  };
}

function homeworkRowForSupabase_(row) {
  return {
    homework_id: String(row.homeworkId || Utilities.getUuid()),
    student_id: String(row.studentId || ''),
    unit_id: String(row.unitId || ''),
    homework_type: String(row.homeworkType || ''),
    student_status: String(row.studentStatus || ''),
    teacher_status: String(row.teacherStatus || ''),
    student_updated_at: nullableIso_(row.studentUpdatedAt),
    teacher_updated_at: nullableIso_(row.teacherUpdatedAt),
    confirmed_by: String(row.confirmedBy || ''),
    confirmation_memo: String(row.confirmationMemo || ''),
    created_at: nullableIso_(row.createdAt) || new Date().toISOString(),
    updated_at: nullableIso_(row.updatedAt) || new Date().toISOString(),
    school_year: String(row.schoolYear || SCHOOL_YEAR),
    round_number: normalizeRoundNumber_(row.roundNumber),
    assigned_date: nullableDate_(row.assignedDate),
    student_completed_at: nullableIso_(row.studentCompletedAt),
    student_completed_date: nullableDate_(row.studentCompletedDate),
    student_no_target_at: nullableIso_(row.studentNoTargetAt),
    student_no_target_date: nullableDate_(row.studentNoTargetDate),
    series: normalizeSeries_(row.series),
    due_date: nullableDate_(row.dueDate)
  };
}

function supabaseStorageEnabledFor_(sheetName) {
  if (!Object.prototype.hasOwnProperty.call(SUPABASE_TABLES_, sheetName)) return false;
  return supabaseConfig_().enabled;
}

function progressRowFromSupabase_(row, rowNumber) {
  return {
    _rowNumber: rowNumber,
    progressId: row.progress_id || '',
    studentId: row.student_id || '',
    unitId: row.unit_id || '',
    pointConfirmed: !!row.point_confirmed,
    warmupConfirmed: !!row.warmup_confirmed,
    tryCompleted: !!row.try_completed,
    tryResult: row.try_result || '',
    studentUpdatedAt: row.student_updated_at || '',
    updatedAt: row.updated_at || '',
    updatedBy: row.updated_by || '',
    lctResult: row.lct_result || '',
    lctDate: row.lct_date || '',
    learningDate: row.learning_date || '',
    pointCompletedAt: row.point_completed_at || '',
    warmupCompletedAt: row.warmup_completed_at || '',
    tryCompletedAt: row.try_completed_at || '',
    clientRevision: Number(row.client_revision || 0),
    clientMutationId: row.client_mutation_id || '',
    schoolYear: row.school_year || SCHOOL_YEAR,
    roundNumber: normalizeRoundNumber_(row.round_number),
    series: normalizeSeries_(row.series)
  };
}

function targetRowFromSupabase_(row, rowNumber) {
  return {
    _rowNumber: rowNumber,
    studentTargetId: row.student_target_id || '',
    studentId: row.student_id || '',
    masterVersion: row.master_version || MASTER_VERSION,
    subject: row.subject || '',
    unitId: row.unit_id || '',
    included: !!row.included,
    source: row.source || '',
    createdAt: row.created_at || '',
    updatedAt: row.updated_at || '',
    updatedBy: row.updated_by || '',
    series: normalizeSeries_(row.series)
  };
}

function profileRowFromSupabase_(row, rowNumber) {
  return {
    _rowNumber: rowNumber,
    studentId: row.student_id || '',
    name: row.name || '',
    campus: row.campus || '',
    grade: row.grade || '',
    gradeJRaw: row.grade_j_raw || '',
    gradeKRaw: row.grade_k_raw || '',
    gradeConflict: !!row.grade_conflict,
    school: row.school || '',
    enrollmentStatus: row.enrollment_status || '',
    lastSyncedAt: row.last_synced_at || ''
  };
}

function homeworkRowFromSupabase_(row, rowNumber) {
  return {
    _rowNumber: rowNumber,
    homeworkId: row.homework_id || '',
    studentId: row.student_id || '',
    unitId: row.unit_id || '',
    homeworkType: row.homework_type || '',
    studentStatus: row.student_status || '',
    teacherStatus: row.teacher_status || '',
    studentUpdatedAt: row.student_updated_at || '',
    teacherUpdatedAt: row.teacher_updated_at || '',
    confirmedBy: row.confirmed_by || '',
    confirmationMemo: row.confirmation_memo || '',
    createdAt: row.created_at || '',
    updatedAt: row.updated_at || '',
    schoolYear: row.school_year || SCHOOL_YEAR,
    roundNumber: normalizeRoundNumber_(row.round_number),
    assignedDate: row.assigned_date || '',
    studentCompletedAt: row.student_completed_at || '',
    studentCompletedDate: row.student_completed_date || '',
    studentNoTargetAt: row.student_no_target_at || '',
    studentNoTargetDate: row.student_no_target_date || '',
    series: normalizeSeries_(row.series),
    dueDate: row.due_date || ''
  };
}

function supabaseColumnForField_(fieldName) {
  return String(fieldName || '').replace(/[A-Z]/g, letter => '_' + letter.toLowerCase());
}

function supabaseReadRows_(sheetName, fieldName, fieldValue) {
  const table = SUPABASE_TABLES_[sheetName];
  if (!table) throw new Error('Supabase対象外のデータです: ' + sheetName);
  const filters = fieldName
    ? '&' + encodeURIComponent(supabaseColumnForField_(fieldName)) +
      '=eq.' + encodeURIComponent(String(fieldValue))
    : '';
  const pageSize = 1000;
  const rows = [];
  for (let start = 0; ; start += pageSize) {
    const response = supabaseRequest_(
      table + '?select=*' + filters,
      'get',
      null,
      {Range: start + '-' + (start + pageSize - 1)}
    );
    const page = JSON.parse(response.body || '[]');
    rows.push.apply(rows, page);
    if (page.length < pageSize) break;
  }
  const mappers = {
    UnitProgress: progressRowFromSupabase_,
    StudentTargets: targetRowFromSupabase_,
    StudentProfiles: profileRowFromSupabase_,
    Homework: homeworkRowFromSupabase_
  };
  const mapper = mappers[sheetName];
  return rows.map((row, index) => mapper(row, index + 2));
}

function supabaseWriteRows_(sheetName, rows) {
  const validRows = (rows || []).filter(row => {
    if (!row) return false;
    if (sheetName === 'StudentProfiles') return !!row.studentId;
    if (sheetName === 'Homework') return !!(row.homeworkId && row.studentId && row.unitId);
    return !!(row.studentId && row.unitId);
  });
  if (!validRows.length) return;
  if (sheetName === 'UnitProgress') {
    supabaseUpsertBatches_(
      SUPABASE_TABLES_.UnitProgress,
      validRows.map(progressRowForSupabase_),
      'student_id,unit_id,school_year,round_number'
    );
    return;
  }
  if (sheetName === 'StudentTargets') {
    supabaseUpsertBatches_(
      SUPABASE_TABLES_.StudentTargets,
      validRows.map(targetRowForSupabase_),
      'student_id,unit_id'
    );
    return;
  }
  if (sheetName === 'StudentProfiles') {
    supabaseUpsertBatches_(
      SUPABASE_TABLES_.StudentProfiles,
      validRows.map(profileRowForSupabase_),
      'student_id'
    );
    return;
  }
  if (sheetName === 'Homework') {
    supabaseUpsertBatches_(
      SUPABASE_TABLES_.Homework,
      validRows.map(homeworkRowForSupabase_),
      'homework_id'
    );
    return;
  }
  throw new Error('Supabase対象外のデータです: ' + sheetName);
}

function sheetRowsForSupabaseMigration_(sheetName) {
  const sheet = getSheet_(sheetName);
  const values = sheet.getDataRange().getValues();
  if (!values.length) return [];
  return rowsFromValues_(values[0].map(String), values.slice(1), 2);
}

function studentPasswordHash_(password) {
  const bytes = Utilities.computeHmacSha256Signature(
    'STUDENT_AUTH:' + String(password || ''),
    getRequiredProperty_(PROP.SESSION_SECRET),
    Utilities.Charset.UTF_8
  );
  return bytes.map(byte => ('0' + ((byte + 256) % 256).toString(16)).slice(-2)).join('');
}

function authRowForSupabase_(record) {
  const gradeJ = normalizeGrade_(record.gradeJRaw);
  const gradeK = normalizeGrade_(record.gradeKRaw);
  return {
    student_id: String(record.studentId || ''),
    password_hash: studentPasswordHash_(record.password),
    status: String(record.status || ''),
    name: String(record.name || ''),
    campus: String(record.campus || ''),
    grade_j_raw: String(record.gradeJRaw || ''),
    grade_k_raw: String(record.gradeKRaw || ''),
    grade: gradeJ || gradeK || '',
    grade_conflict: !!(gradeJ && gradeK && gradeJ !== gradeK),
    school: String(record.school || ''),
    updated_at: new Date().toISOString()
  };
}

function getStudentAuthFromSupabase_(studentId) {
  const response = supabaseRequest_(
    'student_auth?select=*&student_id=eq.' + encodeURIComponent(String(studentId)) + '&limit=1',
    'get'
  );
  const rows = JSON.parse(response.body || '[]');
  return rows[0] || null;
}

function authenticateStudentWithSupabase_(studentId, password) {
  if (!supabaseConfig_().enabled) return null;
  const row = getStudentAuthFromSupabase_(studentId);
  if (!row || !safeStringEquals_(String(row.password_hash || ''), studentPasswordHash_(password))) {
    throw publicError_('生徒番号またはパスワードが違います。', 'INVALID_CREDENTIALS');
  }
  if (String(row.status) !== 'ACTIVE') {
    throw publicError_('退塾・休塾等のためログインできません。教室へお問い合わせください。', 'STUDENT_INACTIVE');
  }
  if (!row.grade) {
    throw publicError_('中学生の学年を確認できません。教室へお問い合わせください。', 'GRADE_NOT_FOUND');
  }
  return {
    profile: {
      studentId: String(row.student_id),
      name: String(row.name || ''),
      campus: String(row.campus || ''),
      grade: String(row.grade || ''),
      gradeJRaw: String(row.grade_j_raw || ''),
      gradeKRaw: String(row.grade_k_raw || ''),
      gradeConflict: !!row.grade_conflict,
      school: String(row.school || ''),
      enrollmentStatus: 'ACTIVE',
      lastSyncedAt: String(row.updated_at || new Date().toISOString())
    },
    permissionLevel: '',
    role: ROLE.STUDENT,
    authStartedAt: Date.now(),
    authTiming: {supabaseAuth: true}
  };
}

function migrateLoginStorageToSupabase() {
  const config = supabaseConfig_();
  if (config.enabled) {
    throw new Error('本番切替後は再移行できません。SUPABASE_ENABLED=true のまま使用してください。');
  }
  const profiles = sheetRowsForSupabaseMigration_('StudentProfiles')
    .filter(row => row.studentId)
    .map(profileRowForSupabase_);
  const homework = sheetRowsForSupabaseMigration_('Homework')
    .filter(row => row.homeworkId && row.studentId && row.unitId)
    .map(homeworkRowForSupabase_);

  const master = SpreadsheetApp.openById(getRequiredProperty_(PROP.STUDENT_MASTER_SS_ID));
  const masterSheet = master.getSheetByName(getRequiredProperty_(PROP.STUDENT_MASTER_SHEET_NAME));
  if (!masterSheet) throw new Error('生徒マスタの正本シートが見つかりません。');
  const masterValues = masterSheet.getDataRange().getValues();
  const authRows = [];
  for (let index = 1; index < masterValues.length; index++) {
    const record = studentAuthRecordFromRow_(masterValues[index], index + 1);
    if (record && record.studentId && record.password) authRows.push(authRowForSupabase_(record));
  }

  supabaseUpsertBatches_('student_profiles', profiles, 'student_id');
  supabaseUpsertBatches_('homework', homework, 'homework_id');
  supabaseUpsertBatches_('student_auth', authRows, 'student_id');

  const result = {
    success: true,
    profileSheetCount: profiles.length,
    profileSupabaseCount: supabaseTableCount_('student_profiles'),
    homeworkSheetCount: homework.length,
    homeworkSupabaseCount: supabaseTableCount_('homework'),
    authSourceCount: authRows.length,
    authSupabaseCount: supabaseTableCount_('student_auth')
  };
  result.countsMatch =
    result.profileSheetCount === result.profileSupabaseCount &&
    result.homeworkSheetCount === result.homeworkSupabaseCount &&
    result.authSourceCount === result.authSupabaseCount;
  console.info(JSON.stringify({action: 'migrateLoginStorageToSupabase', result}));
  return result;
}

function testSupabaseStudentTargetDeltaWrite() {
  const rows = supabaseReadRows_('StudentTargets', 'studentId', 'TEST-STUDENT-01');
  if (!rows.length) throw new Error('テスト生徒の目標範囲データが見つかりません。');
  const original = rows[0];
  const changed = Object.assign({}, original, {
    included: !isTrue_(original.included),
    updatedAt: new Date().toISOString(),
    updatedBy: 'SUPABASE_DELTA_TEST'
  });
  const startedAt = Date.now();
  try {
    supabaseWriteRows_('StudentTargets', [changed]);
    const saved = supabaseReadRows_('StudentTargets', 'studentId', 'TEST-STUDENT-01')
      .find(row => String(row.unitId) === String(original.unitId));
    if (!saved || isTrue_(saved.included) !== isTrue_(changed.included)) {
      throw new Error('Supabase差分保存の確認に失敗しました。');
    }
  } finally {
    supabaseWriteRows_('StudentTargets', [Object.assign({}, original, {
      updatedAt: new Date().toISOString(),
      updatedBy: 'SUPABASE_DELTA_TEST_RESTORE'
    })]);
  }
  const result = {success: true, changedRows: 1, restored: true, elapsedMs: Date.now() - startedAt};
  console.info(JSON.stringify({action: 'testSupabaseStudentTargetDeltaWrite', result}));
  return result;
}

function supabaseUpsertBatches_(table, rows, conflictColumns) {
  const batchSize = 200;
  for (let index = 0; index < rows.length; index += batchSize) {
    supabaseRequest_(
      table + '?on_conflict=' + encodeURIComponent(conflictColumns),
      'post',
      rows.slice(index, index + batchSize),
      {Prefer: 'resolution=merge-duplicates,return=minimal'}
    );
  }
}

function dedupeSupabaseRows_(rows, keyFields) {
  const byKey = new Map();
  (rows || []).forEach(row => {
    const key = keyFields.map(field => String(row[field] == null ? '' : row[field])).join('\u001f');
    const current = byKey.get(key);
    if (!current || String(row.updated_at || '') >= String(current.updated_at || '')) {
      byKey.set(key, row);
    }
  });
  return Array.from(byKey.values());
}

function supabaseTableCount_(table) {
  const response = supabaseRequest_(
    table + '?select=*&limit=1',
    'get',
    null,
    {Prefer: 'count=exact'}
  );
  const contentRange = String(
    response.headers['Content-Range'] ||
    response.headers['content-range'] ||
    ''
  );
  const match = contentRange.match(/\/(\d+)$/);
  return match ? Number(match[1]) : null;
}

function migrateProgressStorageToSupabase() {
  const config = supabaseConfig_();
  if (config.enabled) {
    throw new Error('移行中はSUPABASE_ENABLEDをfalseにしてください。');
  }

  const progressRows = dedupeSupabaseRows_(
    getRowsAsObjects_('UnitProgress')
      .filter(row => row.studentId && row.unitId)
      .map(progressRowForSupabase_),
    ['student_id','unit_id','school_year','round_number']
  );
  const targetRows = dedupeSupabaseRows_(
    getRowsAsObjects_('StudentTargets')
      .filter(row => row.studentId && row.unitId)
      .map(targetRowForSupabase_),
    ['student_id','unit_id']
  );

  supabaseUpsertBatches_(
    SUPABASE_TABLES_.UnitProgress,
    progressRows,
    'student_id,unit_id,school_year,round_number'
  );
  supabaseUpsertBatches_(
    SUPABASE_TABLES_.StudentTargets,
    targetRows,
    'student_id,unit_id'
  );

  const result = {
    success: true,
    sheetProgressCount: progressRows.length,
    supabaseProgressCount: supabaseTableCount_(SUPABASE_TABLES_.UnitProgress),
    sheetTargetCount: targetRows.length,
    supabaseTargetCount: supabaseTableCount_(SUPABASE_TABLES_.StudentTargets),
    checkedAt: new Date().toISOString()
  };
  result.countsMatch =
    result.sheetProgressCount === result.supabaseProgressCount &&
    result.sheetTargetCount === result.supabaseTargetCount;
  console.info(JSON.stringify({
    action: 'migrateProgressStorageToSupabase',
    success: result.success,
    countsMatch: result.countsMatch,
    sheetProgressCount: result.sheetProgressCount,
    supabaseProgressCount: result.supabaseProgressCount,
    sheetTargetCount: result.sheetTargetCount,
    supabaseTargetCount: result.supabaseTargetCount
  }));
  return result;
}

function verifyProgressStorageMigration() {
  return {
    success: true,
    sheetProgressCount: getRowsAsObjects_('UnitProgress')
      .filter(row => row.studentId && row.unitId).length,
    supabaseProgressCount: supabaseTableCount_(SUPABASE_TABLES_.UnitProgress),
    sheetTargetCount: getRowsAsObjects_('StudentTargets')
      .filter(row => row.studentId && row.unitId).length,
    supabaseTargetCount: supabaseTableCount_(SUPABASE_TABLES_.StudentTargets),
    checkedAt: new Date().toISOString()
  };
}
