import { RouteCode, UserRole } from '@prisma/client';
import { DEFAULT_GOA_FARE } from '../config/fare.js';
import { prisma } from '../lib/prisma.js';
import { AppError } from '../utils/AppError.js';

export async function getGoaPublicFare() {
  const saved = await prisma.publicRouteFare.findUnique({ where: { route: RouteCode.GOA } });
  return Number(saved?.fareAmount ?? DEFAULT_GOA_FARE);
}

async function requireGoaDispatcher(dispatcherId: string) {
  const dispatcher = await prisma.user.findFirst({
    where: { id: dispatcherId, role: UserRole.DISPATCHER, dispatcherRoute: RouteCode.GOA, isActive: true },
    select: { id: true },
  });
  if (!dispatcher) throw new AppError(403, 'ROUTE_ACCESS_DENIED', 'Only a Goa dispatcher can manage the public Goa fare.');
}

export async function getDispatcherPublicFare(dispatcherId: string) {
  await requireGoaDispatcher(dispatcherId);
  return { fareAmount: await getGoaPublicFare() };
}

export async function updateDispatcherPublicFare(dispatcherId: string, fareAmount: number) {
  await requireGoaDispatcher(dispatcherId);
  const saved = await prisma.publicRouteFare.upsert({
    where: { route: RouteCode.GOA },
    update: { fareAmount },
    create: { route: RouteCode.GOA, fareAmount },
  });
  return { fareAmount: Number(saved.fareAmount) };
}
