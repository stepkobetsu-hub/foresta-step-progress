-- Internal queue-processing control. PAUSED is used only while a complete test batch is registered.
INSERT OR IGNORE INTO sync_status (
  sync_key, source_system, row_count, checksum, status, error_summary, updated_at
) VALUES (
  'PHASE46_GOOGLE_QUEUE_PROCESSING', 'CLOUDFLARE', 0, '', 'ENABLED', '', datetime('now')
);

