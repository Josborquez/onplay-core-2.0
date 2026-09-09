import { build } from 'esbuild';
import { mkdirSync, writeFileSync } from 'node:fs';

await build({
  entryPoints: ['src/servidor.mjs'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  outfile: 'dist/servidor.mjs',
  external: ['@prisma/client', '.prisma/client'],
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
});
mkdirSync('dist', { recursive: true });
writeFileSync('dist/build-info.json', JSON.stringify({
  construidoEn: new Date().toISOString(),
  nodeBuild: process.version,
  devDependenciasInstaladas: true,
  cwd: process.cwd(),
}, null, 2));
console.log('build ok');
