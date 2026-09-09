// Jerarquía de roles (02-SDD §5, SDD general §6.2).
// Un rol superior puede hacer todo lo del inferior.

export type Rol = 'vendedor' | 'encargado' | 'admin';

const NIVEL: Record<Rol, number> = {
  vendedor: 1,
  encargado: 2,
  admin: 3,
};

/** ¿El rol del usuario alcanza el rol mínimo exigido por el endpoint? */
export function rolAlcanza(rolUsuario: Rol, rolMinimo: Rol): boolean {
  return NIVEL[rolUsuario] >= NIVEL[rolMinimo];
}
