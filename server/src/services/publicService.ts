import {
  AssignmentStatus,
  DispatchProtocol,
  ReservationStatus,
  RouteCode,
  TripStatus,
  VehicleStatus,
} from '@prisma/client';
import { DEFAULT_GOA_FARE } from '../config/fare.js';
import { NCEBT } from '../config/terminal.js';
import { passengerCapacityOf } from '../config/vehicle.js';
import { prisma } from '../lib/prisma.js';
import { manilaServiceDay } from './driverSchedulePolicy.js';
import { admitAcceptedGosoSchedulesForDay, operationalQueueStatuses } from './queueSchedulingService.js';
import { selectTripForQueueRow } from './queueTripSelection.js';
import { syncTayaDailyQueue } from './tayaQueueService.js';

const activeTripStatuses = [TripStatus.SCHEDULED, TripStatus.ASSIGNING, TripStatus.ASSIGNED, TripStatus.BOARDING, TripStatus.READY, TripStatus.DELAYED];

const routeNames: Record<RouteCode, 'Goa' | 'Legazpi'> = {
  GOA: 'Goa',
  LEGAZPI: 'Legazpi',
};

const protocolNames: Record<DispatchProtocol, 'Goso' | 'Taya'> = {
  GOSO: 'Goso',
  TAYA: 'Taya',
};

const destinationNames: Record<RouteCode, string> = {
  GOA: 'Goa Terminal',
  LEGAZPI: 'Legazpi Central Terminal',
};

export async function getPublicDepartures() {
  await Promise.all([admitAcceptedGosoSchedulesForDay(), syncTayaDailyQueue()]);
  const today = manilaServiceDay(new Date());
  const tayaServiceDate = new Date(`${today.date}T00:00:00.000Z`);
  const entries = await prisma.queueEntry.findMany({
    where: {
      status: { in: operationalQueueStatuses },
      vehicle: { status: { notIn: [VehicleStatus.ON_TRIP, VehicleStatus.UNAVAILABLE] } },
      OR: [
        { route: RouteCode.GOA, scheduledLoadingTime: { gte: today.start, lt: today.end } },
        { route: RouteCode.LEGAZPI, tayaDailySchedule: { is: { serviceDate: tayaServiceDate } } },
      ],
    },
    orderBy: [{ route: 'asc' }, { position: 'asc' }],
    include: {
      assignments: {
        where: { status: { in: [AssignmentStatus.PENDING, AssignmentStatus.ACCEPTED] } },
        orderBy: { assignedAt: 'desc' },
        select: { tripId: true },
      },
      vehicle: {
        include: {
          trips: {
            where: { status: { in: activeTripStatuses }, departedAt: null },
            orderBy: { scheduledOrTriggeredTime: 'asc' },
            include: {
              passengerCounts: {
                orderBy: { timestamp: 'desc' },
                take: 1,
              },
              reservations: {
                where: { status: { in: [ReservationStatus.CONFIRMED, ReservationStatus.REALLOCATED] } },
                select: { seatCount: true },
              },
            },
          },
        },
      },
    },
  });

  const routePositions = new Map<RouteCode, number>();
  const departures = entries.map((entry) => {
    const trip = selectTripForQueueRow(entry.scheduledLoadingTime, entry.assignments, entry.vehicle.trips);
    const capacity = passengerCapacityOf(entry.vehicle);
    const submittedOccupancy = trip?.passengerCounts[0]?.count;
    const reservedOccupancy = trip?.reservations.reduce((total, reservation) => total + reservation.seatCount, 0) ?? 0;
    const occupancy = Math.min(capacity, submittedOccupancy ?? reservedOccupancy);
    const reservable = entry.route === RouteCode.GOA;
    const routePosition = (routePositions.get(entry.route) ?? 0) + 1;
    routePositions.set(entry.route, routePosition);
    return {
      id: entry.id,
      route: routeNames[entry.route],
      routeCode: entry.route.toLowerCase(),
      origin: NCEBT.name,
      destination: destinationNames[entry.route],
      vanId: entry.vehicle.vanId,
      protocol: protocolNames[entry.vehicle.protocol],
      // Taya has no public fixed departure schedule; its actual departure is
      // determined by the existing occupancy and dispatch rules.
      departureTime: entry.route === RouteCode.GOA ? trip?.scheduledOrTriggeredTime.toISOString() ?? null : null,
      queuePosition: entry.route === RouteCode.GOA ? routePosition : entry.position,
      occupancy: {
        count: occupancy,
        capacity,
        percent: Math.round((occupancy / capacity) * 100),
      },
      availableSeats: reservable ? Math.max(0, capacity - occupancy) : null,
      reservable,
    };
  });

  return {
    terminal: {
      name: NCEBT.name,
      address: NCEBT.address,
    },
    departures,
    updatedAt: new Date().toISOString(),
  };
}

export async function getPublicRoutes() {
  const nextTrips = await prisma.trip.findMany({
    where: {
      status: { in: activeTripStatuses },
      departedAt: null,
    },
    distinct: ['route'],
    orderBy: { scheduledOrTriggeredTime: 'asc' },
    select: { route: true, scheduledOrTriggeredTime: true },
  });

  const nextDepartureByRoute = new Map(nextTrips.map((trip) => [trip.route, trip.scheduledOrTriggeredTime.toISOString()]));

  return {
    origin: NCEBT.name,
    routes: [
      {
        code: 'goa',
        name: 'Goa',
        destination: destinationNames.GOA,
        protocol: 'Goso',
        reservable: true,
        fare: DEFAULT_GOA_FARE,
        nextDeparture: nextDepartureByRoute.get(RouteCode.GOA) ?? null,
        summary: 'Scheduled departures with advance seat reservations.',
      },
      {
        code: 'legazpi',
        name: 'Legazpi',
        destination: destinationNames.LEGAZPI,
        protocol: 'Taya',
        reservable: false,
        fare: null,
        nextDeparture: null,
        summary: 'Departs when the van reaches full occupancy. No online reservations.',
      },
    ],
  };
}
