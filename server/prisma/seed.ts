import {
  AssignmentStatus,
  DispatchAction,
  DispatchProtocol,
  GeofenceEventType,
  NotificationType,
  PaymentMethod,
  PaymentStatus,
  PrismaClient,
  QueueStatus,
  ReservationStatus,
  RouteCode,
  TripStatus,
  UserRole,
  VehicleStatus,
} from '@prisma/client';
import { hash } from 'bcryptjs';
import { DEFAULT_GOA_FARE } from '../src/config/fare.js';
import { VAN_PASSENGER_CAPACITY } from '../src/config/vehicle.js';
import 'dotenv/config';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const prisma = new PrismaClient();
const DEMO_PASSWORD = 'UVGoDemo123!';

function dateAt(daysFromToday: number, hours: number, minutes = 0) {
  const date = new Date();
  date.setDate(date.getDate() + daysFromToday);
  date.setHours(hours, minutes, 0, 0);
  return date;
}

function manilaServiceDate(daysFromToday = 0) {
  const value = new Date(Date.now() + daysFromToday * 24 * 60 * 60_000);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? '';
  return new Date(`${part('year')}-${part('month')}-${part('day')}T00:00:00.000Z`);
}

export async function clearDemoData() {
  if (process.env.NODE_ENV === 'production' || process.env.DEMO_MODE === 'false') {
    throw new Error('Demo reset is disabled outside demo mode.');
  }

  await prisma.$transaction([
    prisma.tripAssignment.deleteMany(),
    prisma.tayaDailySchedule.deleteMany(),
    prisma.tayaWeeklySchedule.deleteMany(),
    prisma.dispatcherAlertRead.deleteMany(),
    prisma.reservationSeat.deleteMany(),
    prisma.payment.deleteMany(),
    prisma.notification.deleteMany(),
    prisma.dispatchLog.deleteMany(),
    prisma.geofenceEvent.deleteMany(),
    prisma.passengerCount.deleteMany(),
    prisma.reservation.deleteMany(),
    prisma.queueEntry.deleteMany(),
    prisma.trip.deleteMany(),
    prisma.weeklySchedule.deleteMany(),
    prisma.vehicle.deleteMany(),
    prisma.user.deleteMany(),
  ]);
}

export async function seedDemoData() {
  const passwordHash = await hash(DEMO_PASSWORD, 12);

  const dispatcher = await prisma.user.upsert({
    where: { email: 'dispatcher@uvgo.demo' },
    update: { name: 'Juan Dela Cruz', role: UserRole.DISPATCHER, dispatcherRoute: RouteCode.GOA, isActive: true, passwordHash },
    create: {
      id: 'seed_user_dispatcher',
      email: 'dispatcher@uvgo.demo',
      name: 'Juan Dela Cruz',
      contact: '09175558884',
      role: UserRole.DISPATCHER,
      dispatcherRoute: RouteCode.GOA,
      passwordHash,
    },
  });

  const legazpiDispatcher = await prisma.user.upsert({
    where: { email: 'dispatcher.legazpi@uvgo.demo' },
    update: { name: 'Liza Mendoza', role: UserRole.DISPATCHER, dispatcherRoute: RouteCode.LEGAZPI, isActive: true, passwordHash },
    create: {
      id: 'seed_user_dispatcher_legazpi',
      email: 'dispatcher.legazpi@uvgo.demo',
      name: 'Liza Mendoza',
      contact: '09175558885',
      role: UserRole.DISPATCHER,
      dispatcherRoute: RouteCode.LEGAZPI,
      passwordHash,
    },
  });

  const driverSpecs = [
    ['seed_user_driver_rodel', 'driver.rodel@uvgo.demo', 'Rodel Reyes', '09171234567', dispatcher.id],
    ['seed_user_driver_mario', 'driver.mario@uvgo.demo', 'Mario Bautista', '09171234568', dispatcher.id],
    ['seed_user_driver_pedro', 'driver.pedro@uvgo.demo', 'Pedro Enriquez', '09171234569', legazpiDispatcher.id],
    ['seed_user_driver_noel', 'driver.noel@uvgo.demo', 'Noel Beleno', '09171234570', legazpiDispatcher.id],
  ] as const;

  const drivers = await Promise.all(
    driverSpecs.map(([id, email, name, contact, managedByDispatcherId]) =>
      prisma.user.upsert({
        where: { email },
        update: { name, contact, role: UserRole.DRIVER, isActive: true, passwordHash, managedByDispatcherId },
        create: { id, email, name, contact, role: UserRole.DRIVER, passwordHash, managedByDispatcherId },
      }),
    ),
  );

  const passengerSpecs = [
    ['seed_user_passenger_ana', 'passenger@uvgo.demo', 'Ana Reyes', '09172345670'],
    ['seed_user_passenger_maria', 'maria.santos@uvgo.demo', 'Maria Santos', '09172345671'],
    ['seed_user_passenger_john', 'john.cruz@uvgo.demo', 'John Dela Cruz', '09172345672'],
  ] as const;

  const passengers = await Promise.all(
    passengerSpecs.map(([id, email, name, contact]) =>
      prisma.user.upsert({
        where: { email },
        update: { name, contact, role: UserRole.PASSENGER, isActive: true, passwordHash },
        create: { id, email, name, contact, role: UserRole.PASSENGER, passwordHash },
      }),
    ),
  );

  const vehicleSpecs = [
    { id: 'seed_vehicle_033', vanId: 'VAN-033', plateNo: 'EAG-033', route: RouteCode.GOA, protocol: DispatchProtocol.GOSO, capacity: VAN_PASSENGER_CAPACITY, status: VehicleStatus.AT_TERMINAL, assignedDriverId: drivers[0].id, managedByDispatcherId: dispatcher.id, inside: true },
    { id: 'seed_vehicle_021', vanId: 'VAN-021', plateNo: 'EAG-021', route: RouteCode.GOA, protocol: DispatchProtocol.GOSO, capacity: VAN_PASSENGER_CAPACITY, status: VehicleStatus.INCOMING, assignedDriverId: drivers[1].id, managedByDispatcherId: dispatcher.id, inside: true },
    { id: 'seed_vehicle_019', vanId: 'VAN-019', plateNo: 'EAG-019', route: RouteCode.LEGAZPI, protocol: DispatchProtocol.TAYA, capacity: VAN_PASSENGER_CAPACITY, status: VehicleStatus.DELAYED, assignedDriverId: drivers[2].id, managedByDispatcherId: legazpiDispatcher.id, inside: true },
    { id: 'seed_vehicle_005', vanId: 'VAN-005', plateNo: 'EAG-005', route: RouteCode.LEGAZPI, protocol: DispatchProtocol.TAYA, capacity: VAN_PASSENGER_CAPACITY, status: VehicleStatus.OUTSIDE_ZONE, assignedDriverId: drivers[3].id, managedByDispatcherId: legazpiDispatcher.id, inside: false },
  ] as const;

  const vehicles = await Promise.all(
    vehicleSpecs.map((vehicle) =>
      prisma.vehicle.upsert({
        where: { vanId: vehicle.vanId },
        update: {
          plateNo: vehicle.plateNo,
          route: vehicle.route,
          protocol: vehicle.protocol,
          capacity: vehicle.capacity,
          status: vehicle.status,
          assignedDriverId: vehicle.assignedDriverId,
          managedByDispatcherId: vehicle.managedByDispatcherId,
          lastKnownInsideZone: vehicle.inside,
          insideTerminalZone: vehicle.inside && vehicle.status !== VehicleStatus.INCOMING,
          locationTrackingActive: vehicle.inside,
          goOnTripEnabled: vehicle.id === 'seed_vehicle_033',
          latestLatitude: null,
          latestLongitude: null,
          latestLocationAccuracyM: null,
          latestLocationObservedAt: null,
          latestDistanceKm: null,
          terminalEntrySampleCount: 0,
          terminalExitSampleCount: 0,
          departureSequenceStartKm: null,
          departureAuthorizedAt: null,
          departureAuthorizedTripId: null,
          departureReviewRequired: false,
          departureReviewReason: null,
        },
        create: {
          id: vehicle.id,
          vanId: vehicle.vanId,
          plateNo: vehicle.plateNo,
          route: vehicle.route,
          protocol: vehicle.protocol,
          capacity: vehicle.capacity,
          status: vehicle.status,
          assignedDriverId: vehicle.assignedDriverId,
          managedByDispatcherId: vehicle.managedByDispatcherId,
          lastKnownInsideZone: vehicle.inside,
          insideTerminalZone: vehicle.inside && vehicle.status !== VehicleStatus.INCOMING,
          locationTrackingActive: vehicle.inside,
          goOnTripEnabled: vehicle.id === 'seed_vehicle_033',
          latestArrivalAt: vehicle.inside ? dateAt(0, 9, 15) : null,
        },
      }),
    ),
  );

  const queueSpecs = [
    { id: 'seed_queue_goa_1', vehicleId: vehicles[0].id, route: RouteCode.GOA, position: 1, arrivalTimestamp: dateAt(0, 9, 15), status: QueueStatus.ASSIGNED },
    { id: 'seed_queue_goa_2', vehicleId: vehicles[1].id, route: RouteCode.GOA, position: 2, arrivalTimestamp: dateAt(0, 9, 28), status: QueueStatus.WAITING },
    { id: 'seed_queue_legazpi_1', vehicleId: vehicles[2].id, route: RouteCode.LEGAZPI, position: 1, arrivalTimestamp: dateAt(0, 9, 10), status: QueueStatus.DELAYED },
    { id: 'seed_queue_legazpi_2', vehicleId: vehicles[3].id, route: RouteCode.LEGAZPI, position: 2, arrivalTimestamp: dateAt(0, 9, 35), status: QueueStatus.WAITING },
  ] as const;

  const queues = await Promise.all(
    queueSpecs.map((queue) =>
      prisma.queueEntry.upsert({
        where: { id: queue.id },
        update: queue,
        create: queue,
      }),
    ),
  );

  const goaTrip = await prisma.trip.upsert({
    where: { id: 'seed_trip_goa_morning' },
    update: { vehicleId: vehicles[0].id, scheduledOrTriggeredTime: dateAt(1, 10), boardingStartTime: dateAt(1, 9, 50), status: TripStatus.ASSIGNED, fareAmount: DEFAULT_GOA_FARE, createdByDispatcherId: dispatcher.id },
    create: { id: 'seed_trip_goa_morning', vehicleId: vehicles[0].id, route: RouteCode.GOA, scheduledOrTriggeredTime: dateAt(1, 10), boardingStartTime: dateAt(1, 9, 50), status: TripStatus.ASSIGNED, fareAmount: DEFAULT_GOA_FARE, createdByDispatcherId: dispatcher.id },
  });

  await prisma.trip.upsert({
    where: { id: 'seed_trip_goa_day_two' },
    update: { vehicleId: vehicles[0].id, scheduledOrTriggeredTime: dateAt(2, 8), boardingStartTime: dateAt(2, 7, 50), status: TripStatus.SCHEDULED, fareAmount: DEFAULT_GOA_FARE, createdByDispatcherId: dispatcher.id },
    create: { id: 'seed_trip_goa_day_two', vehicleId: vehicles[0].id, route: RouteCode.GOA, scheduledOrTriggeredTime: dateAt(2, 8), boardingStartTime: dateAt(2, 7, 50), status: TripStatus.SCHEDULED, fareAmount: DEFAULT_GOA_FARE, createdByDispatcherId: dispatcher.id },
  });

  await prisma.trip.upsert({
    where: { id: 'seed_trip_goa_day_three' },
    update: { vehicleId: vehicles[0].id, scheduledOrTriggeredTime: dateAt(3, 10), boardingStartTime: dateAt(3, 9, 50), status: TripStatus.SCHEDULED, fareAmount: DEFAULT_GOA_FARE, createdByDispatcherId: dispatcher.id },
    create: { id: 'seed_trip_goa_day_three', vehicleId: vehicles[0].id, route: RouteCode.GOA, scheduledOrTriggeredTime: dateAt(3, 10), boardingStartTime: dateAt(3, 9, 50), status: TripStatus.SCHEDULED, fareAmount: DEFAULT_GOA_FARE, createdByDispatcherId: dispatcher.id },
  });

  const legazpiTrip = await prisma.trip.upsert({
    where: { id: 'seed_trip_legazpi_loading' },
    update: { vehicleId: vehicles[2].id, scheduledOrTriggeredTime: dateAt(0, 11), boardingStartTime: dateAt(0, 10, 30), status: TripStatus.BOARDING, fareAmount: 250, createdByDispatcherId: legazpiDispatcher.id },
    create: { id: 'seed_trip_legazpi_loading', vehicleId: vehicles[2].id, route: RouteCode.LEGAZPI, scheduledOrTriggeredTime: dateAt(0, 11), boardingStartTime: dateAt(0, 10, 30), status: TripStatus.BOARDING, fareAmount: 250, createdByDispatcherId: legazpiDispatcher.id },
  });

  await prisma.tripAssignment.upsert({
    where: { tripId_queueEntryId: { tripId: goaTrip.id, queueEntryId: queues[0].id } },
    update: { driverId: drivers[0].id, status: AssignmentStatus.ACCEPTED, respondedAt: dateAt(0, 9, 30), responseDeadline: dateAt(1, 9, 50) },
    create: {
      id: 'seed_assignment_goa',
      tripId: goaTrip.id,
      queueEntryId: queues[0].id,
      driverId: drivers[0].id,
      status: AssignmentStatus.ACCEPTED,
      assignedAt: dateAt(0, 9, 30),
      // Kept for historical schema compatibility; assignments are active immediately.
      responseDeadline: dateAt(1, 9, 50),
      respondedAt: dateAt(0, 9, 30),
    },
  });

  const legazpiAssignment = await prisma.tripAssignment.upsert({
    where: { tripId_queueEntryId: { tripId: legazpiTrip.id, queueEntryId: queues[2].id } },
    update: { driverId: drivers[2].id, status: AssignmentStatus.ACCEPTED, respondedAt: dateAt(0, 9, 20), responseDeadline: dateAt(0, 9, 25) },
    create: {
      id: 'seed_assignment_legazpi',
      tripId: legazpiTrip.id,
      queueEntryId: queues[2].id,
      driverId: drivers[2].id,
      status: AssignmentStatus.ACCEPTED,
      assignedAt: dateAt(0, 9, 15),
      responseDeadline: dateAt(0, 9, 25),
      respondedAt: dateAt(0, 9, 20),
    },
  });
  void legazpiAssignment;

  const serviceDate = manilaServiceDate();
  await prisma.tayaDailySchedule.upsert({
    where: { serviceDate_vehicleId: { serviceDate, vehicleId: vehicles[2].id } },
    update: { dispatcherId: legazpiDispatcher.id, position: 1, queueEntryId: queues[2].id, tripId: legazpiTrip.id },
    create: { id: 'seed_taya_daily_1', dispatcherId: legazpiDispatcher.id, vehicleId: vehicles[2].id, serviceDate, position: 1, queueEntryId: queues[2].id, tripId: legazpiTrip.id },
  });
  await prisma.tayaDailySchedule.upsert({
    where: { serviceDate_vehicleId: { serviceDate, vehicleId: vehicles[3].id } },
    update: { dispatcherId: legazpiDispatcher.id, position: 2, queueEntryId: queues[3].id },
    create: { id: 'seed_taya_daily_2', dispatcherId: legazpiDispatcher.id, vehicleId: vehicles[3].id, serviceDate, position: 2, queueEntryId: queues[3].id },
  });
  const serviceWeekday = serviceDate.getUTCDay() === 0 ? 7 : serviceDate.getUTCDay();
  await prisma.tayaWeeklySchedule.upsert({
    where: { weekday_vehicleId: { weekday: serviceWeekday, vehicleId: vehicles[2].id } },
    update: { dispatcherId: legazpiDispatcher.id, position: 1 },
    create: { id: 'seed_taya_weekly_1', dispatcherId: legazpiDispatcher.id, vehicleId: vehicles[2].id, weekday: serviceWeekday, position: 1 },
  });
  await prisma.tayaWeeklySchedule.upsert({
    where: { weekday_vehicleId: { weekday: serviceWeekday, vehicleId: vehicles[3].id } },
    update: { dispatcherId: legazpiDispatcher.id, position: 2 },
    create: { id: 'seed_taya_weekly_2', dispatcherId: legazpiDispatcher.id, vehicleId: vehicles[3].id, weekday: serviceWeekday, position: 2 },
  });

  const confirmedReservation = await prisma.reservation.upsert({
    where: { reference: 'UVGO-DEMO-001' },
    update: { passengerId: passengers[0].id, tripId: goaTrip.id, seatCount: 1, fareAmount: DEFAULT_GOA_FARE, status: ReservationStatus.CONFIRMED },
    create: { id: 'seed_reservation_confirmed', reference: 'UVGO-DEMO-001', passengerId: passengers[0].id, tripId: goaTrip.id, seatCount: 1, fareAmount: DEFAULT_GOA_FARE, status: ReservationStatus.CONFIRMED },
  });

  const pendingReservation = await prisma.reservation.upsert({
    where: { reference: 'UVGO-DEMO-002' },
    update: { passengerId: passengers[1].id, tripId: goaTrip.id, seatCount: 2, fareAmount: DEFAULT_GOA_FARE * 2, status: ReservationStatus.PENDING_VERIFICATION },
    create: { id: 'seed_reservation_pending', reference: 'UVGO-DEMO-002', passengerId: passengers[1].id, tripId: goaTrip.id, seatCount: 2, fareAmount: DEFAULT_GOA_FARE * 2, status: ReservationStatus.PENDING_VERIFICATION },
  });

  const seatSpecs = [
    { id: 'seed_seat_4', reservationId: confirmedReservation.id, tripId: goaTrip.id, seatNumber: 4 },
    { id: 'seed_seat_8', reservationId: pendingReservation.id, tripId: goaTrip.id, seatNumber: 8 },
    { id: 'seed_seat_9', reservationId: pendingReservation.id, tripId: goaTrip.id, seatNumber: 9 },
  ];
  await Promise.all(seatSpecs.map((seat) => prisma.reservationSeat.upsert({ where: { tripId_seatNumber: { tripId: seat.tripId, seatNumber: seat.seatNumber } }, update: { reservationId: seat.reservationId }, create: seat })));

  await prisma.payment.upsert({
    where: { paypalOrderId: 'DEMO-PAYPAL-ORDER-001' },
    update: { reservationId: confirmedReservation.id, method: PaymentMethod.PAYPAL, amount: DEFAULT_GOA_FARE, status: PaymentStatus.CAPTURED, paidAt: dateAt(0, 8, 45) },
    create: { id: 'seed_payment_paypal', reservationId: confirmedReservation.id, method: PaymentMethod.PAYPAL, paypalOrderId: 'DEMO-PAYPAL-ORDER-001', amount: DEFAULT_GOA_FARE, status: PaymentStatus.CAPTURED, paidAt: dateAt(0, 8, 45) },
  });

  await prisma.payment.upsert({
    where: { id: 'seed_payment_gcash' },
    update: { reservationId: pendingReservation.id, method: PaymentMethod.GCASH_RECEIPT, gcashReference: 'GCASH-DEMO-7788', receiptImageKey: 'demo/gcash-receipt.webp', receiptMimeType: 'image/webp', amount: DEFAULT_GOA_FARE * 2, status: PaymentStatus.PENDING_VERIFICATION, verifiedByUserId: null, verifiedAt: null, rejectionReason: null },
    create: { id: 'seed_payment_gcash', reservationId: pendingReservation.id, method: PaymentMethod.GCASH_RECEIPT, gcashReference: 'GCASH-DEMO-7788', receiptImageKey: 'demo/gcash-receipt.webp', receiptMimeType: 'image/webp', amount: DEFAULT_GOA_FARE * 2, status: PaymentStatus.PENDING_VERIFICATION },
  });

  await prisma.geofenceEvent.upsert({
    where: { id: 'seed_geofence_entered_033' },
    update: { timestamp: dateAt(0, 9, 15) },
    create: { id: 'seed_geofence_entered_033', vehicleId: vehicles[0].id, eventType: GeofenceEventType.ENTERED, timestamp: dateAt(0, 9, 15), latitude: 13.622917, longitude: 123.204842, distanceKm: 0.15 },
  });

  await prisma.passengerCount.upsert({
    where: { id: 'seed_count_goa' },
    update: { count: VAN_PASSENGER_CAPACITY, timestamp: dateAt(0, 9, 42) },
    create: { id: 'seed_count_goa', vehicleId: vehicles[0].id, tripId: goaTrip.id, count: VAN_PASSENGER_CAPACITY, submittedByDriverId: drivers[0].id, timestamp: dateAt(0, 9, 42) },
  });

  await prisma.passengerCount.upsert({
    where: { id: 'seed_count_legazpi' },
    update: { count: 10, timestamp: dateAt(0, 9, 40) },
    create: { id: 'seed_count_legazpi', vehicleId: vehicles[2].id, tripId: legazpiTrip.id, count: 10, submittedByDriverId: drivers[2].id, timestamp: dateAt(0, 9, 40) },
  });

  await prisma.notification.upsert({
    where: { id: 'seed_notification_passenger' },
    update: { message: 'Your Goa reservation UVGO-DEMO-001 is confirmed.', isRead: false },
    create: { id: 'seed_notification_passenger', userId: passengers[0].id, type: NotificationType.BOOKING, message: 'Your Goa reservation UVGO-DEMO-001 is confirmed.', isRead: false },
  });

  await prisma.dispatchLog.upsert({
    where: { id: 'seed_dispatch_log_assignment' },
    update: { actorUserId: dispatcher.id, targetId: goaTrip.id, route: RouteCode.GOA, reason: 'Demo assignment created by seed data.' },
    create: { id: 'seed_dispatch_log_assignment', actorUserId: dispatcher.id, action: DispatchAction.ASSIGNMENT_CREATED, targetId: goaTrip.id, route: RouteCode.GOA, reason: 'Demo assignment created by seed data.', metadata: { queueEntryId: queues[0].id } },
  });

  // Demo and operations-managed accounts are trusted fixtures. Public passenger
  // registrations start unverified and use the email challenge flow instead.
  await prisma.user.updateMany({ data: { emailVerifiedAt: new Date() } });

  console.log('UVGo seed complete.');
  console.log('Demo password for all accounts:', DEMO_PASSWORD);
  console.log('Goa dispatcher: dispatcher@uvgo.demo');
  console.log('Legazpi dispatcher: dispatcher.legazpi@uvgo.demo');
  console.log('Driver: driver.rodel@uvgo.demo');
  console.log('Passenger: passenger@uvgo.demo');
}

export async function resetDemoData() {
  await clearDemoData();
  await seedDemoData();
}

export async function disconnectSeedClient() {
  await prisma.$disconnect();
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (invokedPath === import.meta.url) {
  seedDemoData()
    .catch((error: unknown) => {
      console.error('UVGo seed failed:', error);
      process.exitCode = 1;
    })
    .finally(async () => {
      await disconnectSeedClient();
    });
}
