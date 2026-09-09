// Ítem suelto (05-SDD V2): descripción precargada con el término buscado + precio.
// La línea viaja con productoId: null (validación 4 de 02-SDD §5.4).
import { useEffect, useState } from 'react';
import { Boton, Campo, CampoMonto, Dialogo } from './base.js';

interface Props {
  abierto: boolean;
  terminoInicial: string;
  onCerrar: () => void;
  onAgregar: (descripcion: string, precio: number) => void;
}

export function DialogoItemSuelto({ abierto, terminoInicial, onCerrar, onAgregar }: Props) {
  const [descripcion, setDescripcion] = useState('');
  const [precio, setPrecio] = useState<number | ''>('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!abierto) return;
    setDescripcion(terminoInicial);
    setPrecio('');
    setError('');
  }, [abierto, terminoInicial]);

  const agregar = () => {
    if (descripcion.trim() === '') {
      setError('Escribe una descripción.');
      return;
    }
    if (precio === '' || precio <= 0) {
      setError('Escribe un precio mayor que $0.');
      return;
    }
    onAgregar(descripcion.trim(), precio);
  };

  return (
    <Dialogo abierto={abierto} titulo="Vender como ítem suelto" onCerrar={onCerrar} ancho={420}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          agregar();
        }}
        className="flex flex-col gap-3"
      >
        <Campo
          etiqueta="Descripción"
          value={descripcion}
          onChange={(e) => setDescripcion(e.target.value)}
          autoFocus
        />
        <CampoMonto etiqueta="Precio" valor={precio} onValor={setPrecio} error={error} />
        <div className="mt-1">
          <Boton type="submit" variante="principal">
            Agregar a la venta
          </Boton>
        </div>
      </form>
    </Dialogo>
  );
}
