-- Remove future, unbooked departures left by driver/van deletions. Booked
-- departures are retained for safe passenger reassignment and reporting.
DELETE t
FROM `Trip` AS t
INNER JOIN `Vehicle` AS v ON v.`id` = t.`vehicleId`
WHERE v.`assignedDriverId` IS NULL
  AND v.`status` = 'UNAVAILABLE'
  AND t.`scheduledOrTriggeredTime` > CURRENT_TIMESTAMP
  AND t.`departedAt` IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM `Reservation` AS r
    WHERE r.`tripId` = t.`id`
  );

-- Deleting a weekly rule sets weeklyScheduleId to NULL on any preserved booked
-- occurrence through the existing foreign-key action.
DELETE ws
FROM `WeeklySchedule` AS ws
INNER JOIN `Vehicle` AS v ON v.`id` = ws.`vehicleId`
WHERE v.`assignedDriverId` IS NULL
  AND v.`status` = 'UNAVAILABLE';
