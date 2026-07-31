// ===== SupabaseStorage.gs =====
// Google Sheetを正本として残したまま、段階移行と件数照合を行う。
// SUPABASE_ENABLED が true になるまでは本番の読書き先を変更しない。

const SUPABASE_TABLES_ = Object.freeze({
  UnitProgress: 'learning_progress',
  StudentTargets: 'student_targets'
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
