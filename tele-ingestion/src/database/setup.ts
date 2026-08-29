import { getPool } from './index.js';
import { schemaSql } from './schema.js';

export const setupDatabase = async (): Promise<void> => {
  const pool = getPool();
  
  console.log('[database]: Starting database schema initialization...');
  
  try {
    await pool.query(schemaSql);
    console.log('[database]: Schema initialization completed successfully.');
  } catch (error) {
    console.error('[database]: Error during schema initialization:', error);
    throw error;
  }
};
