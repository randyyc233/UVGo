import { z } from 'zod';
import { MAX_VAN_PASSENGER_CAPACITY } from '../config/vehicle.js';

export const goOnTripSchema = z.object({ enabled: z.boolean() });

// Capacity is per-vehicle, so this is only the outer bound. The driver service
// re-checks the count against the vehicle's own capacity.
export const occupancySchema = z.object({
  count: z.coerce.number().int().min(0).max(MAX_VAN_PASSENGER_CAPACITY),
});

export const cancelAssignmentSchema = z.object({
  reason: z.string().trim().max(500).optional().default(''),
});

export const driverProfileSchema = z.object({
  name: z.string().trim().min(2, 'Full name must be at least 2 characters.').max(120, 'Full name must be 120 characters or fewer.'),
  email: z.email('Please enter a valid email address.').max(191).transform((value) => value.trim().toLowerCase()),
  contact: z.string().trim().min(7, 'Phone number must be at least 7 characters.').max(32, 'Phone number must be 32 characters or fewer.'),
});

export const driverPasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Enter your current password.').max(128),
  newPassword: z.string()
    .min(8, 'New password must be at least 8 characters.')
    .max(128, 'New password must be 128 characters or fewer.')
    .regex(/[a-z]/, 'New password must contain a lowercase letter.')
    .regex(/[A-Z]/, 'New password must contain an uppercase letter.')
    .regex(/\d/, 'New password must contain a number.'),
}).refine((input) => input.currentPassword !== input.newPassword, {
  message: 'Choose a new password that is different from your current password.',
  path: ['newPassword'],
});

export const locationSampleSchema = z.object({
  latitude: z.coerce.number().min(-90).max(90),
  longitude: z.coerce.number().min(-180).max(180),
  accuracyMeters: z.number().positive().max(10_000),
  speedMps: z.number().nonnegative().max(100).nullable().optional(),
  headingDegrees: z.number().min(0).max(360).nullable().optional(),
  observedAt: z.iso.datetime().optional(),
});
