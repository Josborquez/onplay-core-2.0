-- AlterTable
ALTER TABLE `Compra` MODIFY `lector` ENUM('manual', 'andina', 'nico', 'nico_factura') NOT NULL DEFAULT 'manual';

-- AlterTable
ALTER TABLE `Proveedor` MODIFY `lector` ENUM('manual', 'andina', 'nico', 'nico_factura') NOT NULL DEFAULT 'manual';
