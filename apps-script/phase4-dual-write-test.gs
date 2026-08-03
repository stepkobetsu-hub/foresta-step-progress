Exit code: 0
Wall time: 2 seconds
Output:
const PHASE45 = Object.freeze({
  SPREADSHEET_ID:'1axZz8nGy15srgo2DVladaY_KQ3XXVbNrOrk3zL1GqaI', SHEET_NAME:'Cloudflare蜷梧悄讀懆ｨｼ',
  TEST_STUDENT_ID:'TEST-STUDENT-01', TOKEN_PROPERTY:'PHASE4_DUAL_WRITE_TOKEN', MAX_BATCH_SIZE:25,
  HEADERS:['sync_id','student_id','operation_type','record_id','payload','request_id','attempt_count','last_error','next_retry_at','status','created_at','updated_at','version','record_state']
});
function doPost(e){const started=Date.now();try{const b=JSON.parse((e&&e.postData&&e.postData.contents)||'{}');authenticate45_(b.token);if(b.action!=='batchWrite')return json45_({success:false,code:'METHOD_NOT_ALLOWED'});return json45_(batchWrite45_(b,started));}catch(x){return json45_({success:false,code:'INTERNAL_ERROR',error:String(x&&x.message||x)});}}
function authenticate45_(token){const expected=PropertiesService.getScriptProperties().getProperty(PHASE45.TOKEN_PROPERTY);if(!expected||String(token||'')!==expected)throw new Error('UNAUTHORIZED');}
function batchWrite45_(body,started){const ops=Array.isArray(body.operations)?body.operations:[];if(!ops.length||ops.length>PHASE45.MAX_BATCH_SIZE)return{success:false,code:'INVALID_BATCH_SIZE',results:[]};const lock=LockService.getScriptLock();lock.waitLock(20000);try{
  const sheet=SpreadsheetApp.openById(PHASE45.SPREADSHEET_ID).getSheetByName(PHASE45.SHEET_NAME);if(!sheet)throw new Error('SYNC_SHEET_NOT_FOUND');
  const values=sheet.getDataRange().getValues();if(values[0].map(String).join('|')!==PHASE45.HEADERS.join('|'))throw new Error('INVALID_SYNC_SHEET_SCHEMA');
  const byRequest=new Map(),versions=new Map();for(let i=1;i<values.length;i++){byRequest.set(String(values[i][5]),i);if(String(values[i][9])==='SAVED'){const k=[values[i][1],values[i][2],values[i][3]].join('|');versions.set(k,Math.max(Number(versions.get(k)||0),Number(values[i][12]||0)));}}
  const results=[];ops.forEach(op=>{const requestId=String(op.requestId||'');try{if(String(op.studentId)!==PHASE45.TEST_STUDENT_ID)throw new Error('TEST_STUDENT_ONLY');if(!requestId||!op.operationType||!op.recordId)throw new Error('INVALID_OPERATION');const existingIndex=byRequest.get(requestId);if(existingIndex!==undefined&&String(values[existingIndex][9])==='SAVED'){results.push({requestId,ok:true,duplicate:true,version:Number(values[existingIndex][12]),updatedAt:String(values[existingIndex][11])});return;}
    const key=[op.studentId,op.operationType,op.recordId].join('|'),version=Number(versions.get(key)||0)+1,now=new Date().toISOString();const row=[String(op.syncId||''),String(op.studentId),String(op.operationType),String(op.recordId),JSON.stringify(op.payload||{}),requestId,1,'','','SAVED',now,now,version,String(op.recordState||'ACTIVE')];
    if(existingIndex!==undefined)values[existingIndex]=row;else{values.push(row);byRequest.set(requestId,values.length-1);}versions.set(key,version);results.push({requestId,ok:true,version,updatedAt:now});
  }catch(x){results.push({requestId,ok:false,error:String(x&&x.message||x)});}});
  sheet.getRange(1,1,values.length,PHASE45.HEADERS.length).setValues(values);SpreadsheetApp.flush();return{success:results.every(r=>r.ok),batchId:String(body.batchId||''),results,googleMs:Date.now()-started};
}finally{lock.releaseLock();}}
function json45_(v){return ContentService.createTextOutput(JSON.stringify(v)).setMimeType(ContentService.MimeType.JSON);}

