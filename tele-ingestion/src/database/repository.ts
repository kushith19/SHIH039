import { getPool } from './index.js';
import { TelemetryRow, InfrastructureRow } from '../types/index.js';

export class TelemetryRepository {
  static async insertTelemetryBatch(rows: TelemetryRow[]): Promise<number> {
    if (rows.length === 0) return 0;

    const pool = getPool();
    const client = await pool.connect();
    
    try {
      await client.query('BEGIN');
      
      const endpointIds = [...new Set(rows.map(r => r.endpointId))];
      if (endpointIds.length > 0) {
        const checkResult = await client.query(
          `SELECT id FROM infrastructure WHERE id = ANY($1::text[])`,
          [endpointIds]
        );
        const existingIds = new Set(checkResult.rows.map(r => r.id));
        const missingIds = endpointIds.filter(id => !existingIds.has(id));
        
        if (missingIds.length > 0) {
          throw new Error(`Unknown endpoint(s): ${missingIds.join(', ')}`);
        }
      }

      const times = rows.map(r => r.time);
      const endpointIdsParam = rows.map(r => r.endpointId);
      const simulationTicks = rows.map(r => r.simulationTick);
      const metricNames = rows.map(r => r.metricName);
      const values = rows.map(r => r.value);
      const units = rows.map(r => r.unit);

      const insertResult = await client.query(`
        INSERT INTO telemetry (time, endpoint_id, simulation_tick, metric_name, value, unit)
        SELECT * FROM UNNEST ($1::timestamptz[], $2::text[], $3::bigint[], $4::text[], $5::double precision[], $6::text[])
        ON CONFLICT (endpoint_id, metric_name, simulation_tick, time) DO NOTHING
      `, [times, endpointIdsParam, simulationTicks, metricNames, values, units]);

      await client.query('COMMIT');
      return insertResult.rowCount ?? 0;
    } catch (error) {
      await client.query('ROLLBACK');
      console.error(`[repository] Database failure:`, error);
      throw error;
    } finally {
      client.release();
    }
  }

  static async upsertInfrastructureBatch(rows: InfrastructureRow[]): Promise<{ inserted: number; updated: number }> {
    if (rows.length === 0) return { inserted: 0, updated: 0 };

    // Deduplicate rows by ID, keeping the latest one to prevent ON CONFLICT DO UPDATE errors in a single statement
    const deduplicatedRows = Object.values(rows.reduce((acc, row) => {
      acc[row.id] = row;
      return acc;
    }, {} as Record<string, InfrastructureRow>));

    const pool = getPool();
    
    const ids = deduplicatedRows.map(r => r.id);
    const names = deduplicatedRows.map(r => r.name);
    const types = deduplicatedRows.map(r => r.type);
    const sectors = deduplicatedRows.map(r => r.sector ?? null);
    const criticalities = deduplicatedRows.map(r => r.criticality ?? null);

    const result = await pool.query(`
      INSERT INTO infrastructure (id, name, type, sector, criticality)
      SELECT * FROM UNNEST ($1::text[], $2::text[], $3::text[], $4::text[], $5::text[])
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        type = EXCLUDED.type,
        sector = COALESCE(EXCLUDED.sector, infrastructure.sector),
        criticality = COALESCE(EXCLUDED.criticality, infrastructure.criticality)
      RETURNING (xmax = 0) AS is_insert
    `, [ids, names, types, sectors, criticalities]);

    let inserted = 0;
    let updated = 0;
    
    for (const row of result.rows) {
      if (row.is_insert) inserted++;
      else updated++;
    }

    return { inserted, updated };
  }

  static async getAllInfrastructure(): Promise<InfrastructureRow[]> {
    const pool = getPool();
    const result = await pool.query('SELECT id, name, type, sector, criticality FROM infrastructure ORDER BY id ASC');
    return result.rows;
  }

  static async getRecentTelemetry(minutes: number) {
    const pool = getPool();
    const result = await pool.query(`
      SELECT endpoint_id as "endpointId", metric_name as "metricName", value, unit, time, simulation_tick as "simulationTick"
      FROM telemetry
      WHERE time >= NOW() - INTERVAL '1 minute' * $1
      ORDER BY time ASC
    `, [minutes]);
    return result.rows;
  }

  static async checkEndpointExists(endpointId: string): Promise<boolean> {
    const pool = getPool();
    const result = await pool.query('SELECT 1 FROM infrastructure WHERE id = $1', [endpointId]);
    return (result.rowCount ?? 0) > 0;
  }

  static async getEndpointHistory(endpointId: string, hours: number) {
    const pool = getPool();
    const result = await pool.query(`
      SELECT metric_name as "metricName", value, unit, time, simulation_tick as "simulationTick"
      FROM telemetry
      WHERE endpoint_id = $1 AND time >= NOW() - INTERVAL '1 hour' * $2
      ORDER BY time ASC
    `, [endpointId, hours]);
    return result.rows;
  }
}
