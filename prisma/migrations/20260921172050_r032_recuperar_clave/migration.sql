-- CreateTable
CREATE TABLE `RecuperacionClave` (
    `id` VARCHAR(191) NOT NULL,
    `usuarioId` VARCHAR(191) NOT NULL,
    `tokenHash` CHAR(64) NOT NULL,
    `expiraEn` DATETIME(3) NOT NULL,
    `usadoEn` DATETIME(3) NULL,
    `ip` VARCHAR(191) NULL,
    `creadoEn` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `RecuperacionClave_tokenHash_key`(`tokenHash`),
    INDEX `RecuperacionClave_usuarioId_creadoEn_idx`(`usuarioId`, `creadoEn`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `RecuperacionClave` ADD CONSTRAINT `RecuperacionClave_usuarioId_fkey` FOREIGN KEY (`usuarioId`) REFERENCES `Usuario`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
