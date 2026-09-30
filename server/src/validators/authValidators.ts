import { z } from 'zod';

export const loginSchema = z.object({
  email: z.email('Please enter a valid email address.').max(191).transform((value) => value.trim().toLowerCase()),
  password: z.string().min(8, 'Password must be at least 8 characters.').max(128, 'Password must be 128 characters or fewer.'),
});

export const googleLoginSchema = z.object({
  credential: z.string().trim().min(1, 'Google did not return a sign-in credential.').max(10_000),
}).strict();

export const passengerSignupSchema = z.object({
  name: z.string().trim().min(2, 'Full name must be at least 2 characters.').max(120, 'Full name must be 120 characters or fewer.'),
  email: z.email('Please enter a valid email address.').max(191).transform((value) => value.trim().toLowerCase()),
  contact: z.string().trim().min(7, 'Contact number must be at least 7 characters.').max(32, 'Contact number must be 32 characters or fewer.'),
  password: z.string()
    .min(8, 'Password must be at least 8 characters.')
    .max(128, 'Password must be 128 characters or fewer.')
    .regex(/[a-z]/, 'Password must contain a lowercase letter.')
    .regex(/[A-Z]/, 'Password must contain an uppercase letter.')
    .regex(/\d/, 'Password must contain a number.'),
  confirmPassword: z.string().max(128, 'Password confirmation must be 128 characters or fewer.'),
}).strict().refine((input) => input.password === input.confirmPassword, {
  message: 'Passwords do not match.',
  path: ['confirmPassword'],
});

const emailOnlySchema = z.object({
  email: z.email('Please enter a valid email address.').max(191).transform((value) => value.trim().toLowerCase()),
}).strict();

const oneTimeCode = z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code from your email.');

export const resendVerificationSchema = emailOnlySchema;

export const verifyEmailSchema = emailOnlySchema.extend({ code: oneTimeCode }).strict();

export const forgotPasswordSchema = emailOnlySchema;

export const resetPasswordSchema = emailOnlySchema.extend({
  code: oneTimeCode,
  newPassword: z.string()
    .min(8, 'New password must be at least 8 characters.')
    .max(128, 'New password must be 128 characters or fewer.')
    .regex(/[a-z]/, 'New password must contain a lowercase letter.')
    .regex(/[A-Z]/, 'New password must contain an uppercase letter.')
    .regex(/\d/, 'New password must contain a number.'),
  confirmPassword: z.string().max(128, 'Password confirmation must be 128 characters or fewer.'),
}).strict().refine((input) => input.newPassword === input.confirmPassword, {
  message: 'Passwords do not match.',
  path: ['confirmPassword'],
});

