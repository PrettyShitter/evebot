CREATE TABLE production_structure_product_profiles (
  location_id TEXT NOT NULL REFERENCES production_facility_profiles(location_id) ON DELETE CASCADE,
  output_type_id TEXT NOT NULL,
  system_cost_multiplier TEXT NOT NULL,
  material_bonus_percent REAL NOT NULL,
  time_bonus_percent REAL NOT NULL,
  broker_fee_rate TEXT NOT NULL,
  evidence TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  PRIMARY KEY(location_id, output_type_id)
);
