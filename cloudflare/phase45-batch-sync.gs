const PHASE45 = Object.freeze({
  SPREADSHEET_ID: '1axZz8nGy15srgo2DVladaY_KQ3XXVbNrOrk3zL1GqaI',
  SHEET_NAME: 'Cloudflare蜷梧悄讀懆ｨｼ',
  TEST_STUDENT_ID: 'TEST-STUDENT-01',
  TOKEN_PROPERTY: 'PHASE4_DUAL_WRITE_TOKEN',
  MAX_BATCH_SIZE: 25,
  SERVICE_VERSION: 'phase46-v2',
  HEADERS: ['sync_id','student_id','operation_type','record_id','payload','request_id','attempt_count','last_error','next_retry_at','status','created_at','updated_at','version','record_state']
});

function doGet(e) {
  try {
    return json45_(schemaResponse46_());
  } catch (error) {
    return json45_(errorResponse46_('DO_GET_ERROR', error));
  }
}

function doPost(e) {
  const started = Date.now();
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    authenticate45_(body.token);
    if (body.action === 'schema') return json45_(schemaResponse46_());
    if (body.action === 'batchRead') return json45_(batchRead46_(body));
    if (body.action !== 'batchWrite') return json45_({success:false,serviceVersion:PHASE45.SERVICE_VERSION,code:'METHOD_NOT_ALLOWED'});
    return json45_(batchWrite45_(body, started));
  } catch (error) {
    return json45_(errorResponse46_('DO_POST_ERROR', error));
  }
}

function errorResponse46_(code, error) {
  return {
    success: false,
    serviceVersion: PHASE45.SERVICE_VERSION,
    code: code,
    errorName: String(error && error.name || 'Error'),
    error: String(error && error.message || error || 'UNKNOWN_ERROR'),
    lineNumber: Number(error && error.lineNumber || 0)
  };
}

function schemaResponse46_() {
  const sheet = SpreadsheetApp.openById(PHASE45.SPREADSHEET_ID).getSheetByName(PHASE45.SHEET_NAME);
  if (!sheet) throw new Error('SYNC_SHEET_NOT_FOUND');
  const width = Math.max(sheet.getLastColumn(), PHASE45.HEADERS.length);
  const actual = width ? sheet.getRange(1, 1, 1, width).getDisplayValues()[0].map(String) : [];
  const nonEmpty = actual.filter(function (value) { return value !== ''; });
  const duplicates = nonEmpty.filter(function (value, index, values) { return values.indexOf(value) !== index; });
  const blanks = actual.map(function (value, index) { return value === '' ? index + 1 : null; }).filter(Boolean);
  const namesMatch = actual.length === PHASE45.HEADERS.length && actual.every(function (value, index) { return value === PHASE45.HEADERS[index]; });
  const valid = actual.length === 14 && PHASE45.HEADERS.length === 14 && namesMatch && blanks.length === 0 && duplicates.length === 0;
  return {
    success: valid,
    serviceVersion: PHASE45.SERVICE_VERSION,
    code: valid ? 'SCHEMA_OK' : 'SCHEMA_MISMATCH',
    columnCount: actual.length,
    headers: actual,
    expectedHeaders: PHASE45.HEADERS,
    blanks: blanks,
    duplicates: duplicates,
    namesAndOrderMatch: namesMatch
  };
}

function authenticate45_(token) {
  const expected = PropertiesService.getScriptProperties().getProperty(PHASE45.TOKEN_PROPERTY);
  if (!expected || String(token || '') !== expected) throw new Error('UNAUTHORIZED');
}

function assertSchema46_() {
  const schema = schemaResponse46_();
  if (!schema.success) throw new Error('INVALID_SYNC_SHEET_SCHEMA');
}

function batchWrite45_(body, started) {
  const ops = Array.isArray(body.operations) ? body.operations : [];
  if (!ops.length || ops.length > PHASE45.MAX_BATCH_SIZE) return {success:false,serviceVersion:PHASE45.SERVICE_VERSION,code:'INVALID_BATCH_SIZE',results:[]};
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    assertSchema46_();
    const sheet = SpreadsheetApp.openById(PHASE45.SPREADSHEET_ID).getSheetByName(PHASE45.SHEET_NAME);
    const values = sheet.getDataRange().getValues();
    const byRequest = new Map(), versions = new Map();
    for (let i=1; i<values.length; i++) {
      byRequest.set(String(values[i][5]), i);
      if (String(values[i][9]) === 'SAVED') {
        const key = [values[i][1],values[i][2],values[i][3]].join('|');
        versions.set(key, Math.max(Number(versions.get(key)||0), Number(values[i][12]||0)));
      }
    }
    const results = [];
    ops.forEach(function (op) {
      const requestId = String(op.requestId || '');
      try {
        if (String(op.studentId) !== PHASE45.TEST_STUDENT_ID) throw new Error('TEST_STUDENT_ONLY');
        if (!requestId || !op.operationType || !op.recordId) throw new Error('INVALID_OPERATION');
        const existingIndex = byRequest.get(requestId);
        if (existingIndex !== undefined && String(values[existingIndex][9]) === 'SAVED') {
          results.push({requestId:requestId,ok:true,duplicate:true,version:Number(values[existingIndex][12]),updatedAt:String(values[existingIndex][11])});
          return;
        }
        const key = [op.studentId,op.operationType,op.recordId].join('|');
        const version = Number(versions.get(key)||0)+1, now = new Date().toISOString();
        const row = [String(op.syncId||''),String(op.studentId),String(op.operationType),String(op.recordId),JSON.stringify(op.payload||{}),requestId,1,'','','SAVED',now,now,version,String(op.recordState||'ACTIVE')];
        if (existingIndex !== undefined) values[existingIndex] = row;
        else { values.push(row); byRequest.set(requestId, values.length-1); }
        versions.set(key, version);
        results.push({requestId:requestId,ok:true,version:version,updatedAt:now});
      } catch (error) {
        results.push({requestId:requestId,ok:false,error:String(error && error.message || error)});
      }
    });
    sheet.getRange(1,1,values.length,PHASE45.HEADERS.length).setValues(values);
    SpreadsheetApp.flush();
    return {success:results.every(function(r){return r.ok;}),serviceVersion:PHASE45.SERVICE_VERSION,batchId:String(body.batchId||''),results:results,googleMs:Date.now()-started};
  } finally { lock.releaseLock(); }
}

function batchRead46_(body) {
  if (String(body.studentId||'') !== PHASE45.TEST_STUDENT_ID) return {success:false,serviceVersion:PHASE45.SERVICE_VERSION,code:'TEST_STUDENT_ONLY',rows:[]};
  const ids = Array.isArray(body.requestIds) ? body.requestIds.map(String) : [];
  if (!ids.length || ids.length > PHASE45.MAX_BATCH_SIZE) return {success:false,serviceVersion:PHASE45.SERVICE_VERSION,code:'INVALID_BATCH_SIZE',rows:[]};
  assertSchema46_();
  const sheet = SpreadsheetApp.openById(PHASE45.SPREADSHEET_ID).getSheetByName(PHASE45.SHEET_NAME);
  const values = sheet.getDataRange().getValues(), wanted = new Set(ids), rows = [];
  for (let i=1; i<values.length; i++) {
    if (!wanted.has(String(values[i][5]))) continue;
    const row = {};
    PHASE45.HEADERS.forEach(function(h,j){row[h]=values[i][j];});
    try { row.payload = JSON.parse(String(row.payload||'{}')); } catch (error) { row.payload = {}; }
    rows.push(row);
  }
  return {success:true,serviceVersion:PHASE45.SERVICE_VERSION,headers:PHASE45.HEADERS,rows:rows};
}

function json45_(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}

