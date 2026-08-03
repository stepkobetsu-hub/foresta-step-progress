Exit code: 0
Wall time: 1.6 seconds
Output:
-- Phase 4.5: atomic batch claiming, stale-lock recovery, reconciliation and metrics.
ALTER TABLE sync_queue ADD COLUMN lock_token TEXT;
ALTER TABLE sync_queue ADD COLUMN locked_at TEXT;
ALTER TABLE sync_queue ADD COLUMN batch_id TEXT;
ALTER TABLE sync_queue ADD COLUMN sync_duration_ms REAL;
ALTER TABLE sync_queue ADD COLUMN reconciliation_status TEXT NOT NULL DEFAULT 'PENDING';

CREATE INDEX IF NOT EXISTS idx_sync_queue_claim
  ON sync_queue(status, next_retry_at, locked_at, created_at);

CREATE TABLE IF NOT EXISTS sync_batches (
  batch_id TEXT PRIMARY KEY,
  item_count INTEGER NOT NULL,
  saved_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  apps_script_ms REAL,
  duration_ms REAL,
  status TEXT NOT NULL DEFAULT 'PROCESSING',
  last_error TEXT NOT NULL DEFAULT '',
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT
);

