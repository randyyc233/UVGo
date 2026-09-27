-- Record the passenger loading start time separately from the departure time.
-- Until now the loading window was implied as (departure - 10 minutes), so the
-- backfill reproduces exactly that behaviour for existing departures.
ALTER TABLE `Trip`
    ADD COLUMN `boardingStartTime` DATETIME(3) NULL AFTER `scheduledOrTriggeredTime`;

UPDATE `Trip`
   SET `boardingStartTime` = DATE_SUB(`scheduledOrTriggeredTime`, INTERVAL 10 MINUTE)
 WHERE `boardingStartTime` IS NULL;
