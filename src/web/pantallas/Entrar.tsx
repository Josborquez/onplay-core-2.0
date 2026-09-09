// V0 — Entrar (05-SDD §7): tarjeta de 380 px, foco en Correo, Enter envía.
// Nunca se dice cuál de los dos campos falló.
import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useSesion } from '../sesion.js';
import { Banner, Boton, Campo } from '../components/base.js';

export function Entrar() {
  const { usuario, vencida, entrar } = useSesion();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [fallo, setFallo] = useState(false);

  if (usuario) return <Navigate to="/" replace />;

  const enviar = async () => {
    if (enviando) return;
    setEnviando(true);
    setFallo(false);
    try {
      await entrar(email.trim(), password);
    } catch {
      setFallo(true);
      setEnviando(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg2 p-4">
      <div className="w-full max-w-[380px] rounded-tarjeta bg-bg p-6 shadow-tarjeta">
        <h1 className="mb-6 text-center text-tit text-lab">OnPlay</h1>
        {vencida ? (
          <div className="mb-4">
            <Banner tono="alerta">Tu sesión venció. Entra de nuevo.</Banner>
          </div>
        ) : null}
        {fallo ? (
          <div className="mb-4">
            <Banner tono="peligro">Correo o contraseña incorrectos.</Banner>
          </div>
        ) : null}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void enviar();
          }}
          className="flex flex-col gap-3"
        >
          <Campo
            etiqueta="Correo"
            type="email"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoFocus
          />
          <Campo
            etiqueta="Contraseña"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <div className="mt-2">
            <Boton type="submit" variante="principal" tamano="grande" cargando={enviando}>
              Entrar
            </Boton>
          </div>
        </form>
      </div>
    </div>
  );
}
