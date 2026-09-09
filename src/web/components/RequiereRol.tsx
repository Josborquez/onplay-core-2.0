// Guardia del backoffice (05-SDD §6): un vendedor nunca entra a /admin.
// Sin permiso → pantalla propia con el rol requerido y botón para volver (§8).
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSesion } from '../sesion.js';
import { rolAlcanza, type RolUsuario } from '../tipos.js';
import { Boton } from './base.js';

export function RequiereRol({ rol, children }: { rol: RolUsuario; children: ReactNode }) {
  const { usuario } = useSesion();
  const navegar = useNavigate();
  if (usuario && rolAlcanza(usuario.rol, rol)) return <>{children}</>;
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
      <p className="text-tit text-lab">Esta sección es solo para {rol}</p>
      <p className="text-cuerpo text-lab2">
        Esta acción es solo para {rol}. Pídele a un {rol} que la haga.
      </p>
      <div className="w-[192px]">
        <Boton onClick={() => navegar('/')}>Volver al mostrador</Boton>
      </div>
    </div>
  );
}
