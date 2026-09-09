// V1 — Apertura de turno (05-SDD §7). Diálogo no cerrable: sin turno no hay nada más.
// 409 TURNO_YA_ABIERTO → se carga el turno existente en silencio.
import { useState } from 'react';
import { api, ErrorApi } from '../api.js';
import type { Turno } from '../tipos.js';
import { Boton, CampoMonto, Dialogo } from './base.js';

export function DialogoApertura({ onAbierto }: { onAbierto: (t: Turno) => void }) {
  const [monto, setMonto] = useState<number | ''>('');
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState('');

  const abrir = async () => {
    if (monto === '') {
      setError('Escribe el monto contado, aunque sea $0.');
      return;
    }
    setEnviando(true);
    setError('');
    try {
      const turno = await api<Turno>('/turnos/abrir', {
        method: 'POST',
        body: JSON.stringify({ montoApertura: monto }),
      });
      onAbierto(turno);
    } catch (e) {
      if (e instanceof ErrorApi && e.codigo === 'TURNO_YA_ABIERTO') {
        // Turno abierto en otro dispositivo: se carga sin molestar.
        const actual = await api<Turno | null>('/turnos/actual').catch(() => null);
        if (actual) {
          onAbierto(actual);
          return;
        }
      }
      setError('No se pudo abrir el turno. Revisa la conexión e intenta de nuevo.');
      setEnviando(false);
    }
  };

  return (
    <Dialogo abierto titulo="Abrir turno" cerrable={false} ancho={420}>
      <p className="mb-4 text-cuerpo text-lab2">
        Cuenta el efectivo antes de escribirlo. Este monto se usa para cuadrar la caja al cierre.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void abrir();
        }}
      >
        <CampoMonto etiqueta="Efectivo en caja" valor={monto} onValor={setMonto} error={error} autoFocus />
        <div className="mt-4">
          <Boton type="submit" variante="principal" tamano="grande" cargando={enviando}>
            Abrir turno
          </Boton>
        </div>
      </form>
    </Dialogo>
  );
}
