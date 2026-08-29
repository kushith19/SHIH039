import { Router } from 'express';
import { z } from 'zod';
import { IngestionService } from '../ingestion/service.js';

export const ingestionRouter = Router();

ingestionRouter.post('/snapshot', async (req, res) => {
  console.info(`[ingestion route] Request arrived. tick: ${req.body?.simulationTick}, timestamp: ${req.body?.timestamp}, endpoints: ${req.body?.endpoints?.length}`);
  try {
    const result = await IngestionService.processSnapshot(req.body);
    res.status(202).json(result);
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation failed', details: error.errors });
    } else if (error && typeof error === 'object' && 'status' in error) {
      const customErr = error as { status: number, message: string };
      res.status(customErr.status).json({ error: customErr.message });
    } else {
      console.error('[ingestion]: Internal error during snapshot ingestion', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
});

ingestionRouter.post('/infrastructure', async (req, res) => {
  try {
    const result = await IngestionService.registerInfrastructure(req.body);
    res.status(202).json(result);
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation failed', details: error.errors });
    } else {
      console.error('[ingestion]: Internal error during infrastructure registration', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
});
