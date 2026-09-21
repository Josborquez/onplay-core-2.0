// R-032: «¿Olvidaste tu contraseña?». Misma tarjeta que V0 (Entrar).
// /recuperar pide el correo y siempre responde igual (no revela quién tiene cuenta);
// /restablecer?token=… llega desde el enlace del correo y fija la contraseña nueva.
import { useEffect, useState, type ReactNode } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { ErrorApi, pedirRecuperacion, recuperacionDisponible, restablecerClave } from '../api.js';
import { Banner, Boton, Campo } from '../components/base.js';
import { useSesion } from '../sesion.js';

function Tarjeta({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-bg2 p-4">
      <div className="w-full max-w-[380px] rounded-tarjeta bg-bg p-6 shadow-tarjeta">
        <h1 className="mb-4 text-center text-tit text-lab">{titulo}</h1>
        {children}
        <p className="mt-4 text-center text-sec">
          <Link to="/entrar" className="text-lab2 underline underline-offset-2">
            Volver a entrar
          </Link>
        </p>
      </div>
    </div>
  );
}

export function Recuperar() {
  const { usuario } = useSesion();
  const [disponible, setDisponible] = useState<boolean | null>(null);
  const [email, setEmail] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [enviado, setEnviado] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    recuperacionDisponible()
      .then((r) => setDisponible(r.disponible))
      .catch(() => setDisponible(false));
  }, []);

  if (usuario) return <Navigate to="/" replace />;

  const enviar = async () => {
    if (enviando || !email.trim()) return;
    setEnviando(true);
    setError(null);
    try {
      await pedirRecuperacion(email.trim());
      setEnviado(true);
    } catch (e) {
      setError(
        e instanceof ErrorApi && e.codigo === 'DEMASIADOS_INTENTOS'
          ? 'Demasiados intentos. Espera unos minutos y vuelve a probar.'
          : 'No se pudo enviar. Revisa el correo e intenta de nuevo.',
      );
    } finally {
      setEnviando(false);
    }
  };

  if (disponible === false) {
    return (
      <Tarjeta titulo="Recuperar contraseña">
        <Banner tono="alerta">El envío de correos no está configurado. Pide al administrador una contraseña temporal.</Banner>
      </Tarjeta>
    );
  }

  if (enviado) {
    return (
      <Tarjeta titulo="Revisa tu correo">
        <p className="text-center text-cuerpo text-lab2">
          Si <strong className="text-lab">{email.trim()}</strong> tiene una cuenta, te llegará un enlace para elegir una
          contraseña nueva. Vence en una hora. Revisa también la carpeta de spam.
        </p>
      </Tarjeta>
    );
  }

  return (
    <Tarjeta titulo="Recuperar contraseña">
      <p className="mb-4 text-center text-sec text-lab2">Escribe el correo con el que entras y te enviaremos un enlace.</p>
      {error ? (
        <div className="mb-4">
          <Banner tono="peligro">{error}</Banner>
        </div>
      ) : null}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void enviar();
        }}
        className="flex flex-col gap-3"
      >
        <Campo etiqueta="Correo" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
        <div className="mt-2">
          <Boton type="submit" variante="principal" tamano="grande" cargando={enviando || disponible === null}>
            Enviar enlace
          </Boton>
        </div>
      </form>
    </Tarjeta>
  );
}

export function Restablecer() {
  const [parametros] = useSearchParams();
  const token = parametros.get('token') ?? '';
  const navegar = useNavigate();
  const [nueva, setNueva] = useState('');
  const [repetida, setRepetida] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [vencido, setVencido] = useState(!token);

  const enviar = async () => {
    if (enviando) return;
    setError(null);
    if (nueva.length < 8) return setError('La contraseña debe tener al menos 8 caracteres.');
    if (nueva !== repetida) return setError('Las dos contraseñas no coinciden.');
    setEnviando(true);
    try {
      await restablecerClave(token, nueva);
      navegar('/entrar?restablecida=1', { replace: true });
    } catch (e) {
      if (e instanceof ErrorApi && e.codigo === 'ENLACE_INVALIDO') setVencido(true);
      else setError('No se pudo guardar la contraseña. Intenta de nuevo.');
      setEnviando(false);
    }
  };

  if (vencido) {
    return (
      <Tarjeta titulo="Enlace vencido">
        <Banner tono="alerta">Este enlace ya se usó o venció. Pide uno nuevo.</Banner>
        <div className="mt-4">
          <Boton variante="principal" onClick={() => navegar('/recuperar')}>
            Pedir otro enlace
          </Boton>
        </div>
      </Tarjeta>
    );
  }

  return (
    <Tarjeta titulo="Elige una contraseña nueva">
      {error ? (
        <div className="mb-4">
          <Banner tono="peligro">{error}</Banner>
        </div>
      ) : null}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void enviar();
        }}
        className="flex flex-col gap-3"
      >
        <Campo etiqueta="Contraseña nueva" type="password" autoComplete="new-password" value={nueva} onChange={(e) => setNueva(e.target.value)} autoFocus />
        <Campo etiqueta="Repite la nueva" type="password" autoComplete="new-password" value={repetida} onChange={(e) => setRepetida(e.target.value)} />
        <div className="mt-2">
          <Boton type="submit" variante="principal" tamano="grande" cargando={enviando}>
            Guardar contraseña
          </Boton>
        </div>
      </form>
    </Tarjeta>
  );
}
