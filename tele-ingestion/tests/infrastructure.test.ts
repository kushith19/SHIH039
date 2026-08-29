import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { initDb, closeDb, getPool } from '../src/database/index.js';
import dotenv from 'dotenv';

dotenv.config();

describe('POST /ingest/infrastructure', () => {
  let pool;

  beforeAll(async () => {
    await initDb();
    pool = getPool();
    // Cleanup any existing data to ensure tests are isolated
    await pool.query('DELETE FROM telemetry');
    await pool.query('DELETE FROM infrastructure WHERE id LIKE \'test-infra-%\'');
  });

  afterAll(async () => {
    await pool.query('DELETE FROM telemetry');
    await pool.query('DELETE FROM infrastructure WHERE id LIKE \'test-infra-%\'');
    await closeDb();
  });

  it('should reject empty or invalid requests', async () => {
    const res1 = await request(app).post('/ingest/infrastructure').send({});
    expect(res1.status).toBe(400);
    
    const res2 = await request(app).post('/ingest/infrastructure').send({ endpoints: [] });
    expect(res2.status).toBe(400); // Expects array directly

    const res3 = await request(app).post('/ingest/infrastructure').send([]);
    expect(res3.status).toBe(202); // Empty array is valid array, but returns 0 inserted
  });

  it('should accept valid batch registration and insert new records', async () => {
    const payload = [
      { id: 'test-infra-1', name: 'Node 1', type: 'camera' },
      { id: 'test-infra-2', name: 'Node 2', type: 'sensor', sector: 'transport', criticality: 'high' }
    ];

    const res = await request(app).post('/ingest/infrastructure').send(payload);
    
    expect(res.status).toBe(202);
    expect(res.body).toEqual({
      status: 'accepted',
      registered: 2,
      inserted: 2,
      updated: 0
    });
  });

  it('should update existing infrastructure when re-registered', async () => {
    const payload = [
      // Update existing record
      { id: 'test-infra-1', name: 'Node 1 Updated', type: 'camera_v2' },
      // Insert new record
      { id: 'test-infra-3', name: 'Node 3', type: 'router' }
    ];

    const res = await request(app).post('/ingest/infrastructure').send(payload);
    
    expect(res.status).toBe(202);
    expect(res.body.registered).toBe(2);
    expect(res.body.inserted).toBe(1); // test-infra-3 is new
    expect(res.body.updated).toBe(1);  // test-infra-1 is updated
    
    // Check if db reflects the update
    const dbRes = await pool.query('SELECT name, type FROM infrastructure WHERE id = $1', ['test-infra-1']);
    expect(dbRes.rows[0].name).toBe('Node 1 Updated');
    expect(dbRes.rows[0].type).toBe('camera_v2');
  });

  it('should handle duplicate IDs within the same request gracefully', async () => {
    // A single request contains the same ID twice
    const payload = [
      { id: 'test-infra-4', name: 'Duplicate First', type: 'sensor' },
      { id: 'test-infra-4', name: 'Duplicate Second', type: 'sensor_updated', criticality: 'critical' }
    ];

    const res = await request(app).post('/ingest/infrastructure').send(payload);
    
    expect(res.status).toBe(202);
    // Because deduplication is applied, the length of valid input was 2, but actual insert/update is 1.
    // The service handles deduplication and should report inserted 1.
    // It's acceptable for registered to be 2.
    expect(res.body.registered).toBe(2);
    expect(res.body.inserted).toBe(1);
    expect(res.body.updated).toBe(0);

    const dbRes = await pool.query('SELECT name, criticality FROM infrastructure WHERE id = $1', ['test-infra-4']);
    expect(dbRes.rows[0].name).toBe('Duplicate Second');
    expect(dbRes.rows[0].criticality).toBe('critical');
  });
});
