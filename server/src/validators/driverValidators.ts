import { z } from 'zod';

export const goOnTripSchema = z.object({ enabled: z.boolean() });

export const occupancySchema = z.object({ count: z.coerce.number().int().min(0) });

export const locationSampleSchema = z.object({
  latitude: z.coerce.number().min(-90).max(90),
  longitude: z.coerce.number().min(-180).max(180),
  observedAt: z.iso.datetime().optional(),
});
