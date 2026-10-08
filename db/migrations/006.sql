CREATE TABLE production_action_receipts (
  action_id TEXT PRIMARY KEY,
  action_kind TEXT NOT NULL,
  request_payload TEXT NOT NULL,
  created_at TEXT NOT NULL
);
