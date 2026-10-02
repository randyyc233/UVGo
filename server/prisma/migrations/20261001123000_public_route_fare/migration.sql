CREATE TABLE `PublicRouteFare` (
  `route` ENUM('GOA', 'LEGAZPI') NOT NULL,
  `fareAmount` DECIMAL(10, 2) NOT NULL,
  `updatedAt` DATETIME(3) NOT NULL,

  PRIMARY KEY (`route`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
