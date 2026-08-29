import { z } from 'zod';

export const MetricReadingSchema = z.object({
  name: z.string().min(1),
  value: z.number().finite(),
  unit: z.string().min(1),
});

export const EndpointSnapshotSchema = z.object({
  endpoint: z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    type: z.string().min(1),
  }).passthrough(),
  telemetry: z.array(MetricReadingSchema),
}).passthrough();

export const CitySnapshotSchema = z.object({
  timestamp: z.string().datetime(),
  simulationTick: z.number().int().nonnegative(),
  endpoints: z.array(EndpointSnapshotSchema),
}).passthrough();
