-- Prevent one externally completed GCash or hosted-PayPal transaction from
-- being reported against more than one reservation. Existing payments remain
-- null and continue to work; new manual reports store a normalized key.
ALTER TABLE `Payment`
  ADD COLUMN `externalReferenceKey` VARCHAR(191) NULL,
  ADD UNIQUE INDEX `Payment_externalReferenceKey_key`(`externalReferenceKey`);
