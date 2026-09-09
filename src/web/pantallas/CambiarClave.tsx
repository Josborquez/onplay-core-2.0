// 2.0 §5.4: el admin inicial entra con la clave del entorno (de un solo uso) y no puede usar
// el sistema hasta cambiarla. Misma tarjeta que V0 (Entrar).
import { useState } from 'react';
import { cambiarClave, ErrorApi } from '../api.js';
import { Banner, Boton, Campo } from '../components/base.js';
import { useSesion } from '../sesion.js';

export function CambiarClave() {
  const { usuario, actualizarUsuario, salir } = useSesion();
  const [actual, setActual] = useState('');
  const [nueva, setNueva] = useState('');
  const [repetida, setRepetida] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const enviar = async () => {
    if (enviando) return;
    setError(null);
    if (nueva.length < 8) return setError('La contraseña nueva debe tener al menos 8 caracteres.');
    if (nueva !== repetida) return setError('Las dos contraseñas nuevas no coinciden.');
    if (nueva === actual) return setError('La contraseña nueva debe ser distinta de la actual.');
    setEnviando(true);
    try {
      const u = await cambiarClave(actual, nueva);
      actualizarUsuario(u);
    } catch (e) {
      setError(e instanceof ErrorApi && e.codigo === 'CLAVE_ACTUAL_INVALIDA' ? 'La contraseña actual no es correcta.' : 'No se pudo cambiar la contraseña.');
      setEnviando(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg2 p-4">
      <div className="w-full max-w-[380px] rounded-tarjeta bg-bg p-6 shadow-tarjeta">
        <h1 className="mb-2 text-center text-tit text-lab">Cambia tu contraseña</h1>
        <p className="mb-4 text-center text-sec text-lab2">
          Hola {usuario?.nombre}. La contraseña con la que entraste es de un solo uso: elige una nueva para seguir.
        </p>
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
          <Campo etiqueta="Contraseña actual" type="password" autoComplete="current-password" value={actual} onChange={(e) => setActual(e.target.value)} autoFocus />
          <Campo etiqueta="Contraseña nueva" type="password" autoComplete="new-password" value={nueva} onChange={(e) => setNueva(e.target.value)} />
          <Campo etiqueta="Repite la nueva" type="password" autoComplete="new-password" value={repetida} onChange={(e) => setRepetida(e.target.value)} />
          <div className="mt-2 flex flex-col gap-2">
            <Boton type="submit" variante="principal" tamano="grande" cargando={enviando}>
              Guardar y entrar
            </Boton>
            <Boton type="button" variante="secundario" onClick={() => void salir()}>
              Salir
            </Boton>
          </div>
        </form>
      </div>
    </div>
  );
}
