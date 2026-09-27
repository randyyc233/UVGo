-- Driver assignments are operational immediately. Existing pending records
-- are promoted so deployment cannot leave a scheduled van waiting for an
-- approval action that no longer exists in the driver or dispatcher UI.
UPDATE `TripAssignment`
SET
  `status` = 'ACCEPTED',
  `respondedAt` = COALESCE(`respondedAt`, CURRENT_TIMESTAMP(3))
WHERE `status` = 'PENDING';

UPDATE `QueueEntry` AS `queue`
INNER JOIN `TripAssignment` AS `assignment`
  ON `assignment`.`queueEntryId` = `queue`.`id`
SET `queue`.`status` = 'ACCEPTED'
WHERE `queue`.`status` = 'ASSIGNED'
  AND `assignment`.`status` = 'ACCEPTED';

UPDATE `Trip` AS `trip`
SET `trip`.`status` = 'ASSIGNED'
WHERE `trip`.`status` = 'ASSIGNING'
  AND EXISTS (
    SELECT 1
    FROM `TripAssignment` AS `assignment`
    WHERE `assignment`.`tripId` = `trip`.`id`
      AND `assignment`.`status` = 'ACCEPTED'
  );
