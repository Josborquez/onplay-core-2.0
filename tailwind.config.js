/** Cristal OnPlay (05-SDD §4): todo color sale de un token CSS.
 * Tailwind solo referencia variables; ningún componente declara un color literal. */
export default {
  content: ['./index.html', './src/web/**/*.{ts,tsx}'],
  theme: {
    colors: {
      transparent: 'transparent',
      bg: 'var(--bg)',
      bg2: 'var(--bg2)',
      bg3: 'var(--bg3)',
      barra: 'var(--barra)',
      lab: 'var(--lab)',
      lab2: 'var(--lab2)',
      lab3: 'var(--lab3)',
      sep: 'var(--sep)',
      ac: 'var(--ac)',
      'ac-relleno': 'var(--ac-relleno)',
      'sobre-ac': 'var(--sobre-ac)',
      'ac-suave': 'var(--ac-suave)',
      rosa: 'var(--rosa)',
      ok: 'var(--ok)',
      alerta: 'var(--alerta)',
      peligro: 'var(--peligro)',
      'barra-solida': 'var(--barra-solida)',
      velo: 'var(--velo)',
    },
    zIndex: { 0: '0', 10: '10', 20: '20', 30: '30', 40: '40', 50: '50', toast: 'var(--z-toast)' },
    opacity: { 0: '0', 30: '0.3', 35: '0.35', 40: '0.4', 50: '0.5', 55: '0.55', 60: '0.6', 70: '0.7', 80: '0.8', 90: '0.9', 100: '1' },
    fontFamily: {
      sans: ['-apple-system', 'Inter', 'system-ui', 'sans-serif'],
      mono: ['"IBM Plex Mono"', 'ui-monospace', 'monospace'],
    },
    fontSize: {
      total: ['var(--t-total)', { lineHeight: '1.05', letterSpacing: '-0.035em', fontWeight: '600' }],
      tit: ['var(--t-tit)', { lineHeight: '1.2', letterSpacing: '-0.02em', fontWeight: '600' }],
      cuerpo: ['var(--t-cuerpo)', { lineHeight: '1.4', letterSpacing: '-0.01em' }],
      chico: ['var(--t-chico)', { lineHeight: '1.35' }],
      rot: ['var(--t-rot)', { lineHeight: '1.3' }],
    },
    spacing: {
      0: '0', 1: '4px', 2: '8px', 3: '12px', 4: '16px', 5: '20px',
      6: '24px', 8: '32px', 12: '48px',
      // alturas de objetivo táctil (05-SDD §4.4)
      tactil: '44px', boton: '50px', fila: '56px', 'item-barra': '40px',
    },
    borderRadius: {
      none: '0', menor: '6px', DEFAULT: '8px', campo: '11px', tarjeta: '12px', full: '9999px',
    },
    boxShadow: {
      tarjeta: 'var(--sombra)',
      foco: '0 0 0 3.5px var(--ac-suave)',
      none: 'none',
    },
    extend: {},
  },
  plugins: [],
};
