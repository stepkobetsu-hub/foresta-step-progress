const PHASE4 = Object.freeze({
  SPREADSHEET_ID: '1axZz8nGy15srgo2DVladaY_KQ3XXVbNrOrk3zL1GqaI',
  SHEET_NAME: 'Cloudflare同期検証',
  TEST_STUDENT_ID: 'TEST-STUDENT-01',
  TOKEN_PROPERTY: 'PHASE4_DUAL_WRITE_TOKEN',
  MAX_ATTEMPTS: 3,
  HEADERS: ['sync_id','student_id','operation_type','record_id','payload','request_id','attempt_count','last_error','next_retry_at','status','created_at','updated_at','version','record_state']
});

function doGet() {
  return json_({success:true, service:'cloudflare-phase4-dual-write-test', testStudentOnly:true});
}

function doPost(e) {
  const startedAt = Date.now();
  try {
    const input = JSON.parse((e.postData && e.postData.contents) || '{}');
    authenticate_(input.token);
    if (String(input.student_id || '') !== PHASE4.TEST_STUDENT_ID) {
      return json_({success:false, code:'FORBIDDEN_STUDENT_SCOPE'}, 403);
    }
    if (input.action === 'read') return json_(readSync_(input, startedAt));
    if (input.action !== 'write') return json_({success:false, code:'METHOD_NOT_ALLOWED'}, 405);
    return json_(upsertSync_(input, startedAt));
  } catch (error) {
    return json_({success:false, code:'INTERNAL_ERROR', error:String(error && error.message || error), googleMs:Date.now()-startedAt});
  }
}

function authenticate_(token) {
  const expected = PropertiesService.getScriptProperties().getProperty(PHASE4.TOKEN_PROPERTY);
  if (!expected || String(token || '') !== expected) throw new Error('UNAUTHORIZED');
}

function getSheet_() {
  const book = SpreadsheetApp.openById(PHASE4.SPREADSHEET_ID);
  let sheet = book.getSheetByName(PHASE4.SHEET_NAME);
  if (!sheet) {
    sheet = book.insertSheet(PHASE4.SHEET_NAME);
    sheet.getRange(1,1,1,PHASE4.HEADERS.length).setValues([PHASE4.HEADERS]);
    sheet.setFrozenRows(1);
  }
  const current = sheet.getRange(1,1,1,PHASE4.HEADERS.length).getValues()[0].map(String);
  if (current.join('|') !== PHASE4.HEADERS.join('|')) throw new Error('INVALID_SYNC_SHEET_SCHEMA');
  return sheet;
}

function readRows_(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  return sheet.getRange(2,1,lastRow-1,PHASE4.HEADERS.length).getValues().map((values, index) => {
    const row = {rowNumber:index+2};
    PHASE4.HEADERS.forEach((header, column) => row[header] = values[column]);
    return row;
  });
}

function upsertSync_(input, startedAt) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheet = getSheet_();
    const rows = readRows_(sheet);
    const requestId = String(input.request_id || '');
    if (!requestId) throw new Error('REQUEST_ID_REQUIRED');
    const duplicate = rows.find(row => String(row.request_id) === requestId);
    if (duplicate) return responseFromRow_(duplicate, true, startedAt);
    const recordId = String(input.record_id || '');
    const operationType = String(input.operation_type || '');
    const prior = rows.filter(row => String(row.record_id) === recordId && String(row.operation_type) === operationType)
      .sort((a,b) => Number(b.version || 0) - Number(a.version || 0))[0];
    const expectedVersion = Number(input.version || 0);
    const currentVersion = Number(prior && prior.version || 0);
    if (expectedVersion !== currentVersion) return {success:false, code:'VERSION_CONFLICT', status:'CONFLICT', expectedVersion, currentVersion, googleMs:Date.now()-startedAt};
    const now = new Date().toISOString();
    const version = currentVersion + 1;
    const syncId = String(input.sync_id || Utilities.getUuid());
    const payload = JSON.stringify(input.payload || {});
    const state = String(input.record_state || 'ACTIVE');
    const values = [syncId,PHASE4.TEST_STUDENT_ID,operationType,recordId,payload,requestId,1,'','',
      'SAVED',now,now,version,state];
    sheet.appendRow(values);
    SpreadsheetApp.flush();
    const row = {rowNumber:sheet.getLastRow()};
    PHASE4.HEADERS.forEach((header,index) => row[header]=values[index]);
    return responseFromRow_(row, false, startedAt);
  } finally { lock.releaseLock(); }
}

function readSync_(input, startedAt) {
  const sheet = getSheet_();
  const rows = readRows_(sheet);
  const syncId = String(input.sync_id || '');
  const requestId = String(input.request_id || '');
  const row = rows.find(item => (syncId && String(item.sync_id) === syncId) || (requestId && String(item.request_id) === requestId));
  if (!row) return {success:false, code:'NOT_FOUND', googleMs:Date.now()-startedAt};
  return responseFromRow_(row, true, startedAt);
}

function responseFromRow_(row, duplicate, startedAt) {
  let payload = {};
  try { payload = JSON.parse(String(row.payload || '{}')); } catch (error) {}
  return {
    success:true, sync_id:String(row.sync_id), student_id:String(row.student_id),
    operation_type:String(row.operation_type), record_id:String(row.record_id), payload,
    request_id:String(row.request_id), attempt_count:Number(row.attempt_count || 0),
    status:String(row.status), version:Number(row.version || 0),
    record_state:String(row.record_state || ''), updated_at:String(row.updated_at || ''),
    duplicate:!!duplicate, googleMs:Date.now()-startedAt
  };
}

function json_(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}
