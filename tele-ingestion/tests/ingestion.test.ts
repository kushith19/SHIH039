import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { initDb, closeDb, getPool } from '../src/database/index.js';
import dotenv from 'dotenv';

dotenv.config();

const VALID_SNAPSHOT = {
  timestamp: "2023-10-10T12:00:00Z",
  simulationTick: 123,
  endpoints: [
    {
      endpoint: {
        id: "test-ep-1",
        name: "Test Endpoint 1",
        type: "sensor"
      },
      telemetry: [
        { name: "temperature", value: 25.5, unit: "C" },
        { name: "humidity", value: 60, unit: "%" }
      ]
    }
  ]
};

describe('POST /ingest/snapshot', () => {
  let pool;

  beforeAll(async () => {
    await initDb();
    pool = getPool();
    // Insert a test endpoint to satisfy foreign key constraints
    await pool.query(`
      INSERT INTO infrastructure (id, name, type)
      VALUES ('test-ep-1', 'Test Endpoint 1', 'sensor')
      ON CONFLICT DO NOTHING
    `);
    
    // Clear out telemetry before tests
    await pool.query('DELETE FROM telemetry WHERE endpoint_id = $1', ['test-ep-1']);
  });

  afterAll(async () => {
    // Cleanup telemetry
    await pool.query('DELETE FROM telemetry WHERE endpoint_id = $1', ['test-ep-1']);
    // Clean up infrastructure
    await pool.query('DELETE FROM infrastructure WHERE id = $1', ['test-ep-1']);
    await closeDb();
  });

  it('should accept a valid snapshot and insert telemetry', async () => {
    const res = await request(app).post('/ingest/snapshot').send(VALID_SNAPSHOT);
    
    expect(res.status).toBe(202);
    expect(res.body.metricsInserted).toBe(2);
    expect(res.body.endpointsProcessed).toBe(1);
    expect(res.body.simulationTick).toBe(123);
  });

  it('should ignore duplicate snapshot telemetry (idempotency)', async () => {
    // Send same snapshot again
    const res = await request(app).post('/ingest/snapshot').send(VALID_SNAPSHOT);
    
    expect(res.status).toBe(202);
    // Because it's idempotent, it shouldn't crash, but inserted should be 0
    expect(res.body.metricsInserted).toBe(0);
  });

  it('should reject a malformed snapshot', async () => {
    const malformed = {
      timestamp: "not-a-date",
      simulationTick: "wrong-type",
      endpoints: []
    };
    
    const res = await request(app).post('/ingest/snapshot').send(malformed);
    
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation failed');
  });

  it('should reject invalid metric values (e.g. NaN, Infinity)', async () => {
    const invalidSnapshot = {
      ...VALID_SNAPSHOT,
      simulationTick: 124, // use new tick
      endpoints: [
        {
          endpoint: { id: "test-ep-1", name: "E", type: "T" },
          telemetry: [
            { name: "temp", value: "NaN", unit: "C" } // Passing string NaN, invalid type
          ]
        }
      ]
    };
    
    const res = await request(app).post('/ingest/snapshot').send(invalidSnapshot);
    expect(res.status).toBe(400);
  });

  it('should reject when endpoint is unknown in infrastructure table', async () => {
    const unknownEndpointSnapshot = {
      ...VALID_SNAPSHOT,
      simulationTick: 125,
      endpoints: [
        {
          endpoint: { id: "unknown-ep-x", name: "Unknown", type: "sensor" },
          telemetry: [
            { name: "temp", value: 10, unit: "C" }
          ]
        }
      ]
    };
    
    const res = await request(app).post('/ingest/snapshot').send(unknownEndpointSnapshot);
    
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Unknown endpoint');
  });

  it('should handle multiple endpoints and multiple metrics properly', async () => {
    // Add second endpoint
    await pool.query(`
      INSERT INTO infrastructure (id, name, type)
      VALUES ('test-ep-2', 'Test Endpoint 2', 'camera')
      ON CONFLICT DO NOTHING
    `);

    const multiSnapshot = {
      timestamp: "2023-10-10T12:05:00Z",
      simulationTick: 126,
      endpoints: [
        {
          endpoint: { id: "test-ep-1", name: "E1", type: "T1" },
          telemetry: [{ name: "t1", value: 1, unit: "u" }]
        },
        {
          endpoint: { id: "test-ep-2", name: "E2", type: "T2" },
          telemetry: [{ name: "t2", value: 2, unit: "u" }, { name: "t3", value: 3, unit: "u" }]
        }
      ]
    };

    const res = await request(app).post('/ingest/snapshot').send(multiSnapshot);
    
    expect(res.status).toBe(202);
    expect(res.body.metricsInserted).toBe(3);
    
    // Cleanup
    await pool.query('DELETE FROM telemetry WHERE endpoint_id = $1', ['test-ep-2']);
    await pool.query('DELETE FROM infrastructure WHERE id = $1', ['test-ep-2']);
  });
});
