ALTER TABLE characters ADD COLUMN scopes TEXT NOT NULL DEFAULT '[]';

CREATE TABLE production_character_profiles (
  character_id TEXT PRIMARY KEY REFERENCES characters(id) ON DELETE CASCADE,
  race TEXT,
  clone_profile TEXT NOT NULL DEFAULT 'alpha',
  skills_payload TEXT NOT NULL,
  standings_payload TEXT NOT NULL,
  skill_queue_payload TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  source TEXT NOT NULL CHECK(source IN ('esi','manual'))
);

CREATE TABLE production_facility_profiles (
  location_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  system_id TEXT NOT NULL,
  facility_kind TEXT NOT NULL CHECK(facility_kind IN ('npc_station','structure','unknown')),
  services_payload TEXT NOT NULL DEFAULT '[]',
  industry_tax TEXT,
  material_bonus TEXT,
  time_bonus TEXT,
  reprocessing_yield_bonus TEXT,
  access_status TEXT NOT NULL DEFAULT 'unknown' CHECK(access_status IN ('unknown','confirmed','unavailable')),
  profile_source TEXT NOT NULL DEFAULT 'esi' CHECK(profile_source IN ('esi','manual')),
  evidence TEXT,
  observed_at TEXT NOT NULL
);

CREATE TABLE production_blueprint_instances (
  item_id TEXT PRIMARY KEY,
  character_id TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  blueprint_type_id TEXT NOT NULL,
  location_id TEXT NOT NULL,
  location_flag TEXT,
  quantity INTEGER NOT NULL,
  material_efficiency INTEGER NOT NULL,
  time_efficiency INTEGER NOT NULL,
  runs INTEGER NOT NULL,
  observed_at TEXT NOT NULL,
  source TEXT NOT NULL CHECK(source IN ('esi','manual'))
);
CREATE INDEX production_blueprints_character_type ON production_blueprint_instances(character_id,blueprint_type_id);

CREATE TABLE production_contract_sources (
  contract_id TEXT PRIMARY KEY,
  region_id TEXT NOT NULL,
  location_id TEXT,
  contract_type TEXT NOT NULL,
  status TEXT NOT NULL,
  price TEXT NOT NULL,
  expires_at TEXT,
  items_payload TEXT,
  observed_at TEXT NOT NULL,
  coverage_status TEXT NOT NULL DEFAULT 'unknown' CHECK(coverage_status IN ('available','unavailable','unknown'))
);
CREATE INDEX production_contract_location_expiry ON production_contract_sources(location_id,expires_at);

CREATE TABLE production_assets (
  character_id TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  item_id TEXT NOT NULL,
  type_id TEXT NOT NULL,
  location_id TEXT NOT NULL,
  location_type TEXT NOT NULL,
  location_flag TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  observed_at TEXT NOT NULL,
  payload TEXT NOT NULL,
  PRIMARY KEY(character_id,item_id)
);
CREATE TABLE production_character_contracts (
  character_id TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  contract_id TEXT NOT NULL,
  contract_type TEXT NOT NULL,
  status TEXT NOT NULL,
  location_id TEXT NOT NULL,
  price TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  payload TEXT NOT NULL,
  PRIMARY KEY(character_id,contract_id)
);
CREATE TABLE production_jobs (
  character_id TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  job_id TEXT NOT NULL,
  facility_id TEXT NOT NULL,
  activity_id INTEGER NOT NULL,
  blueprint_id TEXT NOT NULL,
  blueprint_type_id TEXT NOT NULL,
  runs INTEGER NOT NULL,
  status TEXT NOT NULL,
  start_at TEXT NOT NULL,
  end_at TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  payload TEXT NOT NULL,
  PRIMARY KEY(character_id,job_id)
);
CREATE TABLE production_system_indices (
  system_id TEXT NOT NULL,
  activity TEXT NOT NULL,
  cost_index TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  PRIMARY KEY(system_id,activity)
);
CREATE TABLE production_adjusted_prices (
  type_id TEXT PRIMARY KEY,
  adjusted_price TEXT NOT NULL,
  observed_at TEXT NOT NULL
);
CREATE TABLE production_sync_runs (
  id TEXT PRIMARY KEY,
  character_id TEXT,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  status TEXT NOT NULL,
  details TEXT NOT NULL
);

CREATE TABLE production_opportunities (
  id TEXT PRIMARY KEY,
  calculation_snapshot_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  payload TEXT NOT NULL
);

CREATE TABLE production_projects (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK(status IN ('pinned','planning','purchasing','partially_ready','in_production','ready_for_sale','partially_sold','reconciling','completed','cancelled','needs_review')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  payload TEXT NOT NULL
);

CREATE TABLE project_plan_versions (
  project_id TEXT NOT NULL REFERENCES production_projects(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  snapshot_id TEXT NOT NULL,
  payload TEXT NOT NULL,
  PRIMARY KEY(project_id,version)
);

CREATE TABLE project_nodes (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES production_projects(id) ON DELETE CASCADE,
  node_key TEXT NOT NULL,
  node_type TEXT NOT NULL CHECK(node_type IN ('manufacturing','reprocessing','purchase','output')),
  status TEXT NOT NULL,
  payload TEXT NOT NULL,
  UNIQUE(project_id,node_key)
);
CREATE TABLE project_edges (
  project_id TEXT NOT NULL REFERENCES production_projects(id) ON DELETE CASCADE,
  from_node TEXT NOT NULL REFERENCES project_nodes(id) ON DELETE CASCADE,
  to_node TEXT NOT NULL REFERENCES project_nodes(id) ON DELETE CASCADE,
  type_id TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK(quantity > 0),
  PRIMARY KEY(project_id,from_node,to_node,type_id)
);

CREATE TABLE blueprint_sources (
  id TEXT PRIMARY KEY,
  source_kind TEXT NOT NULL CHECK(source_kind IN ('owned','market','contract','manual')),
  source_id TEXT NOT NULL,
  contract_id TEXT,
  blueprint_type_id TEXT NOT NULL,
  location_id TEXT,
  quantity INTEGER NOT NULL CHECK(quantity > 0),
  material_efficiency INTEGER,
  time_efficiency INTEGER,
  runs INTEGER,
  price TEXT,
  status TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  payload TEXT NOT NULL,
  UNIQUE(source_kind,source_id)
);
CREATE TABLE blueprint_run_allocations (
  id TEXT PRIMARY KEY,
  blueprint_source_id TEXT NOT NULL REFERENCES blueprint_sources(id),
  project_id TEXT NOT NULL REFERENCES production_projects(id) ON DELETE CASCADE,
  node_id TEXT NOT NULL REFERENCES project_nodes(id) ON DELETE CASCADE,
  runs INTEGER NOT NULL CHECK(runs > 0),
  created_at TEXT NOT NULL,
  UNIQUE(blueprint_source_id,node_id)
);

CREATE TABLE project_purchase_allocations (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES production_projects(id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  source_id TEXT NOT NULL,
  type_id TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK(quantity > 0),
  actual_cost TEXT NOT NULL,
  allocated_at TEXT NOT NULL,
  UNIQUE(project_id,source,source_id,type_id)
);
CREATE TABLE project_job_links (
  project_id TEXT NOT NULL REFERENCES production_projects(id) ON DELETE CASCADE,
  node_id TEXT NOT NULL REFERENCES project_nodes(id) ON DELETE CASCADE,
  character_id TEXT NOT NULL REFERENCES characters(id),
  job_id TEXT NOT NULL,
  source_status TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  payload TEXT NOT NULL,
  PRIMARY KEY(character_id,job_id)
);
CREATE TABLE reprocessing_confirmations (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES production_projects(id) ON DELETE CASCADE,
  node_id TEXT NOT NULL REFERENCES project_nodes(id) ON DELETE CASCADE,
  confirmed_at TEXT NOT NULL,
  source TEXT NOT NULL CHECK(source='manual'),
  payload TEXT NOT NULL
);
CREATE TABLE project_output_lots (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES production_projects(id) ON DELETE CASCADE,
  node_id TEXT NOT NULL REFERENCES project_nodes(id) ON DELETE CASCADE,
  type_id TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK(quantity > 0),
  remaining INTEGER NOT NULL CHECK(remaining >= 0 AND remaining <= quantity),
  unit_cost TEXT NOT NULL,
  source_id TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE project_sales_allocations (
  id TEXT PRIMARY KEY,
  output_lot_id TEXT NOT NULL REFERENCES project_output_lots(id),
  character_id TEXT NOT NULL REFERENCES characters(id),
  transaction_id TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK(quantity > 0),
  gross TEXT NOT NULL,
  net TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  UNIQUE(character_id,transaction_id,output_lot_id)
);
CREATE TABLE project_cost_events (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES production_projects(id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  source_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  amount TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  payload TEXT NOT NULL,
  UNIQUE(source,source_id,event_type)
);
CREATE TABLE production_reservations (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES production_projects(id) ON DELETE CASCADE,
  type_id TEXT,
  kind TEXT NOT NULL CHECK(kind IN ('purchase','fee','blueprint','material')),
  amount TEXT NOT NULL,
  quantity INTEGER,
  paid INTEGER NOT NULL DEFAULT 0 CHECK(paid IN (0,1)),
  created_at TEXT NOT NULL
);
CREATE TABLE calculation_snapshots (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  market_snapshot_ids TEXT NOT NULL,
  sde_version TEXT NOT NULL,
  character_profile_at TEXT,
  facility_profile_ids TEXT NOT NULL,
  coverage_payload TEXT NOT NULL,
  inputs_payload TEXT NOT NULL,
  formula_version TEXT NOT NULL
);
