// Migrador propio (10-SDD §5.3, P11): aplica los `migration.sql` de Prisma con el cliente de
// consultas, sin ejecutar el schema engine (bloqueado en la Web App). Usa la MISMA tabla
// `_prisma_migrations` con las mismas columnas y el mismo checksum (SHA-256 del archivo), así
// una base migrada por Prisma en desarrollo y una migrada aquí en producción son indistinguibles
// y `prisma migrate status` sigue funcionando en local.
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';

export interface MigracionArchivo {
  nombre: string;
  checksum: string;
  sql: string;
}

export interface FilaMigracion {
  migration_name: string;
  checksum: string;
  finished_at: Date | null;
  rolled_back_at: Date | null;
  logs: string | null;
  applied_steps_count: number | bigint;
}

export interface EstadoMigraciones {
  directorio: string;
  aplicadas: string[];
  pendientes: string[];
  /** Filas con `finished_at` NULL y sin `rolled_back_at`: quedaron a medias, reparación humana. */
  fallidas: string[];
  /** Aplicadas cuyo archivo cambió después (alguien editó una migración aplicada). */
  conflictos: { nombre: string; enBase: string; enArchivo: string }[];
}

type Log = { info: (o: unknown, m?: string) => void; warn: (o: unknown, m?: string) => void };

export class ErrorMigracion extends Error {
  constructor(
    mensaje: string,
    public migracion: string | null = null,
  ) {
    super(mensaje);
    this.name = 'ErrorMigracion';
  }
}

/** dist/servidor.mjs → dist/migrations (copiadas por esbuild); desde la fuente → prisma/migrations. */
export function directorioMigraciones(): string {
  const aqui = dirname(fileURLToPath(import.meta.url));
  const candidatos = [resolve(aqui, 'migrations'), resolve(aqui, '../../../prisma/migrations')];
  const hallado = candidatos.find((c) => existsSync(join(c, 'migration_lock.toml')) || existsSync(c));
  if (!hallado) throw new ErrorMigracion(`no encuentro el directorio de migraciones (probé ${candidatos.join(', ')})`);
  return hallado;
}

/**
 * Mismo algoritmo que Prisma Migrate: SHA-256 del `migration.sql` con finales de línea LF.
 * Se normaliza CRLF→LF porque git (autocrlf) puede entregar el archivo con CRLF en Windows y
 * el checksum debe ser el mismo en cualquier sistema (verificado contra filas escritas por Prisma).
 */
export function checksumDe(sql: string): string {
  return createHash('sha256').update(sql.replace(/\r\n/g, '\n')).digest('hex');
}

/** Carpetas ordenadas por nombre (Prisma las prefija con la marca de tiempo). */
export function leerMigraciones(dir: string): MigracionArchivo[] {
  return readdirSync(dir)
    .filter((n) => statSync(join(dir, n)).isDirectory() && existsSync(join(dir, n, 'migration.sql')))
    .sort()
    .map((nombre) => {
      const sql = readFileSync(join(dir, nombre, 'migration.sql'), 'utf8');
      return { nombre, sql, checksum: checksumDe(sql) };
    });
}

/**
 * Separa un archivo SQL en sentencias por `;`, respetando comentarios (`--`, `/* *\/`) y literales
 * entre comillas simples, dobles o acentos graves (un `;` dentro de un literal no corta).
 */
export function dividirSentencias(sql: string): string[] {
  const sentencias: string[] = [];
  let actual = '';
  let i = 0;
  while (i < sql.length) {
    const c = sql[i]!;
    const n = sql[i + 1];
    if (c === '-' && n === '-') {
      while (i < sql.length && sql[i] !== '\n') i++;
      continue;
    }
    if (c === '#' && (actual.trim() === '' || /\s$/.test(actual))) {
      while (i < sql.length && sql[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && n === '*') {
      const fin = sql.indexOf('*/', i + 2);
      i = fin < 0 ? sql.length : fin + 2;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      actual += c;
      i++;
      while (i < sql.length) {
        const d = sql[i]!;
        actual += d;
        if (d === '\\' && c !== '`') {
          actual += sql[i + 1] ?? '';
          i += 2;
          continue;
        }
        i++;
        if (d === c) break;
      }
      continue;
    }
    if (c === ';') {
      const s = actual.trim();
      if (s) sentencias.push(s);
      actual = '';
      i++;
      continue;
    }
    actual += c;
    i++;
  }
  const resto = actual.trim();
  if (resto) sentencias.push(resto);
  return sentencias;
}

// Misma forma que la tabla que crea Prisma Migrate (nombres, tipos y defaults).
const DDL_TABLA_MIGRACIONES =
  'CREATE TABLE IF NOT EXISTS `_prisma_migrations` (' +
  '`id` VARCHAR(36) NOT NULL, ' +
  '`checksum` VARCHAR(64) NOT NULL, ' +
  '`finished_at` DATETIME(3) NULL, ' +
  '`migration_name` VARCHAR(255) NOT NULL, ' +
  '`logs` TEXT NULL, ' +
  '`rolled_back_at` DATETIME(3) NULL, ' +
  '`started_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), ' +
  '`applied_steps_count` INT UNSIGNED NOT NULL DEFAULT 0, ' +
  'PRIMARY KEY (`id`)) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci';

const SQL_FILAS = 'SELECT migration_name, checksum, finished_at, rolled_back_at, logs, applied_steps_count FROM `_prisma_migrations`';

function urlConUnaConexion(url: string): string {
  // GET_LOCK, DDL y las filas de control deben ir por la MISMA conexión: pool de 1.
  const u = new URL(url);
  u.searchParams.set('connection_limit', '1');
  return u.toString();
}

async function leerFilas(prisma: PrismaClient): Promise<FilaMigracion[]> {
  try {
    return await prisma.$queryRawUnsafe<FilaMigracion[]>(SQL_FILAS);
  } catch (e) {
    // Base vacía: la tabla todavía no existe.
    if (/doesn't exist|does not exist|1146/i.test((e as Error).message)) return [];
    throw e;
  }
}

function clasificar(archivos: MigracionArchivo[], filas: FilaMigracion[], directorio: string): EstadoMigraciones {
  const porNombre = new Map(filas.map((f) => [f.migration_name, f]));
  const estado: EstadoMigraciones = { directorio, aplicadas: [], pendientes: [], fallidas: [], conflictos: [] };
  for (const m of archivos) {
    const fila = porNombre.get(m.nombre);
    if (!fila || fila.rolled_back_at != null) {
      estado.pendientes.push(m.nombre);
    } else if (fila.finished_at == null) {
      estado.fallidas.push(m.nombre);
    } else {
      estado.aplicadas.push(m.nombre);
      if (fila.checksum !== m.checksum) estado.conflictos.push({ nombre: m.nombre, enBase: fila.checksum, enArchivo: m.checksum });
    }
  }
  return estado;
}

/** Solo lectura: lo que mostraría `prisma migrate status`. Sirve para /salud y GET /admin/migraciones. */
export async function estadoMigraciones(prisma: PrismaClient, dir: string = directorioMigraciones()): Promise<EstadoMigraciones> {
  return clasificar(leerMigraciones(dir), await leerFilas(prisma), dir);
}

export interface OpcionesMigrador {
  url: string;
  dir?: string;
  log?: Log;
  /** Se llama con las pendientes ANTES de tocar la base (§5.3: respaldo previo). Si lanza, no se migra. */
  antesDeAplicar?: (pendientes: string[]) => Promise<void>;
}

export interface ResultadoMigrador {
  aplicadas: string[];
  omitidas: number;
  directorio: string;
}

/**
 * Aplica las migraciones pendientes en orden. Cada una: fila en `_prisma_migrations` con
 * `finished_at` NULL → sentencias una a una (`applied_steps_count` avanza) → `finished_at`.
 * Si una sentencia falla, la fila queda con `finished_at` NULL y `logs` con el error, y se lanza
 * `ErrorMigracion`: el arranque debe detenerse (§5.1 paso 3). Candado `GET_LOCK('onplay_migrador')`
 * para que dos instancias arrancando a la vez no migren en paralelo.
 */
export async function aplicarMigraciones(op: OpcionesMigrador): Promise<ResultadoMigrador> {
  const directorio = op.dir ?? directorioMigraciones();
  const archivos = leerMigraciones(directorio);
  const prisma = new PrismaClient({ datasourceUrl: urlConUnaConexion(op.url) });
  try {
    const [candado] = await prisma.$queryRawUnsafe<{ c: number | bigint | null }[]>("SELECT GET_LOCK('onplay_migrador', 60) AS c");
    if (Number(candado?.c) !== 1) throw new ErrorMigracion('otro proceso está migrando (no se obtuvo GET_LOCK en 60 s)');
    try {
      await prisma.$executeRawUnsafe(DDL_TABLA_MIGRACIONES);
      let filas = await leerFilas(prisma);
      // Una migración que falló en su PRIMERA sentencia (0 pasos aplicados) no dejó nada a
      // medias: cada sentencia DDL de MySQL es atómica por sí sola. Se marca revertida y se
      // reintenta (p. ej. tras corregir el .sql, R-021). Con pasos > 0 sigue siendo reparación humana.
      for (const f of filas) {
        if (f.finished_at == null && f.rolled_back_at == null && Number(f.applied_steps_count) === 0) {
          await prisma.$executeRawUnsafe(
            "UPDATE `_prisma_migrations` SET rolled_back_at = UTC_TIMESTAMP(3), logs = CONCAT(IFNULL(logs, ''), ' | revertida automáticamente: 0 sentencias aplicadas') WHERE migration_name = ? AND finished_at IS NULL AND rolled_back_at IS NULL",
            f.migration_name,
          );
          op.log?.warn({ migracion: f.migration_name, error: f.logs }, 'migración fallida sin sentencias aplicadas: se marca revertida y se reintenta');
        }
      }
      filas = await leerFilas(prisma);
      const estado = clasificar(archivos, filas, directorio);
      if (estado.fallidas.length > 0) {
        throw new ErrorMigracion(
          `la migración ${estado.fallidas[0]} quedó a medias (finished_at NULL). Repárela a mano y marque rolled_back_at o finished_at en _prisma_migrations`,
          estado.fallidas[0]!,
        );
      }
      if (estado.conflictos.length > 0) {
        const c = estado.conflictos[0]!;
        throw new ErrorMigracion(`checksum distinto en ${c.nombre}: el archivo cambió después de aplicarse (base ${c.enBase.slice(0, 12)}…, archivo ${c.enArchivo.slice(0, 12)}…)`, c.nombre);
      }
      if (estado.pendientes.length > 0 && op.antesDeAplicar) await op.antesDeAplicar(estado.pendientes);

      const aplicadas: string[] = [];
      for (const m of archivos) {
        if (!estado.pendientes.includes(m.nombre)) continue;
        const id = randomUUID();
        await prisma.$executeRawUnsafe(
          'INSERT INTO `_prisma_migrations` (id, checksum, migration_name, started_at, applied_steps_count) VALUES (?, ?, ?, UTC_TIMESTAMP(3), 0)',
          id,
          m.checksum,
          m.nombre,
        );
        const sentencias = dividirSentencias(m.sql);
        let pasos = 0;
        try {
          for (const s of sentencias) {
            await prisma.$executeRawUnsafe(s);
            pasos++;
            await prisma.$executeRawUnsafe('UPDATE `_prisma_migrations` SET applied_steps_count = ? WHERE id = ?', pasos, id);
          }
        } catch (e) {
          const detalle = `sentencia ${pasos + 1} de ${sentencias.length}: ${(e as Error).message}`;
          await prisma
            .$executeRawUnsafe('UPDATE `_prisma_migrations` SET logs = ? WHERE id = ?', detalle.slice(0, 60000), id)
            .catch(() => undefined);
          throw new ErrorMigracion(`falló la migración ${m.nombre} en la ${detalle}`, m.nombre);
        }
        await prisma.$executeRawUnsafe('UPDATE `_prisma_migrations` SET finished_at = UTC_TIMESTAMP(3) WHERE id = ?', id);
        aplicadas.push(m.nombre);
        op.log?.info({ migracion: m.nombre, sentencias: sentencias.length }, 'migración aplicada');
      }
      return { aplicadas, omitidas: estado.aplicadas.length, directorio };
    } finally {
      await prisma.$queryRawUnsafe("SELECT RELEASE_LOCK('onplay_migrador')").catch(() => undefined);
    }
  } finally {
    await prisma.$disconnect();
  }
}
