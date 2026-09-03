# 08 — Bitácora de revisión visual y novedades

**Propósito.** Registro vivo de lo que aparece al revisar el sistema con datos reales: defectos, datos raros del origen, mejoras chicas y decisiones tomadas sobre la marcha. Es el complemento operativo de las specs (01, 02, 05, 06, 07): las specs dicen qué se construye; este documento dice qué se encontró al usarlo y qué se hizo.

**Reglas de este documento.**

- Cada hallazgo recibe un número `R-NNN` y no se reutiliza.
- Se anota la fecha, dónde se vio (pantalla, endpoint, canal), qué se decidió y en qué archivo quedó el cambio.
- Lo que amplía alcance (P1) se registra aquí como **Agendado** con la etapa a la que pertenece; no se construye hasta esa etapa.
- Los estados posibles son: `Abierto`, `Corregido`, `Agendado (E#)`, `Descartado` (con motivo).
- Los cambios al importador se aplican a los productos ya cargados con una corrida completa (`POST /sync/:canalId?dryRun=false`); el sync incremental solo alcanza lo modificado en Woo desde la última marca.

---

## Resumen

| Nº | Fecha | Área | Título | Estado |
|---|---|---|---|---|
| R-001 | 2026-09-02 | Importador | Variaciones con el nombre del padre repetido | Corregido |
| R-002 | 2026-09-02 | Importador / Mostrador | El SKU de las variaciones es un EAN y no llegaba a `codigoBarras` | Corregido |
| R-003 | 2026-09-02 | Importador | Las variaciones no recordaban a su producto padre | Corregido |
| R-004 | 2026-09-02 | Datos del origen | Variación sin SKU en Woo (Katana Blue, id 2898) | Abierto (dato del canal) |
| R-005 | 2026-09-02 | Mostrador (V2) | Accesos rápidos con pestañas fijas en vez de las categorías reales | Corregido (ajusta 05-SDD) |
| R-006 | 2026-09-02 | Mostrador (V2) | Accesos rápidos: vista de lista con miniatura además de la grilla | Corregido (amplía 05-SDD §5.2) |
| R-007 | 2026-09-02 | Mostrador (V2) | Panel de venta sin botón Eliminar en la línea | Corregido |
| R-008 | 2026-09-02 | Backoffice (V18) | Sin forma de crear un cliente desde `/admin/clientes` | Corregido (amplía 07-SDD V18) |
| R-009 | 2026-09-02 | Backoffice (V5) | Productos: paginación por página, grilla/lista, columna Stock y modal de ficha | Corregido (resuelve 05-SDD §14 H5; cantidad de stock agendada E2) |
| R-010 | 2026-09-02 | Datos / Importador | 236 cartas Magic de onplay.cl con SKU maestro `IND-` | Corregido (2026-09-03: patrón MTG ampliado + 235 renumeradas y auditadas; queda 1) |
| R-011 | 2026-09-02 | Riesgo de negocio | Sobreventa entre web y mostrador con poco stock (ha ocurrido en la vida real) | Agendado (E2/E3) — regla de prioridad decidida y escrita en 03 §6.9 y 06 §8.4 |
| R-012 | 2026-09-02 | Backoffice (V5) | Tipo = Sellado + Categoría = Magic no muestra nada | Corregido (filtro Juego + categoría por subárbol) |
| R-013 | 2026-09-02 | Etapa 2 | Cierre de E2: código completo, queda el recuento real (criterio 18) | Abierto (del dueño) |
| R-014 | 2026-09-02 | Mostrador / Stock | El stock no puede quedar en −1 ni la venta aceptar más de lo disponible; icono de Clientes | Corregido (cambia D-E2-1 y M2 de 03-SDD) |
| R-015 | 2026-09-03 | Importador / Sync | Cada corrida completa repetía en `SyncLog` los mismos errores conocidos | Corregido |
| R-016 | 2026-09-03 | Etapa 3 / Stock | Un pedido web pagado puede dejar el libro en negativo (choca con R-014) | Decidido por defecto — **pendiente de ratificar por el dueño** |
| R-017 | 2026-09-03 | Etapa 3 | Arranque de E3: Fase 0 con defaults, Fases 1–2 hechas; ajustes menores a la spec 06 | Corregido (amplía 06-SDD §5.2, §8.1, §8.2) |

---

## Detalle

### R-001 · Variaciones con el nombre del padre repetido

- **Fecha:** 2026-09-02. **Estado:** Corregido.
- **Dónde se vio:** buscador del mostrador (V2) con «katana». Producto de referencia: <https://onplaygames.cl/producto/katana-sleeves-standard-size-100/> (id 2897, variable, 19 variaciones por color).
- **Qué pasaba:** en Woo el atributo de variación se llama igual que el producto y cada opción repite el nombre completo («Katana Sleeves Standard Size (100) - Red»). El importador armaba `padre — opción`, y quedaba «Katana Sleeves Standard Size (100) — Katana Sleeves Standard Size (100) - Red» (105–110 caracteres). En el buscador las 19 filas empezaban idénticas y el color quedaba al final. Afectaba a 242 productos de 35 padres variables.
- **Decisión:** el nombre de una variación no repite el padre. Regla en `nombreDeVariacion` (`apps/api/src/sync/variaciones.ts`):
  - la opción repite el padre como prefijo → `padre — resto` («… (100) — Red»);
  - la opción es un nombre completo por sí sola → se usa la opción sola. Cuenta como completa si contiene el padre entero, o si tiene 4+ palabras y comparte la mitad o más de las palabras del padre (caso Cortex: padre «Protectores Ultimate Guard: Cortex Sleeves Matte Standard Size (100pzs)», opción «Cortex Sleeves Matte Standard Size (100) - Transparent»);
  - cualquier otra → `padre — opción`, como antes. Varias opciones siguen uniéndose con ` / `.
  - La comparación ignora mayúsculas, espacios dobles, guiones tipográficos y comillas («» vs ""): el origen los mezcla (caso «Guild Summit»).
- **Resultado en datos:** dos corridas completas de onplaygames_cl el 2026-09-02 (469 y 98 actualizados); ningún nombre con ` — ` supera los 85 caracteres.
- **Alcance:** cambia solo el `nombre`. No toca SKU maestro, tipo, categoría ni `externoSku` (P3). Como el nombre entra al hash de sync, la siguiente corrida completa actualiza los 242.
- **Tests:** `apps/api/src/sync/variaciones.test.ts`.

### R-002 · El SKU de las variaciones es un EAN y no llegaba a `codigoBarras`

- **Fecha:** 2026-09-02. **Estado:** Corregido.
- **Dónde se vio:** escáner en el mostrador. `GET /productos/buscar?q=4260250073780` (EAN del Katana Red) devolvía 0 resultados.
- **Qué pasaba:** el importador solo llenaba `codigoBarras` desde `meta_data` (claves `barcode`, `ean`, `gtin`…), y onplaygames.cl no las usa. Pero en ese canal el SKU de la variación **es** el EAN-13 del fabricante (Ultimate Guard, etc.). Había 337 filas de `ProductoCanal` en onplaygames_cl con SKU externo numérico de 12–14 dígitos y `codigoBarras` nulo. Ninguna se podía escanear.
- **Decisión:** si el SKU externo tiene forma de código de barras (EAN-8, UPC-A, EAN-13, GTIN-14: solo dígitos, largo 8 o 12–14) y no vino uno por `meta_data`, se copia a `codigoBarras`. Regla `codigoBarrasDesdeSku` en `variaciones.ts`; aplica a variaciones y a productos simples.
- **Resultado en datos:** 338 productos con `codigoBarras` tras la corrida (antes: 1). `GET /productos/buscar?q=4260250073780` devuelve ACC-000079 «Katana Sleeves Standard Size (100) — Red».
- **Regla de actualización (§6.5):** en productos ya importados el importador **completa** `codigoBarras` solo si está vacío. Un código cargado a mano nunca se pisa (`completarFaltantes` en `importador.ts`).
- **Tests:** `variaciones.test.ts` (acepta 8/12/13/14 dígitos, rechaza `OP11-001-NM-EN`, `2897-V2898`, 9 dígitos).

### R-003 · Las variaciones no recordaban a su producto padre

- **Fecha:** 2026-09-02. **Estado:** Corregido (dato guardado; sin uso en UI todavía).
- **Qué pasaba:** cada color de un producto variable queda como producto independiente (§6.2 regla 3, correcto para E1), pero nada vinculaba a los 19 Katana entre sí. E2 (stock por variante) y E3 (escribir a Woo, donde la variación cuelga del padre: `products/{padre}/variations/{id}`) necesitan ese vínculo.
- **Decisión:** guardar en `Producto.atributos` (JSON) dos claves: `padreExternoId` (id del producto padre en el canal, como texto) y `variante` (texto limpio de la opción, ej. «Red»). No se agrega columna ni tabla (SDD §6.2: nada antes de la etapa que lo necesita); cuando E3 lo requiera, migrar desde el JSON es trivial.
- **Regla de actualización:** en productos ya importados solo se agregan las claves si faltan; el resto de `atributos` no se toca.
- **Resultado en datos:** 241 productos con `padreExternoId` (las 242 variaciones menos la que falla por SKU duplicado en el origen).
- **Agendado (E3):** usar `padreExternoId` para agrupar variantes en la UI y para el push de stock/precio por variación.

### R-004 · Variación sin SKU en Woo (Katana Blue, id 2898)

- **Fecha:** 2026-09-02. **Estado:** Abierto (corrección de datos en el canal, no de código).
- **Qué pasa:** de las 19 variaciones del Katana (id 2897), solo «Blue» (id 2898) no tiene SKU en Woo. El importador le sintetiza `externoSku = 2897-V2898` (regla existente) y por lo tanto no tiene EAN escaneable.
- **Acción sugerida:** cargar el EAN en el SKU de esa variación en onplaygames.cl; el próximo sync incremental lo recoge y R-002 lo convierte en `codigoBarras`. (P2: se corrige en el canal, `onplay-core` solo lee.)

### R-005 · Accesos rápidos con pestañas fijas en vez de las categorías reales

- **Fecha:** 2026-09-02. **Estado:** Corregido. **Ajusta 05-SDD §V2 «Accesos rápidos»** (que fijaba `Snacks`, `Sellado`, `Cartas`).
- **Dónde se vio:** Mostrador (V2), control segmentado sobre la grilla táctil.
- **Qué pasaba:** las tres pestañas estaban escritas en el código. El catálogo real tiene además **Accesorios** (263 productos activos) y **Juegos de Mesa** (50) que no se podían alcanzar sin escribir en el buscador, y las subcategorías de Snacks (Bebidas, Aguas, Confitería, Energéticas) no se veían. Además el árbol de categorías no se guardaba localmente: sin conexión al abrir, no había pestañas (P8).
- **Decisión:** las pestañas son las **categorías raíz reales que tienen productos en el caché local** (las vacías, como Eventos o Sin clasificar, no aparecen). Dentro de una raíz, las subcategorías con productos aparecen como filtros con su conteo («Bebidas · 1»). Se conserva la regla original de «Cartas», ahora generalizada: si la selección supera 60 productos y tiene subcategorías, hay que elegir una primero; si una hoja supera 60, se muestran 60 en orden alfabético con el aviso «Se muestran 60 de N…». El árbol de categorías se persiste en IndexedDB (`meta.categorias`) como respaldo offline.
- **Archivos:** `apps/web/src/components/AccesoRapido.tsx`, `apps/web/src/catalogo.ts` (`contarProductos`, `categorias()` con respaldo local).
- **Agendado (E2):** cuando exista stock, ocultar de la grilla los productos con stock 0 en la ubicación del mostrador.

### R-006 · Accesos rápidos: vista de lista con miniatura además de la grilla

- **Fecha:** 2026-09-02. **Estado:** Corregido. Pedido del dueño durante la revisión visual.
- **Qué pasaba:** los productos de los accesos rápidos solo se veían como tarjetas (grilla), sin imagen. Para protectores, carpetas y sellado el color o la portada se reconoce mejor por la foto que por el nombre.
- **Decisión:** conmutador **Grilla / Lista** junto a las pestañas. La grilla queda igual (tarjeta con precio y «+»). La lista muestra miniatura de 40 px, nombre, SKU, precio y «+»; si no hay imagen o no carga (sin conexión), aparece un marcador neutro. La preferencia se recuerda en `localStorage` (`onplay.accesos-vista`, solo interfaz, S3).
- **Cambio de contrato acotado:** `GET /productos/catalogo-offline` agrega `imagenUrl` a los campos de `02-SDD §5.2`. Es solo la URL (la imagen se descarga bajo demanda con `loading="lazy"`), así que el payload crece poco y el caché sigue siendo utilizable sin conexión. Para que las filas ya cacheadas reciban el campo, el caché lleva un número de esquema (`meta.esquema`, hoy 2): si no coincide, la próxima actualización baja el catálogo completo una sola vez y luego vuelve al delta `?desde`.
- **Archivos:** `apps/api/src/rutas/productos.ts` (select del offline), `apps/web/src/catalogo.ts` (`imagenUrl` opcional en `ProductoCache`, `ESQUEMA_CATALOGO`), `apps/web/src/components/AccesoRapido.tsx` (`ConmutadorVista`, `FilaProducto`, `Miniatura`).
- **Agendado (E3):** las imágenes vienen de los sitios Woo; si algún día se sirven desde `onplay-core`, cambiar solo la URL en el importador.

### R-007 · Panel de venta sin botón Eliminar en la línea

- **Fecha:** 2026-09-02. **Estado:** Corregido. Pedido del dueño durante la revisión visual.
- **Qué pasaba:** la única forma de sacar una línea del carrito era bajar la cantidad con «−» hasta cero. Con 3 o 4 unidades son varios toques y no es evidente que «−» en 1 elimina.
- **Decisión:** botón **Eliminar** (ícono papelera) al final de cada línea, junto al precio unitario. Con cantidad 1 quita de inmediato. Con cantidad mayor pide un segundo toque en línea («¿Quitar 3?» en rojo, se desarma solo a los 5 s), que es la «confirmación solo si la cantidad era mayor que 1» de 05-SDD §7.1 sin diálogo modal. El «−» conserva su comportamiento.
- **Archivos:** `apps/web/src/components/PanelVenta.tsx` (`LineaVenta`); usa el `onEliminar` que ya existía en `Mostrador.tsx`.

### R-008 · Sin forma de crear un cliente desde `/admin/clientes`

- **Fecha:** 2026-09-02. **Estado:** Corregido. Surgió de la pregunta del dueño «¿cómo agregar un cliente para los créditos de tienda?».
- **Qué pasaba:** 07-SDD define el alta de cliente solo en el mostrador (C1, dos campos dentro del cobro) y V18 como tabla de consulta. Un encargado que quería registrar a alguien y darle saldo sin una venta de por medio no tenía botón: debía abrir el cobro del mostrador con un carrito vacío.
- **Decisión:** botón **Nuevo cliente** en el encabezado de V18 que abre un diálogo con nombre (obligatorio), RUT, teléfono y correo (opcionales). Usa el mismo `POST /clientes` del mostrador (validación de RUT, duplicados §6.6: alta → 409, media/baja → crea). Al crear navega a la ficha, que es donde vive «Cargar saldo». El diálogo recuerda el circuito del saldo: con dinero se cobra en el mostrador como venta de `SRV-000001` (§6.3, entra al arqueo); premios y ajustes van por V17 desde la ficha.
- **Fuera de alcance:** el «crédito» (`permiteCredito`/`limiteCredito`, C8) sigue en la Fase 5 BLOQUEADA; la ficha solo lo muestra.
- **Archivos:** `apps/web/src/pantallas/admin/Clientes.tsx` (`DialogoNuevoCliente`).

### R-009 · Productos del backoffice: paginación, grilla/lista, Stock y modal de ficha

- **Fecha:** 2026-09-02. **Estado:** Corregido. Pedido del dueño: «falta paginación, Stock, Listado y Grilla, al hacer clic modal con el detalle, imagen, cantidad».
- **Qué pasaba:** V5 cargaba 50 productos y ofrecía «Cargar 50 más» (cursor, sin total por §14 H5); el detalle era una fila expandible con solo los canales; no había imagen ni vista de grilla; el stock no se mencionaba.
- **Decisión:**
  - **Paginación por página** con «Anterior / Siguiente», «Página X de Y» y «Mostrando 1–50 de 3.352». La API `GET /productos` acepta `pagina` (misma convención que `GET /ventas`) y devuelve `total` en ambos modos; el cursor sigue disponible. Esto **resuelve H5** de 05-SDD §14: un `COUNT` sobre ~3.000 filas es barato. Sigue sin cargarse el catálogo completo.
  - **Grilla / Lista** con el mismo conmutador del mostrador (ahora en `components/base.tsx`). La lista lleva miniatura, nombre, SKU/nº de carta/código de barras, tipo, stock y precio; la grilla, imagen cuadrada, nombre, SKU y precio. Preferencia en `localStorage` (`onplay.productos-vista`).
  - **Clic → modal de ficha**: imagen grande, precio con botón «Cambiar» (misma confirmación auditada), tipo, juego, categoría, stock, código de barras, nº de carta, todos los `atributos` con etiqueta en castellano (variante, padre en el canal, set, rareza…), estado, fecha de actualización y canales (SKU externo, id, precio del canal, publicado/despublicado, último sync).
  - **Stock:** columna y dato en la ficha que muestran «No controla» o «Controla · cant. E2». **La cantidad no existe todavía** (P4; `ubicacion`/`movimiento_stock` se crean en E2 por SDD §6.2). **Agendado (E2):** cantidad por ubicación en la columna y en la ficha.
- **Archivos:** `apps/api/src/rutas/productos.ts` (`pagina`, `total`), `apps/web/src/pantallas/admin/Productos.tsx` (reescrita), `apps/web/src/components/base.tsx` (`ConmutadorVista`, `Vista`), `apps/web/src/components/AccesoRapido.tsx` (usa el compartido).

### R-010 · 236 cartas Magic de onplay.cl con SKU maestro `IND-`

- **Fecha:** 2026-09-02. **Estado:** Abierto (visto al revisar R-009; no se tocó).
- **Qué se ve:** en la grilla de productos aparecen cartas Magic (ej. «Angel's Trumpet» `IND-000016`, «Angelic Gift» `IND-000066`) con prefijo `IND-` = tipo `indeterminado`, mientras el resto lleva `MTG-SET-NNN-NM-EN`. Son 236, todas activas, todas en la categoría Magic y todas del canal onplay_cl.
- **Hipótesis:** el SKU externo de esas cartas no calza con la forma `MTG-…` de 02-SDD §6.4, así que `skuMaestroDesdeExterno` devuelve null y el importador reserva un correlativo con el tipo del mapeo, que para ellas salió `indeterminado` en vez de `single`. Hay que mirar el `externoSku` real de algunas (`ProductoCanal`) y el mapeo de onplay.cl.
- **Diagnóstico (2026-09-03):** el tipo era correcto (`single`); lo que fallaba era `skuMaestroDesdeExterno`: el patrón Magic exigía un número de coleccionista solo numérico, y esas 236 cartas traen sufijo (promos «240p», showcase «116s», variantes «2013a», «259★») o son de The List (`PLST-{SET}-{NUM}`). Al no reconocerlas, el importador reservaba un correlativo y `PREFIJO_POR_TIPO.single` es `IND` por diseño (§6.4).
- **Corrección:** patrón ampliado en `packages/dominio/src/sku.ts` (sufijo opcional de un carácter y prefijo `PLST-`) con tests; script `npm run renumerar-ind -- [--aplicar] [--admin <email>]` (`apps/api/scripts/renumerar-ind.ts`): simula por defecto, aplica en una transacción y deja Auditoria `editar` por producto con el SKU anterior. Aplicado en dev: **235 renumeradas** a `MTG-…` (55 de The List como `MTG-PLST-SET-NNN-…`), 0 colisiones, **queda 1** sin forma reconocible: `IND-000048` «Nykthos, Shrine to Nyx» con SKU externo `PPRO-2022-3-NM-EN` (promo Pro Tour con año y número, formato único; no vale la pena una regla).
- **Decisión sobre P3:** el SKU maestro es interno y nunca se publicó (`02` §6.4); ninguna venta lo referencia por texto (0 líneas). Renumerarlo no toca ningún canal. En producción hay que correr el script una vez tras la importación inicial (o importar ya con el patrón nuevo).

### R-011 · Sobreventa entre web y mostrador con poco stock

- **Fecha:** 2026-09-02. **Estado:** Agendado (E2/E3). El dueño confirma que **ha ocurrido en la vida real**; las specs 01/02 no lo tratan como riesgo explícito.
- **Escenario:** queda 1 unidad. Un cliente la compra en onplaygames.cl y, al mismo tiempo, otro la compra en el mostrador. Hoy las dos ventas se concretan.
- **Qué hace el sistema hoy (E1+E4):**
  - El mostrador vende sin mirar stock (`controlaStock=false`, P4): no consulta a Woo ni tiene cantidad propia.
  - Woo descuenta su stock solo por el pedido web. La venta física es invisible para Woo: `onplay-core` solo lee (P2, `SYNC_SOLO_LECTURA`).
  - No hay alerta ni bloqueo en ningún punto. El conflicto aparece al preparar el pedido web y no encontrar el producto.
  - En el carrito web Woo tampoco reserva: la reserva ocurre al crear el pedido (retención de stock de pedidos pendientes, 60 min por defecto en Woo).
- **Qué resuelve el roadmap:**
  - **E2 (inventario):** cantidad propia por ubicación como libro de movimientos; la venta del mostrador descuenta; los pedidos web ingresan como movimientos de salida. Aparece la base para avisar «queda 1» en el cobro.
  - **E3 (sync bidireccional, subetapa stock):** después de cada venta física se publica el stock a Woo con la verificación S2 (leer el stock del canal, comparar con `stockPublicado`, no pisar si difiere → panel de discrepancias). El pedido web se ingiere y descuenta del libro. La ventana de choque baja a segundos, pero no a cero: dos sistemas no se pueden bloquear entre sí.
- **Qué hicieron las versiones previas (leídas el 2026-09-02, repos `OnplayPOS` y `onplay-erp`):**
  - **OnplayPOS** (en producción hasta 2026-03): inventario propio, pero tras cada venta empujaba `stock_quantity` **absoluto** a Woo, fire-and-forget, **sin leer el remoto** (`server/src/controllers/sale.controller.js:375-435`), y **nunca ingirió pedidos web**. Con POS=3 y la web vendiendo 2, la venta física de 1 empujaba 2 y **resucitaba stock ya vendido**. Sin reserva, sin lock, sin reconciliación, sin panel. Es la causa técnica de los casos reales.
  - **onplay-erp** (cuarto intento, 2026-06/07): lo declaró problema raíz (`00-fundacion.md:15`) y lo diseñó completo: reserva → confirmar | liberar con `FOR UPDATE` (construido), cola de sync encolada **dentro** de la transacción de la venta y ejecutada fuera con idempotencia y reintentos (construido), ingesta de pedidos por **polling** con cursor, solo `processing` descuenta, y el pedido web perdedor queda en **EXCEPCIÓN** para resolución manual, **nunca cancelación automática ni stock negativo** (D5-04). La ingesta (5C) **no se construyó**; sin ella el push restauraba unidades vendidas, por lo que se exigía onplay.cl en standby.
  - Diferencia clave con `onplay-core`: onplay-erp ignoraba el stock de Woo por diseño (I-1); `onplay-core` tiene S2 (leer y comparar antes de escribir), que es la guarda que faltó en ambos. Las piezas de onplay-erp (gate con candado, outbox transaccional, polling de pedidos, cola de excepciones) son el punto de partida recomendado para el SDD de E2/E3.
- **Decisiones que la spec debe fijar (pendientes del dueño):**
  1. **Quién gana** cuando chocan — **DECIDIDO por el dueño el 2026-09-02:** la venta física en la tienda (Merced) tiene prioridad sobre la online; **la online gana si el pago está realizado**. Escrito en `03-SDD-etapa2-inventario.md` §6.9 (E2: bloqueo con salida de encargado cuando el espejo del canal muestra 0) y `06-SDD-etapa3-sincronizacion.md` §8.4 (E3c: solo pedidos pagados reservan; `pedido_sin_stock` a excepción manual).
  2. **Umbral de aviso** en el cobro: mostrar «último(s) N en la web» cuando el stock del canal sea ≤ umbral.
  3. **Espejo de solo lectura antes de E2:** guardar `stock_quantity`/`stock_status` del canal en `ProductoCanal` (`stockCanal`, `stockCanalEn`) en cada sync, para que el vendedor vea la cantidad web en la ficha y en el cobro. Es lectura pura (P2), no crea inventario propio ni toca la caja. Reduce el riesgo desde ya con costo bajo; ampliación de 02-SDD §5.2 si se aprueba.

### R-012 · Tipo = Sellado + Categoría = Magic no muestra nada

- **Fecha:** 2026-09-02. **Estado:** Corregido. Reporte del dueño.
- **Qué pasaba:** no era un bug del filtro sino de la taxonomía de `02-SDD` §6.3: **todo el sellado vive en la categoría raíz «Sellado»** y el juego se guarda en `producto.juego` (string libre). «Magic» como categoría existe solo bajo «Cartas», así que la intersección Tipo = Sellado ∩ Categoría = Cartas > Magic es vacía por diseño (45 sellados de Magic tienen `categoria = sellado`, `juego = magic`). Además el filtro de categoría era exacto: elegir «Cartas» no traía a Magic ni a One Piece.
- **Decisión:** (1) V5 gana el filtro **Juego**, alimentado por `GET /productos/juegos` (valores reales con conteo; la API ya aceptaba `juego`). Tipo = Sellado + Juego = Magic da los 45. (2) El filtro **Categoría pasa a subárbol** en `GET /productos` (elegir «Cartas» incluye sus hijas), igual que en `/stock` y `/recuentos`. (3) Cuando el cruce Sellado + una categoría de «Cartas» queda vacío, el mensaje explica dónde vive el sellado. No se mueve ningún producto de categoría: la taxonomía de la spec se mantiene.
- **Archivos:** `apps/api/src/categorias.ts` (helper `idsSubarbol` compartido por productos/stock/recuentos), `apps/api/src/rutas/productos.ts`, `apps/web/src/pantallas/admin/Productos.tsx`.

### R-013 · Cierre de la Etapa 2: código completo, queda el recuento real

- **Fecha:** 2026-09-02. **Estado:** Abierto — depende del dueño.
- **Qué se hizo:** Fases 1–5 de `03-SDD` implementadas en un día y verificadas criterio por criterio (17 de 18). Guía operativa para el encargado en `09-guia-inventario-encargado.md`. README y CLAUDE.md al día.
- **Qué falta (criterio 18):** dos recuentos consecutivos de snacks y sellado que cuadren, hechos en la tienda. Es lo que declara «lista» la etapa según `01-SDD` §9. Se hace desde `/admin/recuentos` siguiendo la guía.
- **Datos de prueba en dev que conviene limpiar antes de un recuento real:** SNK-000001 Coca-Cola, SNK-000002 Sprite y ACC-000079 Katana Red tienen movimientos de prueba (incluidos 1.000 ajustes «crit1 concurrencia»), ventas V-2026-00015..00023, devoluciones D-2026-00001/00002 y recuentos de prueba. En producción la base nace limpia; en dev, un recuento real los deja en el número correcto sin borrar nada (P9).
- **Recordatorio de despliegue:** E2 se construyó en local (D-E2-6). Ponerla en producción exige que E1 lleve 7 días corridos (`02` criterio 11) y `npx prisma migrate deploy` con la migración `20260902195601_e2_inventario`.

### R-014 · El stock no puede quedar en −1 ni la venta aceptar más de lo disponible

- **Fecha:** 2026-09-02. **Estado:** Corregido. **Decisión del dueño que cambia D-E2-1 y M2 de `03-SDD`** (la versión original permitía negativos con advertencia).
- **Regla nueva:** con control de stock, el mostrador no agrega más unidades que las disponibles en la ubicación de venta (tope con el stock del caché; aviso «solo quedan N»; «+» del carrito apagado en el tope) y el servidor rechaza la venta entera con `422 STOCK_INSUFICIENTE {productoId, descripcion, disponible, solicitado}` si el stock cambió entre medio. La regla vive en `registrarMovimiento` (`apps/api/src/stock/libro.ts`), así que también protege mermas, ajustes y traslados. Un producto en «sin stock» se corrige con Ingresar o Recontar antes de venderlo.
- **Efectos:** criterio 5 de la spec reescrito (dos ventas simultáneas de la última unidad → una 201 y una 422, stock 0). Las advertencias `STOCK_NEGATIVO` ya no se emiten. La sección «Negativos» de Alertas queda para datos anteriores a esta regla (en dev, el Sprite en −1 hasta que se reconte).
- **Icono:** «Clientes» en la barra lateral pasa de `◉` a un icono de dos personas (SVG en línea, hereda el color).
- **Dos defectos que salieron al verificar en Chrome y quedaron corregidos:** (a) el delta del caché offline (`catalogo-offline?desde=`) solo traía productos cuya fila `Producto` cambió, así que un movimiento de stock no refrescaba el tope del carrito hasta 30 min; ahora el delta incluye productos con `StockActual.actualizadoEn` o `ProductoCanal.stockCanalEn` posteriores a la marca, y el mostrador refresca el caché al terminar cada venta. (b) el libro escribía `actualizadoEn` con `NOW(3)` (hora local de MariaDB) mientras Prisma guarda UTC: los cambios quedaban fechados horas atrás y el delta no los veía; ahora usa `UTC_TIMESTAMP(3)`.
- **Verificado:** merma de 5 con 1 disponible → 422; venta de 2 con 1 → 422 con `descripcion`; dos ventas simultáneas de la última unidad → una 201 y una 422, stock 0, `verificar` sin diferencias; delta trae la Coca tras un ingreso.
- **Reporte posterior del dueño «no puedo seleccionar más de un producto»:** el navegador tenía en caché el stock viejo (esquema 3, marcas en hora local) y el tope bloqueaba con un número desactualizado; además en dev el Sprite está en −1 y no se puede agregar por diseño. Corregido: el esquema del caché sube a 4 (descarga completa única) y, con conexión, al agregar un producto con control el tope se toma del servidor en el momento (`GET /productos/:id/stock`); sin conexión vale el caché. Verificado en Chrome: dos productos distintos, tres unidades de la Coca con «+» apagado en 3, Sprite → «no tiene stock disponible».
- **Archivos:** `stock/libro.ts`, `rutas/ventas.ts`, `rutas/productos.ts` (delta), `catalogo.ts` (esquema 4), `Mostrador.tsx`, `PanelVenta.tsx`, `DialogoCobro.tsx`, `DialogoMovimientoStock.tsx`, `BarraLateral.tsx`, `tipos.ts`, docs 03 y 09.

### R-015 · Cada corrida completa repetía en `SyncLog` los mismos errores conocidos

- **Fecha:** 2026-09-03. **Estado:** Corregido.
- **Dónde se vio:** `/admin/sync`, bitácora de errores. onplaygames_cl tiene 11 errores permanentes del origen (2 productos sin precio, 9 SKUs de variación duplicados con sufijo `-1`) y cada `POST /sync/:canalId/importar?dryRun=false` los volvía a insertar: 63 filas en dev para 21 detalles distintos. El criterio 2 de `02-SDD` §10 («`SyncLog` abiertos → 0») se volvía inalcanzable, porque marcar resuelto no servía de nada hasta la corrida siguiente.
- **Decisión:** un error de sync que ya está **abierto** (`resultado='error'`, `resuelto=false`) con el mismo canal y el mismo `detalle` no se vuelve a registrar. Marcarlo resuelto lo deja reaparecer en la próxima corrida si el origen sigue igual, así que la bitácora sigue diciendo la verdad: una fila abierta por problema real. Aplica a la importación completa y al incremental (`registrarErrorSync` en `apps/api/src/sync/importador.ts`). El `resumen.errores` de la respuesta no cambia: sigue contando todo lo que falló en la corrida.
- **Verificado por curl:** importación real de onplaygames_cl con 11 errores → 0 filas nuevas (21 abiertas antes y después); marcar una resuelta por `PATCH /sync/logs/:id` y reimportar → reaparece exactamente una vez.
- **Pendiente del dueño (criterio 2):** en dev quedan 10 filas abiertas «viejas» (6 del 2026-09-01 y 4 del 2026-09-02 13:56) cuyo texto ya no coincide con el actual porque R-001/R-003 cambiaron el nombre de las variaciones dentro del detalle; hay que marcarlas resueltas a mano una vez. Las 11 vigentes son datos del origen y se resuelven en Woo o se marcan resueltas con criterio.

### R-016 · Un pedido web pagado puede dejar el libro en negativo (choca con R-014)

- **Fecha:** 2026-09-03. **Estado:** decidido por defecto al construir E3; **pendiente de ratificar por el dueño.**
- **Contradicción:** R-014 (dueño, 2026-09-02) dice que el stock NUNCA queda negativo y `registrarMovimiento` aborta con `422 STOCK_INSUFICIENTE`. `06-SDD` §8.4 (25-08, también decisión del dueño sobre prioridad entre canales) dice que un pedido online **pagado** es un hecho: «el descuento `venta_online` se hace aunque el stock quede negativo» y se abre `pedido_sin_stock` para que una persona decida (contactar, reembolsar o reponer). Las dos reglas no pueden convivir tal cual.
- **Decisión tomada:** R-014 sigue valiendo para todo lo que decide una persona en la tienda (venta del mostrador, merma, ajuste, traslado). La **única** excepción es el motivo `venta_online` cuando lo escribe la ingesta de E3 (`permitirNegativo: true` en `EntradaMovimiento`, que solo tiene efecto con ese motivo): el cliente ya pagó en la web y ocultar la unidad vendida sería peor que mostrar un −1 con su discrepancia. El mostrador no cambia: con `stockVenta` 0 no deja agregar y el −1 vive en `bodega` (ubicación online), no en `mostrador`.
- **Si el dueño prefiere lo contrario** (abortar la ingesta del pedido y abrir la discrepancia sin descontar), el cambio es de una línea en `apps/api/src/sync/pedidos.ts` (quitar `permitirNegativo`) y capturar el `422` como candidata `pedido_sin_stock`.
- **Archivos:** `stock/libro.ts` (opción), `sync/pedidos.ts` (uso), 06-SDD §8.4.

### R-017 · Arranque de E3: Fase 0 con defaults, Fases 1–2 hechas; ajustes menores a la spec 06

- **Fecha:** 2026-09-03. **Estado:** Corregido (amplía `06-SDD`).
- **Fase 0 (§9):** E2 entrega `Ubicacion.publicable` (bodega) y `referencia_tipo = 'pedido_canal'` (HE3 cerrado). Conteo real de ofertas activas: onplay.cl 0, onplaygames.cl 87 (universo que E3a no toca). Pedidos pagados de los últimos 30 días: 9 y 6. **Quedan del dueño antes de encender cualquier push:** claves `ck_/cs_` de escritura, `SYNC_SOLO_LECTURA=false` anotado en Auditoria, respaldo restaurado en un entorno de prueba y staging. Mientras tanto `PATCH /canales/:id` responde `422 CANDADO_SOLO_LECTURA` si se intenta encender `pushPrecio`/`pushStock`.
- **Fase 1:** migración `20260903201100_e3_sincronizacion` (schema consolidado E1+E2+E3+E4), `ClienteWoo` con `paginarPedidos`, `listarReembolsos`, `listarProductosPorIds`, `actualizarProducto/Variacion` (PUT acotado a `regular_price`/`stock_quantity`, con test que prueba que no deja pasar otros campos), reglas puras en `packages/dominio/src/sync.ts` (16 tests), cerrojo de corridas con `FOR UPDATE` sobre `Canal`, barrido de arranque, cron `SYNC_CRON_COMPLETA` (*/15) que solo corre en canales con algún interruptor encendido, usuario semilla `sistema@onplay.cl` (inactivo) que firma los movimientos de las corridas automáticas.
- **Fase 2 (ingesta):** verificada contra onplaygames.cl real: simulación no persiste nada (criterio 1), 6 pedidos ingeridos con 16 líneas, descuento `venta_online` en `bodega` con `pedido_sin_stock` al quedar en −1, reproceso sin duplicar (criterio 7), dos corridas simultáneas → una 409 (criterio 13), `pedido_anulado` al detectar el paso a `refunded` y `vecesVista` 2 sin fila nueva (criterio 10), `pushStock` sin ingesta → 422 (criterio 12), mapeo manual de una línea descuenta el stock que la ingesta no pudo, resolver `pedido_sin_stock` con `reponer` crea `compra` y audita, vendedor 403.
- **Ajustes a la spec (decisiones de implementación):**
  1. **§5.2 `@@unique([productoCanalId, tipo, estado])`** impediría dos discrepancias *resueltas* del mismo tipo. Se reemplaza por `claveAbierta String? @unique` = `"<sujeto>:<tipo>"` mientras está abierta y `null` al cerrarla: misma garantía (una abierta por sujeto y tipo), sin el efecto secundario. El sujeto puede ser producto-canal, pedido o línea.
  2. **Marca de agua inicial (§8.1):** al encender `ingestaPedidos` por primera vez, `ultimaIngestaEn = ahora`: la ingesta parte desde ese momento y no relee los 369 pedidos históricos de onplaygames.cl. La simulación sin marca mira las últimas 24 h para poder mostrar un plan.
  3. **Pedido que llega ya con reembolso parcial (§8.2):** la primera ingesta descuenta `cantidad − cantidadDevuelta` y no abre discrepancia (el reembolso ocurrió antes de que el maestro supiera del pedido). Los reembolsos posteriores sí abren `pedido_anulado` acotada a la línea.
  4. **Pedido anulado que nunca se ingirió** (consulta B lo devuelve): se omite con motivo; no hay nada que revertir.
  5. **`imponer_maestro`** responde `501 NO_DISPONIBLE_AUN` hasta que exista el push de stock (Fase 4).
  6. **`GET /sync/pedidos`** (no listado en §6) existe porque V14 lo necesita.
- **Fases 3 y 4 (push de precio y de stock, adopción) — mismo día:** motor único en `apps/api/src/sync/push.ts`: lee S_canal por listado (`include` de a 100; variaciones con una llamada por padre), decide con el dominio (`decidirPushPrecio`/`decidirPushStock`), escribe con concurrencia 4 y guarda `precioPublicado`/`stockPublicado` DESPUÉS del 200; simulación sin efectos; `producto_desaparecido` cuando el canal no devuelve el vínculo (publicado=false, nada se borra); espejo `stockCanal` se refresca de paso. Rutas `POST /sync/:canalId/precios|stock|adoptar` (`?productoIds=` para acotar), `POST /productos/:id/publicar` y publicación a demanda al cambiar el precio en `PATCH /productos/:id` (G9, sin bloquear la respuesta), `imponer_maestro` real (admin; con el candado responde 422 CANDADO_SOLO_LECTURA), corrida completa pedidos → precios → stock. §5.3 aplicado en el importador: con `pushPrecio` el pull no escribe `precioVenta` y abre `precio_derivado`; con `pushStock` no despublica solo y abre `producto_desaparecido`. Enum `canal_sin_gestion` al final de `TipoDiscrepancia` (§7.4; migración `20260903203328_e3_canal_sin_gestion`). Adoptar cierra la `primera_publicacion` del vínculo.
- **Verificado por curl (dev, candado puesto):** simulación de precios sobre onplaygames.cl: 459 leídos, 373 al día, 86 en oferta detenidos (criterios 1 y 4), ninguna discrepancia creada; stock en onplay.cl → 0 elegibles y 2.878 no elegibles (criterio 5); `primera_publicacion` → adoptar real deja `stockPublicado = S_canal` y cierra la discrepancia; deriva simulada → `stock_derivado` con los tres números y sin escribir (criterio 9), `vecesVista` 2 (criterio 10); `adoptar_canal` crea `ajuste` con la diferencia y audita (criterio 11); escritura real → `fallar` con el mensaje del candado, `syncStock=error`, corrida terminada (criterio 15); G9 y §5.3 (precioVenta intacto + `precio_derivado`).
- **Dato raro del origen que salió al probar:** el importador guarda `atributos.padreExternoId` como **string** («2897»); el push lo lee como número o string numérico. Sin eso 239 variaciones parecían desaparecidas.
- **Fases 5 y 6 — mismo día:** V12 `pantallas/admin/Sync.tsx` reescrita (la insignia «SOLO LECTURA · Etapa 1» se reemplaza por el estado real del candado y, por canal, los tres interruptores con marca de agua y última corrida, Simular corrida completa como botón principal y Publicar secundario con confirmación, Ingerir ahora, Adoptar (simular/real), Simular solo stock; el pull de catálogo de E1 queda plegado; dos bitácoras conmutables: Corridas (E3) y Catálogo (E1); resultado con el plan y los tres números por ítem); V13 `Discrepancias.tsx` (`/admin/discrepancias`, encargado+: tarjetas agrupadas por tipo con maestro · canal · publicado, frase, «Detectada N veces desde…», acciones con consecuencia escrita antes de confirmar y nota obligatoria, «El maestro tiene razón» solo admin, `pedido_sin_stock` con Llegó otra unidad / Contacté al cliente / Se reembolsa); V14 `PedidosOnline.tsx` (`/admin/pedidos`: tabla, expandir líneas, «Vincular a un producto» con buscador del maestro; `?sinMapear=true` enlazado desde V13); tipos en `tiposSync.ts`; menú con Pedidos online y Discrepancias (encargado). F6: `?soloErrores=true` en precios/stock (G10, verificado: lee solo los vínculos en `error`), purga de `SyncCorridaItem` > 90 días al correr el cron completo, corte RS4 tras cada push real de stock (accionables abiertas > `ALERTA_DISCREPANCIAS` → `pushStock=false` + Auditoria + mensaje en la corrida; sin correo por P6). `adoptar_canal` acotado a tipos de stock.
- **Pendiente:** revisión visual de V12/V13/V14 en Chrome (typecheck y build limpios; el tool de Chrome tenía dos navegadores conectados y no se pudo elegir sin el dueño).

---

## Cómo agregar una entrada

1. Tomar el siguiente `R-NNN`.
2. Agregar la fila al Resumen y la sección en Detalle con: fecha, dónde se vio, qué pasaba, decisión, alcance/tests.
3. Si es un cambio de código, nombrar el archivo y agregar el test.
4. Si amplía alcance, marcar `Agendado (E#)` y dejarlo; no construirlo.
