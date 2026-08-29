import { Router, Request, Response } from 'express';
import { TelemetryRepository } from '../database/repository.js';
import { RecentTelemetryQuerySchema, EndpointHistoryQuerySchema } from '../validation/query.schema.js';

export const apiRouter = Router();

apiRouter.get('/infrastructure', async (req: Request, res: Response) => {
  try {
    const infrastructure = await TelemetryRepository.getAllInfrastructure();
    res.json({
      count: infrastructure.length,
      infrastructure
    });
  } catch (error) {
    console.error('[query api] GET /infrastructure failed:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

apiRouter.get('/telemetry/recent', async (req: Request, res: Response) => {
  try {
    const query = RecentTelemetryQuerySchema.safeParse(req.query);
    if (!query.success) {
      res.status(400).json({ error: 'Invalid query parameters', details: query.error.format() });
      return;
    }

    const { minutes } = query.data;
    const data = await TelemetryRepository.getRecentTelemetry(minutes);

    res.json({
      windowMinutes: minutes,
      data
    });
  } catch (error) {
    console.error('[query api] GET /telemetry/recent failed:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

apiRouter.get('/telemetry/history/:endpointId', async (req: Request, res: Response) => {
  try {
    const { endpointId } = req.params;
    const query = EndpointHistoryQuerySchema.safeParse(req.query);
    
    if (!query.success) {
      res.status(400).json({ error: 'Invalid query parameters', details: query.error.format() });
      return;
    }

    const exists = await TelemetryRepository.checkEndpointExists(endpointId);
    if (!exists) {
      res.status(404).json({ error: 'Endpoint not found' });
      return;
    }

    const { hours } = query.data;
    const samples = await TelemetryRepository.getEndpointHistory(endpointId, hours);

    res.json({
      endpointId,
      hours,
      samples
    });
  } catch (error) {
    console.error(`[query api] GET /telemetry/history/${req.params.endpointId} failed:`, error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});
