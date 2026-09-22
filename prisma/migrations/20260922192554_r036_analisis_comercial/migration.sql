-- AlterTable
ALTER TABLE `PedidoCanal` ADD COLUMN `moneda` VARCHAR(191) NOT NULL DEFAULT 'CLP',
    ADD COLUMN `totalDescuento` INTEGER NULL,
    ADD COLUMN `totalEnvio` INTEGER NULL,
    ADD COLUMN `totalImpuestos` INTEGER NULL;

-- AlterTable
ALTER TABLE `PedidoCanalLinea` ADD COLUMN `costoEn` DATETIME(3) NULL,
    ADD COLUMN `costoFuente` ENUM('referencia', 'promedio') NULL,
    ADD COLUMN `costoUnitario` INTEGER NULL,
    ADD COLUMN `impuestoLinea` INTEGER NULL,
    ADD COLUMN `totalLinea` INTEGER NULL;

-- AlterTable
ALTER TABLE `VentaLinea` ADD COLUMN `costoEn` DATETIME(3) NULL,
    ADD COLUMN `costoFuente` ENUM('referencia', 'promedio') NULL,
    ADD COLUMN `costoUnitario` INTEGER NULL;
