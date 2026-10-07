CREATE TABLE project_lot_allocations (
  id TEXT PRIMARY KEY,
  source_lot_id TEXT NOT NULL REFERENCES project_output_lots(id),
  project_id TEXT NOT NULL REFERENCES production_projects(id) ON DELETE CASCADE,
  node_id TEXT NOT NULL REFERENCES project_nodes(id) ON DELETE CASCADE,
  quantity INTEGER NOT NULL CHECK(quantity > 0),
  consumed_quantity INTEGER NOT NULL DEFAULT 0 CHECK(consumed_quantity >= 0 AND consumed_quantity <= quantity),
  status TEXT NOT NULL CHECK(status IN ('reserved','consumed','released')),
  allocated_at TEXT NOT NULL,
  consumed_at TEXT,
  UNIQUE(source_lot_id,project_id,node_id)
);
CREATE INDEX project_lot_allocations_available
  ON project_lot_allocations(source_lot_id,status);
