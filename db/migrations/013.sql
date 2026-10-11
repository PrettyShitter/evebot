CREATE INDEX market_orders_generation_location
  ON market_orders(generation, location_id);

CREATE INDEX production_market_orders_generation_location
  ON production_market_orders(generation, location_id);

CREATE INDEX station_observations_station_at_type
  ON station_observations(station_id, at, type_id);
