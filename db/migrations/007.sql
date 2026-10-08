CREATE TABLE production_structure_market_sync (
  structure_id TEXT PRIMARY KEY,
  system_id TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('available','forbidden','capped','failed','missing_scope')),
  pages INTEGER NOT NULL DEFAULT 0,
  order_count INTEGER NOT NULL DEFAULT 0,
  observed_at TEXT NOT NULL,
  message TEXT
);

CREATE TABLE production_structure_market_orders (
  structure_id TEXT NOT NULL REFERENCES production_structure_market_sync(structure_id) ON DELETE CASCADE,
  order_id TEXT NOT NULL,
  type_id TEXT NOT NULL,
  location_id TEXT NOT NULL,
  payload TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  PRIMARY KEY(structure_id, order_id)
);
CREATE INDEX production_structure_orders_type ON production_structure_market_orders(type_id, structure_id);
