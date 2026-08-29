import { z } from 'zod';

export const RecentTelemetryQuerySchema = z.object({
  minutes: z
    .string()
    .optional()
    .transform((val) => (val ? parseInt(val, 10) : 5))
    .refine((val) => !isNaN(val) && val > 0, {
      message: 'minutes must be a positive integer',
    }),
});

export const EndpointHistoryQuerySchema = z.object({
  hours: z
    .string()
    .optional()
    .transform((val) => (val ? parseInt(val, 10) : 24))
    .refine((val) => !isNaN(val) && val > 0, {
      message: 'hours must be a positive integer',
    }),
});
