// Respaldo lógico desde la app (10-SDD §5.6): sin mysqldump ni cron del sistema, el proceso
// genera un archivo SQL (restaurable con phpMyAdmin o `mysql`, sin herramienta propia) con
// DROP/CREATE + INSERT por tabla en lotes de 500 filas (P13), comprimido con gzip, en un
// directorio FUERA del árbol de la versión desplegada ($HOME/onplay-respaldos, R-019), con
// retención de N archivos. Automático: cron diario y SIEMPRE antes de aplicar migraciones.
import { createWriteStream, existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as esperar } from 'node:timers/promises';
import { createGzip } from 'node:zlib';
import type { PrismaClient } from '@prisma/client';
import { prisma as clientePorDefecto } from '../db.js';
import { entorno } from '../entorno.js';
import { estadoMigraciones } from './migrador.js';
import { version } from '../version.js';

export type MotivoRespaldo = 'manual' | 'diario' | 'pre-migracion';

export interface ResumenRespaldo {
  id: string; // nombre del archivo
  ruta: string;
  bytes: number;
  tablas: number;
  filas: number;
  ms: number;
  motivo: MotivoRespaldo;
  creadoEn: string;
  eliminadosPorRetencion: string[];
}

export interface ArchivoRespaldo {
  id: string;
  bytes: number;
  creadoEn: Date;
}

type Log = { info: (o: unknown, m?: string) => void; warn: (o: unknown, m?: string) => void; error: (o: unknown, m?: string) => void };

const LOTE = 500;
const PATRON = /^onplay-core_\d{8}-\d{6}_[a-z-]+\.sql\.gz$/;

function escaparTexto(s: string): string {
  return s.replace(/[\0\x08\x09\x1a\n\r"'\\]/g, (c) => {
    switch (c) {
      case '\0':
        return '\\0';
      case '\x08':
        return '\\b';
      case '\x09':
        return '\\t';
      case '\x1a':
        return '\\Z';
      case '\n':
        return '\\n';
      case '\r':
        return '\\r';
      default:
        return `\\${c}`;
    }
  });
}

function fechaSql(d: Date): string {
  return d.toISOString().replace('T', ' ').replace('Z', '');
}

export function valorSql(v: unknown): string {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL';
  if (typeof v === 'bigint') return v.toString();
  if (typeof v === 'boolean') return v ? '1' : '0';
  if (v instanceof Date) return `'${fechaSql(v)}'`;
  if (v instanceof Uint8Array) return `X'${Buffer.from(v).toString('hex')}'`;
  if (typeof v === 'object') return `'${escaparTexto(JSON.stringify(v))}'`;
  return `'${escaparTexto(String(v))}'`;
}

function marcaDeTiempo(d: Date): string {
  return d.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
}

async function tablasDeLaBase(prisma: PrismaClient): Promise<string[]> {
  const filas = await prisma.$queryRawUnsafe<{ t: string }[]>(
    "SELECT TABLE_NAME AS t FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_NAME",
  );
  // La tabla de control primero: al restaurar, el migrador ya sabe qué hay aplicado.
  return filas.map((f) => f.t).sort((a, b) => (a === '_prisma_migrations' ? -1 : b === '_prisma_migrations' ? 1 : a.localeCompare(b)));
}

async function clavePrimaria(prisma: PrismaClient, tabla: string): Promise<string[]> {
  const filas = await prisma.$queryRawUnsafe<{ Column_name: string; Seq_in_index: number | bigint }[]>(`SHOW KEYS FROM \`${tabla}\` WHERE Key_name = 'PRIMARY'`);
  return filas.sort((a, b) => Number(a.Seq_in_index) - Number(b.Seq_in_index)).map((f) => f.Column_name);
}

export function listarRespaldos(dir: string = entorno.respaldoDir): ArchivoRespaldo[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((n) => PATRON.test(n))
    .map((id) => {
      const st = statSync(join(dir, id));
      return { id, bytes: st.size, creadoEn: st.mtime };
    })
    .sort((a, b) => b.id.localeCompare(a.id));
}

export function rutaRespaldo(id: string, dir: string = entorno.respaldoDir): string | null {
  if (!PATRON.test(id)) return null;
  const ruta = join(dir, id);
  return existsSync(ruta) ? ruta : null;
}

function aplicarRetencion(dir: string, conservar: number): string[] {
  const eliminados: string[] = [];
  for (const a of listarRespaldos(dir).slice(Math.max(1, conservar))) {
    unlinkSync(join(dir, a.id));
    eliminados.push(a.id);
  }
  return eliminados;
}

export interface OpcionesRespaldo {
  motivo: MotivoRespaldo;
  dir?: string;
  retencion?: number;
  prisma?: PrismaClient;
  log?: Log;
}

/** Genera el respaldo y aplica la retención. Lanza si no puede escribir (el que llama decide). */
export async function generarRespaldo(op: OpcionesRespaldo): Promise<ResumenRespaldo> {
  const t = Date.now();
  const prisma = op.prisma ?? clientePorDefecto;
  const dir = op.dir ?? entorno.respaldoDir;
  const retencion = op.retencion ?? entorno.respaldoRetencion;
  mkdirSync(dir, { recursive: true });
  const ahora = new Date();
  const id = `onplay-core_${marcaDeTiempo(ahora)}_${op.motivo}.sql.gz`;
  const ruta = join(dir, id);

  const tablas = await tablasDeLaBase(prisma);
  const estado = await estadoMigraciones(prisma).catch(() => null);
  const gz = createGzip({ level: 6 });
  const archivo = createWriteStream(ruta);
  const terminado = new Promise<void>((res, rej) => {
    archivo.on('finish', res);
    archivo.on('error', rej);
    gz.on('error', rej);
  });
  gz.pipe(archivo);
  const escribir = (s: string) =>
    new Promise<void>((res, rej) => {
      if (gz.write(s)) return res();
      gz.once('drain', res);
      gz.once('error', rej);
    });

  let filasTotal = 0;
  try {
    await escribir(
      [
        `-- onplay-core respaldo lógico`,
        `-- version: ${version}`,
        `-- fecha (UTC): ${ahora.toISOString()}`,
        `-- motivo: ${op.motivo}`,
        `-- migracion vigente: ${estado?.aplicadas.at(-1) ?? 'desconocida'}`,
        `-- tablas: ${tablas.length}`,
        `-- Restaurar: mysql -u usuario -p base < archivo.sql  (o importar en phpMyAdmin)`,
        `SET NAMES utf8mb4;`,
        `SET time_zone = '+00:00';`,
        `SET FOREIGN_KEY_CHECKS = 0;`,
        `SET UNIQUE_CHECKS = 0;`,
        ``,
      ].join('\n'),
    );
    for (const tabla of tablas) {
      const [cr] = await prisma.$queryRawUnsafe<{ 'Create Table': string }[]>(`SHOW CREATE TABLE \`${tabla}\``);
      await escribir(`\n-- ---- ${tabla} ----\nDROP TABLE IF EXISTS \`${tabla}\`;\n${cr!['Create Table']};\n`);
      const pk = await clavePrimaria(prisma, tabla);
      const orden = pk.length > 0 ? `ORDER BY ${pk.map((c) => `\`${c}\``).join(', ')}` : '';
      let desde = 0;
      for (;;) {
        const filas = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(`SELECT * FROM \`${tabla}\` ${orden} LIMIT ${LOTE} OFFSET ${desde}`);
        if (filas.length === 0) break;
        const columnas = Object.keys(filas[0]!);
        const valores = filas.map((f) => `(${columnas.map((c) => valorSql(f[c])).join(',')})`).join(',\n');
        await escribir(`INSERT INTO \`${tabla}\` (${columnas.map((c) => `\`${c}\``).join(', ')}) VALUES\n${valores};\n`);
        filasTotal += filas.length;
        desde += filas.length;
        if (filas.length < LOTE) break;
        await esperar(25); // P13: no monopolizar la base compartida con las tiendas
      }
    }
    await escribir(`\nSET FOREIGN_KEY_CHECKS = 1;\nSET UNIQUE_CHECKS = 1;\n-- fin (${filasTotal} filas)\n`);
    gz.end();
    await terminado;
  } catch (e) {
    gz.destroy();
    archivo.destroy();
    try {
      unlinkSync(ruta);
    } catch {
      /* nada */
    }
    throw e;
  }

  const bytes = statSync(ruta).size;
  const eliminadosPorRetencion = aplicarRetencion(dir, retencion);
  const resumen: ResumenRespaldo = { id, ruta, bytes, tablas: tablas.length, filas: filasTotal, ms: Date.now() - t, motivo: op.motivo, creadoEn: ahora.toISOString(), eliminadosPorRetencion };
  op.log?.info(resumen, 'respaldo generado');
  return resumen;
}

/** §5.3: antes de aplicar migraciones pendientes. En una base vacía (primer arranque) no hay nada que respaldar. */
export async function respaldarAntesDeMigrar(pendientes: string[], log: Log): Promise<void> {
  // El migrador ya creó `_prisma_migrations` antes de llamar aquí: no cuenta como dato.
  const tablas = (await tablasDeLaBase(clientePorDefecto)).filter((t) => t !== '_prisma_migrations');
  if (tablas.length === 0) {
    log.info({ pendientes }, 'base vacía: se migra sin respaldo previo');
    return;
  }
  const r = await generarRespaldo({ motivo: 'pre-migracion', log });
  log.warn({ respaldo: r.id, pendientes }, 'respaldo previo a la migración generado');
}
