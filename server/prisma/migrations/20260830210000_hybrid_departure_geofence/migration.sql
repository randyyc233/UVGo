-- Separate broad incoming detection from terminal arrival and confirmed departure.
ALTER TABLE `Vehicle`
    MODIFY `status` ENUM(
      'OFFLINE',
      'OUTSIDE_ZONE',
      'INCOMING',
      'AT_TERMINAL',
      'WAITING',
      'LOADING',
      'READY_FOR_DISPATCH',
      'DEPARTURE_PENDING',
      'DEPARTURE_REVIEW',
      'ON_TRIP',
      'DELAYED',
      'UNAVAILABLE'
    ) NOT NULL DEFAULT 'OUTSIDE_ZONE',
    ADD COLUMN `insideTerminalZone` BOOLEAN NOT NULL DEFAULT false AFTER `lastKnownInsideZone`,
    ADD COLUMN `latestLatitude` DECIMAL(10, 7) NULL AFTER `latestArrivalAt`,
    ADD COLUMN `latestLongitude` DECIMAL(10, 7) NULL AFTER `latestLatitude`,
    ADD COLUMN `latestLocationAccuracyM` DECIMAL(8, 2) NULL AFTER `latestLongitude`,
    ADD COLUMN `latestLocationObservedAt` DATETIME(3) NULL AFTER `latestLocationAccuracyM`,
    ADD COLUMN `latestDistanceKm` DECIMAL(7, 3) NULL AFTER `latestLocationObservedAt`,
    ADD COLUMN `terminalEntrySampleCount` INTEGER NOT NULL DEFAULT 0 AFTER `latestDistanceKm`,
    ADD COLUMN `terminalExitSampleCount` INTEGER NOT NULL DEFAULT 0 AFTER `terminalEntrySampleCount`,
    ADD COLUMN `departureSequenceStartKm` DECIMAL(7, 3) NULL AFTER `terminalExitSampleCount`,
    ADD COLUMN `departureAuthorizedAt` DATETIME(3) NULL AFTER `departureSequenceStartKm`,
    ADD COLUMN `departureAuthorizedTripId` VARCHAR(191) NULL AFTER `departureAuthorizedAt`,
    ADD COLUMN `departureReviewRequired` BOOLEAN NOT NULL DEFAULT false AFTER `departureAuthorizedTripId`,
    ADD COLUMN `departureReviewReason` VARCHAR(500) NULL AFTER `departureReviewRequired`,
    ADD INDEX `Vehicle_departureReviewRequired_departureAuthorizedAt_idx`(`departureReviewRequired`, `departureAuthorizedAt`);

ALTER TABLE `GeofenceEvent`
    ADD COLUMN `accuracyMeters` DECIMAL(8, 2) NULL AFTER `distanceKm`;

ALTER TABLE `DispatchLog`
    MODIFY `action` ENUM(
      'GEOFENCE_ENTERED',
      'GEOFENCE_EXITED',
      'TERMINAL_ARRIVAL_CONFIRMED',
      'DEPARTURE_AUTHORIZED',
      'DEPARTURE_REVIEW_REQUIRED',
      'ASSIGNMENT_CREATED',
      'ASSIGNMENT_ACCEPTED',
      'ASSIGNMENT_REJECTED',
      'ASSIGNMENT_CANCELLED',
      'QUEUE_OVERRIDDEN',
      'MOVED_TO_LAST',
      'VEHICLE_REPLACED',
      'DRIVER_NOTIFIED',
      'TRIP_STARTED',
      'TRIP_DEPARTED',
      'PAYMENT_APPROVED',
      'PAYMENT_REJECTED',
      'RESERVATION_REALLOCATED',
      'DRIVER_CREATED',
      'DRIVER_UPDATED',
      'DRIVER_DEACTIVATED',
      'VEHICLE_UPDATED',
      'SCHEDULE_CREATED',
      'SCHEDULE_UPDATED',
      'SCHEDULE_DELETED',
      'DEMO_SIMULATION'
    ) NOT NULL;
