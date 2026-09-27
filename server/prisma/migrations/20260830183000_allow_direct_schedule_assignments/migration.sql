-- Dispatcher-created schedules are assigned directly to their selected driver.
-- Queue-backed assignments keep their queue entry; future scheduled assignments do not require one.
ALTER TABLE `TripAssignment`
    MODIFY `queueEntryId` VARCHAR(191) NULL;
