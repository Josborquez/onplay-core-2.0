-- AlterTable
ALTER TABLE `Producto` ADD COLUMN `costoReferencia` INTEGER NULL;

-- CreateTable
CREATE TABLE `Proveedor` (
    `id` VARCHAR(191) NOT NULL,
    `nombre` VARCHAR(191) NOT NULL,
    `rut` VARCHAR(191) NULL,
    `lector` ENUM('manual', 'andina') NOT NULL DEFAULT 'manual',
    `activo` BOOLEAN NOT NULL DEFAULT true,
    `notas` TEXT NULL,
    `creadoEn` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `Proveedor_rut_key`(`rut`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ProductoProveedor` (
    `id` VARCHAR(191) NOT NULL,
    `proveedorId` VARCHAR(191) NOT NULL,
    `codigoProveedor` VARCHAR(191) NOT NULL,
    `descripcionProveedor` VARCHAR(191) NULL,
    `productoId` VARCHAR(191) NOT NULL,
    `unidadesPorBulto` INTEGER NOT NULL DEFAULT 1,
    `actualizadoEn` DATETIME(3) NOT NULL,

    INDEX `ProductoProveedor_productoId_idx`(`productoId`),
    UNIQUE INDEX `ProductoProveedor_proveedorId_codigoProveedor_key`(`proveedorId`, `codigoProveedor`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Compra` (
    `id` VARCHAR(191) NOT NULL,
    `proveedorId` VARCHAR(191) NOT NULL,
    `tipoDocumento` ENUM('factura', 'boleta', 'guia', 'otro') NOT NULL DEFAULT 'factura',
    `numeroDocumento` VARCHAR(191) NOT NULL,
    `fechaDocumento` DATETIME(3) NOT NULL,
    `ubicacionId` VARCHAR(191) NOT NULL,
    `estado` ENUM('borrador', 'recibida', 'anulada') NOT NULL DEFAULT 'borrador',
    `origen` VARCHAR(191) NOT NULL,
    `lector` ENUM('manual', 'andina') NOT NULL DEFAULT 'manual',
    `archivoNombre` VARCHAR(191) NULL,
    `neto` INTEGER NOT NULL DEFAULT 0,
    `impuestos` INTEGER NOT NULL DEFAULT 0,
    `total` INTEGER NOT NULL DEFAULT 0,
    `advertencias` JSON NULL,
    `nota` TEXT NULL,
    `usuarioId` VARCHAR(191) NOT NULL,
    `recibidaPorId` VARCHAR(191) NULL,
    `recibidaEn` DATETIME(3) NULL,
    `creadoEn` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `actualizadoEn` DATETIME(3) NOT NULL,

    INDEX `Compra_estado_fechaDocumento_idx`(`estado`, `fechaDocumento`),
    UNIQUE INDEX `Compra_proveedorId_numeroDocumento_key`(`proveedorId`, `numeroDocumento`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CompraLinea` (
    `id` VARCHAR(191) NOT NULL,
    `compraId` VARCHAR(191) NOT NULL,
    `orden` INTEGER NOT NULL,
    `codigoProveedor` VARCHAR(191) NULL,
    `descripcion` VARCHAR(191) NOT NULL,
    `productoId` VARCHAR(191) NULL,
    `bultos` INTEGER NOT NULL DEFAULT 0,
    `unidadesPorBulto` INTEGER NOT NULL DEFAULT 1,
    `sueltas` INTEGER NOT NULL DEFAULT 0,
    `cantidad` INTEGER NOT NULL,
    `neto` INTEGER NOT NULL DEFAULT 0,
    `impuestos` INTEGER NOT NULL DEFAULT 0,
    `total` INTEGER NOT NULL DEFAULT 0,
    `costoUnitario` INTEGER NOT NULL DEFAULT 0,
    `movimientoId` VARCHAR(191) NULL,

    INDEX `CompraLinea_compraId_orden_idx`(`compraId`, `orden`),
    INDEX `CompraLinea_productoId_idx`(`productoId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `ProductoProveedor` ADD CONSTRAINT `ProductoProveedor_proveedorId_fkey` FOREIGN KEY (`proveedorId`) REFERENCES `Proveedor`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProductoProveedor` ADD CONSTRAINT `ProductoProveedor_productoId_fkey` FOREIGN KEY (`productoId`) REFERENCES `Producto`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Compra` ADD CONSTRAINT `Compra_proveedorId_fkey` FOREIGN KEY (`proveedorId`) REFERENCES `Proveedor`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Compra` ADD CONSTRAINT `Compra_ubicacionId_fkey` FOREIGN KEY (`ubicacionId`) REFERENCES `Ubicacion`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Compra` ADD CONSTRAINT `Compra_usuarioId_fkey` FOREIGN KEY (`usuarioId`) REFERENCES `Usuario`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Compra` ADD CONSTRAINT `Compra_recibidaPorId_fkey` FOREIGN KEY (`recibidaPorId`) REFERENCES `Usuario`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CompraLinea` ADD CONSTRAINT `CompraLinea_compraId_fkey` FOREIGN KEY (`compraId`) REFERENCES `Compra`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CompraLinea` ADD CONSTRAINT `CompraLinea_productoId_fkey` FOREIGN KEY (`productoId`) REFERENCES `Producto`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
