import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

let pool: Pool | null = null;

export const initDb = async (): Promise<void> => {
  if (pool) return;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('[database]: DATABASE_URL environment variable is missing.');
    process.exit(1);
  }

  pool = new Pool({
    connectionString,
    // Add default pool configurations if needed
  });

  // Verify connection immediately on startup
  try {
    const client = await pool.connect();
    client.release();
    console.log('[database]: Connected to PostgreSQL/TimescaleDB successfully');
  } catch (error) {
    console.error('[database]: Failed to connect to database', error);
    process.exit(1);
  }
};

export const getPool = (): Pool => {
  if (!pool) {
    throw new Error('Database pool has not been initialized. Call initDb() first.');
  }
  return pool;
};

export const checkDbHealth = async (): Promise<boolean> => {
  if (!pool) return false;
  try {
    const res = await pool.query('SELECT 1');
    return res.rowCount !== null && res.rowCount > 0;
  } catch (error) {
    console.error('[database]: Health check failed', error);
    return false;
  }
};

export const closeDb = async (): Promise<void> => {
  if (pool) {
    console.log('[database]: Closing PostgreSQL pool...');
    await pool.end();
    pool = null;
    console.log('[database]: PostgreSQL pool closed');
  }
};
