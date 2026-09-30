-- Preserve any historical PayMongo payment rows without keeping PayMongo as
-- an active provider. The provider-specific reference is moved into the
-- existing generic external reference before the obsolete columns are dropped.
ALTER TABLE `Payment`
  MODIFY `method` ENUM('PAYPAL', 'GCASH_RECEIPT', 'PAYMONGO_QRPH', 'LEGACY') NOT NULL;

UPDATE `Payment`
SET
  `externalReferenceKey` = COALESCE(
    `externalReferenceKey`,
    CONCAT(
      'LEGACY:',
      COALESCE(
        `paymongoPaymentId`,
        `paymongoPaymentIntentId`,
        `paymongoPaymentMethodId`,
        `id`
      )
    )
  ),
  `method` = 'LEGACY'
WHERE `method` = 'PAYMONGO_QRPH';

ALTER TABLE `Payment`
  DROP INDEX `Payment_paymongoPaymentIntentId_key`,
  DROP INDEX `Payment_paymongoPaymentMethodId_key`,
  DROP INDEX `Payment_paymongoPaymentId_key`,
  DROP COLUMN `paymongoPaymentIntentId`,
  DROP COLUMN `paymongoPaymentMethodId`,
  DROP COLUMN `paymongoPaymentId`,
  DROP COLUMN `paymongoClientKey`,
  DROP COLUMN `paymongoQrExpiresAt`,
  MODIFY `method` ENUM('PAYPAL', 'GCASH_RECEIPT', 'LEGACY') NOT NULL;
