-- Route dispatchers own the driver accounts and vehicles they manage.
ALTER TABLE `User`
    ADD COLUMN `managedByDispatcherId` VARCHAR(191) NULL AFTER `isActive`,
    ADD INDEX `User_managedByDispatcherId_role_isActive_idx`(`managedByDispatcherId`, `role`, `isActive`);

ALTER TABLE `Vehicle`
    ADD COLUMN `managedByDispatcherId` VARCHAR(191) NULL AFTER `assignedDriverId`,
    ADD INDEX `Vehicle_managedByDispatcherId_route_idx`(`managedByDispatcherId`, `route`);

-- Concrete Goa departures created in Schedule Management retain their creator.
ALTER TABLE `Trip`
    ADD COLUMN `createdByDispatcherId` VARCHAR(191) NULL AFTER `fareAmount`,
    ADD INDEX `Trip_createdByDispatcherId_scheduledOrTriggeredTime_idx`(`createdByDispatcherId`, `scheduledOrTriggeredTime`);

-- Preserve existing demo records by assigning them to the active dispatcher for
-- their route. If a deployment has more than one dispatcher per route, the
-- application will require an explicit owner for newly created records.
UPDATE `Vehicle` AS vehicle
JOIN `User` AS dispatcher
  ON dispatcher.`role` = 'DISPATCHER'
 AND dispatcher.`dispatcherRoute` = vehicle.`route`
 AND dispatcher.`isActive` = true
SET vehicle.`managedByDispatcherId` = dispatcher.`id`
WHERE vehicle.`managedByDispatcherId` IS NULL;

UPDATE `User` AS driver
JOIN `Vehicle` AS vehicle ON vehicle.`assignedDriverId` = driver.`id`
SET driver.`managedByDispatcherId` = vehicle.`managedByDispatcherId`
WHERE driver.`role` = 'DRIVER' AND driver.`managedByDispatcherId` IS NULL;

UPDATE `Trip` AS trip
JOIN `Vehicle` AS vehicle ON vehicle.`id` = trip.`vehicleId`
SET trip.`createdByDispatcherId` = vehicle.`managedByDispatcherId`
WHERE trip.`createdByDispatcherId` IS NULL;

ALTER TABLE `DispatchLog`
    MODIFY `action` ENUM(
      'GEOFENCE_ENTERED',
      'GEOFENCE_EXITED',
      'ASSIGNMENT_CREATED',
      'ASSIGNMENT_ACCEPTED',
      'ASSIGNMENT_REJECTED',
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

ALTER TABLE `User`
    ADD CONSTRAINT `User_managedByDispatcherId_fkey`
    FOREIGN KEY (`managedByDispatcherId`) REFERENCES `User`(`id`)
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `Vehicle`
    ADD CONSTRAINT `Vehicle_managedByDispatcherId_fkey`
    FOREIGN KEY (`managedByDispatcherId`) REFERENCES `User`(`id`)
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `Trip`
    ADD CONSTRAINT `Trip_createdByDispatcherId_fkey`
    FOREIGN KEY (`createdByDispatcherId`) REFERENCES `User`(`id`)
    ON DELETE SET NULL ON UPDATE CASCADE;
