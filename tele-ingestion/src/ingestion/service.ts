import { CitySnapshotSchema } from '../validation/snapshot.schema.js';
import { InfrastructureBatchSchema } from '../validation/infrastructure.schema.js';
import { SnapshotExtractor } from './extractor.js';
import { TelemetryRepository } from '../database/repository.js';

export class IngestionService {
  static async processSnapshot(rawSnapshot: unknown) {
    let validated;
    try {
      validated = CitySnapshotSchema.parse(rawSnapshot);
      console.info('[ingestion service] Validation success.');
    } catch (err) {
      console.error('[ingestion service] Validation failure.');
      throw err;
    }
    
    const rows = SnapshotExtractor.extract(validated);
    
    let metricsInserted = 0;
    try {
      metricsInserted = await TelemetryRepository.insertTelemetryBatch(rows);
    } catch (error) {
      if (error instanceof Error && error.message.includes('Unknown endpoint(s)')) {
        throw { status: 400, message: error.message };
      }
      throw error;
    }

    return {
      status: "accepted",
      simulationTick: validated.simulationTick,
      endpointsProcessed: validated.endpoints.length,
      metricsReceived: rows.length,
      metricsInserted: metricsInserted
    };
  }

  static async registerInfrastructure(rawBatch: unknown) {
    const validated = InfrastructureBatchSchema.parse(rawBatch);
    const { inserted, updated } = await TelemetryRepository.upsertInfrastructureBatch(validated);
    
    return {
      status: 'accepted',
      registered: validated.length,
      inserted,
      updated
    };
  }
}
