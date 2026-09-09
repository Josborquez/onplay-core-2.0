// «Sistema» como pantalla propia (R-024): migraciones, respaldos, usuarios y renumeración no son
// sincronización con las tiendas. Solo admin.
import { useSesion } from '../../sesion.js';
import { Encabezado } from './util.js';
import { Sistema } from './Sistema.js';

export function SistemaPagina() {
  const { usuario } = useSesion();
  return (
    <div className="p-4">
      <Encabezado titulo="Sistema" />
      <p className="mb-2 text-chico text-lab3">Lo que en un servidor normal sería la terminal: estado de la base de datos, copias de seguridad, usuarios del sistema y tareas de mantenimiento.</p>
      {usuario ? <Sistema usuarioActualId={usuario.id} /> : null}
    </div>
  );
}
