// Empaqueta la API (src/api + src/dominio + src/woo) en UN archivo: dist/servidor.mjs (10-SDD §5.2).
// Las dependencias de node_modules quedan externas: en la Web App el runtime las tiene
// instaladas (salida del build = raíz), y así los nativos (@prisma/client, argon2) no se tocan.
import { build } from 'esbuild';
import { cpSync, mkdirSync, rmSync, readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

await build({
  entryPoints: ['src/api/index.ts'],
  outfile: 'dist/servidor.mjs',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  packages: 'external',
  alias: {
    '@onplay/dominio': './src/dominio/index.ts',
    '@onplay/woo-client': './src/woo/index.ts',
  },
  sourcemap: true,
  legalComments: 'none',
  define: { 'process.env.ONPLAY_VERSION': JSON.stringify(pkg.version) },
  logLevel: 'info',
});

// Las migraciones viajan junto al bundle: el migrador (§5.3) las lee de dist/migrations.
mkdirSync('dist', { recursive: true });
rmSync('dist/migrations', { recursive: true, force: true });
cpSync('prisma/migrations', 'dist/migrations', { recursive: true });
console.log(`build api ok · v${pkg.version}`);
