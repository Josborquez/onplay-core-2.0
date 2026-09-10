# SDD — Diseño de interfaz v2 · Cristal OnPlay (rediseño UX del backoffice)

| | |
|---|---|
| **Proyecto** | `onplay-core` 2.0 |
| **Versión** | 2.0 · complementa a `05-SDD-diseno-interfaz-etapa1_1.md` (v1.1), que sigue vigente para el mostrador (V0–V4) y para tokens, tipografía, espaciado y accesibilidad |
| **Fecha** | 10 de septiembre de 2026 |
| **Origen** | Brief `docs/12-brief-diseno-ux.md` (R-028) → proyecto de Claude Design «Rediseño UX onplay-core» (`Rediseño UX onplay-core.dc.html`, pantallas 1a–1i) → implementación R-029 |
| **Estado** | **Implementado el 2026-09-10** en `src/web` (barra, componentes compartidos, Stock, Compras, Clientes y reemplazo de `window.confirm` en toda la app). Las pantallas no listadas en §7 siguen con el patrón viejo y se migran una a una |

Este documento describe **lo que se construyó** a partir del diseño. Cada sección nombra la pantalla del canvas (1a…1i), el hallazgo del brief que resuelve (H1–H6) y el archivo que lo implementa.

---

## 1. Qué cambia respecto de v1.1

| Tema | v1.1 | v2 |
|---|---|---|
| Navegación | 17 ítems planos con caracteres Unicode | 2 accesos + 6 grupos plegables (uno abierto), iconos SVG propios, flyout al estar plegada, barra inferior de 4 pestañas con «Más» en teléfono (1a, H3) |
| Feedback | `Banner` arriba de la página; errores chicos en diálogos; 6 `window.confirm` | Toasts anclados al pie de `<main>`, error inline con icono + resumen en el pie del diálogo, confirmación destructiva en diálogo propio, carga en fondo sin vaciar (1g, H1/H4) |
| Botones | `Boton` al 100 % del contenedor, envuelto en anchos fijos | `Boton ajustado` mide su texto; `soloIcono` de 44 × 44; encabezado con 1 principal + 1 secundario + «⋯» (1b, H2) |
| Tablas | `<table>` con `min-width` y scroll horizontal, acciones por fila de ~28 px | `Tabla` en rejilla CSS: filas de 56 px, menú «⋯» de 44 px, columnas con prioridad, tarjetas bajo 640 px, resumen y paginación dentro de la tarjeta (1b/1h, H2/H5) |
| Pantallas largas | Acción principal al final del scroll | `PieAcciones` fija al pie con resumen en cifras y la acción principal (1d/1e, H2) |
| Flujos | Una sola página larga | `Pasos` (stepper) para cargar factura: Archivo → Moneda → Proveedor → Líneas → Confirmar (1d, H3) |
| Diálogos | Un solo tamaño, todo en uno | Chico 480 · mediano 560 · grande 720; `sobreTitulo`/`subtitulo`; «Vincular a un producto» en dos pasos con pestañas Buscar / Crear (1f, H4) |
| Estados | Insignias en minúscula y tonos mezclados | Vocabulario cerrado por entidad, capitalizado (§6) |

Los tokens de color, la tipografía fluida, la rejilla de 8 px, los objetivos táctiles y las reglas de accesibilidad de v1.1 **no cambian**. Tokens nuevos: `--velo` (velo de los diálogos: claro `rgba(26,18,32,.3)`, oscuro `rgba(0,0,0,.5)`) y `--z-toast: 50`; Tailwind expone `bg-velo`, `bg-barra-solida`, `z-toast` y `opacity-55`.

---

## 2. Navegación (1a) — `src/web/components/BarraLateral.tsx`, `App.tsx`, `pantalla.ts`

**Estructura.** Accesos: Mostrador, Mis ventas. Grupos: **Inventario** (Productos, Alta de snack, Stock, Recuentos, Duplicados) · **Compras** (enlace directo) · **Ventas** (Ventas, Turnos, Reportes) · **Clientes** (enlace directo) · **Tiendas web** (Sincronización, Pedidos online, Discrepancias) · **Administración** (Auditoría, Sistema solo admin). Un vendedor ve solo los accesos.

**Comportamiento.**
- Un solo grupo abierto a la vez; se abre solo el de la ruta actual y la persona puede abrir otro (acordeón). Hijos con sangría de 44 px y el punto rosa de 5 px como única marca de sección activa (v1.1 §4.1.1).
- **Plegada (72 px, y siempre entre 640 y 1023 px):** cada grupo es un icono; clic abre un desplegable `role=menu` de 212 px junto al icono, con el nombre del grupo como rótulo; cierra con Escape, clic fuera o al navegar. El botón de plegar desaparece en tablet (`bloqueada`).
- **Teléfono (< 640 px):** `BarraInferior` con Mostrador · Ventas (Mis ventas para vendedor) · Clientes (encargado) · **Más**, que abre una hoja inferior con la misma lista agrupada, los indicadores, el tema y Salir.
- Pie: indicador de conexión (solo el punto al estar plegada), estado de cada tienda web, tema («Modo oscuro»/«Modo claro») y «Salir · nombre».
- Iconos: `components/iconos.tsx`, SVG inline de 20 px, trazo 1.5, `currentColor`; 26 nombres cerrados (`NombreIcono`). No se agregan librerías.

---

## 3. Sistema de feedback (1g)

### 3.1 Toasts — `components/Toast.tsx`
`ProveedorAvisos` envuelve la app; `ListaAvisos` se monta en el contenedor relativo de `<main>` (escritorio y teléfono). `useAvisos().avisar({ tono, titulo, detalle?, accion?, duracion? })`.

| Tono | `role` | Cierre | Uso |
|---|---|---|---|
| `ok` | `status` | solo a los 5 s; pausa al pasar el mouse | resultado de una acción («Compra recibida. 384 unidades entraron a Bodega.») |
| `error` | `alert` | solo con la ✕ | fallo de una acción («No se guardó el ajuste. Se cortó la conexión; nada cambió en el stock.») con `Reintentar` |
| `progreso` | `status` | quien lo abrió lo actualiza o cierra | tareas largas |

Anatomía: icono de 24 px (check en `--ok`, «!» en `--peligro`, giro en `--ac`), título en 600 + detalle, acción opcional (36 px), ✕. Centrado al pie, 24 px sobre el borde, ancho `min(560px, 100% − 32px)`. Máximo 3 apilados; el cuarto reemplaza al más viejo.

### 3.2 Errores de formulario — `base.tsx`
- `Campo error=` muestra el texto bajo el campo con icono `info` y `role=alert`; el borde pasa a `--peligro`.
- `ErrorForm` y `PieDialogo`: el pie de todo diálogo lleva a la izquierda el error o resumen («1 campo por corregir») y a la derecha los botones, sobre un filete.

### 3.3 Confirmación destructiva — `components/Confirmar.tsx`
`useConfirmar()({ titulo, cuerpo, accion, tono?, cancelar? }) → Promise<boolean>`. Diálogo chico `role=alertdialog`: título en pregunta («¿Quitar la línea 7?»), consecuencia con números, botón `peligro` (o `principal`) con verbo, nunca «Aceptar». Reemplazó los 6 `window.confirm` (fusión de duplicados, activar/desactivar usuario, renumerar SKU, desvincular cuenta, vaciar carrito, quitar línea).

### 3.4 Carga en fondo — `components/Tabla.tsx`
Con `cargando`, la tabla conserva las filas anteriores al 55 % con una línea de progreso de 2 px arriba (`.barra-progreso`, `@keyframes barrido`, sin animación bajo `prefers-reduced-motion`) y `aria-busy`. `Cargando…` solo en la primera carga de una pantalla.

---

## 4. Anatomía de una pantalla de backoffice (1b) — `pantallas/admin/util.tsx`

```
<Encabezado migas? titulo insignia? subtitulo acciones={<Boton ajustado/> <Boton ajustado variante="principal"/> <MenuAcciones variante="cabecera"/>} />
<Filtros> <Filtro ancho="1 1 220px"><CampoBuscar/></Filtro> <Filtro><Selecto/></Filtro> <Segmentado fijo opciones={[…conteo]}/> </Filtros>
<Tabla columnas filas clave menu resumen pie cargando vacio />
<SeccionPlegable titulo resumen accion>…</SeccionPlegable>   ← segunda sección (proveedores, candidatos)
```

- **Encabezado:** migas «‹ Compras / F-00482» para pantallas de detalle; título de 22 px con insignia al lado; subtítulo de 13 px con el resumen («Inventario · 184 productos controlados», «Septiembre 2026 · 17 compras · $2.418.300 recibidos»). A la derecha, como máximo una acción principal, una secundaria y el menú «⋯» (`MenuAcciones variante="cabecera"`).
- **Filtros:** fluidos (`flex: 0 1 200px; min-width: 160px`), nunca `w-[px]`. `Segmentado` con `conteo` por pestaña y `fijo` (no se desmarca).
- **Botones:** `Boton ajustado` (mide su texto, 44 px de alto, principal 50 px con `tamano="grande"`), `icono` opcional, `soloIcono` para 44 × 44. El `Boton` sin `ajustado` conserva el comportamiento v1.1 para las pantallas no migradas.
- **Menú «⋯»:** `MenuAcciones` con ítems de 44 px, `tono="peligro"`, `separadorAntes`, `deshabilitado` + `motivo` (I6). Cierra con Escape, clic fuera o al elegir; flechas para moverse.

---

## 5. Tabla (1b/1h) — `components/Tabla.tsx`

- Rejilla CSS por columna (`ancho` como pista: `minmax(0,1fr)`, `96px`…), cabecera de 36 px en `--t-chico`, filas de **56 px** con filete `--sep`, celda de dos líneas `CeldaDoble` (principal + secundaria en mono).
- Columna de acciones = `MenuAcciones` de 44 × 44 siempre a la vista; nunca hileras de botones chicos.
- **Prioridad de columnas:** 1 siempre · 2 se oculta bajo 1024 px · 3 se oculta bajo 900 px. **Nunca scroll horizontal.**
- **Bajo 640 px** cada fila es una tarjeta con tres zonas: título (`enTarjeta: 'titulo'`), cifras con rótulo (`'cifra'`) y «⋯». Lo marcado `'oculto'` no se muestra.
- `resumen` (aria-live) y `resumenDerecha` arriba; `pie` (paginación «Anterior · Página 1 de 2 · 21 productos · Siguiente») abajo, dentro de la misma tarjeta. `atenuada(fila)` para anuladas (70 %, total tachado).

---

## 6. Vocabulario de estados

| Entidad | Insignia | Tono |
|---|---|---|
| Compra | Borrador · Recibida · Con pendientes · Anulada | neutro · ok · alerta · peligro |
| Línea de compra | Sin vincular · recibida (texto chico) | alerta · — |
| Stock | Negativo · Sin stock · Bajo mínimo · OK · Sin control | peligro · peligro · alerta · ok · neutro |
| Cliente | Inactivo | peligro |

Capitalizadas, con `Insignia` (borde + texto, nunca relleno). El saldo y la deuda de un cliente se distinguen por **tamaño y peso**, no por color (1i).

---

## 7. Pantallas implementadas con v2

| Canvas | Pantalla | Archivo | Qué tiene |
|---|---|---|---|
| 1b | V19 Stock | `pantallas/admin/Stock.tsx` | Encabezado con Alertas (conteo), Nuevo recuento y «⋯» (CSV, recuentos); filtros fluidos; pestañas Todos / Negativo / Sin stock / Bajo mínimo / OK / Sin control con conteos de `/stock/alertas`; tabla Producto · Cantidad · Mínimo · Estado con menú Ajustar / Merma / Ingresar / Trasladar / Ver kardex; toast al guardar |
| 1c | V25 Compras | `pantallas/admin/Compras.tsx` | Subtítulo con el mes (`GET /compras` devuelve `conteos` y `mes`); pestañas Todas / Borradores / **Con pendientes** (`?pendientes=true`) / Recibidas / Anuladas; buscador por documento o proveedor (`?q=`); tabla con estado y menú Abrir / Recibir… / Vincular pendientes; **Proveedores** como sección plegable con su tabla |
| 1d | V26 Cargar factura | ídem, `CompraNueva` | `Pasos` Archivo → Moneda → Proveedor → Líneas → Confirmar; `?modo=manual` entra en el paso 3 «Digitar a mano»; advertencias del lector agrupadas («8 advertencias · Ver las 8»); `PieAcciones` con Líneas · Entran · Total y «Siguiente · …» / «Guardar borrador» |
| 1e | V27 Detalle de compra | ídem, `CompraDetalle` | Migas, título con insignia, acciones Agregar línea · Recibir · «⋯»; tarjetas Proveedor · Documento · Entran · Total; tabla con Cant. · Costo/u (margen) · **Stock X → Y** · Origen en la factura; pie fijo «22 líneas listas · 4 sin vincular quedarán pendientes» + «Recibir 22 líneas»; diálogo Recibir (560) con dos cifras grandes, aviso de inmutabilidad y detalle plegado de pendientes; anular con motivo en `alertdialog` |
| 1f | Vincular a un producto | ídem, `DialogoVincular` | Grande (720). Paso 1: pestañas **Buscar en el maestro** / **Crear producto** (nombre, categoría, código); listbox de resultados con check. Paso 2: unidades por bulto con cálculo «3 × 24 = 72 u · $3.979/u», tarjeta «Precio de venta actual · margen 20 %», tarjeta «Cambiar/Fijar precio» con chips 30/40/50 %; acción «Vincular · 72 u a $5.990» o «Crear y vincular» |
| 1g | Feedback | `Toast.tsx`, `Confirmar.tsx`, `base.tsx`, `Tabla.tsx` | §3 |
| 1h | Tabla → tarjetas | `Tabla.tsx` | §5 |
| 1i | V18 Clientes | `pantallas/admin/Clientes.tsx` | Subtítulo «N clientes · $X en monederos · $Y en deuda»; pestañas con conteo de duplicados; tabla Cliente · Contacto · Saldo (16 px, 600) · Última compra con menú Ver ficha / Cargar saldo; «Candidatos de las tiendas web» como sección plegable con tabla y Vincular de 44 px; toasts al vincular |

**Pendientes de migrar al patrón** (siguen funcionando con los componentes v1.1): Productos, Alta de snack, Alertas, Recuentos, Ventas, Turnos, Reportes, Duplicados, Auditoría, Pedidos online, Discrepancias, Tiendas web, Sistema, ficha de cliente. Regla para migrarlas: mismo orden que §4, `Tabla` en vez de `<table>`, toasts en vez de `Banner` de resultado, `Boton ajustado` en acciones.

---

## 8. Criterios de aceptación (del brief §6) y estado

| Criterio | Estado |
|---|---|
| Ningún objetivo táctil bajo 44 × 44 en las pantallas migradas | ✅ menú «⋯», botones, chips de 36 px solo dentro de diálogos con 8 px de separación |
| Toda acción que cambia datos deja un aviso visible dentro del viewport | ✅ toasts anclados a `<main>` en Stock, Compras, Clientes; errores en `role=alert` |
| En 768 × 1024 ninguna pantalla migrada muestra scroll horizontal ni botones cortados | ✅ por diseño de `Tabla` (prioridades) y `Filtro` fluido; **pendiente de verificar en dispositivo** |
| La barra lateral cabe completa en 1366 × 768 con el pie visible | ✅ acordeón: con un grupo abierto son 2 + 6 + hasta 5 hijos = 13 filas de 40 px + pie |
| Cargar factura con la de Nico (26 líneas, 8 advertencias) sin que las advertencias empujen la tabla | ✅ advertencias agrupadas con conteo, 2 visibles |
| Cero `window.confirm` | ✅ |
