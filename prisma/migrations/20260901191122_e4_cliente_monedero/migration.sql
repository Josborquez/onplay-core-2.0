-- AlterTable
ALTER TABLE `Pago` MODIFY `medio` ENUM('efectivo', 'debito', 'credito', 'transferencia', 'mercadopago', 'otro', 'monedero') NOT NULL;

-- AlterTable
ALTER TABLE `Venta` ADD COLUMN `clienteId` VARCHAR(191) NULL;

-- CreateTable
CREATE TABLE `Cliente` (
    `id` VARCHAR(191) NOT NULL,
    `nombre` VARCHAR(191) NOT NULL,
    `rut` VARCHAR(191) NULL,
    `email` VARCHAR(191) NULL,
    `telefono` VARCHAR(191) NULL,
    `notas` TEXT NULL,
    `activo` BOOLEAN NOT NULL DEFAULT true,
    `permiteCredito` BOOLEAN NOT NULL DEFAULT false,
    `limiteCredito` INTEGER NOT NULL DEFAULT 0,
    `nombreBusqueda` VARCHAR(191) NOT NULL,
    `creadoEn` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `actualizadoEn` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Cliente_rut_key`(`rut`),
    INDEX `Cliente_nombreBusqueda_idx`(`nombreBusqueda`),
    INDEX `Cliente_telefono_idx`(`telefono`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ClienteCanal` (
    `id` VARCHAR(191) NOT NULL,
    `clienteId` VARCHAR(191) NOT NULL,
    `canalId` VARCHAR(191) NOT NULL,
    `externoUserId` INTEGER NOT NULL,
    `externoEmail` VARCHAR(191) NULL,
    `vinculadoEn` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `desvinculadoEn` DATETIME(3) NULL,

    INDEX `ClienteCanal_clienteId_idx`(`clienteId`),
    UNIQUE INDEX `ClienteCanal_canalId_externoUserId_key`(`canalId`, `externoUserId`),
    UNIQUE INDEX `ClienteCanal_clienteId_canalId_key`(`clienteId`, `canalId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `MovimientoMonedero` (
    `id` VARCHAR(191) NOT NULL,
    `clienteId` VARCHAR(191) NOT NULL,
    `monto` INTEGER NOT NULL,
    `motivo` ENUM('carga', 'consumo', 'devolucion', 'premio_evento', 'ajuste', 'reverso_carga') NOT NULL,
    `referenciaTipo` VARCHAR(191) NULL,
    `referenciaId` VARCHAR(191) NULL,
    `nota` TEXT NULL,
    `usuarioId` VARCHAR(191) NOT NULL,
    `creadoEn` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `MovimientoMonedero_clienteId_creadoEn_idx`(`clienteId`, `creadoEn`),
    INDEX `MovimientoMonedero_referenciaTipo_referenciaId_idx`(`referenciaTipo`, `referenciaId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `Venta_clienteId_idx` ON `Venta`(`clienteId`);

-- AddForeignKey
ALTER TABLE `Venta` ADD CONSTRAINT `Venta_clienteId_fkey` FOREIGN KEY (`clienteId`) REFERENCES `Cliente`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ClienteCanal` ADD CONSTRAINT `ClienteCanal_clienteId_fkey` FOREIGN KEY (`clienteId`) REFERENCES `Cliente`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ClienteCanal` ADD CONSTRAINT `ClienteCanal_canalId_fkey` FOREIGN KEY (`canalId`) REFERENCES `Canal`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MovimientoMonedero` ADD CONSTRAINT `MovimientoMonedero_clienteId_fkey` FOREIGN KEY (`clienteId`) REFERENCES `Cliente`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MovimientoMonedero` ADD CONSTRAINT `MovimientoMonedero_usuarioId_fkey` FOREIGN KEY (`usuarioId`) REFERENCES `Usuario`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
