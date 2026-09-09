// Contexto de sesión: usuario en memoria, reanudación por cookie httpOnly (H7).
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { alVencerSesion, cerrarSesion, iniciarSesion, reanudarSesion, type Usuario } from './api.js';

interface Sesion {
  usuario: Usuario | null;
  cargando: boolean;
  vencida: boolean;
  entrar: (email: string, password: string) => Promise<void>;
  salir: () => Promise<void>;
}

const Contexto = createContext<Sesion | null>(null);

export function ProveedorSesion({ children }: { children: ReactNode }) {
  const [usuario, setUsuario] = useState<Usuario | null>(null);
  const [cargando, setCargando] = useState(true);
  const [vencida, setVencida] = useState(false);

  useEffect(() => {
    alVencerSesion(() => {
      setUsuario(null);
      setVencida(true);
    });
    void reanudarSesion().then((u) => {
      setUsuario(u);
      setCargando(false);
    });
  }, []);

  const entrar = useCallback(async (email: string, password: string) => {
    const u = await iniciarSesion(email, password);
    setVencida(false);
    setUsuario(u);
  }, []);

  const salir = useCallback(async () => {
    await cerrarSesion();
    setUsuario(null);
  }, []);

  return <Contexto.Provider value={{ usuario, cargando, vencida, entrar, salir }}>{children}</Contexto.Provider>;
}

export function useSesion(): Sesion {
  const s = useContext(Contexto);
  if (!s) throw new Error('useSesion fuera del proveedor');
  return s;
}
