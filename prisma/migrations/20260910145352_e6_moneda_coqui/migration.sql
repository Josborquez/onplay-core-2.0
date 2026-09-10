-- AlterTable
ALTER TABLE `Compra` ADD COLUMN `gastosExtra` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `moneda` VARCHAR(191) NOT NULL DEFAULT 'CLP',
    ADD COLUMN `tipoCambio` DOUBLE NULL,
    ADD COLUMN `totalOriginal` DOUBLE NULL,
    MODIFY `lector` ENUM('manual', 'andina', 'nico', 'nico_factura', 'coqui') NOT NULL DEFAULT 'manual';

-- AlterTable
ALTER TABLE `CompraLinea` ADD COLUMN `totalOriginal` DOUBLE NULL;

-- AlterTable
ALTER TABLE `Proveedor` MODIFY `lector` ENUM('manual', 'andina', 'nico', 'nico_factura', 'coqui') NOT NULL DEFAULT 'manual';
