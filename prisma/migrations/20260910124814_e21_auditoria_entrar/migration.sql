-- AlterTable
ALTER TABLE `Auditoria` MODIFY `accion` ENUM('crear', 'editar', 'anular', 'cambiar_precio', 'abrir_turno', 'cerrar_turno', 'devolver', 'recuento', 'ajustar_stock', 'vender_reservado', 'entrar') NOT NULL;
