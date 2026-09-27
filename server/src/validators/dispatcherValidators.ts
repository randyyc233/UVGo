import { z } from 'zod';
import {
  MAX_VAN_PASSENGER_CAPACITY,
  MIN_VAN_PASSENGER_CAPACITY,
} from '../config/vehicle.js';

const driverIdentitySchema = z.object({
  name: z.string().trim().min(2).max(120),
  contact: z.string().trim().min(7).max(32),
  email: z.email().max(191).transform((value) => value.trim().toLowerCase()),
});

const vehicleSchema = z.object({
  vanId: z.string().trim().min(2).max(32).transform((value) => value.toUpperCase()),
  plateNo: z.string().trim().min(3).max(32).transform((value) => value.toUpperCase()),
  capacity: z.coerce
    .number()
    .int()
    .min(MIN_VAN_PASSENGER_CAPACITY, `Passenger capacity must be at least ${MIN_VAN_PASSENGER_CAPACITY}.`)
    .max(MAX_VAN_PASSENGER_CAPACITY, `Passenger capacity cannot exceed ${MAX_VAN_PASSENGER_CAPACITY}.`),
});

export const createManagedDriverSchema = driverIdentitySchema.extend({
  password: z.string().min(8).max(128),
  vehicle: vehicleSchema,
});

export const updateManagedDriverSchema = driverIdentitySchema.extend({
  isActive: z.boolean(),
  vehicle: vehicleSchema,
});

export const resetManagedDriverPasswordSchema = z.object({
  password: z.string().min(8).max(128),
});

export const createBackupDispatcherSchema = z.object({
  name: z.string().trim().min(2, 'Full name must be at least 2 characters.').max(120, 'Full name must be 120 characters or fewer.'),
  contact: z.string().trim().min(7, 'Phone number must be at least 7 characters.').max(32, 'Phone number must be 32 characters or fewer.'),
  email: z.email('Please enter a valid email address.').max(191).transform((value) => value.trim().toLowerCase()),
  password: z.string()
    .min(8, 'Temporary password must be at least 8 characters.')
    .max(128, 'Temporary password must be 128 characters or fewer.')
    .regex(/[a-z]/, 'Temporary password must contain a lowercase letter.')
    .regex(/[A-Z]/, 'Temporary password must contain an uppercase letter.')
    .regex(/\d/, 'Temporary password must contain a number.'),
}).strict();

export const dispatcherProfileSchema = z.object({
  name: z.string().trim().min(2, 'Full name must be at least 2 characters.').max(120, 'Full name must be 120 characters or fewer.'),
  email: z.email('Please enter a valid email address.').max(191).transform((value) => value.trim().toLowerCase()),
  contact: z.string().trim().min(7, 'Phone number must be at least 7 characters.').max(32, 'Phone number must be 32 characters or fewer.'),
});

export const dispatcherPasswordSchema = z.object({
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

export const driverAnnouncementSchema = z.object({
  driverId: z.union([z.literal('all'), z.string().trim().min(1)]),
  message: z.string().trim().min(3, 'Write an announcement with at least 3 characters.').max(500),
});

export const departureConfirmationSchema = z.object({
  reason: z.string().trim().min(3, 'Describe how the departure was verified.').max(500),
});

export const managedScheduleSchema = z
  .object({
    // Both times are mandatory: a departure the driver cannot prepare for is
    // not a usable schedule, so loading start is never inferred.
    boardingStartTime: z.iso.datetime({
      message: 'Enter the passenger loading start time.',
    }),
    departureTime: z.iso.datetime({
      message: 'Enter the departure time.',
    }),
    vehicleId: z.string().min(1),
    fareAmount: z.coerce.number().positive().max(10_000),
  })
  .superRefine((value, context) => {
    if (new Date(value.boardingStartTime).getTime() >= new Date(value.departureTime).getTime()) {
      context.addIssue({
        code: 'custom',
        path: ['boardingStartTime'],
        message: 'Passenger loading must start before the departure time.',
      });
    }
  });

const weeklyTimeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Enter a valid time.');

export const weeklyScheduleSchema = z
  .object({
    weekday: z.coerce.number().int().min(1).max(7),
    boardingTime: weeklyTimeSchema,
    departureTime: weeklyTimeSchema,
    vehicleId: z.string().min(1),
    fareAmount: z.coerce.number().positive().max(10_000),
    isActive: z.boolean().optional().default(true),
  })
  .superRefine((value, context) => {
    const [boardingHour = 0, boardingMinute = 0] = value.boardingTime.split(':').map(Number);
    const [departureHour = 0, departureMinute = 0] = value.departureTime.split(':').map(Number);
    if (boardingHour * 60 + boardingMinute >= departureHour * 60 + departureMinute) {
      context.addIssue({
        code: 'custom',
        path: ['boardingTime'],
        message: 'Passenger loading must start before departure on the same day.',
      });
    }
  });

export const tayaWeeklyScheduleSchema = z.object({
  weekday: z.coerce.number().int().min(1).max(7),
  vehicleIds: z.array(z.string().min(1)).max(100),
});

export const queueActionSchema = z.object({
  action: z.enum(['dispatch', 'update_passengers', 'override', 'move_to_last', 'mark_delayed', 'replace', 'notify_driver']),
  reason: z.string().trim().max(500).optional().default(''),
  newPosition: z.coerce.number().int().min(1).optional(),
  passengerCount: z.number().int().min(0).max(MAX_VAN_PASSENGER_CAPACITY).optional(),
}).superRefine((value, context) => {
  if (value.action === 'update_passengers' && value.passengerCount === undefined) {
    context.addIssue({ code: 'custom', path: ['passengerCount'], message: 'Enter the total passengers aboard.' });
  }
  if (['move_to_last', 'mark_delayed', 'replace'].includes(value.action) && value.reason.length < 3) {
    context.addIssue({ code: 'custom', path: ['reason'], message: 'A reason is required for this operational override.' });
  }
  if (value.action === 'override' && !value.newPosition) {
    context.addIssue({ code: 'custom', path: ['newPosition'], message: 'Choose the new queue position.' });
  }
});

export const paymentDecisionSchema = z.object({
  decision: z.enum(['approve', 'reject']),
  reason: z.string().trim().max(500).optional().default(''),
}).superRefine((value, context) => {
  if (value.decision === 'reject' && value.reason.length < 3) {
    context.addIssue({ code: 'custom', path: ['reason'], message: 'A rejection reason is required.' });
  }
});
