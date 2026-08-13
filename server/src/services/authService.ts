import type { User, UserRole } from '@prisma/client';
import { compare } from 'bcryptjs';
import jwt, { type SignOptions } from 'jsonwebtoken';
import { env } from '../config/env.js';
import { prisma } from '../lib/prisma.js';
import { AppError } from '../utils/AppError.js';

export type ClientRole = 'dispatcher' | 'driver' | 'passenger';

export interface AuthenticatedUser {
  id: string;
  role: ClientRole;
  name: string;
  contact: string | null;
  email: string;
  redirectTo: string;
}

interface SessionTokenPayload {
  sub: string;
  role: UserRole;
  version: number;
}

const roleNames: Record<UserRole, ClientRole> = {
  DISPATCHER: 'dispatcher',
  DRIVER: 'driver',
  PASSENGER: 'passenger',
};

const redirects: Record<ClientRole, string> = {
  dispatcher: '/dispatcher/dashboard',
  driver: '/driver/dashboard',
  passenger: '/passenger/home',
};

export function toAuthenticatedUser(user: Pick<User, 'id' | 'role' | 'name' | 'contact' | 'email'>): AuthenticatedUser {
  const role = roleNames[user.role];
  return {
    id: user.id,
    role,
    name: user.name,
    contact: user.contact,
    email: user.email,
    redirectTo: redirects[role],
  };
}

export async function authenticateUser(email: string, password: string) {
  const user = await prisma.user.findUnique({ where: { email: email.trim().toLowerCase() } });

  if (!user || !user.isActive || !(await compare(password, user.passwordHash))) {
    throw new AppError(401, 'INVALID_CREDENTIALS', 'The email or password is incorrect.');
  }

  const payload: SessionTokenPayload = {
    sub: user.id,
    role: user.role,
    version: user.tokenVersion,
  };
  const options: SignOptions = {
    expiresIn: env.JWT_EXPIRES_IN as SignOptions['expiresIn'],
    issuer: 'uvgo-api',
    audience: 'uvgo-client',
  };
  const token = jwt.sign(payload, env.JWT_SECRET, options);

  return { token, user: toAuthenticatedUser(user) };
}

export async function resolveSession(token: string) {
  let payload: jwt.JwtPayload;

  try {
    const verified = jwt.verify(token, env.JWT_SECRET, {
      issuer: 'uvgo-api',
      audience: 'uvgo-client',
    });

    if (typeof verified === 'string') throw new Error('Unexpected token payload.');
    payload = verified;
  } catch {
    throw new AppError(401, 'INVALID_SESSION', 'Your session is invalid or has expired.');
  }

  if (typeof payload.sub !== 'string' || typeof payload.version !== 'number') {
    throw new AppError(401, 'INVALID_SESSION', 'Your session is invalid or has expired.');
  }

  const user = await prisma.user.findUnique({ where: { id: payload.sub } });

  if (!user || !user.isActive || user.tokenVersion !== payload.version) {
    throw new AppError(401, 'INVALID_SESSION', 'Your session is invalid or has expired.');
  }

  return user;
}

