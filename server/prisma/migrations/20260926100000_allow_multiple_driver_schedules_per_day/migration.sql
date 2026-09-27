-- A driver and van may operate more than one Goa schedule on the same day.
-- Keep a lookup index for schedule management without enforcing uniqueness.
DROP INDEX `WeeklySchedule_dispatcherId_vehicleId_weekday_key` ON `WeeklySchedule`;
CREATE INDEX `WeeklySchedule_dispatcherId_vehicleId_weekday_idx`
    ON `WeeklySchedule`(`dispatcherId`, `vehicleId`, `weekday`);
