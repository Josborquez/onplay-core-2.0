// La inyecta esbuild desde package.json (esbuild.config.mjs); desde la fuente (tsx) queda '2.0.0-dev'.
export const version = process.env.ONPLAY_VERSION ?? '2.0.0-dev';
