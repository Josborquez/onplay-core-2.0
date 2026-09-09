// Cliente HTTP del mostrador. El token de acceso vive en MEMORIA (S3, H7):
// el refresh token va en cookie httpOnly y nunca toca localStorage.

export interface Usuario {
  id: string;
  nombre: string;
  email: string;
  rol: 'vendedor' | 'encargado' | 'admin';
}

export class ErrorApi extends Error {
  constructor(
    public estado: number,
    public codigo: string,
    public cuerpo: Record<string, unknown>,
  ) {
    super(codigo);
  }
}

let tokenAcceso: string | null = null;
let expiraEn = 0; // epoch ms del exp del JWT
let alExpirarSesion: (() => void) | null = null;

export function alVencerSesion(fn: () => void) {
  alExpirarSesion = fn;
}

function guardarToken(token: string) {
  tokenAcceso = token;
  try {
    const carga = JSON.parse(atob(token.split('.')[1] ?? '')) as { exp?: number };
    expiraEn = (carga.exp ?? 0) * 1000;
  } catch {
    expiraEn = 0;
  }
}

/** Renovación silenciosa (05-SDD V0): refresca cuando quedan menos de 30 minutos. */
async function asegurarToken(): Promise<string | null> {
  const faltan = expiraEn - Date.now();
  if (tokenAcceso && faltan > 30 * 60 * 1000) return tokenAcceso;
  const r = await fetch('/api/v1/auth/refresh', { method: 'POST', credentials: 'include' });
  if (r.ok) {
    const datos = (await r.json()) as { token: string };
    guardarToken(datos.token);
    return tokenAcceso;
  }
  // Si aún hay un token vigente, se sigue con él; si no, la sesión venció.
  if (tokenAcceso && faltan > 0) return tokenAcceso;
  tokenAcceso = null;
  return null;
}

export async function iniciarSesion(email: string, password: string): Promise<Usuario> {
  const r = await fetch('/api/v1/auth/login', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const cuerpo = (await r.json()) as Record<string, unknown>;
  if (!r.ok) throw new ErrorApi(r.status, String(cuerpo.error ?? 'ERROR'), cuerpo);
  guardarToken(cuerpo.token as string);
  return cuerpo.usuario as unknown as Usuario;
}

/** Intenta recuperar la sesión desde la cookie al cargar la aplicación. */
export async function reanudarSesion(): Promise<Usuario | null> {
  const token = await asegurarToken();
  if (!token) return null;
  try {
    return await api<Usuario>('/auth/yo');
  } catch {
    return null;
  }
}

export async function cerrarSesion() {
  await fetch('/api/v1/auth/salir', { method: 'POST', credentials: 'include' }).catch(() => {});
  tokenAcceso = null;
  expiraEn = 0;
}

export async function api<T>(ruta: string, opciones: RequestInit = {}): Promise<T> {
  const token = await asegurarToken();
  if (!token) {
    alExpirarSesion?.();
    throw new ErrorApi(401, 'SESION_VENCIDA', {});
  }
  const r = await fetch(`/api/v1${ruta}`, {
    ...opciones,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(opciones.body ? { 'Content-Type': 'application/json' } : {}),
      ...opciones.headers,
    },
  });
  if (r.status === 401) {
    alExpirarSesion?.();
    throw new ErrorApi(401, 'SESION_VENCIDA', {});
  }
  const cuerpo = (r.status === 204 ? {} : await r.json()) as Record<string, unknown>;
  if (!r.ok) throw new ErrorApi(r.status, String(cuerpo.error ?? 'ERROR'), cuerpo);
  return cuerpo as T;
}

/**
 * Descarga un archivo de la API con el token en memoria (S3: nunca en la URL) y lo entrega al
 * navegador vía blob. E2 C10: export CSV del stock.
 */
export async function descargar(ruta: string, nombreArchivo: string): Promise<void> {
  const token = await asegurarToken();
  if (!token) throw new ErrorApi(401, 'NO_AUTENTICADO', {});
  const r = await fetch(`/api/v1${ruta}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) throw new ErrorApi(r.status, 'DESCARGA_FALLIDA', {});
  const blob = await r.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nombreArchivo;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
