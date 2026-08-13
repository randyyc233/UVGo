import { z } from 'zod';

const seats = z.array(z.coerce.number().int().min(1).max(40)).min(1).max(4).refine(
  (values) => new Set(values).size === values.length,
  'Each selected seat must be unique.',
);

export const tripSearchSchema = z.object({
  date: z.string().date().optional(),
  passengers: z.coerce.number().int().min(1).max(4).default(1),
});

export const paypalReservationSchema = z.object({
  tripId: z.string().min(1),
  seats,
  contact: z.string().trim().min(7).max(32),
});

export const gcashReservationSchema = paypalReservationSchema.extend({
  gcashReference: z.string().trim().max(100).optional().default(''),
});

export const rescheduleSchema = z.object({
  tripId: z.string().min(1),
  seats,
});
