# 12 — Brief de diseño UX para Claude Design

| | |
|---|---|
| **Proyecto** | `onplay-core` 2.0 · POS/ERP de OnPlay (mostrador + backoffice) |
| **Fecha** | 10 de septiembre de 2026 |
| **Estado de la app** | Etapas 1–4 y 6 (Fase 1) construidas; en staging `core-staging.onplaygames.cl` |
| **Documento vigente de diseño** | `docs/05-SDD-diseno-interfaz-etapa1_1.md` (Cristal OnPlay, v1.1, cubre solo la Etapa 1: V0–V11) |
| **Qué se pide** | Un **`05-SDD-diseno-interfaz` v2** en Markdown que cubra las 28 pantallas actuales, resuelva los hallazgos de §5 y defina los patrones que faltan (§6). Debe ser ejecutable por Claude Code con las mismas reglas de §3 |
| **Origen** | Revisión del dueño 2026-09-10: «botones fuera de área, mensajes que no se notan, necesita un orden» (R-028) |

---

## 1. Contexto en tres párrafos

**Qué es.** Un sistema para una tienda de cartas coleccionables, juegos de mesa y snacks en una galería del centro de Santiago. Tiene dos caras: el **mostrador** (vender de pie, con un cliente esperando, a veces con una sola mano, con lector de código de barras y conexión que se cae) y el **backoffice** (encargado y dueño: productos, stock, compras, clientes, tiendas web, reportes). Una sola PWA React 19 + Tailwind 3.4, sin librería de componentes, con tema claro y oscuro por tokens CSS.

**Quién lo usa.** Tres roles: `vendedor` (solo mostrador y sus ventas), `encargado` (todo el backoffice operativo) y `admin` (además tiendas web con escritura, sistema, usuarios). El vendedor puede ser alguien nuevo que no sabe qué es un «alt art». El encargado carga facturas de distribuidores desde el PDF, recibe mercadería, hace recuentos. El dueño mira reportes y sincronización con las dos tiendas WooCommerce.

**Qué pasó.** El diseño de la Etapa 1 (spec 05) fue pensado para el mostrador y cinco pantallas de backoffice. Desde entonces se sumaron **17 pantallas** de inventario, sincronización, clientes y compras, construidas cada una con los componentes base pero **sin una pauta común de disposición, acciones y mensajes**. El resultado: la barra lateral tiene 17 ítems sin agrupar, cada pantalla pone sus botones donde pudo, los avisos de éxito o error aparecen arriba mientras la persona está mirando abajo, y las tablas con acciones por fila no respetan los objetivos táctiles.

---

## 2. Lo que ya existe y NO se cambia (restricciones duras)

Estas reglas vienen de `05-SDD` y del código; el rediseño se apoya en ellas, no las reemplaza.

### 2.1 Principios de interfaz (05 §2)
I1 una pantalla para vender · I2 el foco vive en el buscador · I3 todo con teclado (solo teclas de función como atajos: F3 plegar barra, F4 backoffice, F8 limpiar venta) · I4 los números primero, énfasis por tamaño y no por color · I5 el error se muestra donde se comete · I6 nada bloquea sin decir por qué (`motivoDeshabilitado` visible, nunca `title`) · I7 estado de conexión permanente y discreto · I8 la marca vive en los neutros.

### 2.2 Tokens (05 §4, `src/web/index.css`, `tailwind.config.js`)

Color por rol semántico, dos temas (`data-tema="claro|oscuro"`):

| Token | Claro | Oscuro | Uso |
|---|---|---|---|
| `--bg` | `#FFFFFF` | `#0A0610` | tarjetas, listas, panel de venta |
| `--bg2` | `#F5F3F9` | `#171021` | fondo de la aplicación |
| `--bg3` | `#FFFFFF` | `#211830` | superficie elevada |
| `--barra` | `rgba(248,246,252,.72)` | `rgba(23,16,33,.74)` | barra lateral translúcida |
| `--lab` / `--lab2` / `--lab3` | `#1A1220` / `.80` / `.72` | `#F4F0F8` / `.62` / `.55` | texto principal / secundario / ayuda |
| `--sep` | `rgba(58,45,72,.13)` | `rgba(168,138,248,.16)` | filetes y bordes |
| `--ac` / `--ac-relleno` / `--sobre-ac` | `#440084` / `#440084` / blanco | `#B79CF9` / `#7A3AD6` / blanco | **solo** acción principal y anillo de foco |
| `--ac-suave` | `rgba(68,0,132,.045)` | `rgba(168,138,248,.09)` | fila seleccionada |
| `--rosa` | `#FF3B77` | `#FF5D8F` | **solo** el punto de 5 px de la sección activa |
| `--ok` / `--alerta` / `--peligro` | `#1D7F3A` / `#B25000` / `#C4001A` | `#30D158` / `#FF9F0A` / `#FF453A` | confirmación / atención / bloqueo |

Reglas de contención de la marca (05 §4.1.1): el morado solo en el relleno del botón principal; el total en `--lab`; el rosa solo en el punto de sección activa; grises con sesgo violeta.

Tipografía: Inter (con `-apple-system` primero) y IBM Plex Mono para códigos; `tabular-nums` en todo dinero y cantidad; escala fluida `--t-total clamp(30px,3.3vw,52px)` · `--t-tit clamp(17px,1.35vw,22px)` · `--t-cuerpo clamp(13.5px,1vw,16px)` · `--t-chico clamp(11.5px,.82vw,13px)` · `--t-rot clamp(9.5px,.68vw,11px)`; inputs nunca bajo 16 px reales.

Espaciado: rejilla de 8 con subdivisión de 4 (`4, 8, 12, 16, 20, 24, 32, 48`; la escala de Tailwind está **cerrada**: no existen `w-40`, `pb-24`, etc.). Radios `6 / 8 / 11 / 12`. Una sola sombra (`--sombra`). Foco: borde `--ac` + `box-shadow 0 0 0 3.5px var(--ac-suave)`.

Objetivos táctiles (05 §4.4): mínimo **44 × 44**, botón principal **50**, fila de lista **56**, ítem de barra **40**, 8 px entre objetivos distintos. Tokens de altura: `h-tactil`, `h-boton`, `h-fila`, `h-item-barra`.

Formato (05 §4.5): `clp()` → `$11.000` / `−$1.240`; `fecha()` → `25-08-2026`; `hora()` 24 h; solo `src/web/utils/formato.ts` formatea.

### 2.3 Estructura (05 §3)
Rejilla `barra lateral | contenido | (panel de venta solo en el mostrador)`; barra 236 px desplegada / 72 px plegada, persistente en `localStorage`, translúcida; `≥1024` completa, `640–1023` siempre plegada + barra fija inferior con total y Cobrar, `<640` barra inferior de 4 pestañas. Conmutador de tema en el pie de la barra. `<main>` con scroll propio.

### 2.4 Componentes base (`src/web/components/base.tsx`)
`Boton` (`principal|secundario|peligro|fantasma`, `tamano`, `cargando`, `deshabilitado`, `motivoDeshabilitado`; **siempre `w-full` del contenedor**, por eso las pantallas lo envuelven en `div` de ancho fijo), `Campo`, `CampoMonto` (solo enteros, prefijo `$`), `Dialogo` (atrapa foco, `ancho` 480 por defecto, `max-h 92vh` con scroll), `Segmentado`, `Insignia` (`neutro|ok|alerta|peligro`, borde + texto), `Banner` (`ok|alerta|peligro`, `role=status`, acción opcional a la derecha), `Vacio` (una sola acción), `Cargando`, `ConmutadorVista` (grilla/lista), `EtiquetaStock` («quedan N · M en bodega» / «sin stock aquí»). En `pantallas/admin/util.tsx`: `Encabezado` (título + `extra` a la derecha), `Selecto`, `Paginacion` (Anterior / Página X de Y / Siguiente).

### 2.5 Reglas transversales que siguen vigentes
Estados (05 §8): cargando inicial con esqueletos, cargando en fondo sin reemplazar contenido, vacío con una acción, error como `Banner --peligro` con qué pasó y reintentar, sin permiso con el rol requerido. Sin conexión (05 §8.1): el mostrador sigue vendiendo con caché y cola; el backoffice se deshabilita con «Necesitas conexión para esto.» Accesibilidad (05 §9): contraste AA calculado, foco visible, foco atrapado en diálogos, nunca solo color, `aria-live` en total/resultados/conexión. Microcopy (05 §10): español de Chile, tuteo, «Cobrar», «código» en vez de SKU en el mostrador, errores que dicen qué hacer, números formateados en las frases. Impresión: cierre de caja y comprobantes en B/N vía `.solo-imprimir`.

---

## 3. Inventario actual de pantallas (28)

Rutas en `src/web/App.tsx`; menú en `src/web/components/BarraLateral.tsx`. «V» sigue la numeración de las specs.

### 3.1 Mostrador (vendedor+)
| V | Ruta | Qué hace | Estado de diseño |
|---|---|---|---|
| V0 | `/entrar` | Login (correo, contraseña, Entrar); primer ingreso obliga cambiar clave (`/cambiar-clave`) | según 05 |
| V1 | diálogo | Apertura de turno (no cerrable; 409 carga el turno existente) | según 05 |
| V2 | `/` | Mostrador: buscador con foco permanente + accesos rápidos por categoría (grilla/lista) + panel de venta; selector de cliente; caja ± (encargado) | según 05 + R-005/R-006/R-025 |
| V3 | diálogo | Cobro por teclado (1–7 medios, Enter, monedero, cliente, offline encola, `RESERVADO_WEB`) | según 05 + E4 |
| V4 | diálogo | Cierre de caja con arqueo (devoluciones, ingresos/retiros), nota si hay diferencia, imprimir | según 05 + E2 |
| V7 lite | `/mis-ventas` | Ventas del turno propio | según 05 |
| V16 | `/clientes/:id` | Ficha de cliente: saldo, compras, movimientos, cuentas vinculadas, Cargar saldo (encargado) | E4, sin pauta 05 |
| V21/V23/V24 | diálogos | Movimiento de stock (ajuste/merma/ingreso/traslado), devolución, movimiento de caja | E2, sin pauta 05 |

### 3.2 Backoffice (encargado+, salvo indicado)
| V | Ruta | Qué hace | Estado de diseño |
|---|---|---|---|
| V5 | `/admin/productos` | Listado paginado, grilla/lista, filtros (texto, tipo, juego, categoría, duplicados, activos), ficha modal con canales, stock por ubicación, kardex, cambio de precio | según 05 + R-009 |
| V6 | `/admin/snacks` | Alta rápida de snack (4 campos, «Guardar y otro») | según 05 |
| V19 | `/admin/stock` | Stock por ubicación/categoría/estado, acciones por fila, «Ingresar y encender», Exportar CSV, enlace Alertas | E2, sin pauta 05 |
| V22 | `/admin/stock/alertas` | Negativos / quiebres / bajos / web, con Recontar, Ajustar, Ingresar | E2 |
| V20 | `/admin/recuentos`, `/:id` | Lista con % cuadrado; detalle con escáner de foco permanente, sistema/contado/diferencia, cierre y descarte | E2 |
| **V25** | `/admin/compras` | Lista de compras (estado, sin vincular, unidades, total) + proveedores plegados | E6 (nuevo hoy) |
| **V26** | `/admin/compras/nueva` | Elegir PDF → propuesta leída → moneda (si USD: tipo de cambio + gastos) → proveedor → documento → líneas con Vincular por fila → totales → Guardar borrador; modo «digitar a mano» | E6 (nuevo hoy) |
| **V27** | `/admin/compras/:id` | Detalle: cabecera editable en borrador, avisos, líneas con «X → Y» de stock, Vincular/Editar/Quitar, Agregar línea, Recibir (confirmación), Anular; en recibida: pendientes con Vincular y «Recibir pendientes» | E6 (nuevo hoy) |
| V7 | `/admin/ventas` | Ventas por fecha/estado, Anular (motivo), Devolver | según 05 + E2 |
| V8 | `/admin/turnos` | Turnos con esperado/declarado/diferencia | según 05 |
| — | `/admin/reportes` | Ventas por usuario por día/semana/mes, CSV | R-026 |
| V18 | `/admin/clientes` | Tabla, filtros (saldo/deuda/crédito/duplicados), candidatos de las tiendas web, crear cliente | E4 |
| V9 | `/admin/duplicados` | Pares lado a lado y fusión | según 05 |
| V11 | `/admin/auditoria` | Auditoría con filtros de entidad y acción | según 05 |
| V14 | `/admin/pedidos` | Pedidos online, fila expandible, mapear línea | E3 |
| V13 | `/admin/discrepancias` | Grupos por tipo, tarjetas, acciones con consecuencia escrita | E3 |
| V12 | `/admin/sync` «Tiendas web» | Tarea del momento + tres bloques por tienda (Catálogo, Pedidos, Publicar), bitácora plegada | R-024 |
| — | `/admin/sistema` (admin) | Migraciones, sembrar, renumerar, usuarios, respaldo | 2.0 §5.5 |

### 3.3 Diálogos compartidos de E6 (dentro de V26/V27)
- **Vincular a un producto:** buscador del maestro (SKU, nombre, código de barras) + «Unidades por bulto» con cálculo en vivo + costo por unidad, precio de venta actual y margen + cambiar precio de venta con sugerencias 30/40/50 % + modo «Crear producto» (nombre, categoría, precio, código de barras) + Quitar vínculo. **Es el diálogo más cargado de la app.**
- **Agregar/Editar línea:** descripción, código, cajas, unidades por caja, sueltas, neto, total, resumen «Entran N unidades a $X».
- **Recibir mercadería / Recibir pendientes:** resumen de unidades y ubicación, banner de inmutabilidad, líneas que quedarán fuera.
- **Nuevo/Editar proveedor:** nombre, RUT, lector.

---

## 4. Cómo se construyen hoy las pantallas de backoffice (patrón de facto)

```
<Encabezado titulo="…" extra={<botón o enlace a la derecha>} />
[aviso: <Banner> en la parte superior, a veces con setTimeout de 4 s]
[filtros: fila de <Selecto>/<Campo> con anchos fijos w-[200px]]
[tabla: <div overflow-x-auto rounded-tarjeta border> <table min-w-[640px]> … acciones por fila como <button px-2 py-1 text-chico> ]
[<Paginacion>]
[acciones finales: <div flex justify-end gap-2> <div w-[160px]><Boton/></div> <div w-[240px]><Boton principal/></div>]
[diálogos: <Dialogo ancho=480..560> con errores como <p text-chico text-peligro> y botones Cancelar / Confirmar a la derecha]
```

Cifras del código (para dimensionar): 71 usos de `Banner`, 22 errores como texto chico rojo dentro de diálogos, 6 `window.confirm` nativos, 7 avisos con `setTimeout`, 10 tablas con scroll horizontal (`min-w` 640–720 px), más de 100 contenedores `w-[Npx]` fijos para botones y filtros, barra lateral con 17 ítems planos.

---

## 5. Hallazgos de la auditoría (ordenados por impacto)

Verificados en el código el 2026-09-10; el dueño los describió como «botones fuera de área, mensajes que no se notan, necesita un orden».

### H1 — Los avisos no se ven (mensajes que no se notan) · alto
- Éxito y error de una acción se muestran como `Banner` **en la parte superior de la página** (`aviso` en V25/V26/V27, V18, V19, V20, V12…), pero la acción se disparó en un botón al pie o dentro de un diálogo que se cierra. En V27, «Recibir» cierra el diálogo y el banner aparece arriba, fuera del viewport si la tabla es larga.
- Los avisos de éxito desaparecen solos a los 4 s en unas pantallas y nunca en otras. No hay un componente de aviso efímero (toast) ni una posición fija.
- Los errores dentro de diálogos son `text-chico text-peligro` bajo el formulario: pequeños, sin icono, fáciles de perder con la vista puesta en el botón.
- Varios `Banner --alerta` encadenados (advertencias del lector en V26: hasta 8 seguidos con la factura de Nico) empujan el contenido útil fuera de la pantalla.

### H2 — Botones fuera de área · alto
- `Boton` ocupa el 100 % de su contenedor, así que cada pantalla lo envuelve en `div` de ancho fijo (`w-[160px]`, `w-[240px]`, `w-[320px]`). En anchos de 640–1023 (tablet, barra plegada) las filas de botones **se salen del contenedor** o se apilan sin orden; en el `Encabezado`, `extra` con dos o tres controles se rompe en varias líneas.
- Las acciones por fila de las tablas (`Vincular · Editar · Quitar`, `Ajustar · Ingresar`, `Recontar`, `Vincular` en clientes) son botones de **~28 px de alto** con `text-chico`: incumplen el mínimo táctil de 44 px (05 §4.4) y quedan a menos de 8 px entre sí.
- Los enlaces con aspecto de botón (`<Link className="… bg-ac-relleno …">` en «Cargar factura») no pasan por `Boton`: distinto alto y sin estado de carga.
- Las tablas de 6–8 columnas con `min-w 640/720` obligan a scroll horizontal en tablet; la columna de acciones queda oculta a la derecha.
- Las acciones finales de una pantalla larga (V26 «Guardar borrador», V27 «Recibir») están al pie del scroll, sin barra fija; en V26 la persona tiene que subir y bajar entre el tipo de cambio (arriba) y el botón (abajo).

### H3 — Falta un orden (arquitectura de información) · alto
- La barra lateral lista **17 ítems planos** en un solo bloque (Mostrador, Mis ventas, Productos, Alta de snack, Stock, Recuentos, Compras, Ventas, Turnos, Reportes, Clientes, Duplicados, Auditoría, Pedidos online, Discrepancias, Tiendas web, Sistema). En 772 px de alto no caben con el pie (tema, conexión, cerrar sesión). No hay grupos ni jerarquía; «Alta de snack» y «Duplicados» pesan lo mismo que «Mostrador».
- Los iconos son caracteres Unicode de pesos distintos (◧ ▤ ⊞ ▥ ☑ ⇩ ◈ ▦ ◫ ⧉ ≣ ⧈ ⚠ ⇄ ⚙): no forman un juego coherente y algunos no se renderizan igual en todos los sistemas.
- El orden de lectura de V26 no sigue el orden de decisión: archivo → banners → **moneda** → proveedor → documento → líneas → totales → guardar. Debería ser un flujo por pasos con el estado de cada paso visible.
- No hay migas ni vuelta consistente: unas pantallas ponen «← Compras» en el `extra` del encabezado, otras nada.

### H4 — Diálogos sobrecargados · medio
- «Vincular a un producto» mezcla cuatro tareas (buscar, fijar unidades por bulto, cambiar precio con margen, crear producto). Necesita pasos o pestañas y una jerarquía clara entre la acción principal («Vincular») y las secundarias.
- «Recibir mercadería» apila un párrafo, un `Banner --alerta` largo y otro con la lista de líneas fuera: la persona no lee y confirma.
- 6 confirmaciones usan `window.confirm` nativo (fusión, quitar línea, desvincular…): rompen el tema y no muestran motivo ni consecuencia.

### H5 — Feedback de tablas y estados · medio
- «sin vincular» es una `Insignia --alerta` en el mismo tono que otras advertencias; no hay una insignia de «recibida» ni de «pendiente» diferenciada.
- Sin esqueletos: `Cargando…` reemplaza todo el contenido (contra 05 §8, «cargando en fondo nunca reemplaza el contenido»). Cambiar un filtro vacía la tabla.
- Tablas sin fila de totales ni resumen arriba (compras: cuántas unidades entran, cuánto cuesta, cuántas líneas sin vincular).

### H6 — Consistencia menor · bajo
- Mezcla de `border border-sep` y `shadow-tarjeta` para tarjetas equivalentes.
- Colores `text-ok` para «Todas las líneas tienen producto» y otros textos: el énfasis por color donde 05 pide énfasis por tamaño/peso.
- Etiquetas de estado en minúscula («borrador», «recibida») frente a insignias capitalizadas en otras pantallas.

---

## 6. Qué se pide a Claude Design (entregable: `05-SDD-diseno-interfaz` v2 en Markdown)

1. **Navegación y orden.** Propuesta de barra lateral **agrupada** (p. ej. Vender · Inventario · Compras · Clientes · Tiendas web · Administración) con jerarquía visual, comportamiento plegado (grupos como iconos con tooltip accesible), y qué pasa en tablet y teléfono. Un juego de iconos coherente (SVG inline, 20 px, trazo 1.5) para reemplazar los caracteres Unicode. Regla de «volver» (migas o botón de retroceso) para pantallas de detalle.
2. **Sistema de feedback.** Dónde y cómo aparecen: (a) resultado de una acción (toast anclado, duración, apilamiento, cómo se anuncia a lectores de pantalla), (b) errores de formulario (inline junto al campo + resumen), (c) advertencias del lector de facturas (agrupadas y plegables, con conteo), (d) confirmaciones destructivas (reemplazo de `window.confirm` por `Dialogo` con consecuencia escrita), (e) estados de carga en fondo (sin vaciar contenido).
3. **Patrón de pantalla de backoffice.** Anatomía única: encabezado con acciones (cuántas caben, cuándo van a un menú «⋯»), zona de filtros responsiva, tabla o lista con acciones por fila **de 44 px** (o acciones en un menú por fila / fila seleccionable con barra de acciones), paginación, y **barra de acciones fija al pie** para pantallas largas con la acción principal y el resumen (total, pendientes).
4. **Patrón de flujo por pasos** para «Cargar factura» (archivo → moneda → proveedor y documento → líneas → confirmar) con el estado de cada paso visible y validaciones por paso; y para «Recibir».
5. **Diálogos.** Tamaños (chico 480, mediano 560, grande 720), jerarquía de botones, errores visibles, y el rediseño de «Vincular a un producto» (buscar / crear como pestañas; unidades por bulto y margen como paso de confirmación).
6. **Tablas responsivas.** Qué columnas se ocultan por ancho, cuándo la tabla pasa a tarjetas (<640), y cómo se expone la columna de acciones sin scroll horizontal.
7. **Insignias y estados** de compra, línea, stock, sincronización: vocabulario cerrado con tono y texto.
8. **Un inventario actualizado** (V0–V27 y diálogos) con la misma forma de las fichas de 05 §7: qué hay en la pantalla, qué hace cada control, estados y microcopy.

**Forma del entregable.** Markdown ejecutable, mismo estilo que `05-SDD-diseno-interfaz-etapa1_1.md` (tablas, listas cortas, criterios de aceptación medibles), con una sección «Cambios respecto de v1.1» y una lista de trabajo por pantalla ordenada por impacto. Sin dependencias nuevas (ni librería de componentes, ni de iconos con runtime); si propone SVG, como archivos o componentes propios. Los tokens de §2.2 no se tocan; se pueden **añadir** tokens (p. ej. `--t-toast`, z-index de capas) documentándolos.

**Criterios de aceptación del rediseño (medibles).**
- Ningún objetivo táctil bajo 44 × 44 en backoffice ni en mostrador; verificable por inspección.
- Toda acción que cambia datos deja un aviso visible dentro del viewport en el momento de completarse, sin scroll.
- En 768 × 1024 (tablet vertical) ninguna pantalla muestra scroll horizontal ni botones cortados.
- La barra lateral cabe completa en 1366 × 768 con el pie visible.
- «Cargar factura» con la factura de Nico (26 líneas, 8 advertencias) se completa sin que las advertencias empujen la tabla fuera de la pantalla.
- Cero `window.confirm`.

---

## 7. Material de apoyo

- Specs: `docs/05-SDD-diseno-interfaz-etapa1_1.md` (base), `docs/11-SDD-etapa6-compras.md` §8 (pantallas nuevas), `docs/03` §8 (inventario), `docs/06` §9 (sync), `docs/07` §8 (clientes).
- Código: `src/web/components/base.tsx`, `src/web/components/BarraLateral.tsx`, `src/web/pantallas/admin/util.tsx`, `src/web/pantallas/admin/Compras.tsx` (la pantalla más nueva y la más cargada), `src/web/index.css`, `tailwind.config.js`.
- PDF reales para probar el flujo de compras: `docs/pdf/` (Andina, Nico pedido y factura, Coqui en USD, Devir).
- Entorno para ver la app: `core-staging.onplaygames.cl` (pedir acceso al dueño).
