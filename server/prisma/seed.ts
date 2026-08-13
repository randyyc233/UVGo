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

export async function clearDemoData() {
  if (process.env.NODE_ENV === 'production' || process.env.DEMO_MODE === 'false') {
    throw new Error('Demo reset is disabled outside demo mode.');
  }

  await prisma.$transaction([
    prisma.tripAssignment.deleteMany(),
    prisma.reservationSeat.deleteMany(),
    prisma.payment.deleteMany(),
    prisma.notification.deleteMany(),
    prisma.dispatchLog.deleteMany(),
    prisma.geofenceEvent.deleteMany(),
    prisma.passengerCount.deleteMany(),
    prisma.reservation.deleteMany(),
    prisma.queueEntry.deleteMany(),
    prisma.trip.deleteMany(),
    prisma.vehicle.deleteMany(),
    prisma.user.deleteMany(),
  ]);
}

export async function seedDemoData() {
  const passwordHash = await hash(DEMO_PASSWORD, 12);

  const dispatcher = await prisma.user.upsert({
    where: { email: 'dispatcher@uvgo.demo' },
    update: { name: 'Juan Dela Cruz', role: UserRole.DISPATCHER, isActive: true, passwordHash },
    create: {
      id: 'seed_user_dispatcher',
      email: 'dispatcher@uvgo.demo',
      name: 'Juan Dela Cruz',
      contact: '09175558884',
      role: UserRole.DISPATCHER,
      passwordHash,
    },
  });

  const driverSpecs = [
    ['seed_user_driver_rodel', 'driver.rodel@uvgo.demo', 'Rodel Reyes', '09171234567'],
    ['seed_user_driver_mario', 'driver.mario@uvgo.demo', 'Mario Bautista', '09171234568'],
    ['seed_user_driver_pedro', 'driver.pedro@uvgo.demo', 'Pedro Enriquez', '09171234569'],
    ['seed_user_driver_noel', 'driver.noel@uvgo.demo', 'Noel Beleno', '09171234570'],
  ] as const;

  const drivers = await Promise.all(
    driverSpecs.map(([id, email, name, contact]) =>
      prisma.user.upsert({
        where: { email },
        update: { name, contact, role: UserRole.DRIVER, isActive: true, passwordHash },
        create: { id, email, name, contact, role: UserRole.DRIVER, passwordHash },
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
    { id: 'seed_vehicle_033', vanId: 'VAN-033', plateNo: 'EAG-033', route: RouteCode.GOA, protocol: DispatchProtocol.GOSO, capacity: 17, status: VehicleStatus.AT_TERMINAL, assignedDriverId: drivers[0].id, inside: true },
    { id: 'seed_vehicle_021', vanId: 'VAN-021', plateNo: 'EAG-021', route: RouteCode.GOA, protocol: DispatchProtocol.GOSO, capacity: 15, status: VehicleStatus.INCOMING, assignedDriverId: drivers[1].id, inside: true },
    { id: 'seed_vehicle_019', vanId: 'VAN-019', plateNo: 'EAG-019', route: RouteCode.LEGAZPI, protocol: DispatchProtocol.TAYA, capacity: 15, status: VehicleStatus.DELAYED, assignedDriverId: drivers[2].id, inside: true },
    { id: 'seed_vehicle_005', vanId: 'VAN-005', plateNo: 'EAG-005', route: RouteCode.LEGAZPI, protocol: DispatchProtocol.TAYA, capacity: 15, status: VehicleStatus.OUTSIDE_ZONE, assignedDriverId: drivers[3].id, inside: false },
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
          lastKnownInsideZone: vehicle.inside,
          locationTrackingActive: vehicle.inside,
          goOnTripEnabled: vehicle.id === 'seed_vehicle_033',
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
          lastKnownInsideZone: vehicle.inside,
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
    update: { vehicleId: vehicles[0].id, scheduledOrTriggeredTime: dateAt(1, 10), status: TripStatus.ASSIGNED, fareAmount: 190 },
    create: { id: 'seed_trip_goa_morning', vehicleId: vehicles[0].id, route: RouteCode.GOA, scheduledOrTriggeredTime: dateAt(1, 10), status: TripStatus.ASSIGNED, fareAmount: 190 },
  });

  await prisma.trip.upsert({
    where: { id: 'seed_trip_goa_day_two' },
    update: { vehicleId: vehicles[0].id, scheduledOrTriggeredTime: dateAt(2, 8), status: TripStatus.SCHEDULED, fareAmount: 190 },
    create: { id: 'seed_trip_goa_day_two', vehicleId: vehicles[0].id, route: RouteCode.GOA, scheduledOrTriggeredTime: dateAt(2, 8), status: TripStatus.SCHEDULED, fareAmount: 190 },
  });

  await prisma.trip.upsert({
    where: { id: 'seed_trip_goa_day_three' },
    update: { vehicleId: vehicles[0].id, scheduledOrTriggeredTime: dateAt(3, 10), status: TripStatus.SCHEDULED, fareAmount: 190 },
    create: { id: 'seed_trip_goa_day_three', vehicleId: vehicles[0].id, route: RouteCode.GOA, scheduledOrTriggeredTime: dateAt(3, 10), status: TripStatus.SCHEDULED, fareAmount: 190 },
  });

  const legazpiTrip = await prisma.trip.upsert({
    where: { id: 'seed_trip_legazpi_loading' },
    update: { vehicleId: vehicles[2].id, scheduledOrTriggeredTime: dateAt(0, 11), status: TripStatus.BOARDING, fareAmount: 250 },
    create: { id: 'seed_trip_legazpi_loading', vehicleId: vehicles[2].id, route: RouteCode.LEGAZPI, scheduledOrTriggeredTime: dateAt(0, 11), status: TripStatus.BOARDING, fareAmount: 250 },
  });

  await prisma.tripAssignment.upsert({
    where: { tripId_queueEntryId: { tripId: goaTrip.id, queueEntryId: queues[0].id } },
    update: { driverId: drivers[0].id, status: AssignmentStatus.PENDING, respondedAt: null, responseDeadline: dateAt(1, 9, 55) },
    create: {
      id: 'seed_assignment_goa',
      tripId: goaTrip.id,
      queueEntryId: queues[0].id,
      driverId: drivers[0].id,
      status: AssignmentStatus.PENDING,
      assignedAt: dateAt(0, 9, 30),
      responseDeadline: dateAt(1, 9, 55),
      respondedAt: null,
    },
  });

  const confirmedReservation = await prisma.reservation.upsert({
    where: { reference: 'UVGO-DEMO-001' },
    update: { passengerId: passengers[0].id, tripId: goaTrip.id, seatCount: 1, fareAmount: 190, status: ReservationStatus.CONFIRMED },
    create: { id: 'seed_reservation_confirmed', reference: 'UVGO-DEMO-001', passengerId: passengers[0].id, tripId: goaTrip.id, seatCount: 1, fareAmount: 190, status: ReservationStatus.CONFIRMED },
  });

  const pendingReservation = await prisma.reservation.upsert({
    where: { reference: 'UVGO-DEMO-002' },
    update: { passengerId: passengers[1].id, tripId: goaTrip.id, seatCount: 2, fareAmount: 380, status: ReservationStatus.PENDING_VERIFICATION },
    create: { id: 'seed_reservation_pending', reference: 'UVGO-DEMO-002', passengerId: passengers[1].id, tripId: goaTrip.id, seatCount: 2, fareAmount: 380, status: ReservationStatus.PENDING_VERIFICATION },
  });

  const seatSpecs = [
    { id: 'seed_seat_4', reservationId: confirmedReservation.id, tripId: goaTrip.id, seatNumber: 4 },
    { id: 'seed_seat_8', reservationId: pendingReservation.id, tripId: goaTrip.id, seatNumber: 8 },
    { id: 'seed_seat_9', reservationId: pendingReservation.id, tripId: goaTrip.id, seatNumber: 9 },
  ];
  await Promise.all(seatSpecs.map((seat) => prisma.reservationSeat.upsert({ where: { tripId_seatNumber: { tripId: seat.tripId, seatNumber: seat.seatNumber } }, update: { reservationId: seat.reservationId }, create: seat })));

  await prisma.payment.upsert({
    where: { paypalOrderId: 'DEMO-PAYPAL-ORDER-001' },
    update: { reservationId: confirmedReservation.id, method: PaymentMethod.PAYPAL, amount: 190, status: PaymentStatus.CAPTURED, paidAt: dateAt(0, 8, 45) },
    create: { id: 'seed_payment_paypal', reservationId: confirmedReservation.id, method: PaymentMethod.PAYPAL, paypalOrderId: 'DEMO-PAYPAL-ORDER-001', amount: 190, status: PaymentStatus.CAPTURED, paidAt: dateAt(0, 8, 45) },
  });

  await prisma.payment.upsert({
    where: { id: 'seed_payment_gcash' },
    update: { reservationId: pendingReservation.id, method: PaymentMethod.GCASH_RECEIPT, gcashReference: 'GCASH-DEMO-7788', receiptImageKey: 'demo/gcash-receipt.webp', receiptMimeType: 'image/webp', amount: 380, status: PaymentStatus.PENDING_VERIFICATION, verifiedByUserId: null, verifiedAt: null, rejectionReason: null },
    create: { id: 'seed_payment_gcash', reservationId: pendingReservation.id, method: PaymentMethod.GCASH_RECEIPT, gcashReference: 'GCASH-DEMO-7788', receiptImageKey: 'demo/gcash-receipt.webp', receiptMimeType: 'image/webp', amount: 380, status: PaymentStatus.PENDING_VERIFICATION },
  });

  await prisma.geofenceEvent.upsert({
    where: { id: 'seed_geofence_entered_033' },
    update: { timestamp: dateAt(0, 9, 15) },
    create: { id: 'seed_geofence_entered_033', vehicleId: vehicles[0].id, eventType: GeofenceEventType.ENTERED, timestamp: dateAt(0, 9, 15), latitude: 13.622917, longitude: 123.204842, distanceKm: 0.15 },
  });

  await prisma.passengerCount.upsert({
    where: { id: 'seed_count_goa' },
    update: { count: 12, timestamp: dateAt(0, 9, 42) },
    create: { id: 'seed_count_goa', vehicleId: vehicles[0].id, tripId: goaTrip.id, count: 12, submittedByDriverId: drivers[0].id, timestamp: dateAt(0, 9, 42) },
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
    update: { actorUserId: dispatcher.id, targetId: goaTrip.id, reason: 'Demo assignment created by seed data.' },
    create: { id: 'seed_dispatch_log_assignment', actorUserId: dispatcher.id, action: DispatchAction.ASSIGNMENT_CREATED, targetId: goaTrip.id, reason: 'Demo assignment created by seed data.', metadata: { queueEntryId: queues[0].id } },
  });

  console.log('UVGo seed complete.');
  console.log('Demo password for all accounts:', DEMO_PASSWORD);
  console.log('Dispatcher: dispatcher@uvgo.demo');
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
