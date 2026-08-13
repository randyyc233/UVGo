-- CreateTable
CREATE TABLE `User` (
    `id` VARCHAR(191) NOT NULL,
    `role` ENUM('DISPATCHER', 'DRIVER', 'PASSENGER') NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `contact` VARCHAR(32) NULL,
    `email` VARCHAR(191) NOT NULL,
    `passwordHash` VARCHAR(191) NOT NULL,
    `tokenVersion` INTEGER NOT NULL DEFAULT 0,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `User_email_key`(`email`),
    INDEX `User_role_isActive_idx`(`role`, `isActive`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Vehicle` (
    `id` VARCHAR(191) NOT NULL,
    `vanId` VARCHAR(32) NOT NULL,
    `plateNo` VARCHAR(32) NOT NULL,
    `route` ENUM('GOA', 'LEGAZPI') NOT NULL,
    `protocol` ENUM('GOSO', 'TAYA') NOT NULL,
    `capacity` INTEGER NOT NULL,
    `status` ENUM('OFFLINE', 'OUTSIDE_ZONE', 'INCOMING', 'AT_TERMINAL', 'WAITING', 'LOADING', 'READY_FOR_DISPATCH', 'ON_TRIP', 'DELAYED', 'UNAVAILABLE') NOT NULL DEFAULT 'OUTSIDE_ZONE',
    `assignedDriverId` VARCHAR(191) NULL,
    `lastKnownInsideZone` BOOLEAN NOT NULL DEFAULT false,
    `locationTrackingActive` BOOLEAN NOT NULL DEFAULT false,
    `latestArrivalAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Vehicle_vanId_key`(`vanId`),
    UNIQUE INDEX `Vehicle_plateNo_key`(`plateNo`),
    UNIQUE INDEX `Vehicle_assignedDriverId_key`(`assignedDriverId`),
    INDEX `Vehicle_route_status_idx`(`route`, `status`),
    INDEX `Vehicle_lastKnownInsideZone_status_idx`(`lastKnownInsideZone`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `GeofenceEvent` (
    `id` VARCHAR(191) NOT NULL,
    `vehicleId` VARCHAR(191) NOT NULL,
    `eventType` ENUM('ENTERED', 'EXITED') NOT NULL,
    `timestamp` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `latitude` DECIMAL(10, 7) NULL,
    `longitude` DECIMAL(10, 7) NULL,
    `distanceKm` DECIMAL(7, 3) NULL,

    INDEX `GeofenceEvent_vehicleId_timestamp_idx`(`vehicleId`, `timestamp`),
    INDEX `GeofenceEvent_eventType_timestamp_idx`(`eventType`, `timestamp`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `QueueEntry` (
    `id` VARCHAR(191) NOT NULL,
    `vehicleId` VARCHAR(191) NOT NULL,
    `route` ENUM('GOA', 'LEGAZPI') NOT NULL,
    `position` INTEGER NOT NULL,
    `arrivalTimestamp` DATETIME(3) NOT NULL,
    `status` ENUM('WAITING', 'ASSIGNED', 'ACCEPTED', 'REJECTED', 'READY_FOR_DISPATCH', 'DEPARTED', 'DELAYED', 'REPLACED') NOT NULL DEFAULT 'WAITING',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `QueueEntry_route_status_position_idx`(`route`, `status`, `position`),
    INDEX `QueueEntry_route_arrivalTimestamp_idx`(`route`, `arrivalTimestamp`),
    INDEX `QueueEntry_vehicleId_status_idx`(`vehicleId`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Trip` (
    `id` VARCHAR(191) NOT NULL,
    `vehicleId` VARCHAR(191) NOT NULL,
    `route` ENUM('GOA', 'LEGAZPI') NOT NULL,
    `scheduledOrTriggeredTime` DATETIME(3) NOT NULL,
    `status` ENUM('SCHEDULED', 'ASSIGNING', 'ASSIGNED', 'BOARDING', 'READY', 'DEPARTED', 'COMPLETED', 'DELAYED', 'UNABLE_TO_DEPART') NOT NULL DEFAULT 'SCHEDULED',
    `fareAmount` DECIMAL(10, 2) NOT NULL,
    `departedAt` DATETIME(3) NULL,
    `completedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Trip_route_scheduledOrTriggeredTime_idx`(`route`, `scheduledOrTriggeredTime`),
    INDEX `Trip_vehicleId_status_idx`(`vehicleId`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `TripAssignment` (
    `id` VARCHAR(191) NOT NULL,
    `tripId` VARCHAR(191) NOT NULL,
    `queueEntryId` VARCHAR(191) NOT NULL,
    `driverId` VARCHAR(191) NOT NULL,
    `status` ENUM('PENDING', 'ACCEPTED', 'REJECTED', 'EXPIRED') NOT NULL DEFAULT 'PENDING',
    `assignedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `responseDeadline` DATETIME(3) NOT NULL,
    `respondedAt` DATETIME(3) NULL,

    INDEX `TripAssignment_driverId_status_idx`(`driverId`, `status`),
    INDEX `TripAssignment_status_responseDeadline_idx`(`status`, `responseDeadline`),
    UNIQUE INDEX `TripAssignment_tripId_queueEntryId_key`(`tripId`, `queueEntryId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Reservation` (
    `id` VARCHAR(191) NOT NULL,
    `reference` VARCHAR(32) NOT NULL,
    `passengerId` VARCHAR(191) NOT NULL,
    `tripId` VARCHAR(191) NOT NULL,
    `seatCount` INTEGER NOT NULL,
    `fareAmount` DECIMAL(10, 2) NOT NULL,
    `status` ENUM('PENDING_PAYMENT', 'PENDING_VERIFICATION', 'CONFIRMED', 'RESCHEDULED', 'REALLOCATED', 'FORFEITED') NOT NULL DEFAULT 'PENDING_PAYMENT',
    `originalReservationId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Reservation_reference_key`(`reference`),
    INDEX `Reservation_passengerId_createdAt_idx`(`passengerId`, `createdAt`),
    INDEX `Reservation_tripId_status_idx`(`tripId`, `status`),
    INDEX `Reservation_originalReservationId_idx`(`originalReservationId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ReservationSeat` (
    `id` VARCHAR(191) NOT NULL,
    `reservationId` VARCHAR(191) NOT NULL,
    `tripId` VARCHAR(191) NOT NULL,
    `seatNumber` INTEGER NOT NULL,

    INDEX `ReservationSeat_reservationId_idx`(`reservationId`),
    UNIQUE INDEX `ReservationSeat_tripId_seatNumber_key`(`tripId`, `seatNumber`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Payment` (
    `id` VARCHAR(191) NOT NULL,
    `reservationId` VARCHAR(191) NOT NULL,
    `method` ENUM('PAYPAL', 'GCASH_RECEIPT') NOT NULL,
    `paypalOrderId` VARCHAR(191) NULL,
    `gcashReference` VARCHAR(100) NULL,
    `receiptImageKey` VARCHAR(191) NULL,
    `receiptMimeType` VARCHAR(64) NULL,
    `amount` DECIMAL(10, 2) NOT NULL,
    `status` ENUM('PENDING', 'PENDING_VERIFICATION', 'VERIFIED', 'CAPTURED', 'REJECTED', 'FAILED') NOT NULL DEFAULT 'PENDING',
    `paidAt` DATETIME(3) NULL,
    `verifiedByUserId` VARCHAR(191) NULL,
    `verifiedAt` DATETIME(3) NULL,
    `rejectionReason` VARCHAR(500) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Payment_paypalOrderId_key`(`paypalOrderId`),
    INDEX `Payment_method_status_createdAt_idx`(`method`, `status`, `createdAt`),
    INDEX `Payment_reservationId_idx`(`reservationId`),
    INDEX `Payment_verifiedByUserId_idx`(`verifiedByUserId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PassengerCount` (
    `id` VARCHAR(191) NOT NULL,
    `vehicleId` VARCHAR(191) NOT NULL,
    `tripId` VARCHAR(191) NOT NULL,
    `count` INTEGER NOT NULL,
    `submittedByDriverId` VARCHAR(191) NOT NULL,
    `timestamp` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `PassengerCount_tripId_timestamp_idx`(`tripId`, `timestamp`),
    INDEX `PassengerCount_vehicleId_timestamp_idx`(`vehicleId`, `timestamp`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Notification` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `type` ENUM('ASSIGNMENT', 'PAYMENT', 'BOOKING', 'REALLOCATION', 'QUEUE', 'TRIP', 'SYSTEM') NOT NULL,
    `message` VARCHAR(500) NOT NULL,
    `isRead` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `Notification_userId_isRead_createdAt_idx`(`userId`, `isRead`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DispatchLog` (
    `id` VARCHAR(191) NOT NULL,
    `actorUserId` VARCHAR(191) NOT NULL,
    `action` ENUM('GEOFENCE_ENTERED', 'GEOFENCE_EXITED', 'ASSIGNMENT_CREATED', 'ASSIGNMENT_ACCEPTED', 'ASSIGNMENT_REJECTED', 'QUEUE_OVERRIDDEN', 'MOVED_TO_LAST', 'VEHICLE_REPLACED', 'DRIVER_NOTIFIED', 'TRIP_STARTED', 'TRIP_DEPARTED', 'PAYMENT_APPROVED', 'PAYMENT_REJECTED', 'RESERVATION_REALLOCATED', 'DEMO_SIMULATION') NOT NULL,
    `targetId` VARCHAR(191) NOT NULL,
    `reason` VARCHAR(500) NULL,
    `metadata` JSON NULL,
    `timestamp` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `DispatchLog_actorUserId_timestamp_idx`(`actorUserId`, `timestamp`),
    INDEX `DispatchLog_action_timestamp_idx`(`action`, `timestamp`),
    INDEX `DispatchLog_targetId_idx`(`targetId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Vehicle` ADD CONSTRAINT `Vehicle_assignedDriverId_fkey` FOREIGN KEY (`assignedDriverId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `GeofenceEvent` ADD CONSTRAINT `GeofenceEvent_vehicleId_fkey` FOREIGN KEY (`vehicleId`) REFERENCES `Vehicle`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `QueueEntry` ADD CONSTRAINT `QueueEntry_vehicleId_fkey` FOREIGN KEY (`vehicleId`) REFERENCES `Vehicle`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Trip` ADD CONSTRAINT `Trip_vehicleId_fkey` FOREIGN KEY (`vehicleId`) REFERENCES `Vehicle`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TripAssignment` ADD CONSTRAINT `TripAssignment_tripId_fkey` FOREIGN KEY (`tripId`) REFERENCES `Trip`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TripAssignment` ADD CONSTRAINT `TripAssignment_queueEntryId_fkey` FOREIGN KEY (`queueEntryId`) REFERENCES `QueueEntry`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TripAssignment` ADD CONSTRAINT `TripAssignment_driverId_fkey` FOREIGN KEY (`driverId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Reservation` ADD CONSTRAINT `Reservation_passengerId_fkey` FOREIGN KEY (`passengerId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Reservation` ADD CONSTRAINT `Reservation_tripId_fkey` FOREIGN KEY (`tripId`) REFERENCES `Trip`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Reservation` ADD CONSTRAINT `Reservation_originalReservationId_fkey` FOREIGN KEY (`originalReservationId`) REFERENCES `Reservation`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ReservationSeat` ADD CONSTRAINT `ReservationSeat_reservationId_fkey` FOREIGN KEY (`reservationId`) REFERENCES `Reservation`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ReservationSeat` ADD CONSTRAINT `ReservationSeat_tripId_fkey` FOREIGN KEY (`tripId`) REFERENCES `Trip`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Payment` ADD CONSTRAINT `Payment_reservationId_fkey` FOREIGN KEY (`reservationId`) REFERENCES `Reservation`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Payment` ADD CONSTRAINT `Payment_verifiedByUserId_fkey` FOREIGN KEY (`verifiedByUserId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PassengerCount` ADD CONSTRAINT `PassengerCount_vehicleId_fkey` FOREIGN KEY (`vehicleId`) REFERENCES `Vehicle`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PassengerCount` ADD CONSTRAINT `PassengerCount_tripId_fkey` FOREIGN KEY (`tripId`) REFERENCES `Trip`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PassengerCount` ADD CONSTRAINT `PassengerCount_submittedByDriverId_fkey` FOREIGN KEY (`submittedByDriverId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Notification` ADD CONSTRAINT `Notification_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DispatchLog` ADD CONSTRAINT `DispatchLog_actorUserId_fkey` FOREIGN KEY (`actorUserId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
