-- Persist the homework archive view across browsers and login sessions.
-- This is a UI preference keyed by the stable Google homework group key, so it
-- deliberately does not depend on the mirrored homework_records table.
CREATE TABLE IF NOT EXISTS homework_group_archives (
  student_id TEXT NOT NULL,
  group_key TEXT NOT NULL,
  archived INTEGER NOT NULL DEFAULT 1 CHECK (archived IN (0, 1)),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (student_id, group_key)
);

CREATE INDEX IF NOT EXISTS idx_homework_group_archives_student
  ON homework_group_archives(student_id, archived, updated_at DESC);
