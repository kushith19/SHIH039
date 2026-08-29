import express from 'express';
import { checkDbHealth } from './database/index.js';
import { ingestionRouter } from './routes/ingestion.js';
import { apiRouter } from './routes/api.js';

export const app = express();

app.use(express.json());

// Health check endpoint
app.get('/health', async (req, res) => {
  const isDbHealthy = await checkDbHealth();
  
  res.status(isDbHealthy ? 200 : 503).json({
    service: 'telemetry-ingestion',
    status: isDbHealthy ? 'healthy' : 'degraded',
    database: isDbHealthy ? 'connected' : 'unavailable'
  });
});

// Mount ingestion router
app.use('/ingest', ingestionRouter);

// Mount query API router
app.use('/api', apiRouter);
