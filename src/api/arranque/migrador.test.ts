// Test obligatorio del migrador (10-SDD §5.3): contra la MariaDB local.
// - base vacía → aplica todas y el esquema es idéntico al de `prisma migrate` (SHOW CREATE TABLE
//   de cada tabla comparado con la base de desarrollo `onplay_core`, migrada por Prisma);
// - los checksums coinciden con los que escribió Prisma (mismo algoritmo);
// - segunda corrida → 0 aplicadas;
// - migración con error → fila con finished_at NULL + logs y excepción; la siguiente corrida se detiene.
// Sin DATABASE_URL (o sin base alcanzable) los tests de base se saltan; los puros corren siempre.
import 'dotenv/config';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { aplicarMigraciones, checksumDe, dividirSentencias, ErrorMigracion, estadoMigraciones, leerMigraciones } from './migrador.js';

describe('dividirSentencias', () => {
  it('separa por ; y quita comentarios', () => {
    const sql = `-- CreateTable\nCREATE TABLE \`a\` (\n  \`id\` INT NOT NULL,\n  PRIMARY KEY (\`id\`)\n);\n\n-- AddForeignKey\nALTER TABLE \`a\` ADD CONSTRAINT x FOREIGN KEY (\`id\`) REFERENCES \`b\`(\`id\`);\n`;
    const s = dividirSentencias(sql);
    expect(s).toHaveLength(2);
    expect(s[0]).toMatch(/^CREATE TABLE/);
    expect(s[1]).toMatch(/^ALTER TABLE/);
  });
  it('respeta ; dentro de literales y comentarios de bloque', () => {
    const sql = `INSERT INTO t (x) VALUES ('a;b'); /* x; y */ UPDATE t SET x = "c;d" WHERE y = \`z;w\`;`;
    expect(dividirSentencias(sql)).toEqual([`INSERT INTO t (x) VALUES ('a;b')`, `UPDATE t SET x = "c;d" WHERE y = \`z;w\``]);
  });
  it('acepta la última sentencia sin ; final', () => {
    expect(dividirSentencias('SELECT 1;\nSELECT 2')).toEqual(['SELECT 1', 'SELECT 2']);
  });
});

const urlDev = process.env.DATABASE_URL ?? '';
const dirReal = resolve(process.cwd(), 'prisma/migrations');

function urlBase(nombre: string): string {
  const u = new URL(urlDev);
  u.pathname = `/${nombre}`;
  return u.toString();
}

async function hayBase(): Promise<boolean> {
  if (!urlDev) return false;
  const p = new PrismaClient({ datasourceUrl: urlDev });
  try {
    await p.$queryRawUnsafe('SELECT 1');
    return true;
  } catch {
    return false;
  } finally {
    await p.$disconnect();
  }
}

const BASE_PRUEBA = 'onplay_core_migrador_test';
const BASE_FALLO = 'onplay_core_migrador_fallo';

const conBase = (await hayBase()) ? describe : describe.skip;

conBase('aplicarMigraciones contra MariaDB local', () => {
  let admin: PrismaClient;
  beforeAll(async () => {
    admin = new PrismaClient({ datasourceUrl: urlDev });
    for (const b of [BASE_PRUEBA, BASE_FALLO]) {
      await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS \`${b}\``);
      await admin.$executeRawUnsafe(`CREATE DATABASE \`${b}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    }
  });
  afterAll(async () => {
    for (const b of [BASE_PRUEBA, BASE_FALLO]) await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS \`${b}\``).catch(() => undefined);
    await admin.$disconnect();
  });

  it('base vacía → aplica todas; esquema y checksums idénticos a los de Prisma; segunda corrida no aplica nada', async () => {
    const archivos = leerMigraciones(dirReal);
    expect(archivos.length).toBeGreaterThan(0);

    const r1 = await aplicarMigraciones({ url: urlBase(BASE_PRUEBA), dir: dirReal });
    expect(r1.aplicadas).toEqual(archivos.map((a) => a.nombre));
    expect(r1.omitidas).toBe(0);

    const prueba = new PrismaClient({ datasourceUrl: urlBase(BASE_PRUEBA) });
    try {
      // 1) Mismo esquema que la base migrada por Prisma (dev).
      const tablas = await prueba.$queryRawUnsafe<{ t: string }[]>(
        `SELECT TABLE_NAME AS t FROM information_schema.TABLES WHERE TABLE_SCHEMA = '${BASE_PRUEBA}' AND TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_NAME`,
      );
      expect(tablas.length).toBeGreaterThan(10);
      const nombreDev = new URL(urlDev).pathname.slice(1);
      const normalizar = (ddl: string) => ddl.replace(/ AUTO_INCREMENT=\d+/g, '').replace(new RegExp(`\`${BASE_PRUEBA}\`\\.`, 'g'), '').replace(new RegExp(`\`${nombreDev}\`\\.`, 'g'), '');
      const distintas: string[] = [];
      for (const { t } of tablas) {
        if (t === '_prisma_migrations') continue;
        const [a] = await prueba.$queryRawUnsafe<{ 'Create Table': string }[]>(`SHOW CREATE TABLE \`${t}\``);
        const [b] = await admin.$queryRawUnsafe<{ 'Create Table': string }[]>(`SHOW CREATE TABLE \`${nombreDev}\`.\`${t}\``);
        if (normalizar(a!['Create Table']) !== normalizar(b!['Create Table'])) distintas.push(t);
      }
      expect(distintas).toEqual([]);

      // 2) Mismo checksum que el que escribió Prisma para la misma migración (mismo algoritmo).
      const filasDev = await admin.$queryRawUnsafe<{ migration_name: string; checksum: string }[]>(
        `SELECT migration_name, checksum FROM \`${nombreDev}\`.\`_prisma_migrations\` WHERE finished_at IS NOT NULL`,
      );
      const dev = new Map(filasDev.map((f) => [f.migration_name, f.checksum]));
      for (const a of archivos) {
        if (dev.has(a.nombre)) expect(a.checksum, a.nombre).toBe(dev.get(a.nombre));
      }
      // 3) Estado: todo aplicado.
      const estado = await estadoMigraciones(prueba, dirReal);
      expect(estado.pendientes).toEqual([]);
      expect(estado.fallidas).toEqual([]);
      expect(estado.conflictos).toEqual([]);
      expect(estado.aplicadas).toHaveLength(archivos.length);
    } finally {
      await prueba.$disconnect();
    }

    // 4) Idempotente.
    const r2 = await aplicarMigraciones({ url: urlBase(BASE_PRUEBA), dir: dirReal });
    expect(r2.aplicadas).toEqual([]);
    expect(r2.omitidas).toBe(archivos.length);
  }, 120_000);

  it('migración con error → fila con finished_at NULL + logs, excepción, y la siguiente corrida se detiene', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'onplay-mig-'));
    try {
      mkdirSync(join(dir, '20990101000000_ok'));
      writeFileSync(join(dir, '20990101000000_ok', 'migration.sql'), 'CREATE TABLE `ok` (`id` INT NOT NULL, PRIMARY KEY (`id`));\n');
      mkdirSync(join(dir, '20990102000000_rota'));
      writeFileSync(
        join(dir, '20990102000000_rota', 'migration.sql'),
        'CREATE TABLE `rota` (`id` INT NOT NULL, PRIMARY KEY (`id`));\nINSERT INTO `no_existe` (`x`) VALUES (1);\n',
      );
      const url = urlBase(BASE_FALLO);
      await expect(aplicarMigraciones({ url, dir })).rejects.toBeInstanceOf(ErrorMigracion);

      const p = new PrismaClient({ datasourceUrl: url });
      try {
        const filas = await p.$queryRawUnsafe<{ migration_name: string; finished_at: Date | null; logs: string | null; applied_steps_count: number }[]>(
          'SELECT migration_name, finished_at, logs, applied_steps_count FROM `_prisma_migrations` ORDER BY migration_name',
        );
        expect(filas).toHaveLength(2);
        expect(filas[0]!.finished_at).not.toBeNull();
        expect(filas[1]!.finished_at).toBeNull();
        expect(Number(filas[1]!.applied_steps_count)).toBe(1);
        expect(filas[1]!.logs).toMatch(/sentencia 2 de 2/);
        const estado = await estadoMigraciones(p, dir);
        expect(estado.fallidas).toEqual(['20990102000000_rota']);
      } finally {
        await p.$disconnect();
      }
      // La siguiente corrida no intenta seguir: reparación humana.
      await expect(aplicarMigraciones({ url, dir })).rejects.toThrow(/quedó a medias/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);

  it('antesDeAplicar recibe las pendientes y puede abortar sin tocar la base', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'onplay-mig-'));
    try {
      mkdirSync(join(dir, '20990103000000_x'));
      writeFileSync(join(dir, '20990103000000_x', 'migration.sql'), 'CREATE TABLE `x` (`id` INT NOT NULL, PRIMARY KEY (`id`));\n');
      let vistas: string[] = [];
      await expect(
        aplicarMigraciones({
          url: urlBase(BASE_FALLO),
          dir,
          antesDeAplicar: async (p) => {
            vistas = p;
            throw new Error('respaldo falló');
          },
        }),
      ).rejects.toThrow(/respaldo falló/);
      expect(vistas).toEqual(['20990103000000_x']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('checksumDe', () => {
  it('es SHA-256 hex del contenido', () => {
    expect(checksumDe('hola')).toBe('b221d9dbb083a7f33428d7c2a3c3198ae925614d70210e28716ccaa7cd4ddb79');
  });
});
