CREATE TABLE production_market_orders (
  generation TEXT NOT NULL REFERENCES market_snapshot_runs(id) ON DELETE CASCADE,
  order_id TEXT NOT NULL,
  type_id TEXT NOT NULL,
  location_id TEXT NOT NULL,
  payload TEXT NOT NULL,
  PRIMARY KEY(generation,order_id)
);
CREATE INDEX production_market_orders_type_generation ON production_market_orders(type_id,generation);
