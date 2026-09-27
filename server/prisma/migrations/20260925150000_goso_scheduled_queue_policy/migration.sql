-- GOSO queue order follows scheduled loading time. A separate late marker
-- keeps missed loading slots at the back without conflating them with a
-- dispatcher-delayed vehicle.
ALTER TABLE `QueueEntry`
  ADD COLUMN `scheduledLoadingTime` DATETIME(3) NULL,
  ADD COLUMN `lateAt` DATETIME(3) NULL;

CREATE INDEX `QueueEntry_route_lateAt_scheduledLoadingTime_idx`
  ON `QueueEntry`(`route`, `lateAt`, `scheduledLoadingTime`);
