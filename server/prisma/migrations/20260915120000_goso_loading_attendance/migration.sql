ALTER TABLE `Trip`
  ADD COLUMN `loadingConfirmedAt` DATETIME(3) NULL,
  ADD COLUMN `loadingConfirmedVehicleId` VARCHAR(191) NULL,
  ADD COLUMN `awaitingQueueReplacement` BOOLEAN NOT NULL DEFAULT false;
