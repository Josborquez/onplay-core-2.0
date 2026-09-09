-- AlterTable
ALTER TABLE `Auditoria` MODIFY `accion` ENUM('crear', 'editar', 'anular', 'cambiar_precio', 'abrir_turno', 'cerrar_turno', 'devolver', 'recuento', 'ajustar_stock', 'vender_reservado') NOT NULL;

-- AlterTable
ALTER TABLE `Producto` ADD COLUMN `stockMinimo` INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE `ProductoCanal` ADD COLUMN `manejaStockCanal` BOOLEAN NULL,
    ADD COLUMN `stockCanal` INTEGER NULL,
    ADD COLUMN `stockCanalEn` DATETIME(3) NULL;

-- CreateTable
CREATE TABLE `Ubicacion` (
    `id` VARCHAR(191) NOT NULL,
    `codigo` VARCHAR(191) NOT NULL,
    `nombre` VARCHAR(191) NOT NULL,
    `publicable` BOOLEAN NOT NULL DEFAULT false,
    `esVenta` BOOLEAN NOT NULL DEFAULT false,
    `activa` BOOLEAN NOT NULL DEFAULT true,
    `orden` INTEGER NOT NULL DEFAULT 0,

    UNIQUE INDEX `Ubicacion_codigo_key`(`codigo`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `MovimientoStock` (
    `id` VARCHAR(191) NOT NULL,
    `productoId` VARCHAR(191) NOT NULL,
    `ubicacionId` VARCHAR(191) NOT NULL,
    `cantidad` INTEGER NOT NULL,
    `motivo` ENUM('recuento_inicial', 'compra', 'venta', 'venta_online', 'ajuste', 'merma', 'devolucion', 'traslado') NOT NULL,
    `referenciaTipo` VARCHAR(191) NULL,
    `referenciaId` VARCHAR(191) NULL,
    `nota` TEXT NULL,
    `usuarioId` VARCHAR(191) NOT NULL,
    `creadoEn` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `MovimientoStock_productoId_ubicacionId_creadoEn_idx`(`productoId`, `ubicacionId`, `creadoEn`),
    INDEX `MovimientoStock_referenciaTipo_referenciaId_idx`(`referenciaTipo`, `referenciaId`),
    INDEX `MovimientoStock_motivo_creadoEn_idx`(`motivo`, `creadoEn`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `StockActual` (
    `productoId` VARCHAR(191) NOT NULL,
    `ubicacionId` VARCHAR(191) NOT NULL,
    `cantidad` INTEGER NOT NULL DEFAULT 0,
    `actualizadoEn` DATETIME(3) NOT NULL,

    INDEX `StockActual_ubicacionId_cantidad_idx`(`ubicacionId`, `cantidad`),
    PRIMARY KEY (`productoId`, `ubicacionId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Recuento` (
    `id` VARCHAR(191) NOT NULL,
    `ubicacionId` VARCHAR(191) NOT NULL,
    `categoriaId` VARCHAR(191) NULL,
    `nombre` VARCHAR(191) NOT NULL,
    `estado` ENUM('abierto', 'cerrado', 'descartado') NOT NULL DEFAULT 'abierto',
    `usuarioId` VARCHAR(191) NOT NULL,
    `creadoEn` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `cerradoEn` DATETIME(3) NULL,
    `nota` TEXT NULL,

    INDEX `Recuento_ubicacionId_estado_idx`(`ubicacionId`, `estado`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `RecuentoLinea` (
    `id` VARCHAR(191) NOT NULL,
    `recuentoId` VARCHAR(191) NOT NULL,
    `productoId` VARCHAR(191) NOT NULL,
    `cantidadSistema` INTEGER NOT NULL,
    `cantidadContada` INTEGER NULL,
    `contadoEn` DATETIME(3) NULL,

    UNIQUE INDEX `RecuentoLinea_recuentoId_productoId_key`(`recuentoId`, `productoId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Devolucion` (
    `id` VARCHAR(191) NOT NULL,
    `folio` VARCHAR(191) NOT NULL,
    `ventaId` VARCHAR(191) NOT NULL,
    `turnoCajaId` VARCHAR(191) NOT NULL,
    `monto` INTEGER NOT NULL,
    `medio` ENUM('efectivo', 'debito', 'credito', 'transferencia', 'mercadopago', 'otro', 'monedero') NOT NULL,
    `motivo` TEXT NOT NULL,
    `usuarioId` VARCHAR(191) NOT NULL,
    `creadoEn` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `Devolucion_folio_key`(`folio`),
    INDEX `Devolucion_ventaId_idx`(`ventaId`),
    INDEX `Devolucion_turnoCajaId_idx`(`turnoCajaId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DevolucionLinea` (
    `id` VARCHAR(191) NOT NULL,
    `devolucionId` VARCHAR(191) NOT NULL,
    `ventaLineaId` VARCHAR(191) NOT NULL,
    `cantidad` INTEGER NOT NULL,
    `reponeStock` BOOLEAN NOT NULL DEFAULT true,
    `montoLinea` INTEGER NOT NULL,

    INDEX `DevolucionLinea_ventaLineaId_idx`(`ventaLineaId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `MovimientoCaja` (
    `id` VARCHAR(191) NOT NULL,
    `turnoCajaId` VARCHAR(191) NOT NULL,
    `tipo` ENUM('ingreso', 'retiro') NOT NULL,
    `monto` INTEGER NOT NULL,
    `nota` TEXT NOT NULL,
    `usuarioId` VARCHAR(191) NOT NULL,
    `creadoEn` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `MovimientoCaja_turnoCajaId_idx`(`turnoCajaId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `MovimientoStock` ADD CONSTRAINT `MovimientoStock_productoId_fkey` FOREIGN KEY (`productoId`) REFERENCES `Producto`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MovimientoStock` ADD CONSTRAINT `MovimientoStock_ubicacionId_fkey` FOREIGN KEY (`ubicacionId`) REFERENCES `Ubicacion`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MovimientoStock` ADD CONSTRAINT `MovimientoStock_usuarioId_fkey` FOREIGN KEY (`usuarioId`) REFERENCES `Usuario`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `StockActual` ADD CONSTRAINT `StockActual_productoId_fkey` FOREIGN KEY (`productoId`) REFERENCES `Producto`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `StockActual` ADD CONSTRAINT `StockActual_ubicacionId_fkey` FOREIGN KEY (`ubicacionId`) REFERENCES `Ubicacion`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Recuento` ADD CONSTRAINT `Recuento_ubicacionId_fkey` FOREIGN KEY (`ubicacionId`) REFERENCES `Ubicacion`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Recuento` ADD CONSTRAINT `Recuento_usuarioId_fkey` FOREIGN KEY (`usuarioId`) REFERENCES `Usuario`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RecuentoLinea` ADD CONSTRAINT `RecuentoLinea_recuentoId_fkey` FOREIGN KEY (`recuentoId`) REFERENCES `Recuento`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RecuentoLinea` ADD CONSTRAINT `RecuentoLinea_productoId_fkey` FOREIGN KEY (`productoId`) REFERENCES `Producto`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Devolucion` ADD CONSTRAINT `Devolucion_ventaId_fkey` FOREIGN KEY (`ventaId`) REFERENCES `Venta`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Devolucion` ADD CONSTRAINT `Devolucion_turnoCajaId_fkey` FOREIGN KEY (`turnoCajaId`) REFERENCES `TurnoCaja`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Devolucion` ADD CONSTRAINT `Devolucion_usuarioId_fkey` FOREIGN KEY (`usuarioId`) REFERENCES `Usuario`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DevolucionLinea` ADD CONSTRAINT `DevolucionLinea_devolucionId_fkey` FOREIGN KEY (`devolucionId`) REFERENCES `Devolucion`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DevolucionLinea` ADD CONSTRAINT `DevolucionLinea_ventaLineaId_fkey` FOREIGN KEY (`ventaLineaId`) REFERENCES `VentaLinea`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MovimientoCaja` ADD CONSTRAINT `MovimientoCaja_turnoCajaId_fkey` FOREIGN KEY (`turnoCajaId`) REFERENCES `TurnoCaja`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MovimientoCaja` ADD CONSTRAINT `MovimientoCaja_usuarioId_fkey` FOREIGN KEY (`usuarioId`) REFERENCES `Usuario`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
