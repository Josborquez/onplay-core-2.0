import type { FastifyInstance } from 'fastify';
import { prisma } from '../db.js';
import { entorno } from '../entorno.js';
import { version } from '../version.js';

async function canalResponde(canal: { url: string; ck: string; cs: string }): Promise<boolean> {
  if (!canal.url || !canal.ck || !canal.cs) return false;
  try {
    const url = new URL('/wp-json/wc/v3/products', canal.url);
    url.searchParams.set('per_page', '1');
    url.searchParams.set('consumer_key', canal.ck);
    url.searchParams.set('consumer_secret', canal.cs);
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    return res.ok;
  } catch {
    return false;
  }
}

export default async function rutasSalud(app: FastifyInstance) {
  // Público (02-SDD §5.7)
  app.get('/salud', async () => {
    let db = false;
    try {
      await prisma.$queryRaw`SELECT 1`;
      db = true;
    } catch {
      db = false;
    }
    const [onplay, onplaygames] = await Promise.all([
      canalResponde(entorno.canales.onplay_cl),
      canalResponde(entorno.canales.onplaygames_cl),
    ]);
    const canales = { onplay_cl: onplay, onplaygames_cl: onplaygames };
    return { ok: db, db, canales, version };
  });
}
