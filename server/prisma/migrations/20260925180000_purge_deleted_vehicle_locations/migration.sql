-- Vans left unassigned and unavailable by driver deletion must not retain
-- location history from before the account was removed.
DELETE ge
FROM `GeofenceEvent` AS ge
INNER JOIN `Vehicle` AS v ON v.`id` = ge.`vehicleId`
WHERE v.`assignedDriverId` IS NULL
  AND v.`status` = 'UNAVAILABLE';

UPDATE `Vehicle`
SET
  `managedByDispatcherId` = NULL,
  `lastKnownInsideZone` = FALSE,
  `insideTerminalZone` = FALSE,
  `locationTrackingActive` = FALSE,
  `goOnTripEnabled` = FALSE,
  `latestArrivalAt` = NULL,
  `latestLatitude` = NULL,
  `latestLongitude` = NULL,
  `latestLocationAccuracyM` = NULL,
  `latestLocationObservedAt` = NULL,
  `latestDistanceKm` = NULL,
  `terminalEntrySampleCount` = 0,
  `terminalExitSampleCount` = 0,
  `departureSequenceStartKm` = NULL,
  `departureAuthorizedAt` = NULL,
  `departureAuthorizedTripId` = NULL,
  `departureReviewRequired` = FALSE,
  `departureReviewReason` = NULL
WHERE `assignedDriverId` IS NULL
  AND `status` = 'UNAVAILABLE';
