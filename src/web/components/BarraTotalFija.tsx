// Barra fija inferior para pantallas angostas (<1024px, 05-SDD §3.4).
import { clp } from '../utils/formato.js';

export function BarraTotalFija({
  total,
  deshabilitado,
  onCobrar,
}: {
  total: number;
  deshabilitado: boolean;
  onCobrar: () => void;
}) {
  return (
    <div className="no-imprimir fixed inset-x-0 bottom-0 z-30 flex items-center justify-between gap-3 border-t border-sep bg-bg px-4 py-3 lg:hidden">
      <span className="num text-tit font-semibold text-lab">{clp(total)}</span>
      <button
        type="button"
        onClick={onCobrar}
        disabled={deshabilitado}
        className={`h-boton rounded-campo bg-ac-relleno px-6 text-cuerpo font-semibold text-sobre-ac ${deshabilitado ? 'cursor-not-allowed opacity-50' : ''}`}
      >
        Cobrar
      </button>
    </div>
  );
}
