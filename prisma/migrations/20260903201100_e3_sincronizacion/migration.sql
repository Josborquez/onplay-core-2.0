-- AlterTable
ALTER TABLE `canal` ADD COLUMN `ingestaPedidos` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `pushPrecio` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `pushStock` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `ultimaIngestaEn` DATETIME(3) NULL,
    ADD COLUMN `ultimoPushPrecioEn` DATETIME(3) NULL,
    ADD COLUMN `ultimoPushStockEn` DATETIME(3) NULL;

-- AlterTable
ALTER TABLE `productocanal` ADD COLUMN `precioPublicado` INTEGER NULL,
    ADD COLUMN `publicadoEn` DATETIME(3) NULL,
    ADD COLUMN `stockPublicado` INTEGER NULL,
    ADD COLUMN `syncMensaje` TEXT NULL,
    ADD COLUMN `syncPrecio` ENUM('pendiente', 'al_dia', 'por_publicar', 'detenido', 'error') NOT NULL DEFAULT 'pendiente',
    ADD COLUMN `syncStock` ENUM('pendiente', 'al_dia', 'por_publicar', 'detenido', 'error') NOT NULL DEFAULT 'pendiente';

-- CreateTable
CREATE TABLE `Discrepancia` (
    `id` VARCHAR(191) NOT NULL,
    `canalId` VARCHAR(191) NOT NULL,
    `productoCanalId` VARCHAR(191) NULL,
    `pedidoCanalId` VARCHAR(191) NULL,
    `pedidoCanalLineaId` VARCHAR(191) NULL,
    `tipo` ENUM('stock_derivado', 'precio_derivado', 'precio_en_oferta', 'primera_publicacion', 'producto_sin_mapear', 'producto_desaparecido', 'pedido_anulado', 'pedido_sin_stock') NOT NULL,
    `estado` ENUM('abierta', 'resuelta', 'descartada') NOT NULL DEFAULT 'abierta',
    `valorMaestro` INTEGER NULL,
    `valorCanal` INTEGER NULL,
    `valorPublicado` INTEGER NULL,
    `vecesVista` INTEGER NOT NULL DEFAULT 1,
    `vistaEn` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `detalle` TEXT NULL,
    `claveAbierta` VARCHAR(191) NULL,
    `creadaEn` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `resueltaEn` DATETIME(3) NULL,
    `resueltaPorId` VARCHAR(191) NULL,
    `accionTomada` VARCHAR(191) NULL,

    UNIQUE INDEX `Discrepancia_claveAbierta_key`(`claveAbierta`),
    INDEX `Discrepancia_canalId_estado_tipo_idx`(`canalId`, `estado`, `tipo`),
    INDEX `Discrepancia_productoCanalId_tipo_idx`(`productoCanalId`, `tipo`),
    INDEX `Discrepancia_creadaEn_idx`(`creadaEn`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SyncCorrida` (
    `id` VARCHAR(191) NOT NULL,
    `canalId` VARCHAR(191) NOT NULL,
    `tipo` ENUM('pedidos', 'precios', 'stock', 'adopcion') NOT NULL,
    `estado` ENUM('en_curso', 'terminada', 'abortada') NOT NULL DEFAULT 'en_curso',
    `simulacion` BOOLEAN NOT NULL DEFAULT true,
    `iniciadaEn` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `terminadaEn` DATETIME(3) NULL,
    `leidos` INTEGER NOT NULL DEFAULT 0,
    `aEscribir` INTEGER NOT NULL DEFAULT 0,
    `escritos` INTEGER NOT NULL DEFAULT 0,
    `omitidos` INTEGER NOT NULL DEFAULT 0,
    `detenidos` INTEGER NOT NULL DEFAULT 0,
    `fallidos` INTEGER NOT NULL DEFAULT 0,
    `mensaje` TEXT NULL,
    `usuarioId` VARCHAR(191) NULL,

    INDEX `SyncCorrida_canalId_tipo_iniciadaEn_idx`(`canalId`, `tipo`, `iniciadaEn`),
    INDEX `SyncCorrida_canalId_tipo_estado_idx`(`canalId`, `tipo`, `estado`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SyncCorridaItem` (
    `id` VARCHAR(191) NOT NULL,
    `corridaId` VARCHAR(191) NOT NULL,
    `sku` VARCHAR(191) NOT NULL,
    `accion` VARCHAR(191) NOT NULL,
    `valorAntes` INTEGER NULL,
    `valorDespues` INTEGER NULL,
    `mensaje` TEXT NULL,

    INDEX `SyncCorridaItem_corridaId_idx`(`corridaId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PedidoCanal` (
    `id` VARCHAR(191) NOT NULL,
    `canalId` VARCHAR(191) NOT NULL,
    `externoId` INTEGER NOT NULL,
    `numero` VARCHAR(191) NOT NULL,
    `estadoCanal` VARCHAR(191) NOT NULL,
    `total` INTEGER NOT NULL,
    `montoReembolsado` INTEGER NOT NULL DEFAULT 0,
    `clienteEmail` VARCHAR(191) NULL,
    `clienteExternoId` INTEGER NULL,
    `clienteId` VARCHAR(191) NULL,
    `creadoEnCanal` DATETIME(3) NOT NULL,
    `modificadoEnCanal` DATETIME(3) NULL,
    `ingeridoEn` DATETIME(3) NULL,
    `revisadoEn` DATETIME(3) NULL,

    INDEX `PedidoCanal_canalId_ingeridoEn_idx`(`canalId`, `ingeridoEn`),
    INDEX `PedidoCanal_clienteId_idx`(`clienteId`),
    UNIQUE INDEX `PedidoCanal_canalId_externoId_key`(`canalId`, `externoId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PedidoCanalLinea` (
    `id` VARCHAR(191) NOT NULL,
    `pedidoId` VARCHAR(191) NOT NULL,
    `externoItemId` INTEGER NOT NULL,
    `externoSku` VARCHAR(191) NULL,
    `descripcion` VARCHAR(191) NOT NULL,
    `cantidad` INTEGER NOT NULL,
    `cantidadDevuelta` INTEGER NOT NULL DEFAULT 0,
    `precioUnitario` INTEGER NOT NULL,
    `productoId` VARCHAR(191) NULL,

    INDEX `PedidoCanalLinea_pedidoId_idx`(`pedidoId`),
    UNIQUE INDEX `PedidoCanalLinea_pedidoId_externoItemId_key`(`pedidoId`, `externoItemId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `ProductoCanal_canalId_syncStock_idx` ON `ProductoCanal`(`canalId`, `syncStock`);

-- CreateIndex
CREATE INDEX `ProductoCanal_canalId_syncPrecio_idx` ON `ProductoCanal`(`canalId`, `syncPrecio`);

-- AddForeignKey
ALTER TABLE `Discrepancia` ADD CONSTRAINT `Discrepancia_canalId_fkey` FOREIGN KEY (`canalId`) REFERENCES `Canal`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Discrepancia` ADD CONSTRAINT `Discrepancia_productoCanalId_fkey` FOREIGN KEY (`productoCanalId`) REFERENCES `ProductoCanal`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Discrepancia` ADD CONSTRAINT `Discrepancia_pedidoCanalId_fkey` FOREIGN KEY (`pedidoCanalId`) REFERENCES `PedidoCanal`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Discrepancia` ADD CONSTRAINT `Discrepancia_pedidoCanalLineaId_fkey` FOREIGN KEY (`pedidoCanalLineaId`) REFERENCES `PedidoCanalLinea`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Discrepancia` ADD CONSTRAINT `Discrepancia_resueltaPorId_fkey` FOREIGN KEY (`resueltaPorId`) REFERENCES `Usuario`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SyncCorrida` ADD CONSTRAINT `SyncCorrida_canalId_fkey` FOREIGN KEY (`canalId`) REFERENCES `Canal`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SyncCorrida` ADD CONSTRAINT `SyncCorrida_usuarioId_fkey` FOREIGN KEY (`usuarioId`) REFERENCES `Usuario`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SyncCorridaItem` ADD CONSTRAINT `SyncCorridaItem_corridaId_fkey` FOREIGN KEY (`corridaId`) REFERENCES `SyncCorrida`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PedidoCanal` ADD CONSTRAINT `PedidoCanal_canalId_fkey` FOREIGN KEY (`canalId`) REFERENCES `Canal`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PedidoCanal` ADD CONSTRAINT `PedidoCanal_clienteId_fkey` FOREIGN KEY (`clienteId`) REFERENCES `Cliente`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PedidoCanalLinea` ADD CONSTRAINT `PedidoCanalLinea_pedidoId_fkey` FOREIGN KEY (`pedidoId`) REFERENCES `PedidoCanal`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PedidoCanalLinea` ADD CONSTRAINT `PedidoCanalLinea_productoId_fkey` FOREIGN KEY (`productoId`) REFERENCES `Producto`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
