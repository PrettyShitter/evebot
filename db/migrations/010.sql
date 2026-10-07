CREATE TABLE blueprint_acquisition_confirmations (
  blueprint_item_id TEXT PRIMARY KEY,
  character_id TEXT NOT NULL,
  transaction_id TEXT NOT NULL,
  price TEXT NOT NULL,
  confirmed_at TEXT NOT NULL,
  UNIQUE(character_id, transaction_id)
);
