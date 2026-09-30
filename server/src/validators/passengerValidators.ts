import { z } from 'zod';
import { MAX_VAN_PASSENGER_CAPACITY } from '../config/vehicle.js';

// The upper bound is the largest capacity any van may have; the passenger
// service re-checks each seat against the capacity of the trip's own vehicle.
const seats = z.array(z.coerce.number().int().min(1).max(MAX_VAN_PASSENGER_CAPACITY)).min(1).max(4).refine(
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

/**
 * The hosted (dashboard-configured) PayPal button is charged on PayPal's own
 * checkout page, so the passenger uploads their PayPal receipt and may include
 * its reference for dispatcher verification — the same shape as a GCash receipt.
 */
export const paypalHostedReservationSchema = paypalReservationSchema.extend({
  paypalTransactionReference: z.string().trim().max(100).optional().default(''),
});

export const rescheduleSchema = z.object({
  tripId: z.string().min(1),
  seats,
});

export const passengerProfileSchema = z.object({
  name: z.string().trim().min(2, 'Full name must be at least 2 characters.').max(120, 'Full name must be 120 characters or fewer.'),
  email: z.email('Please enter a valid email address.').max(191).transform((value) => value.trim().toLowerCase()),
  contact: z.string().trim().min(7, 'Contact number must be at least 7 characters.').max(32, 'Contact number must be 32 characters or fewer.'),
});

export const passengerPasswordSchema = z.object({
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
