import { z } from 'zod';

export const loginSchema = z.object({
  email: z.email().max(191).transform((value) => value.trim().toLowerCase()),
  password: z.string().min(8).max(128),
});

