import { z } from 'zod';
import { CitySnapshotSchema } from '../validation/snapshot.schema.js';
import { TelemetryRow } from '../types/index.js';

type ValidatedSnapshot = z.infer<typeof CitySnapshotSchema>;

export class SnapshotExtractor {
  static extract(snapshot: ValidatedSnapshot): TelemetryRow[] {
    const rows: TelemetryRow[] = [];
    const time = snapshot.timestamp;
    const simulationTick = snapshot.simulationTick;

    for (const ep of snapshot.endpoints) {
      const endpointId = ep.endpoint.id;
      for (const metric of ep.telemetry) {
        rows.push({
          time,
          endpointId,
          simulationTick,
          metricName: metric.name,
          value: metric.value,
          unit: metric.unit,
        });
      }
    }

    console.info(`[extractor] Created ${rows.length} TelemetryRow objects`);
    const sample = rows.slice(0, 3).map(r => ({ endpointId: r.endpointId, metricName: r.metricName, value: r.value, unit: r.unit }));
    console.info(`[extractor] Sample first 3 rows: ${JSON.stringify(sample)}`);

    return rows;
  }
}
