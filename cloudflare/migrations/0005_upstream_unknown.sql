-- Phase 4.6 incident hardening: retain safe upstream metadata and hold ambiguous writes.
ALTER TABLE sync_batches ADD COLUMN upstream_error_code TEXT;
ALTER TABLE sync_batches ADD COLUMN upstream_http_status INTEGER;
ALTER TABLE sync_batches ADD COLUMN upstream_content_type TEXT;
ALTER TABLE sync_batches ADD COLUMN upstream_url_category TEXT;
ALTER TABLE sync_batches ADD COLUMN upstream_redirected INTEGER;
ALTER TABLE sync_batches ADD COLUMN upstream_response_ms REAL;
ALTER TABLE sync_batches ADD COLUMN upstream_body_summary TEXT;

CREATE INDEX IF NOT EXISTS idx_sync_queue_unknown
  ON sync_queue(status, test_run_id, created_at);

