-- Permanent Goa weekly timetable slots. Concrete Trip rows continue to power
-- booking and dispatch; they are generated from these templates on a rolling
-- horizon and retain the template/date pair for idempotency.
CREATE TABLE `WeeklySchedule` (
    `id` VARCHAR(191) NOT NULL,
    `dispatcherId` VARCHAR(191) NOT NULL,
    `vehicleId` VARCHAR(191) NOT NULL,
    `weekday` INTEGER NOT NULL,
    `boardingMinute` INTEGER NOT NULL,
    `departureMinute` INTEGER NOT NULL,
    `fareAmount` DECIMAL(10, 2) NOT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `WeeklySchedule_dispatcherId_vehicleId_weekday_key`(`dispatcherId`, `vehicleId`, `weekday`),
    INDEX `WeeklySchedule_dispatcherId_isActive_weekday_idx`(`dispatcherId`, `isActive`, `weekday`),
    INDEX `WeeklySchedule_vehicleId_isActive_idx`(`vehicleId`, `isActive`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `Trip`
    ADD COLUMN `weeklyScheduleId` VARCHAR(191) NULL AFTER `createdByDispatcherId`,
    ADD COLUMN `weeklyOccurrenceDate` DATETIME(3) NULL AFTER `weeklyScheduleId`,
    ADD UNIQUE INDEX `Trip_weeklyScheduleId_weeklyOccurrenceDate_key`(`weeklyScheduleId`, `weeklyOccurrenceDate`);

ALTER TABLE `WeeklySchedule`
    ADD CONSTRAINT `WeeklySchedule_dispatcherId_fkey`
    FOREIGN KEY (`dispatcherId`) REFERENCES `User`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT `WeeklySchedule_vehicleId_fkey`
    FOREIGN KEY (`vehicleId`) REFERENCES `Vehicle`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `Trip`
    ADD CONSTRAINT `Trip_weeklyScheduleId_fkey`
    FOREIGN KEY (`weeklyScheduleId`) REFERENCES `WeeklySchedule`(`id`)
    ON DELETE SET NULL ON UPDATE CASCADE;
