import type { CookieOptions, Request, Response } from 'express';
import { env } from '../config/env.js';
import { SESSION_COOKIE } from '../middleware/authMiddleware.js';
import { authenticateUser, toAuthenticatedUser } from '../services/authService.js';
import { AppError } from '../utils/AppError.js';
import { loginSchema } from '../validators/authValidators.js';
import { prisma } from '../lib/prisma.js';

const cookieOptions: CookieOptions = {
  httpOnly: true,
  secure: env.NODE_ENV === 'production',
  sameSite: 'lax',
  path: '/',
  maxAge: 8 * 60 * 60 * 1000,
};

export async function login(request: Request, response: Response) {
  const input = loginSchema.parse(request.body);
  const result = await authenticateUser(input.email, input.password);

  response.cookie(SESSION_COOKIE, result.token, cookieOptions);
  response.status(200).json({ user: result.user });
}

export async function logout(_request: Request, response: Response) {
  response.clearCookie(SESSION_COOKIE, { ...cookieOptions, maxAge: undefined });
  response.status(200).json({ message: 'Signed out successfully.' });
}

export async function me(request: Request, response: Response) {
  if (!request.auth) throw new AppError(401, 'AUTHENTICATION_REQUIRED', 'Please sign in to continue.');

  const user = await prisma.user.findUnique({ where: { id: request.auth.userId } });
  if (!user) throw new AppError(401, 'INVALID_SESSION', 'Your session is invalid or has expired.');

  response.status(200).json({ user: toAuthenticatedUser(user) });
}

