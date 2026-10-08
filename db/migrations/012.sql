CREATE TABLE production_contract_blueprint_confirmations (
  contract_id TEXT NOT NULL REFERENCES production_contract_sources(contract_id) ON DELETE CASCADE,
  record_id TEXT NOT NULL,
  blueprint_type_id TEXT NOT NULL,
  material_efficiency INTEGER NOT NULL CHECK(material_efficiency BETWEEN 0 AND 10),
  time_efficiency INTEGER NOT NULL CHECK(time_efficiency BETWEEN 0 AND 20),
  runs INTEGER NOT NULL CHECK(runs > 0),
  evidence TEXT NOT NULL,
  confirmed_at TEXT NOT NULL,
  PRIMARY KEY(contract_id, record_id)
);
