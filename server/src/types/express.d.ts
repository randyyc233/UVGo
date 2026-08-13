import type { UserRole } from '@prisma/client';

declare global {
  namespace Express {
    interface Request {
      auth?: {
        userId: string;
        role: UserRole;
        name: string;
        email: string;
      };
    }
  }
}

export {};

