import { Prisma, type RouteCode, UserRole } from '@prisma/client';
import { hash } from 'bcryptjs';
import { prisma } from '../lib/prisma.js';
import { AppError } from '../utils/AppError.js';

const routeLabels: Record<RouteCode, string> = { GOA: 'Goa', LEGAZPI: 'Legazpi' };

interface CreateBackupDispatcherInput {
  name: string;
  contact: string;
  email: string;
  password: string;
}

async function assertRouteDispatcher(dispatcherId: string, route: RouteCode) {
  const dispatcher = await prisma.user.findFirst({
    where: { id: dispatcherId, role: UserRole.DISPATCHER, dispatcherRoute: route, isActive: true },
    select: { id: true },
  });
  if (!dispatcher) throw new AppError(403, 'ROUTE_ACCESS_DENIED', 'You cannot manage dispatcher accounts for this route.');
}

export async function getRouteDispatchers(dispatcherId: string, route: RouteCode) {
  await assertRouteDispatcher(dispatcherId, route);
  const dispatchers = await prisma.user.findMany({
    where: { role: UserRole.DISPATCHER, dispatcherRoute: route },
    orderBy: [{ isActive: 'desc' }, { createdAt: 'asc' }, { name: 'asc' }],
    include: { managedByDispatcher: { select: { id: true, name: true } } },
  });

  return {
    route: routeLabels[route],
    routeCode: route.toLowerCase(),
    dispatchers: dispatchers.map((dispatcher) => ({
      id: dispatcher.id,
      name: dispatcher.name,
      contact: dispatcher.contact,
      email: dispatcher.email,
      isActive: dispatcher.isActive,
      isCurrentAccount: dispatcher.id === dispatcherId,
      createdAt: dispatcher.createdAt.toISOString(),
      createdBy: dispatcher.managedByDispatcher?.name ?? null,
    })),
  };
}

export async function createBackupDispatcher(dispatcherId: string, route: RouteCode, input: CreateBackupDispatcherInput) {
  await assertRouteDispatcher(dispatcherId, route);
  const passwordHash = await hash(input.password, 12);
  try {
    await prisma.user.create({
      data: {
        role: UserRole.DISPATCHER,
        dispatcherRoute: route,
        name: input.name,
        contact: input.contact,
        email: input.email,
        passwordHash,
        emailVerifiedAt: new Date(),
        isActive: true,
        managedByDispatcherId: dispatcherId,
      },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new AppError(409, 'EMAIL_ALREADY_IN_USE', 'Another UVGo account already uses this email address.');
    }
    throw error;
  }
  return getRouteDispatchers(dispatcherId, route);
}
