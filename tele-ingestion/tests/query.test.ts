import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { initDb, closeDb, getPool } from '../src/database/index.js';
import dotenv from 'dotenv';

dotenv.config();

const VALID_SNAPSHOT = {
  timestamp: new Date().toISOString(),
  simulationTick: 999,
  endpoints: [
    {
      endpoint: {
        id: "query-ep-1",
        name: "Query Test Endpoint 1",
        type: "sensor"
      },
      telemetry: [
        { name: "test_metric", value: 42.5, unit: "test" }
      ]
    }
  ]
};

describe('Query API Layer (/api)', () => {
  let pool;

  beforeAll(async () => {
    await initDb();
    pool = getPool();
    
    // Insert infrastructure for querying
    await pool.query(`
      INSERT INTO infrastructure (id, name, type)
      VALUES ('query-ep-1', 'Query Test Endpoint 1', 'sensor')
      ON CONFLICT DO NOTHING
    `);
    
    // Clear out telemetry before tests
    await pool.query('DELETE FROM telemetry WHERE endpoint_id = $1', ['query-ep-1']);

    // Ingest some data to query
    await request(app).post('/ingest/snapshot').send(VALID_SNAPSHOT);
  });

  afterAll(async () => {
    await pool.query('DELETE FROM telemetry WHERE endpoint_id = $1', ['query-ep-1']);
    await pool.query('DELETE FROM infrastructure WHERE id = $1', ['query-ep-1']);
    await closeDb();
  });

  describe('GET /api/infrastructure', () => {
    it('should return infrastructure records', async () => {
      const res = await request(app).get('/api/infrastructure');
      expect(res.status).toBe(200);
      expect(typeof res.body.count).toBe('number');
      expect(Array.isArray(res.body.infrastructure)).toBe(true);
      
      const ep = res.body.infrastructure.find(e => e.id === 'query-ep-1');
      expect(ep).toBeDefined();
      expect(ep.name).toBe('Query Test Endpoint 1');
    });
  });

  describe('GET /api/telemetry/recent', () => {
    it('should return recent telemetry with default minutes', async () => {
      const res = await request(app).get('/api/telemetry/recent');
      expect(res.status).toBe(200);
      expect(res.body.windowMinutes).toBe(5);
      expect(Array.isArray(res.body.data)).toBe(true);

      const metric = res.body.data.find(d => d.endpointId === 'query-ep-1' && d.metricName === 'test_metric');
      expect(metric).toBeDefined();
      expect(metric.value).toBe(42.5);
      expect(metric.simulationTick).toBe(999);
    });

    it('should allow custom minutes parameter', async () => {
      const res = await request(app).get('/api/telemetry/recent?minutes=10');
      expect(res.status).toBe(200);
      expect(res.body.windowMinutes).toBe(10);
    });

    it('should reject invalid minutes parameter', async () => {
      const res = await request(app).get('/api/telemetry/recent?minutes=-5');
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Invalid query parameters');
    });
  });

  describe('GET /api/telemetry/history/:endpointId', () => {
    it('should return history for known endpoint with default hours', async () => {
      const res = await request(app).get('/api/telemetry/history/query-ep-1');
      expect(res.status).toBe(200);
      expect(res.body.endpointId).toBe('query-ep-1');
      expect(res.body.hours).toBe(24);
      expect(Array.isArray(res.body.samples)).toBe(true);

      const sample = res.body.samples.find(s => s.metricName === 'test_metric');
      expect(sample).toBeDefined();
      expect(sample.value).toBe(42.5);
    });

    it('should return 404 for unknown endpoint', async () => {
      const res = await request(app).get('/api/telemetry/history/unknown-ep');
      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Endpoint not found');
    });

    it('should reject invalid hours parameter', async () => {
      const res = await request(app).get('/api/telemetry/history/query-ep-1?hours=abc');
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Invalid query parameters');
    });
  });
});
