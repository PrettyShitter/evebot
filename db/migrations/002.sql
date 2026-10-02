CREATE TABLE character_orders (character_id TEXT NOT NULL, id TEXT NOT NULL, state TEXT NOT NULL, payload TEXT NOT NULL, available_at TEXT NOT NULL, PRIMARY KEY(character_id,id,state));
CREATE INDEX lot_deal_type ON purchase_lots(deal_id,type_id);
CREATE INDEX sale_transaction ON sale_allocations(seller_id,transaction_id);
CREATE INDEX event_deal_time ON deal_events(deal_id,at);
CREATE INDEX history_region_type ON regional_history(region_id,type_id);
CREATE INDEX snapshots_region_complete ON market_snapshot_runs(region_id,status,completed_at);
