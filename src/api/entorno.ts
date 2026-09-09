import 'dotenv/config';

function requerida(nombre: string): string {
  const valor = process.env[nombre];
  if (!valor) throw new Error(`Variable de entorno requerida: ${nombre}`);
  return valor;
}

export const entorno = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  // En la Web App de Hostinger PORT no existe (LiteSpeed Node escucha en un socket, R-019):
  // opcional con default, nunca motivo de salida.
  puerto: Number(process.env.PORT ?? 3010),
  // Prisma la lee sola, pero se exige aquí para que el panel muestre un error claro (§5.1 paso 1).
  databaseUrl: requerida('DATABASE_URL'),
  jwtSecret: requerida('JWT_SECRET'),
  // 2.0 §5.4 — solo se usan si no hay ningún usuario activo.
  adminInicialEmail: process.env.ADMIN_INICIAL_EMAIL ?? '',
  adminInicialPassword: process.env.ADMIN_INICIAL_PASSWORD ?? '',
  // 2.0 §5.6 — respaldo lógico desde la app: hora Chile; vacío desactiva el automático.
  respaldoCron: process.env.RESPALDO_CRON ?? '0 3 * * *',
  respaldoRetencion: Number(process.env.RESPALDO_RETENCION ?? 7),
  // Fuera del árbol de la versión desplegada: $HOME es el directorio del dominio y persiste (R-019).
  respaldoDir: process.env.RESPALDO_DIR ?? (process.env.HOME ? `${process.env.HOME}/onplay-respaldos` : 'respaldos'),
  jwtExpira: process.env.JWT_EXPIRA ?? '8h',
  refreshExpira: process.env.REFRESH_EXPIRA ?? '30d',
  corsOrigins: (process.env.CORS_ORIGINS ?? '').split(',').filter(Boolean),
  // Candado de la Etapa 1 (S1/S2): solo lectura hacia WooCommerce salvo opt-out explícito.
  syncSoloLectura: (process.env.SYNC_SOLO_LECTURA ?? 'true') !== 'false',
  // §11: apagar el cron sin tocar código, y ajustar la frecuencia si hiciera falta.
  syncHabilitado: (process.env.SYNC_HABILITADO ?? 'true') !== 'false',
  syncCron: process.env.SYNC_CRON ?? '*/30 * * * *',
  // E3 §11 — la unidad programada es la corrida completa (pedidos → precios → stock).
  syncCronCompleta: process.env.SYNC_CRON_COMPLETA ?? '*/15 * * * *',
  syncLote: Number(process.env.SYNC_LOTE ?? 50),
  syncConcurrencia: Number(process.env.SYNC_CONCURRENCIA ?? 4),
  // De dónde descuenta una venta online (§8.2). Código de Ubicacion.
  syncUbicacionOnline: process.env.SYNC_UBICACION_ONLINE ?? 'bodega',
  // Antigüedad máxima de la ingesta para permitir el push de stock (§4.2).
  syncVentanaIngestaMin: Number(process.env.SYNC_VENTANA_INGESTA_MIN ?? 20),
  alertaDiscrepancias: Number(process.env.ALERTA_DISCREPANCIAS ?? 25),
  alertaCorreo: process.env.ALERTA_CORREO ?? '',
  canales: {
    onplay_cl: {
      url: process.env.WOO_ONPLAY_URL ?? '',
      ck: process.env.WOO_ONPLAY_CK ?? '',
      cs: process.env.WOO_ONPLAY_CS ?? '',
    },
    onplaygames_cl: {
      url: process.env.WOO_ONPLAYGAMES_URL ?? '',
      ck: process.env.WOO_ONPLAYGAMES_CK ?? '',
      cs: process.env.WOO_ONPLAYGAMES_CS ?? '',
    },
  },
} as const;
