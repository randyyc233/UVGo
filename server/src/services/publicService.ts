import {
  DispatchProtocol,
  QueueStatus,
  ReservationStatus,
  RouteCode,
  VehicleStatus,
} from '@prisma/client';
import { NCEBT } from '../config/terminal.js';
import { prisma } from '../lib/prisma.js';

type PublicStatusCode = 'incoming' | 'waiting' | 'loading' | 'ready' | 'departed' | 'delayed';

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

function resolvePublicStatus(queueStatus: QueueStatus, vehicleStatus: VehicleStatus) {
  if (queueStatus === QueueStatus.DEPARTED) return { code: 'departed' as const, label: 'Departed' };
  if (queueStatus === QueueStatus.DELAYED || vehicleStatus === VehicleStatus.DELAYED) return { code: 'delayed' as const, label: 'Delayed' };
  if (queueStatus === QueueStatus.READY_FOR_DISPATCH || vehicleStatus === VehicleStatus.READY_FOR_DISPATCH) {
    return { code: 'ready' as const, label: 'Ready for Dispatch' };
  }
  if (vehicleStatus === VehicleStatus.INCOMING) return { code: 'incoming' as const, label: 'Incoming' };
  if (vehicleStatus === VehicleStatus.AT_TERMINAL || vehicleStatus === VehicleStatus.LOADING) {
    return { code: 'loading' as const, label: 'Loading' };
  }
  return { code: 'waiting' as const, label: 'Waiting' };
}

export async function getPublicDepartures() {
  const entries = await prisma.queueEntry.findMany({
    where: {
      status: {
        notIn: [QueueStatus.REJECTED, QueueStatus.REPLACED],
      },
    },
    orderBy: [{ route: 'asc' }, { position: 'asc' }],
    include: {
      vehicle: {
        include: {
          trips: {
            where: { status: { notIn: ['COMPLETED', 'UNABLE_TO_DEPART'] } },
            orderBy: { scheduledOrTriggeredTime: 'asc' },
            take: 1,
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

  const departures = entries.map((entry) => {
    const trip = entry.vehicle.trips[0] ?? null;
    const submittedOccupancy = trip?.passengerCounts[0]?.count;
    const reservedOccupancy = trip?.reservations.reduce((total, reservation) => total + reservation.seatCount, 0) ?? 0;
    const occupancy = Math.min(entry.vehicle.capacity, submittedOccupancy ?? reservedOccupancy);
    const reservable = entry.route === RouteCode.GOA;
    const status = resolvePublicStatus(entry.status, entry.vehicle.status);

    return {
      id: entry.id,
      route: routeNames[entry.route],
      routeCode: entry.route.toLowerCase(),
      origin: NCEBT.name,
      destination: destinationNames[entry.route],
      vanId: entry.vehicle.vanId,
      protocol: protocolNames[entry.vehicle.protocol],
      departureTime: trip?.scheduledOrTriggeredTime.toISOString() ?? null,
      queuePosition: entry.position,
      occupancy: {
        count: occupancy,
        capacity: entry.vehicle.capacity,
        percent: Math.round((occupancy / entry.vehicle.capacity) * 100),
      },
      availableSeats: reservable ? Math.max(0, entry.vehicle.capacity - occupancy) : null,
      status: status as { code: PublicStatusCode; label: string },
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
      status: { notIn: ['COMPLETED', 'UNABLE_TO_DEPART'] },
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
        fare: 190,
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
        nextDeparture: nextDepartureByRoute.get(RouteCode.LEGAZPI) ?? null,
        summary: 'Status-only service that departs when the van reaches full occupancy.',
      },
    ],
  };
}

