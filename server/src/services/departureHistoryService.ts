import { AssignmentStatus, RouteCode } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { AppError } from '../utils/AppError.js';
import { manilaServiceDay } from './driverSchedulePolicy.js';

const dismissalPrefix = 'departure-history:';

export async function getDepartureHistory(dispatcherId: string, route: RouteCode, date: string) {
  const day = manilaServiceDay(new Date(`${date}T00:00:00+08:00`));
  const dismissed = await prisma.dispatcherAlertRead.findMany({
    where: { userId: dispatcherId, alertKey: { startsWith: dismissalPrefix }, dismissedAt: { not: null } },
    select: { alertKey: true },
  });
  const trips = await prisma.trip.findMany({
    where: {
      route,
      departedAt: { gte: day.start, lt: day.end },
      id: { notIn: dismissed.map((item) => item.alertKey.slice(dismissalPrefix.length)) },
    },
    orderBy: [{ departedAt: 'desc' }, { id: 'desc' }],
    select: {
      id: true, route: true, departedAt: true, scheduledOrTriggeredTime: true,
      vehicle: { select: { vanId: true } },
      assignments: {
        where: { status: AssignmentStatus.ACCEPTED },
        orderBy: { assignedAt: 'desc' },
        select: { assignedAt: true, driver: { select: { name: true } } },
      },
      passengerCounts: {
        orderBy: { timestamp: 'desc' },
        select: { count: true, timestamp: true, submittedBy: { select: { name: true } } },
      },
    },
  });
  return {
    date,
    departures: trips.map((trip) => {
      const departedAt = trip.departedAt!;
      const count = trip.passengerCounts.find((item) => item.timestamp <= departedAt);
      const assignment = trip.assignments.find((item) => item.assignedAt <= departedAt);
      return {
        id: trip.id,
        routeCode: trip.route.toLowerCase(),
        vanId: trip.vehicle.vanId,
        driver: assignment?.driver.name ?? count?.submittedBy.name ?? 'Not recorded',
        departedAt: departedAt.toISOString(),
        scheduledDepartureTime: route === RouteCode.GOA ? trip.scheduledOrTriggeredTime.toISOString() : null,
        passengerCount: count?.count ?? null,
      };
    }),
  };
}

export async function dismissDepartureHistory(dispatcherId: string, route: RouteCode, tripId: string) {
  const trip = await prisma.trip.findUnique({ where: { id: tripId }, select: { route: true, departedAt: true } });
  if (!trip) throw new AppError(404, 'DEPARTURE_NOT_FOUND', 'This departure was not found.');
  if (trip.route !== route) throw new AppError(403, 'ROUTE_ACCESS_DENIED', 'You can delete departure history only for your assigned route.');
  if (!trip.departedAt) throw new AppError(409, 'TRIP_NOT_DEPARTED', 'Only confirmed departures can be removed from history.');
  // Dismiss only this dispatcher's list entry. Operational trip data and audit
  // logs remain intact, including data used by queue rotation and bookings.
  const alertKey = `${dismissalPrefix}${tripId}`;
  const dismissedAt = new Date();
  await prisma.dispatcherAlertRead.upsert({
    where: { userId_alertKey: { userId: dispatcherId, alertKey } },
    update: { dismissedAt, readAt: dismissedAt },
    create: { userId: dispatcherId, alertKey, dismissedAt, readAt: dismissedAt },
  });
}
