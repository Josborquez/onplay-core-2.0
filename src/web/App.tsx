// Rutas (05-SDD §6) y armazón: barra lateral plegable + centro.
// F3 pliega la barra; F4 va al backoffice (solo encargado+).
import { useEffect, useState, type ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { iniciarColaVentas } from './cola.js';
import { BarraLateral } from './components/BarraLateral.js';
import { RequiereRol } from './components/RequiereRol.js';
import { Cargando } from './components/base.js';
import { Cliente } from './pantallas/Cliente.js';
import { CambiarClave } from './pantallas/CambiarClave.js';
import { Entrar } from './pantallas/Entrar.js';
import { MisVentas } from './pantallas/MisVentas.js';
import { Mostrador } from './pantallas/Mostrador.js';
import { AltaSnack } from './pantallas/admin/AltaSnack.js';
import { Auditoria } from './pantallas/admin/Auditoria.js';
import { Clientes } from './pantallas/admin/Clientes.js';
import { Duplicados } from './pantallas/admin/Duplicados.js';
import { Stock } from './pantallas/admin/Stock.js';
import { Alertas } from './pantallas/admin/Alertas.js';
import { Recuentos, RecuentoDetalle } from './pantallas/admin/Recuentos.js';
import { Productos } from './pantallas/admin/Productos.js';
import { Sync } from './pantallas/admin/Sync.js';
import { SistemaPagina } from './pantallas/admin/SistemaPagina.js';
import { Discrepancias } from './pantallas/admin/Discrepancias.js';
import { PedidosOnline } from './pantallas/admin/PedidosOnline.js';
import { TurnosAdmin } from './pantallas/admin/TurnosAdmin.js';
import { VentasAdmin } from './pantallas/admin/VentasAdmin.js';
import { ProveedorSesion, useSesion } from './sesion.js';
import { useLateralPlegada, useTema } from './tema.js';
import { rolAlcanza, type RolUsuario } from './tipos.js';

/** Bajo 1024 px la barra va SIEMPRE plegada y no se expande (05-SDD §3.4). */
function useAngosta() {
  const [angosta, setAngosta] = useState(() => window.matchMedia('(max-width: 1023px)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 1023px)');
    const al = (e: MediaQueryListEvent) => setAngosta(e.matches);
    mq.addEventListener('change', al);
    return () => mq.removeEventListener('change', al);
  }, []);
  return angosta;
}

function Armazon({ children }: { children: ReactNode }) {
  const { usuario, cargando } = useSesion();
  const { tema, conmutar: conmutarTema } = useTema();
  const { plegada: preferida, conmutar: conmutarLateral } = useLateralPlegada();
  const angosta = useAngosta();
  const plegada = angosta || preferida;
  const navegar = useNavigate();

  // F10: la cola de ventas offline corre en cualquier pantalla con sesión.
  useEffect(() => iniciarColaVentas(), []);

  // F3: plegar/desplegar la barra. F4: ir al backoffice, solo encargado+ (05-SDD V2).
  useEffect(() => {
    const alTeclear = (e: KeyboardEvent) => {
      if (e.key === 'F3') {
        e.preventDefault();
        conmutarLateral();
      } else if (e.key === 'F4') {
        e.preventDefault();
        if (usuario && rolAlcanza(usuario.rol, 'encargado')) navegar('/admin/productos');
      }
    };
    window.addEventListener('keydown', alTeclear);
    return () => window.removeEventListener('keydown', alTeclear);
  }, [conmutarLateral, navegar, usuario]);

  if (cargando) return <Cargando texto="Un momento…" />;
  if (!usuario) return <Navigate to="/entrar" replace />;
  // 2.0 §5.4: la clave del entorno es de un solo uso; nada se usa hasta cambiarla.
  if (usuario.debeCambiarClave) return <CambiarClave />;

  return (
    <div
      className="rejilla-app grid h-screen bg-bg2"
      style={{ gridTemplateColumns: `${plegada ? 72 : 236}px minmax(0, 1fr)` }}
    >
      <BarraLateral plegada={plegada} onPlegar={conmutarLateral} tema={tema} onTema={conmutarTema} />
      <main className="min-h-0 overflow-y-auto">{children}</main>
    </div>
  );
}

/** Ruta del backoffice (05-SDD §6): /sync exige admin; el resto, encargado+. */
function admin(pantalla: ReactNode, rol: RolUsuario = 'encargado') {
  return (
    <Armazon>
      <RequiereRol rol={rol}>{pantalla}</RequiereRol>
    </Armazon>
  );
}

export function App() {
  return (
    <ProveedorSesion>
      <BrowserRouter>
        <Routes>
          <Route path="/entrar" element={<Entrar />} />
          <Route
            path="/"
            element={
              <Armazon>
                <Mostrador />
              </Armazon>
            }
          />
          <Route
            path="/mis-ventas"
            element={
              <Armazon>
                <MisVentas />
              </Armazon>
            }
          />
          <Route
            path="/clientes/:id"
            element={
              <Armazon>
                <Cliente />
              </Armazon>
            }
          />
          <Route path="/admin" element={<Navigate to="/admin/productos" replace />} />
          <Route path="/admin/productos" element={admin(<Productos />)} />
          <Route path="/admin/snacks" element={admin(<AltaSnack />)} />
          <Route path="/admin/stock" element={admin(<Stock />)} />
          <Route path="/admin/stock/alertas" element={admin(<Alertas />)} />
          <Route path="/admin/recuentos" element={admin(<Recuentos />)} />
          <Route path="/admin/recuentos/:id" element={admin(<RecuentoDetalle />)} />
          <Route path="/admin/ventas" element={admin(<VentasAdmin />)} />
          <Route path="/admin/turnos" element={admin(<TurnosAdmin />)} />
          <Route path="/admin/clientes" element={admin(<Clientes />)} />
          <Route path="/admin/duplicados" element={admin(<Duplicados />)} />
          <Route path="/admin/auditoria" element={admin(<Auditoria />)} />
          <Route path="/admin/sync" element={admin(<Sync />)} /> {/* R-024: admin y encargado */}
          <Route path="/admin/sistema" element={admin(<SistemaPagina />, 'admin')} /> {/* 2.0 §5.5 */}
          <Route path="/admin/discrepancias" element={admin(<Discrepancias />)} /> {/* E3 V13 */}
          <Route path="/admin/pedidos" element={admin(<PedidosOnline />)} /> {/* E3 V14 */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </ProveedorSesion>
  );
}
