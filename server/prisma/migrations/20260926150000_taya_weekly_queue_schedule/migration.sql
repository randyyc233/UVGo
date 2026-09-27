CREATE TABLE `TayaWeeklySchedule` (
    `id` VARCHAR(191) NOT NULL,
    `dispatcherId` VARCHAR(191) NOT NULL,
    `vehicleId` VARCHAR(191) NOT NULL,
    `weekday` INTEGER NOT NULL,
    `position` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `TayaWeeklySchedule_weekday_vehicleId_key`(`weekday`, `vehicleId`),
    UNIQUE INDEX `TayaWeeklySchedule_weekday_position_key`(`weekday`, `position`),
    INDEX `TayaWeeklySchedule_dispatcherId_weekday_idx`(`dispatcherId`, `weekday`),
    INDEX `TayaWeeklySchedule_vehicleId_weekday_idx`(`vehicleId`, `weekday`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `TayaWeeklySchedule`
  ADD CONSTRAINT `TayaWeeklySchedule_dispatcherId_fkey`
  FOREIGN KEY (`dispatcherId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `TayaWeeklySchedule`
  ADD CONSTRAINT `TayaWeeklySchedule_vehicleId_fkey`
  FOREIGN KEY (`vehicleId`) REFERENCES `Vehicle`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- Preserve today's existing Taya order as the first recurring rule for this
-- weekday. Dispatchers can fill the other weekday tabs from Schedule Management.
INSERT INTO `TayaWeeklySchedule` (
  `id`, `dispatcherId`, `vehicleId`, `weekday`, `position`, `createdAt`, `updatedAt`
)
SELECT
  CONCAT('taya_weekly_', `daily`.`id`),
  `daily`.`dispatcherId`,
  `daily`.`vehicleId`,
  WEEKDAY(CONVERT_TZ(CURRENT_TIMESTAMP, '+00:00', '+08:00')) + 1,
  `daily`.`position`,
  CURRENT_TIMESTAMP(3),
  CURRENT_TIMESTAMP(3)
FROM `TayaDailySchedule` AS `daily`
WHERE `daily`.`serviceDate` = DATE(CONVERT_TZ(CURRENT_TIMESTAMP, '+00:00', '+08:00'))
ORDER BY `daily`.`position` ASC;
