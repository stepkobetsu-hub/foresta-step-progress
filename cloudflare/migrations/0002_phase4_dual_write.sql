-- Phase 4: TEST-STUDENT-01-only Google dual-write synchronization queue.
-- Production student writes remain disabled in Worker configuration.
CREATE TABLE IF NOT EXISTS sync_queue (
  sync_id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL,
  operation_type TEXT NOT NULL,
  record_id TEXT NOT NULL,
  payload TEXT NOT NULL DEFAULT '{}',
  request_id TEXT NOT NULL UNIQUE,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT NOT NULL DEFAULT '',
  next_retry_at TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING',
  cloudflare_status TEXT NOT NULL DEFAULT 'SAVED',
  google_status TEXT NOT NULL DEFAULT 'PENDING',
  google_version INTEGER NOT NULL DEFAULT 0,
  google_updated_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_sync_queue_due
  ON sync_queue(status, next_retry_at, attempt_count);
CREATE INDEX IF NOT EXISTS idx_sync_queue_record
  ON sync_queue(student_id, operation_type, record_id, created_at DESC);
