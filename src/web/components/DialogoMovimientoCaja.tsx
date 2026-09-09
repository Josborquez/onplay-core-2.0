// V24 — Movimiento de caja (03-SDD §6.7, C9): ingreso o retiro de efectivo durante el turno,
// con nota obligatoria. Entra al arqueo. Solo encargado.
import { useEffect, useState } from 'react';
import { ErrorApi, api } from '../api.js';
import { clp } from '../utils/formato.js';
import { Boton, Campo, CampoMonto, Dialogo, Segmentado } from './base.js';

type Tipo = 'ingreso' | 'retiro';

interface Props {
  abierto: boolean;
  turnoId: string | null;
  onCerrar: () => void;
  onHecho: (m: { tipo: Tipo; monto: number }) => void;
}

export function DialogoMovimientoCaja({ abierto, turnoId, onCerrar, onHecho }: Props) {
  const [tipo, setTipo] = useState<Tipo>('retiro');
  const [monto, setMonto] = useState<number | ''>('');
  const [nota, setNota] = useState('');
  const [error, setError] = useState('');
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    if (!abierto) return;
    setTipo('retiro');
    setMonto('');
    setNota('');
    setError('');
  }, [abierto]);

  const guardar = async () => {
    if (!turnoId) return;
    if (monto === '' || monto <= 0) {
      setError('El monto debe ser mayor que $0.');
      return;
    }
    if (!nota.trim()) {
      setError('La nota es obligatoria: un movimiento de caja sin explicación descuadra el arqueo sin rastro.');
      return;
    }
    setEnviando(true);
    setError('');
    try {
      await api(`/turnos/${turnoId}/movimientos-caja`, { method: 'POST', body: JSON.stringify({ tipo, monto, nota: nota.trim() }) });
      onHecho({ tipo, monto });
      onCerrar();
    } catch (e) {
      setError(e instanceof ErrorApi ? (e.codigo === 'TURNO_CERRADO' ? 'El turno ya cerró.' : `No se pudo registrar (${e.codigo}).`) : 'Sin conexión.');
    } finally {
      setEnviando(false);
    }
  };

  return (
    <Dialogo abierto={abierto} titulo="Movimiento de caja" onCerrar={onCerrar} cerrable={!enviando} ancho={440}>
      <div className="flex flex-col gap-3">
        <Segmentado<Tipo>
          opciones={[
            { valor: 'retiro', etiqueta: 'Retiro de efectivo' },
            { valor: 'ingreso', etiqueta: 'Ingreso de efectivo' },
          ]}
          valor={tipo}
          onChange={(t) => t && setTipo(t)}
        />
        <CampoMonto etiqueta="Monto" valor={monto} onValor={setMonto} autoFocus />
        <Campo etiqueta="Nota (obligatoria)" value={nota} onChange={(e) => setNota(e.target.value)} placeholder={tipo === 'retiro' ? 'Ej.: depósito al banco' : 'Ej.: sencillo para vueltos'} />
        <p className="text-chico text-lab3">
          {tipo === 'retiro' ? 'Resta' : 'Suma'} {monto === '' ? '' : clp(monto)} al efectivo que debería haber al cierre.
        </p>
        {error ? <p className="text-chico text-peligro">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <Boton onClick={onCerrar} deshabilitado={enviando}>
            Cancelar
          </Boton>
          <Boton variante="principal" cargando={enviando} onClick={() => void guardar()}>
            Registrar {tipo}
          </Boton>
        </div>
      </div>
    </Dialogo>
  );
}
