import dotenv from 'dotenv';
import { createServer } from 'http';
import { app } from './app.js';
import { initDb, closeDb } from './database/index.js';

dotenv.config();

const port = process.env.PORT || 3000;
const server = createServer(app);

// Initialize DB then start server
initDb().then(() => {
  server.listen(port, () => {
    console.log(`[server]: Server is running at http://localhost:${port}`);
  });
}).catch(err => {
  console.error('[server]: Failed to initialize database', err);
  process.exit(1);
});

// Graceful Shutdown Handling
const shutdown = () => {
  console.log('SIGINT/SIGTERM received: closing HTTP server');
  server.close(async () => {
    console.log('HTTP server closed');
    await closeDb();
    process.exit(0);
  });
  
  // Failsafe shutdown
  setTimeout(() => {
    console.error('Could not close connections in time, forcefully shutting down');
    process.exit(1);
  }, 10000);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
