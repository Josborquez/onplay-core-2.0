-- AlterTable
ALTER TABLE `discrepancia` MODIFY `tipo` ENUM('stock_derivado', 'precio_derivado', 'precio_en_oferta', 'primera_publicacion', 'producto_sin_mapear', 'producto_desaparecido', 'pedido_anulado', 'pedido_sin_stock', 'canal_sin_gestion') NOT NULL;
