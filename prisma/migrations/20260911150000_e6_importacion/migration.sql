-- AlterTable
ALTER TABLE `Compra` ADD COLUMN `arancel` INTEGER NULL,
    ADD COLUMN `arancelPct` DOUBLE NULL,
    ADD COLUMN `cif` DOUBLE NULL,
    ADD COLUMN `dinFecha` DATETIME(3) NULL,
    ADD COLUMN `dinNumero` VARCHAR(191) NULL,
    ADD COLUMN `flete` DOUBLE NULL,
    ADD COLUMN `fob` DOUBLE NULL,
    ADD COLUMN `ivaImportacion` INTEGER NULL,
    ADD COLUMN `seguro` DOUBLE NULL,
    ADD COLUMN `tipoCambioAduana` DOUBLE NULL;

-- CreateTable
CREATE TABLE `CompraGasto` (
    `id` VARCHAR(191) NOT NULL,
    `compraId` VARCHAR(191) NOT NULL,
    `tipo` ENUM('agente', 'courier', 'seguro', 'otro') NOT NULL,
    `descripcion` VARCHAR(191) NOT NULL,
    `montoNeto` INTEGER NOT NULL,
    `iva` INTEGER NOT NULL DEFAULT 0,
    `documento` VARCHAR(191) NULL,
    `fecha` DATETIME(3) NULL,
    `creadoEn` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `CompraGasto_compraId_idx`(`compraId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `CompraGasto` ADD CONSTRAINT `CompraGasto_compraId_fkey` FOREIGN KEY (`compraId`) REFERENCES `Compra`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
