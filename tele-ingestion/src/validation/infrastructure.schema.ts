import { z } from 'zod';

export const InfrastructureDescriptorSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  type: z.string().min(1),
  sector: z.string().optional(),
  criticality: z.string().optional(),
});

export const InfrastructureBatchSchema = z.array(InfrastructureDescriptorSchema);
