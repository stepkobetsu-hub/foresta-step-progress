-- Phase 1: read-only mirror schema for learning progress.
-- No production writes are enabled by this migration.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS students (
  student_id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL DEFAULT '',
  name_kana TEXT NOT NULL DEFAULT '',
  school TEXT NOT NULL DEFAULT '',
  grade TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  source_updated_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  version INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS student_profiles (
  student_id TEXT PRIMARY KEY REFERENCES students(student_id) ON DELETE CASCADE,
  campus TEXT NOT NULL DEFAULT '',
  school_name TEXT NOT NULL DEFAULT '',
  grade_j_raw TEXT NOT NULL DEFAULT '',
  grade_k_raw TEXT NOT NULL DEFAULT '',
  grade_conflict INTEGER NOT NULL DEFAULT 0 CHECK (grade_conflict IN (0,1)),
  enrollment_status TEXT NOT NULL DEFAULT '',
  source_updated_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  version INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS materials (
  material_id TEXT PRIMARY KEY,
  series TEXT NOT NULL,
  subject TEXT NOT NULL,
  grade TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL,
  has_lct INTEGER NOT NULL DEFAULT 1 CHECK (has_lct IN (0,1)),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  version INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS units (
  unit_id TEXT PRIMARY KEY,
  material_id TEXT NOT NULL REFERENCES materials(material_id),
  subject TEXT NOT NULL,
  grade TEXT NOT NULL DEFAULT '',
  unit_order INTEGER NOT NULL DEFAULT 0,
  unit_type TEXT NOT NULL DEFAULT 'normal',
  title TEXT NOT NULL,
  has_lct INTEGER NOT NULL DEFAULT 1 CHECK (has_lct IN (0,1)),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  version INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS student_targets (
  target_id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL REFERENCES students(student_id) ON DELETE CASCADE,
  material_id TEXT REFERENCES materials(material_id),
  subject TEXT NOT NULL,
  target_start TEXT,
  target_end TEXT,
  target_period TEXT,
  included INTEGER NOT NULL DEFAULT 1 CHECK (included IN (0,1)),
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1,
  UNIQUE(student_id, material_id, subject, target_period)
);

CREATE TABLE IF NOT EXISTS progress_records (
  record_id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL REFERENCES students(student_id) ON DELETE CASCADE,
  material_id TEXT REFERENCES materials(material_id),
  subject TEXT NOT NULL,
  grade TEXT NOT NULL DEFAULT '',
  unit_id TEXT NOT NULL REFERENCES units(unit_id),
  round INTEGER NOT NULL DEFAULT 1,
  point_confirmed INTEGER NOT NULL DEFAULT 0 CHECK (point_confirmed IN (0,1)),
  warmup_confirmed INTEGER NOT NULL DEFAULT 0 CHECK (warmup_confirmed IN (0,1)),
  try_completed INTEGER NOT NULL DEFAULT 0 CHECK (try_completed IN (0,1)),
  memorization_completed INTEGER NOT NULL DEFAULT 0 CHECK (memorization_completed IN (0,1)),
  exercise_completed INTEGER NOT NULL DEFAULT 0 CHECK (exercise_completed IN (0,1)),
  lct_result TEXT NOT NULL DEFAULT '',
  learning_date TEXT,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1,
  request_id TEXT,
  UNIQUE(student_id, unit_id, round)
);

CREATE TABLE IF NOT EXISTS homework_records (
  homework_id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL REFERENCES students(student_id) ON DELETE CASCADE,
  material_id TEXT REFERENCES materials(material_id),
  subject TEXT NOT NULL,
  unit_id TEXT NOT NULL REFERENCES units(unit_id),
  assigned_date TEXT,
  due_date TEXT,
  completed_date TEXT,
  correction_date TEXT,
  review_date TEXT,
  archived_at TEXT,
  restored_at TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING',
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1,
  request_id TEXT
);

CREATE TABLE IF NOT EXISTS homework_archives (
  archive_id TEXT PRIMARY KEY,
  homework_id TEXT NOT NULL REFERENCES homework_records(homework_id) ON DELETE CASCADE,
  student_id TEXT NOT NULL REFERENCES students(student_id) ON DELETE CASCADE,
  archived_at TEXT NOT NULL,
  restored_at TEXT,
  archived_by TEXT NOT NULL DEFAULT '',
  restored_by TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1,
  request_id TEXT UNIQUE
);

CREATE TABLE IF NOT EXISTS staff_permissions (
  staff_id TEXT PRIMARY KEY,
  role TEXT NOT NULL,
  permission_level INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  version INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS sessions (
  session_id_hash TEXT PRIMARY KEY,
  subject_id TEXT NOT NULL,
  subject_type TEXT NOT NULL CHECK (subject_type IN ('STUDENT','STAFF')),
  role TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at TEXT
);

CREATE TABLE IF NOT EXISTS operation_logs (
  operation_id TEXT PRIMARY KEY,
  request_id TEXT UNIQUE,
  actor_id TEXT NOT NULL DEFAULT '',
  actor_role TEXT NOT NULL DEFAULT '',
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL DEFAULT '',
  entity_id TEXT NOT NULL DEFAULT '',
  outcome TEXT NOT NULL,
  detail_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sync_status (
  sync_key TEXT PRIMARY KEY,
  source_system TEXT NOT NULL DEFAULT 'GOOGLE',
  last_started_at TEXT,
  last_completed_at TEXT,
  source_cursor TEXT,
  row_count INTEGER NOT NULL DEFAULT 0,
  checksum TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'PENDING',
  error_summary TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_students_school_grade ON students(school, grade);
CREATE INDEX IF NOT EXISTS idx_students_status_grade ON students(status, grade);
CREATE INDEX IF NOT EXISTS idx_students_name_kana ON students(name_kana);
CREATE INDEX IF NOT EXISTS idx_materials_subject_grade ON materials(subject, grade);
CREATE INDEX IF NOT EXISTS idx_units_material_order ON units(material_id, unit_order);
CREATE INDEX IF NOT EXISTS idx_units_subject_grade ON units(subject, grade);
CREATE INDEX IF NOT EXISTS idx_targets_student_material ON student_targets(student_id, material_id);
CREATE INDEX IF NOT EXISTS idx_targets_student_subject ON student_targets(student_id, subject);
CREATE INDEX IF NOT EXISTS idx_progress_student_material ON progress_records(student_id, material_id);
CREATE INDEX IF NOT EXISTS idx_progress_student_subject ON progress_records(student_id, subject);
CREATE INDEX IF NOT EXISTS idx_progress_student_updated ON progress_records(student_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_homework_student_status ON homework_records(student_id, status);
CREATE INDEX IF NOT EXISTS idx_homework_student_archived ON homework_records(student_id, archived_at);
CREATE INDEX IF NOT EXISTS idx_homework_status_updated ON homework_records(status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_archives_student_archived ON homework_archives(student_id, archived_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_subject_expiry ON sessions(subject_id, expires_at);
CREATE INDEX IF NOT EXISTS idx_operations_actor_created ON operation_logs(actor_id, created_at DESC);
