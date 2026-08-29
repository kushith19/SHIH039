export const schemaSql = `
CREATE EXTENSION IF NOT EXISTS timescaledb CASCADE;

CREATE TABLE IF NOT EXISTS infrastructure (
  id VARCHAR(255) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  type VARCHAR(100) NOT NULL,
  sector VARCHAR(100),
  criticality VARCHAR(50)
);

CREATE TABLE IF NOT EXISTS telemetry (
  time TIMESTAMPTZ NOT NULL,
  endpoint_id VARCHAR(255) NOT NULL REFERENCES infrastructure(id),
  simulation_tick BIGINT NOT NULL,
  metric_name VARCHAR(255) NOT NULL,
  value DOUBLE PRECISION NOT NULL,
  unit VARCHAR(50) NOT NULL,
  UNIQUE (endpoint_id, metric_name, simulation_tick, time)
);

-- Turn telemetry into a TimescaleDB hypertable partitioned by time
SELECT create_hypertable('telemetry', 'time', if_not_exists => TRUE);

-- Create optimized indexes for time-series querying
CREATE INDEX IF NOT EXISTS ix_telemetry_endpoint_time ON telemetry (endpoint_id, time DESC);
CREATE INDEX IF NOT EXISTS ix_telemetry_metric_time ON telemetry (metric_name, time DESC);
CREATE INDEX IF NOT EXISTS ix_telemetry_simulation_tick ON telemetry (simulation_tick);
`;
