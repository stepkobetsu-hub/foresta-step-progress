-- V3 fast autosave tables. These are deliberately small and independent from the legacy Google sync machinery.

CREATE TABLE IF NOT EXISTS v3_sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT '',
  profile_json TEXT NOT NULL DEFAULT '{}',
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_v3_sessions_expires ON v3_sessions(expires_at);

CREATE TABLE IF NOT EXISTS v3_target_overrides (
  student_id TEXT NOT NULL,
  series TEXT NOT NULL,
  subject TEXT NOT NULL,
  unit_id TEXT NOT NULL,
  included INTEGER NOT NULL CHECK (included IN (0, 1)),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (student_id, series, subject, unit_id)
);
CREATE INDEX IF NOT EXISTS idx_v3_target_student ON v3_target_overrides(student_id, subject, series);

CREATE TABLE IF NOT EXISTS v3_homework_overrides (
  student_id TEXT NOT NULL,
  homework_id TEXT NOT NULL,
  student_status TEXT,
  student_completed_date TEXT,
  teacher_status TEXT,
  confirmation_memo TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (student_id, homework_id)
);
CREATE INDEX IF NOT EXISTS idx_v3_homework_student ON v3_homework_overrides(student_id, updated_at);

CREATE TABLE IF NOT EXISTS homework_group_archives (
  student_id TEXT NOT NULL,
  group_key TEXT NOT NULL,
  archived INTEGER NOT NULL DEFAULT 1 CHECK (archived IN (0, 1)),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (student_id, group_key)
);
