import 'dotenv/config';

function requerida(nombre: string): string {
  const valor = process.env[nombre];
  if (!valor) throw new Error(`Variable de entorno requerida: ${nombre}`);
  return valor;
}

export const entorno = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  puerto: Number(process.env.PORT ?? 3010),
  jwtSecret: requerida('JWT_SECRET'),
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
