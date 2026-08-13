import type { RequestHandler } from 'express';
import type { UserRole } from '@prisma/client';
import { resolveSession } from '../services/authService.js';
import { AppError } from '../utils/AppError.js';
import { asyncHandler } from '../utils/asyncHandler.js';

export const SESSION_COOKIE = 'uvgo_session';

function extractToken(authorization: string | undefined, cookieToken: string | undefined) {
  if (cookieToken) return cookieToken;
  if (authorization?.startsWith('Bearer ')) return authorization.slice(7);
  return null;
}

export const requireAuthentication = asyncHandler(async (request, _response, next) => {
  const token = extractToken(request.header('authorization'), request.cookies?.[SESSION_COOKIE] as string | undefined);

  if (!token) {
    throw new AppError(401, 'AUTHENTICATION_REQUIRED', 'Please sign in to continue.');
  }

  const user = await resolveSession(token);
  request.auth = {
    userId: user.id,
    role: user.role,
    name: user.name,
    email: user.email,
  };
  next();
});

export function requireRole(...allowedRoles: UserRole[]): RequestHandler {
  return (request, _response, next) => {
    if (!request.auth) {
      next(new AppError(401, 'AUTHENTICATION_REQUIRED', 'Please sign in to continue.'));
      return;
    }

    if (!allowedRoles.includes(request.auth.role)) {
      next(new AppError(403, 'FORBIDDEN', 'Your account does not have permission to access this resource.'));
      return;
    }

    next();
  };
}

