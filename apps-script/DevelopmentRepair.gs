function repairDevelopmentStandardRanges() {
  if (!isDevelopment_()) throw new Error('開発環境以外では実行できません。');
  const sheet = getSheet_('StandardRanges');
  if (sheet.getLastRow() > 1) {
    sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).clearContent();
  }
  const now = nowIso_();
  const records = UNIT_MASTER_SEED
    .filter(unit => unit.standardEligible)
    .flatMap(unit => {
      const grades = unit.gradeScope === '中1～中3共通' ? ['中1','中2','中3'] : [unit.gradeScope];
      return grades.map(grade => ({
        standardRangeId: Utilities.getUuid(),
        masterVersion: unit.masterVersion,
        grade,
        subject: unit.subject,
        unitId: unit.unitId,
        included: true,
        createdAt: now,
        updatedAt: now,
        updatedBy: 'SYSTEM_REPAIR'
      }));
    });
  const headers = DB_SCHEMAS.StandardRanges;
  const values = records.map(record =>
    headers.map(header => record[header] == null ? '' : record[header])
  );
  sheet.getRange(2, 1, values.length, headers.length).setValues(values);
  seedDevelopmentProfiles_();
  return {
    success: true,
    standardRangeCount: values.length,
    summaryStandardCount: records.filter(record => {
      const unit = UNIT_MASTER_SEED.find(item => item.unitId === record.unitId);
      return unit && unit.unitType === 'SUMMARY';
    }).length,
    preStepStandardCount: records.filter(record => {
      const unit = UNIT_MASTER_SEED.find(item => item.unitId === record.unitId);
      return unit && unit.unitType === 'PRE_STEP';
    }).length
  };
}

function logDevelopmentDataCounts() {
  if (!isDevelopment_()) throw new Error('開発環境以外では実行できません。');
  const units = getRowsAsObjects_('Units');
  const ranges = getRowsAsObjects_('StandardRanges');
  const bySubject = {};
  units.forEach(unit => {
    bySubject[unit.subject] = (bySubject[unit.subject] || 0) + 1;
  });
  const result = {
    units: units.length,
    summaries: units.filter(unit => unit.unitType === 'SUMMARY').length,
    preSteps: units.filter(unit => unit.unitType === 'PRE_STEP').length,
    standardRanges: ranges.length,
    summaryStandardRanges: ranges.filter(range => {
      const unit = units.find(item => item.unitId === range.unitId);
      return unit && unit.unitType === 'SUMMARY';
    }).length,
    preStepStandardRanges: ranges.filter(range => {
      const unit = units.find(item => item.unitId === range.unitId);
      return unit && unit.unitType === 'PRE_STEP';
    }).length,
    bySubject
  };
  console.log(JSON.stringify(result));
  return result;
}

function repairDevelopmentUnitDisplayFields() {
  if (!isDevelopment_()) throw new Error('開発環境以外では実行できません。');
  const sheet = getSheet_('Units');
  const headers = DB_SCHEMAS.Units;
  const rows = getRowsAsObjects_('Units');
  const seedById = new Map(UNIT_MASTER_SEED.map(unit => [String(unit.unitId), unit]));
  const fields = ['section','chapter','difficulty','stepCode','unitTitle'];
  fields.forEach(field => {
    const column = headers.indexOf(field) + 1;
    const values = rows.map(row => {
      const seed = seedById.get(String(row.unitId));
      return [seed && seed[field] != null ? String(seed[field]) : ''];
    });
    sheet.getRange(2, column, values.length, 1).setNumberFormat('@').setValues(values);
  });
  return {success: true, repairedUnits: rows.length, fields};
}

function runAndLogDevelopmentIntegrationTests() {
  if (!isDevelopment_()) throw new Error('開発環境以外では実行できません。');
  const result = runDevelopmentIntegrationTests();
  console.log(JSON.stringify(result));
  return result;
}

function migrateDevelopmentLearningWorkflowSchema() {
  if (!isDevelopment_()) throw new Error('開発環境以外では実行できません。');
  const sheet = ensureSheet_(
    getDb_(),
    SHEET_NAMES.UnitProgress,
    DB_SCHEMAS.UnitProgress
  );
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
  const required = [
    'lctResult', 'lctDate', 'learningDate',
    'pointCompletedAt', 'warmupCompletedAt', 'tryCompletedAt'
  ];
  const result = {
    success: required.every(header => headers.includes(header)),
    addedColumns: required,
    unitProgressColumns: headers.length
  };
  console.log(JSON.stringify(result));
  return result;
}

function backupDevelopmentProgressDatabase() {
  if (!isDevelopment_()) throw new Error('開発環境以外では実行できません。');
  const source = DriveApp.getFileById(getRequiredProperty_(PROP.PROGRESS_DB_SS_ID));
  const stamp = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyyMMdd-HHmmss');
  const copy = source.makeCopy(source.getName() + '【変更前バックアップ-' + stamp + '】');
  const result = {success: true, backupFileId: copy.getId(), backupName: copy.getName()};
  console.log(JSON.stringify(result));
  return result;
}

function migrateDevelopmentRoundSchema() {
  if (!isDevelopment_()) throw new Error('開発環境以外では実行できません。');
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    ensureSheet_(getDb_(), SHEET_NAMES.UnitProgress, DB_SCHEMAS.UnitProgress);
    ensureSheet_(getDb_(), SHEET_NAMES.Homework, DB_SCHEMAS.Homework);
    const progress = getRowsAsObjects_('UnitProgress');
    const homework = getRowsAsObjects_('Homework');
    const progressKeys = new Set();
    const homeworkKeys = new Set();
    const migratedProgress = progress.map(row => {
      const next = Object.assign({}, row, {
        schoolYear: row.schoolYear || SCHOOL_YEAR,
        roundNumber: row.roundNumber || 1
      });
      const key = [
        String(next.studentId), String(next.schoolYear),
        String(next.unitId), String(next.roundNumber)
      ].join('|');
      if (progressKeys.has(key)) throw new Error('進捗の周回キーが重複するため移行を中止しました: ' + key);
      progressKeys.add(key);
      return next;
    });
    const migratedHomework = homework.map(row => {
      const assignedDate = dateOnly_(row.assignedDate || row.createdAt);
      const completedAt = row.studentCompletedAt ||
        (row.studentStatus === 'DECLARED_DONE' ? (row.studentUpdatedAt || row.updatedAt) : '');
      const noTargetAt = row.studentNoTargetAt ||
        (row.studentStatus === 'NO_TARGET_CLAIM' ? (row.studentUpdatedAt || row.updatedAt) : '');
      const next = Object.assign({}, row, {
        schoolYear: row.schoolYear || SCHOOL_YEAR,
        roundNumber: row.roundNumber || 1,
        assignedDate,
        studentCompletedAt: completedAt,
        studentCompletedDate: dateOnly_(row.studentCompletedDate || completedAt),
        studentNoTargetAt: noTargetAt,
        studentNoTargetDate: dateOnly_(row.studentNoTargetDate || noTargetAt)
      });
      const key = [
        String(next.studentId), String(next.schoolYear), String(next.unitId),
        String(next.roundNumber), String(next.assignedDate), String(next.homeworkType)
      ].join('|');
      if (homeworkKeys.has(key)) throw new Error('宿題の周回キーが重複するため移行を中止しました: ' + key);
      homeworkKeys.add(key);
      return next;
    });
    replaceAllObjectRowsFast_('UnitProgress', migratedProgress, progress.length);
    replaceAllObjectRowsFast_('Homework', migratedHomework, homework.length);
    appendAuditFast_(
      {userType: 'SYSTEM', userId: 'DEVELOPMENT_MIGRATION', role: 'ADMIN'},
      'MIGRATE_ROUND_SCHEMA',
      'Database',
      String(SCHOOL_YEAR),
      {unitProgressCount: progress.length, homeworkCount: homework.length},
      {unitProgressCount: migratedProgress.length, homeworkCount: migratedHomework.length, defaultRound: 1}
    );
    const result = {
      success: true,
      schoolYear: SCHOOL_YEAR,
      unitProgressCount: migratedProgress.length,
      homeworkCount: migratedHomework.length,
      unitProgressRound1Count: migratedProgress.filter(row => Number(row.roundNumber) === 1).length,
      homeworkRound1Count: migratedHomework.filter(row => Number(row.roundNumber) === 1).length
    };
    console.log(JSON.stringify(result));
    return result;
  } finally {
    lock.releaseLock();
  }
}

function migrateDevelopmentUnitTypesAndStandardRanges() {
  if (!isDevelopment_()) throw new Error('開発環境以外では実行できません。');
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const units = getRowsAsObjects_('Units');
    const rangesBefore = getRowsAsObjects_('StandardRanges');
    const targetsBefore = getRowsAsObjects_('StudentTargets');
    const targetFingerprintBefore = fingerprintStudentTargets_(targetsBefore);
    const seedById = new Map(UNIT_MASTER_SEED.map(unit => [String(unit.unitId), unit]));
    if (units.length !== 574 || seedById.size !== 574) {
      throw new Error('単元マスタ574件を確認できないため移行を中止しました。');
    }

    const unitSheet = getSheet_('Units');
    const unitHeaders = DB_SCHEMAS.Units;
    const unitTypeColumn = unitHeaders.indexOf('unitType') + 1;
    const eligibleColumn = unitHeaders.indexOf('standardEligible') + 1;
    const unitTypeValues = units.map(row => {
      const seed = seedById.get(String(row.unitId));
      if (!seed) throw new Error('移行対象の単元IDが原本シードにありません: ' + row.unitId);
      return [seed.unitType];
    });
    const eligibleValues = units.map(row => {
      const seed = seedById.get(String(row.unitId));
      return [seed.standardEligible];
    });
    unitSheet.getRange(2, unitTypeColumn, unitTypeValues.length, 1).setValues(unitTypeValues);
    unitSheet.getRange(2, eligibleColumn, eligibleValues.length, 1).setValues(eligibleValues);

    const rangeSheet = getSheet_('StandardRanges');
    if (rangeSheet.getLastRow() > 1) {
      rangeSheet.getRange(2, 1, rangeSheet.getLastRow() - 1, rangeSheet.getLastColumn()).clearContent();
    }
    const now = nowIso_();
    const ranges = UNIT_MASTER_SEED
      .filter(unit => unit.standardEligible)
      .flatMap(unit => {
        const grades = unit.gradeScope === '中1～中3共通' ? ['中1','中2','中3'] : [unit.gradeScope];
        return grades.map(grade => ({
          standardRangeId: Utilities.getUuid(),
          masterVersion: unit.masterVersion,
          grade,
          subject: unit.subject,
          unitId: unit.unitId,
          included: true,
          createdAt: now,
          updatedAt: now,
          updatedBy: 'SYSTEM_PRESTEP_MIGRATION'
        }));
      });
    const rangeHeaders = DB_SCHEMAS.StandardRanges;
    const rangeValues = ranges.map(record =>
      rangeHeaders.map(header => record[header] == null ? '' : record[header])
    );
    rangeSheet.getRange(2, 1, rangeValues.length, rangeHeaders.length).setValues(rangeValues);

    const targetsAfter = getRowsAsObjects_('StudentTargets');
    const targetFingerprintAfter = fingerprintStudentTargets_(targetsAfter);
    const migratedUnits = getRowsAsObjects_('Units');
    const migratedRanges = getRowsAsObjects_('StandardRanges');
    const migratedUnitById = new Map(migratedUnits.map(unit => [String(unit.unitId), unit]));
    const result = {
      success:
        migratedUnits.length === 574 &&
        migratedUnits.filter(unit => String(unit.unitType) === 'NORMAL').length === 479 &&
        migratedUnits.filter(unit => String(unit.unitType) === 'PRE_STEP').length === 65 &&
        migratedUnits.filter(unit => String(unit.unitType) === 'SUMMARY').length === 30 &&
        migratedRanges.length === 889 &&
        migratedRanges.filter(range =>
          String((migratedUnitById.get(String(range.unitId)) || {}).unitType) === 'PRE_STEP'
        ).length === 0 &&
        targetsBefore.length === targetsAfter.length &&
        targetFingerprintBefore === targetFingerprintAfter,
      unitCounts: {
        total: migratedUnits.length,
        normal: migratedUnits.filter(unit => String(unit.unitType) === 'NORMAL').length,
        preStep: migratedUnits.filter(unit => String(unit.unitType) === 'PRE_STEP').length,
        summary: migratedUnits.filter(unit => String(unit.unitType) === 'SUMMARY').length
      },
      standardRangeCounts: {
        before: rangesBefore.length,
        summaryAdditionGross: 42,
        preStepRemoval: 65,
        after: migratedRanges.length,
        summary: migratedRanges.filter(range =>
          String((migratedUnitById.get(String(range.unitId)) || {}).unitType) === 'SUMMARY'
        ).length,
        preStep: migratedRanges.filter(range =>
          String((migratedUnitById.get(String(range.unitId)) || {}).unitType) === 'PRE_STEP'
        ).length
      },
      studentTargets: {
        before: targetsBefore.length,
        after: targetsAfter.length,
        fingerprintPreserved: targetFingerprintBefore === targetFingerprintAfter
      }
    };
    if (!result.success) throw new Error('単元分類または標準範囲の移行後検証に失敗しました。');
    appendObject_('AuditLog', {
      auditId: Utilities.getUuid(),
      actorType: 'SYSTEM',
      actorId: 'SYSTEM_PRESTEP_MIGRATION',
      actorRole: 'ADMIN',
      action: 'MIGRATE_UNIT_TYPES_AND_STANDARD_RANGES',
      entityType: 'SYSTEM',
      entityId: MASTER_VERSION,
      beforeJson: JSON.stringify({
        environment: 'development',
        standardRangeCount: rangesBefore.length,
        studentTargetCount: targetsBefore.length,
        studentTargetFingerprint: targetFingerprintBefore
      }),
      afterJson: JSON.stringify(result),
      createdAt: nowIso_()
    });
    console.log(JSON.stringify(result));
    return result;
  } finally {
    lock.releaseLock();
  }
}

function migrateDevelopmentUnitOrderAndChapters() {
  if (!isDevelopment_()) throw new Error('開発環境以外では実行できません。');
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const sheet = ensureSheet_(getDb_(), SHEET_NAMES.Units, DB_SCHEMAS.Units);
    const unitsBefore = getRowsAsObjects_('Units');
    const rangesBefore = getRowsAsObjects_('StandardRanges');
    const targetsBefore = getRowsAsObjects_('StudentTargets');
    const seedById = new Map(UNIT_MASTER_SEED.map(unit => [String(unit.unitId), unit]));
    const unitIdFingerprintBefore = fingerprintUnitIds_(unitsBefore);
    const rangeFingerprintBefore = fingerprintStandardRanges_(rangesBefore);
    const targetFingerprintBefore = fingerprintStudentTargets_(targetsBefore);
    if (
      unitsBefore.length !== 574 ||
      seedById.size !== 574 ||
      unitsBefore.some(row => !seedById.has(String(row.unitId)))
    ) {
      throw new Error('単元ID574件が原本シードと一致しないため、順序復旧を中止しました。');
    }

    const orderedFields = [
      'sourceSheetOrder','sourceRowNumber','originalDisplayOrder',
      'sectionOrder','unitOrder','chapterId','chapterLabel'
    ];
    const displayOrderColumn = DB_SCHEMAS.Units.indexOf('displayOrder') + 1;
    const orderedFieldStartColumn = DB_SCHEMAS.Units.indexOf(orderedFields[0]) + 1;
    const displayValues = unitsBefore.map(row => [seedById.get(String(row.unitId)).displayOrder]);
    const metadataValues = unitsBefore.map(row => {
      const seed = seedById.get(String(row.unitId));
      return orderedFields.map(field => seed[field] == null ? '' : seed[field]);
    });
    sheet.getRange(2, displayOrderColumn, displayValues.length, 1).setValues(displayValues);
    sheet.getRange(2, orderedFieldStartColumn, metadataValues.length, orderedFields.length)
      .setValues(metadataValues);

    const unitsAfter = getRowsAsObjects_('Units');
    const rangesAfter = getRowsAsObjects_('StandardRanges');
    const targetsAfter = getRowsAsObjects_('StudentTargets');
    const result = {
      success:
        unitsAfter.length === 574 &&
        fingerprintUnitIds_(unitsAfter) === unitIdFingerprintBefore &&
        fingerprintStandardRanges_(rangesAfter) === rangeFingerprintBefore &&
        fingerprintStudentTargets_(targetsAfter) === targetFingerprintBefore &&
        unitsAfter.every(row => {
          const seed = seedById.get(String(row.unitId));
          return seed &&
            Number(row.displayOrder) === Number(seed.displayOrder) &&
            String(row.chapterId) === String(seed.chapterId) &&
            String(row.chapterLabel) === String(seed.chapterLabel);
        }),
      units: unitsAfter.length,
      unitIdsPreserved: fingerprintUnitIds_(unitsAfter) === unitIdFingerprintBefore,
      standardRanges: {
        before: rangesBefore.length,
        after: rangesAfter.length,
        fingerprintPreserved: fingerprintStandardRanges_(rangesAfter) === rangeFingerprintBefore
      },
      studentTargets: {
        before: targetsBefore.length,
        after: targetsAfter.length,
        fingerprintPreserved: fingerprintStudentTargets_(targetsAfter) === targetFingerprintBefore
      },
      updatedFields: ['displayOrder'].concat(orderedFields)
    };
    if (!result.success) throw new Error('順序復旧後の保持検証に失敗しました。');
    appendObject_('AuditLog', {
      auditId: Utilities.getUuid(),
      actorType: 'SYSTEM',
      actorId: 'SYSTEM_UNIT_ORDER_RESTORE',
      actorRole: 'ADMIN',
      action: 'RESTORE_UNIT_ORDER_AND_CHAPTERS',
      entityType: 'SYSTEM',
      entityId: MASTER_VERSION,
      beforeJson: JSON.stringify({
        environment: 'development',
        units: unitsBefore.length,
        unitIdFingerprint: unitIdFingerprintBefore,
        standardRangeFingerprint: rangeFingerprintBefore,
        studentTargetFingerprint: targetFingerprintBefore
      }),
      afterJson: JSON.stringify(result),
      createdAt: nowIso_()
    });
    console.log(JSON.stringify(result));
    return result;
  } finally {
    lock.releaseLock();
  }
}

function fingerprintUnitIds_(rows) {
  return digestSelection_(rows.map(row => String(row.unitId)));
}

function fingerprintStandardRanges_(rows) {
  const values = rows.map(row => [
    row.standardRangeId, row.masterVersion, row.grade, row.subject, row.unitId,
    row.included, row.createdAt, row.updatedAt, row.updatedBy
  ].map(value => String(value == null ? '' : value)).join('|')).sort();
  return digestSelection_(values);
}

function fingerprintStudentTargets_(rows) {
  const values = rows.map(row => [
    row.studentTargetId, row.studentId, row.masterVersion, row.subject,
    row.unitId, row.included, row.source, row.createdAt, row.updatedAt, row.updatedBy
  ].map(value => String(value == null ? '' : value)).join('|')).sort();
  return digestSelection_(values);
}

const ACCEPTANCE_TEST_CLEANUP_SPEC = Object.freeze({
  studentId: '1320',
  progressUnitId: '2026FS-MATH-G2-32d414b4c3',
  summaryUnitId: '2026FS-ENG-G1-dd63dfe6c8',
  startedAt: '2026-07-26T12:20:00.000Z',
  endedAt: '2026-07-26T13:10:00.000Z',
  sessionUserIds: ['1320', 'TEST-STUDENT-02', 'TEST-TEACHER-01', 'TEST-ADMIN-01']
});

/**
 * 第2.5段階の受入試験データを、削除前後に同じ条件で確認する。
 * セッショントークンのハッシュや認証情報は戻り値・ログへ出さない。
 */
function inspectAcceptanceTestData() {
  if (!isDevelopment_()) throw new Error('開発環境以外では実行できません。');
  const spec = ACCEPTANCE_TEST_CLEANUP_SPEC;
  const units = getRowsAsObjects_('Units');
  const unitById = new Map(units.map(row => [String(row.unitId), row]));
  const standardRanges = getRowsAsObjects_('StandardRanges');
  const progress = getRowsAsObjects_('UnitProgress').filter(row =>
    String(row.studentId) === spec.studentId &&
    String(row.unitId) === spec.progressUnitId &&
    isAcceptanceTimestamp_(row.studentUpdatedAt || row.updatedAt)
  );
  const homework = getRowsAsObjects_('Homework').filter(row =>
    String(row.studentId) === spec.studentId &&
    String(row.unitId) === spec.progressUnitId &&
    isAcceptanceTimestamp_(row.createdAt)
  );
  const targets = getRowsAsObjects_('StudentTargets').filter(row =>
    String(row.studentId) === spec.studentId &&
    String(row.unitId) === spec.summaryUnitId &&
    isAcceptanceTimestamp_(row.createdAt || row.updatedAt)
  );
  const sessions = getRowsAsObjects_('Sessions').filter(row =>
    spec.sessionUserIds.includes(String(row.userId)) &&
    isAcceptanceTimestamp_(row.issuedAt)
  );
  const auditLog = getRowsAsObjects_('AuditLog');
  const evidenceActions = [
    'CREATE_PROGRESS', 'UPDATE_PROGRESS', 'DECLARE_HOMEWORK',
    'CONFIRM_HOMEWORK', 'SET_STUDENT_TARGET', 'LOGOUT'
  ];
  const evidence = auditLog.filter(row =>
    evidenceActions.includes(String(row.action)) &&
    (
      String(row.actorId) === spec.studentId ||
      String(row.entityId) === spec.studentId ||
      acceptanceJsonMentionsStudent_(row.beforeJson, spec.studentId) ||
      acceptanceJsonMentionsStudent_(row.afterJson, spec.studentId)
    ) &&
    isAcceptanceTimestamp_(row.createdAt)
  );
  const result = {
    environment: 'development',
    operationType: 'ACCEPTANCE_TEST',
    targetStudentId: spec.studentId,
    acceptanceWindow: {startedAt: spec.startedAt, endedAt: spec.endedAt},
    progress: progress.map(row => ({
      rowNumber: row._rowNumber,
      progressId: String(row.progressId),
      studentId: String(row.studentId),
      unitId: String(row.unitId),
      studentUpdatedAt: toAcceptanceIso_(row.studentUpdatedAt),
      updatedAt: toAcceptanceIso_(row.updatedAt)
    })),
    homework: homework.map(row => ({
      rowNumber: row._rowNumber,
      homeworkId: String(row.homeworkId),
      studentId: String(row.studentId),
      unitId: String(row.unitId),
      homeworkType: String(row.homeworkType),
      createdAt: toAcceptanceIso_(row.createdAt)
    })),
    studentTargets: targets.map(row => ({
      rowNumber: row._rowNumber,
      studentTargetId: String(row.studentTargetId),
      studentId: String(row.studentId),
      unitId: String(row.unitId),
      included: isTrue_(row.included),
      createdAt: toAcceptanceIso_(row.createdAt)
    })),
    sessions: sessions.map(row => ({
      rowNumber: row._rowNumber,
      userType: String(row.userType),
      userId: String(row.userId),
      role: String(row.role),
      issuedAt: toAcceptanceIso_(row.issuedAt),
      expiresAt: toAcceptanceIso_(row.expiresAt),
      revoked: !!row.revokedAt
    })),
    auditEvidenceCount: evidence.length,
    auditEvidence: evidence.map(row => ({
      auditId: String(row.auditId),
      actorType: String(row.actorType),
      actorId: String(row.actorId),
      action: String(row.action),
      entityType: String(row.entityType),
      entityId: String(row.entityId),
      createdAt: toAcceptanceIso_(row.createdAt)
    })),
    cleanupMarkerCount: auditLog.filter(row =>
      String(row.action) === 'ACCEPTANCE_TEST_DATA_CLEANUP' &&
      String(row.entityId) === 'STUDENT:' + spec.studentId
    ).length,
    masterCounts: {
      units: units.length,
      summaries: units.filter(row => String(row.unitType) === 'SUMMARY').length,
      standardRanges: standardRanges.length,
      summaryStandardRanges: standardRanges.filter(row => {
        const unit = unitById.get(String(row.unitId));
        return unit && String(unit.unitType) === 'SUMMARY';
      }).length
    },
    targetCount: getStudentTargetUnitIds_(spec.studentId).length
  };
  console.log(JSON.stringify(result));
  return result;
}

/**
 * 第2.5段階の受入試験で作成した4区分だけを削除する。
 * 件数と種別が想定どおりでない場合は、何も削除せず停止する。
 */
function cleanupAcceptanceTestData() {
  if (!isDevelopment_()) throw new Error('開発環境以外では実行できません。');
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const before = inspectAcceptanceTestData();
    validateAcceptanceCleanupTargets_(before);

    deleteAcceptanceRows_('UnitProgress', before.progress.map(row => row.rowNumber));
    deleteAcceptanceRows_('Homework', before.homework.map(row => row.rowNumber));
    deleteAcceptanceRows_('StudentTargets', before.studentTargets.map(row => row.rowNumber));
    deleteAcceptanceRows_('Sessions', before.sessions.map(row => row.rowNumber));

    appendObject_('AuditLog', {
      auditId: Utilities.getUuid(),
      actorType: 'SYSTEM',
      actorId: 'ACCEPTANCE_CLEANUP',
      actorRole: 'ADMIN',
      action: 'ACCEPTANCE_TEST_DATA_CLEANUP',
      entityType: 'ACCEPTANCE_TEST',
      entityId: 'STUDENT:' + ACCEPTANCE_TEST_CLEANUP_SPEC.studentId,
      beforeJson: JSON.stringify({
        environment: 'development',
        operationType: 'ACCEPTANCE_TEST',
        targetStudentId: ACCEPTANCE_TEST_CLEANUP_SPEC.studentId,
        progressIds: before.progress.map(row => row.progressId),
        homeworkIds: before.homework.map(row => row.homeworkId),
        studentTargetIds: before.studentTargets.map(row => row.studentTargetId),
        sessionCount: before.sessions.length
      }),
      afterJson: JSON.stringify({
        acceptanceDataRemoved: true,
        auditHistoryPreserved: true
      }),
      createdAt: nowIso_()
    });

    const after = inspectAcceptanceTestData();
    validateAcceptanceCleanupResult_(after);
    const result = {success: true, before, after};
    console.log(JSON.stringify(result));
    return result;
  } finally {
    lock.releaseLock();
  }
}

function validateAcceptanceCleanupTargets_(snapshot) {
  const homeworkTypes = snapshot.homework.map(row => row.homeworkType).sort();
  const expectedHomeworkTypes = ['EXERCISE', 'TRY_REDO'];
  const master = snapshot.masterCounts;
  if (
    snapshot.progress.length !== 1 ||
    snapshot.homework.length !== 2 ||
    JSON.stringify(homeworkTypes) !== JSON.stringify(expectedHomeworkTypes) ||
    snapshot.studentTargets.length !== 1 ||
    snapshot.studentTargets[0].included !== true ||
    snapshot.sessions.length < 1 ||
    master.units !== UNIT_MASTER_SEED.length ||
    master.summaries !== 30 ||
    master.standardRanges !== 912 ||
    master.summaryStandardRanges !== 0 ||
    snapshot.targetCount !== 311
  ) {
    throw new Error('削除対象または保護対象の件数が想定と異なるため、削除を中止しました。');
  }
}

function validateAcceptanceCleanupResult_(snapshot) {
  const master = snapshot.masterCounts;
  if (
    snapshot.progress.length !== 0 ||
    snapshot.homework.length !== 0 ||
    snapshot.studentTargets.length !== 0 ||
    snapshot.sessions.length !== 0 ||
    snapshot.auditEvidenceCount < 1 ||
    snapshot.cleanupMarkerCount < 1 ||
    master.units !== UNIT_MASTER_SEED.length ||
    master.summaries !== 30 ||
    master.standardRanges !== 912 ||
    master.summaryStandardRanges !== 0 ||
    snapshot.targetCount !== 310
  ) {
    throw new Error('削除後の検証に失敗しました。開発DBを確認してください。');
  }
}

function deleteAcceptanceRows_(sheetName, rowNumbers) {
  const sheet = getSheet_(sheetName);
  rowNumbers.slice().sort((a, b) => b - a).forEach(rowNumber => sheet.deleteRow(rowNumber));
}

function isAcceptanceTimestamp_(value) {
  const time = new Date(value).getTime();
  return Number.isFinite(time) &&
    time >= new Date(ACCEPTANCE_TEST_CLEANUP_SPEC.startedAt).getTime() &&
    time <= new Date(ACCEPTANCE_TEST_CLEANUP_SPEC.endedAt).getTime();
}

function toAcceptanceIso_(value) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : String(value);
}

function acceptanceJsonMentionsStudent_(value, studentId) {
  return String(value || '').indexOf('"studentId":"' + studentId + '"') >= 0;
}

function setupDevelopmentPerformanceUpgrade() {
  if (!isDevelopment_()) throw new Error('開発環境専用です。');
  const db = getDb_();
  ensureSheet_(db, SHEET_NAMES.Milestones, DB_SCHEMAS.Milestones);
  ensureSheet_(db, SHEET_NAMES.UnitProgress, DB_SCHEMAS.UnitProgress);
  invalidateStaticDataCache_();
  return {
    success: true,
    environment: 'development',
    milestoneSheet: SHEET_NAMES.Milestones,
    unitProgressColumns: DB_SCHEMAS.UnitProgress.length
  };
}

function upgradeDevelopmentForGoalSeries() {
  if (!isDevelopment_()) throw new Error('開発環境専用です。');
  const result = setupDatabase();
  invalidateStaticDataCache_();
  const units = getRowsAsObjects_('Units');
  const goalUnits = units.filter(row => normalizeSeries_(row.series) === MATERIAL_SERIES.GOAL);
  const goalCounts = {};
  goalUnits.forEach(row => {
    const subject = String(row.subject);
    goalCounts[subject] = Number(goalCounts[subject] || 0) + 1;
  });
  return {
    success: true,
    environment: 'development',
    insertedUnits: result.insertedUnits,
    insertedStandardRanges: result.insertedStandardRanges,
    totalUnits: units.length,
    stepUnits: units.length - goalUnits.length,
    goalUnits: goalUnits.length,
    goalCounts,
    schemas: {
      Units: DB_SCHEMAS.Units.length,
      StandardRanges: DB_SCHEMAS.StandardRanges.length,
      StudentTargets: DB_SCHEMAS.StudentTargets.length,
      UnitProgress: DB_SCHEMAS.UnitProgress.length,
      Homework: DB_SCHEMAS.Homework.length
    }
  };
}

