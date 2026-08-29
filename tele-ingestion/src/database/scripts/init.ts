import { initDb, closeDb } from '../index.js';
import { setupDatabase } from '../setup.js';

const runInit = async () => {
  try {
    await initDb();
    await setupDatabase();
    console.log('Database initialization script finished successfully.');
  } catch (error) {
    console.error('Database initialization script failed.', error);
    process.exit(1);
  } finally {
    await closeDb();
  }
};

runInit();
