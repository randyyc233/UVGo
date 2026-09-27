CREATE TABLE `TayaDailySchedule` (
    `id` VARCHAR(191) NOT NULL,
    `dispatcherId` VARCHAR(191) NOT NULL,
    `vehicleId` VARCHAR(191) NOT NULL,
    `serviceDate` DATE NOT NULL,
    `position` INTEGER NOT NULL,
    `queueEntryId` VARCHAR(191) NULL,
    `tripId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `TayaDailySchedule_queueEntryId_key`(`queueEntryId`),
    UNIQUE INDEX `TayaDailySchedule_tripId_key`(`tripId`),
    UNIQUE INDEX `TayaDailySchedule_serviceDate_vehicleId_key`(`serviceDate`, `vehicleId`),
    UNIQUE INDEX `TayaDailySchedule_serviceDate_position_key`(`serviceDate`, `position`),
    INDEX `TayaDailySchedule_dispatcherId_serviceDate_idx`(`dispatcherId`, `serviceDate`),
    INDEX `TayaDailySchedule_vehicleId_serviceDate_idx`(`vehicleId`, `serviceDate`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `TayaDailySchedule`
  ADD CONSTRAINT `TayaDailySchedule_dispatcherId_fkey`
  FOREIGN KEY (`dispatcherId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `TayaDailySchedule`
  ADD CONSTRAINT `TayaDailySchedule_vehicleId_fkey`
  FOREIGN KEY (`vehicleId`) REFERENCES `Vehicle`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `TayaDailySchedule`
  ADD CONSTRAINT `TayaDailySchedule_queueEntryId_fkey`
  FOREIGN KEY (`queueEntryId`) REFERENCES `QueueEntry`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `TayaDailySchedule`
  ADD CONSTRAINT `TayaDailySchedule_tripId_fkey`
  FOREIGN KEY (`tripId`) REFERENCES `Trip`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- Preserve the operational Legazpi order that exists when this feature is
-- deployed. Dispatchers can edit this generated sequence from Schedule
-- Management; later terminal arrivals must not erase or reorder it.
INSERT INTO `TayaDailySchedule` (
  `id`, `dispatcherId`, `vehicleId`, `serviceDate`, `position`,
  `queueEntryId`, `tripId`, `createdAt`, `updatedAt`
)
SELECT
  CONCAT('taya_migration_', `ranked`.`queueEntryId`),
  `ranked`.`dispatcherId`,
  `ranked`.`vehicleId`,
  DATE(CONVERT_TZ(CURRENT_TIMESTAMP, '+00:00', '+08:00')),
  `ranked`.`plannedPosition`,
  `ranked`.`queueEntryId`,
  NULL,
  CURRENT_TIMESTAMP(3),
  CURRENT_TIMESTAMP(3)
FROM (
  SELECT
    `q`.`id` AS `queueEntryId`,
    `q`.`vehicleId` AS `vehicleId`,
    COALESCE(
      `v`.`managedByDispatcherId`,
      (SELECT `u`.`id` FROM `User` AS `u`
       WHERE `u`.`role` = 'DISPATCHER'
         AND `u`.`dispatcherRoute` = 'LEGAZPI'
         AND `u`.`isActive` = TRUE
       ORDER BY `u`.`createdAt` ASC, `u`.`id` ASC LIMIT 1)
    ) AS `dispatcherId`,
    ROW_NUMBER() OVER (ORDER BY `q`.`position` ASC, `q`.`arrivalTimestamp` ASC, `q`.`createdAt` ASC, `q`.`id` ASC) AS `plannedPosition`
  FROM `QueueEntry` AS `q`
  INNER JOIN `Vehicle` AS `v` ON `v`.`id` = `q`.`vehicleId`
  WHERE `q`.`route` = 'LEGAZPI'
    AND `q`.`status` IN ('WAITING', 'ASSIGNED', 'ACCEPTED', 'READY_FOR_DISPATCH', 'DELAYED')
    AND `v`.`status` NOT IN ('ON_TRIP', 'UNAVAILABLE')
) AS `ranked`
WHERE `ranked`.`dispatcherId` IS NOT NULL;
