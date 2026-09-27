-- Every UV Express van carries 11 passengers plus one driver.
-- Normalize existing records and make 11 the database default for new rows.
UPDATE `Vehicle`
SET `capacity` = 11
WHERE `capacity` <> 11;

ALTER TABLE `Vehicle`
    MODIFY `capacity` INTEGER NOT NULL DEFAULT 11;
