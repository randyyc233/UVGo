import type { RouteCode, UserRole } from '@prisma/client';

declare global {
  namespace Express {
    interface Request {
      auth?: {
        userId: string;
        role: UserRole;
        name: string;
        email: string;
        dispatcherRoute: RouteCode | null;
      };
    }
  }
}

export {};

