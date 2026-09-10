# SDD — Etapa 6: Compras, proveedores y márgenes
## Especificación ejecutable

| | |
|---|---|
| **Proyecto** | `onplay-core` |
| **Etapa** | 6 de 6 |
| **Versión** | 1.0 |
| **Fecha** | 10 de septiembre de 2026 |
| **Documento padre** | `docs/01-SDD-general.md` (§9 «Etapa 6») |
| **Precedente** | `docs/03-SDD-etapa2-inventario.md` (libro de stock, motivo `compra`) |
| **Diseño visual** | `docs/05-SDD-diseno-interfaz-etapa1_1.md` — Cristal OnPlay |
| **Destinatario** | Claude Code |
| **Estado** | **Fase 1 construida en local el 2026-09-10** (R-027). Fases 2–4 agendadas |

> **Dependencia:** Etapa 2 (inventario): recibir una compra escribe en el libro de stock con `registrarMovimiento` y motivo `compra`. No toca los canales (E3) ni los clientes (E4).
>
> **Origen:** pedido del dueño el 2026-09-10 con la factura electrónica N° 097397951 de Embotelladora Andina (Coca-Cola) en `docs/pdf/`: «vamos a agregar la carga de la factura por distribuidor ya que todos envían sus facturas de manera diferente».

---

## 1. Qué resuelve esta etapa

**Objetivo O7:** que se conozca el costo y el margen real de lo que se vende.

Hoy la mercadería entra al stock con «Ingresar» (E2 C5), a mano, producto por producto, sin costo y sin documento. Cada distribuidor manda su factura en un formato distinto (Andina en cajas y botellas con impuestos específicos por línea; otros en unidades; otros en papel). Digitar cada línea es lento y se equivoca; no digitar deja el stock desactualizado y el costo desconocido.

Esta etapa hace que **la factura sea la unidad de trabajo**: se carga el documento del proveedor, el sistema lo lee con el lector de ese distribuidor, la persona revisa y vincula cada línea a un producto del maestro (una vez: el sistema recuerda el código del proveedor), y **recibir** ingresa todas las unidades al libro de stock con su costo unitario.

## 2. Qué NO hace esta etapa

- **No emite ni valida documentos tributarios.** El PDF es un insumo para leer líneas; no se guarda el archivo ni se contrasta con el SII (`01` §2.3).
- **No paga a proveedores ni lleva cuentas por pagar.** Registra qué llegó y cuánto costó, no si se pagó.
- **No hace OCR.** Solo lee PDF con texto. Una foto o un escaneo se digita a mano.
- **No calcula costo promedio ponderado ni margen** en la Fase 1 (Fases 2 y 3).
- **No reemplaza «Ingresar»** de E2 para los casos sin documento (una compra chica en efectivo sin factura sigue entrando por V21 o por una compra «digitada a mano»).

---

## 3. Alcance funcional

| # | Funcionalidad | Prioridad | Fase |
|---|---|---|---|
| C1 | Proveedores con RUT y lector de documentos | P0 | 1 |
| C2 | Lector de PDF por distribuidor (Andina primero) que entrega líneas, cabecera y totales | P0 | 1 |
| C3 | Compra en borrador: revisar, vincular líneas a productos, corregir bultos/unidades | P0 | 1 |
| C4 | Memoria de vinculación por código de proveedor (`producto_proveedor`) | P0 | 1 |
| C5 | Recibir: movimientos `compra` al libro + `costoReferencia` = último costo unitario | P0 | 1 |
| C6 | Compra digitada a mano (proveedor sin lector, sin PDF) | P0 | 1 |
| C7 | Costo promedio ponderado por producto | P1 | 2 |
| C8 | Reporte de margen por producto, categoría y canal | P1 | 3 |
| C9 | Sugerencia de reposición por rotación; órdenes de compra | P2 | 4 |
| C10 | Más lectores (un archivo + un test por distribuidor) | continuo | — |

## 4. Principios de esta etapa

- **M1 — El documento manda.** Los totales de la compra son los del documento (es lo que se paga); si las líneas no suman lo mismo, se avisa, no se bloquea.
- **M2 — Un lector es una función pura sobre celdas de texto.** `extraerPaginasPdf` (pdfjs) convierte el PDF en filas y celdas; el lector nunca ve el PDF. Así cada lector tiene un test con las celdas reales de una factura y agregar un distribuidor no toca nada más.
- **M3 — Vincular es decisión humana; recordar es del sistema.** Ninguna línea se asocia a un producto por parecido de nombre. La primera vez la persona elige; desde entonces el código del proveedor lo trae vinculado (`aprendida`).
- **M4 — Recibir es la única escritura al stock**, en una transacción, por `registrarMovimiento` (E2 M1). Una compra recibida es inmutable (P9): si vino mal, merma o ajuste.
- **M5 — La misma factura no se carga dos veces**: única `(proveedorId, numeroDocumento)`.
- **M6 — Lo que no tiene producto no entra al stock**, pero queda en la compra (la persona decide omitirlo al recibir, y se ve en la lista como «N sin vincular»).

---

## 5. Modelo de datos

Migración `20260910131454_e6_compras`.

### 5.1 Entidades nuevas

**`Proveedor`** — `id`, `nombre`, `rut` (único, normalizado `91144000-8`, nullable), `lector` (enum `LectorFactura`: `manual` · `andina`), `activo`, `notas`, `creadoEn`. Con RUT, `POST /compras/leer` reconoce al proveedor solo.

**`ProductoProveedor`** — memoria de vinculación (C4): `proveedorId`, `codigoProveedor` (tal como viene en el documento), `descripcionProveedor` (última vista), `productoId`, `unidadesPorBulto`. Única `(proveedorId, codigoProveedor)`.

**`Compra`** — `proveedorId`, `tipoDocumento` (`factura` · `boleta` · `guia` · `otro`), `numeroDocumento`, `fechaDocumento`, `ubicacionId` (dónde entra; por defecto la `publicable` = bodega, D-E6-2), `estado` (`borrador` · `recibida` · `anulada`), `origen` (`pdf` | `manual`), `lector`, `archivoNombre`, `neto`, `impuestos`, `total` (CLP), `advertencias` (JSON de textos), `nota`, `usuarioId`, `recibidaPorId`, `recibidaEn`. Única `(proveedorId, numeroDocumento)` (M5).

**`CompraLinea`** — `compraId`, `orden`, `codigoProveedor`, `descripcion` (congelada), `productoId` (nullable = sin vincular), `bultos`, `unidadesPorBulto`, `sueltas`, `cantidad` (= bultos × unidadesPorBulto + sueltas), `neto`, `impuestos`, `total`, `costoUnitario` (= total / cantidad redondeado), `movimientoId` (el `MovimientoStock` creado al recibir).

### 5.2 Cambios sobre entidades previas

- `Producto.costoReferencia Int?` (anunciado en `01` §6.2 «se agrega por migración en E6»): **último costo unitario recibido**. Null hasta la primera compra.
- `MovimientoStock` con motivo `compra` gana referencia real: `referenciaTipo = 'compra'`, `referenciaId = compra.id`, nota `«factura 097397951 · Embotelladora Andina S.A.»`.
- Back-relations: `Producto.proveedores/lineasCompra`, `Usuario.compras/comprasRecibidas`, `Ubicacion.compras`.

### 5.3 Decisiones por defecto (a ratificar por el dueño)

- **D-E6-1 — Costo unitario = total de la línea / unidades, CON IVA e impuestos específicos.** Es lo que cuesta cada unidad puesta en la tienda y lo que se compara con el precio de venta (que también lleva IVA). Se guarda además el `neto` por línea para que la Fase 3 pueda calcular margen neto si el contador lo pide.
- **D-E6-2 — Las compras entran a `bodega`** (la ubicación `publicable`), no al mostrador: lo que llega se traslada a la venta con el traslado de E2. Se puede cambiar por compra.
- **D-E6-3 — No se guarda el PDF.** Se guarda el nombre del archivo, las líneas leídas y las advertencias; el PDF original lo tiene el correo del proveedor. Guardar binarios en la base es una decisión aparte (S4 prohíbe JSON a disco; un blob en MySQL sería aceptable si se pide).
- **D-E6-4 — Una compra recibida no se anula.** Corrección por merma/ajuste (P9). Anular solo borra borradores (queda `anulada` con nota, no se elimina).

---

## 6. Reglas de negocio (`src/dominio/compra.ts`, con tests)

### 6.1 Línea
`calcularLinea`: `unidadesPorBulto ≥ 1`, `bultos`/`sueltas` enteros ≥ 0, `cantidad = bultos × unidadesPorBulto + sueltas > 0`, montos enteros ≥ 0, `costoUnitario = round(total / cantidad)`. Andina: `23.353 / 48 = 487` (coincide con la columna «BRUTO x BOT.» de la factura).

### 6.2 Totales
`cuadrarTotales`: suma las líneas; si hay totales del documento, mandan (M1) y se avisa cuando `|documento − suma| > 1 por línea` (redondeos). Sin documento (digitada), los totales son la suma y se recalculan al editar líneas.

### 6.3 Lectores
`src/api/compras/pdf.ts` → `PaginaTexto[]` (filas de celdas, arriba→abajo, izquierda→derecha, tolerancia ±2 pt). `src/api/compras/lectores/index.ts` registra los lectores; `detectarLector` elige el primero que `reconoce` (por RUT o razón social en la primera página). Cada lector devuelve `DocumentoLeido` (`proveedor {rut, nombre}`, `tipoDocumento`, `numeroDocumento`, `fechaDocumento` ISO, `lineas`, `totales`, `advertencias`).

**Andina** (`lectores/andina.ts`, RUT 91.144.000-8): columnas `COD · DESCRIPCION · CAJ/BOT · P.UNIT · SUB TOTAL · TASA% · MONTO DESCTO · FLETE · NETO · IMPTO ESPECÍF. · TOTAL · BRUTO x BOT`. Se lee desde la derecha (las columnas del medio pueden faltar). `CAJ/BOT` `4/00` = 4 cajas, 0 botellas; unidades por caja desde «x 12» / «x 6» de la descripción (si no dice, 1 y advertencia). `TOTAL` de la línea ya incluye IVA e impuesto específico (verificado: `neto × 1,19 + impto = total`). Fila de totales: primer número = neto, último = total (las celdas vacías no viajan). La página «CEDIBLE» repite las líneas y se descarta; una página con líneas distintas se suma (factura larga). Fixture real en `andina.test.ts`.

### 6.4 Memoria de vinculación
Al crear o editar una línea con `productoId` y `codigoProveedor` se hace `upsert` en `ProductoProveedor` (salvo `aprender:false`). `POST /compras/leer` la usa: líneas con código conocido vienen con `productoId`, `producto`, `unidadesPorBulto` aprendidas y `aprendida:true`.

### 6.5 Recibir
Transacción: candados `StockActual` en orden ascendente por `productoId` (E2 §6.1) → por cada línea con producto `registrarMovimiento(+cantidad, 'compra', ref compra)` → `CompraLinea.movimientoId` → `Producto.costoReferencia = costoUnitario` y `controlaStock = true` si estaba apagado (M5 de E2, Auditoria `ajustar_stock` «primer ingreso por compra») → `Compra.estado = recibida` + Auditoria `editar`. Líneas sin producto: 422 `LINEAS_SIN_VINCULAR` salvo `omitirSinVincular:true` (quedan fuera y se informan como `omitidas`). Sin ninguna línea con producto → 422 `SIN_LINEAS`.

---

## 7. API (`src/api/rutas/compras.ts`, rol **encargado**)

### 7.1 Proveedores
- `GET /proveedores` → `{ proveedores[] (con compras, productosVinculados), lectores[] }`
- `POST /proveedores {nombre, rut?, lector?, notas?}` → 201; RUT inválido 422 `RUT_INVALIDO`; RUT repetido 409 `PROVEEDOR_DUPLICADO`; sin `lector`, el RUT conocido lo decide (`lectorPorRut`).
- `PATCH /proveedores/:id` (mismos campos + `activo`)
- `GET /proveedores/:id/productos` (memoria), `DELETE /proveedores/:id/productos/:mapeoId`

### 7.2 Leer un documento
- `POST /compras/leer {archivo: base64, nombre?, proveedorId?}` (`bodyLimit` 12 MB, PDF ≤ 8 MB) → propuesta: `lector`, `proveedor | proveedorSugerido {nombre, rut, lector}`, cabecera, `lineas[]` calculadas y con vinculación aprendida, `totales` (+ `sumaLineas`), `advertencias`, `yaCargada {id, estado} | null`, `sinVincular`. Errores: 422 `ARCHIVO_INVALIDO` / `PDF_ILEGIBLE` / `LECTOR_NO_DISPONIBLE` (con `muestra` de las primeras filas para escribir el lector), 413 `ARCHIVO_DEMASIADO_GRANDE`. **No escribe nada.**

### 7.3 Compras
- `POST /compras {proveedorId, tipoDocumento, numeroDocumento, fechaDocumento, ubicacionId?, origen, lector, archivoNombre?, totales?, advertencias?, lineas[]}` → 201 borrador (aprende las vinculaciones que vengan); 409 `COMPRA_DUPLICADA {compraId, estado}`.
- `GET /compras?estado&proveedorId&pagina` (50 por página; `totalLineas`, `sinVincular`, `unidades`)
- `GET /compras/:id` (líneas con `producto` y `stockVigente` en la ubicación de la compra)
- `PATCH /compras/:id {ubicacionId?, fechaDocumento?, numeroDocumento?, tipoDocumento?, nota?}` (solo borrador → 409 `COMPRA_NO_EDITABLE`)
- `POST /compras/:id/recibir {omitirSinVincular?}` → `{ compra, movimientos[], encendidos[], omitidas[] }`
- `POST /compras/:id/anular {nota}` (borrador → `anulada`; recibida → 409 `COMPRA_RECIBIDA`)

### 7.4 Líneas del borrador
- `POST /compras/:id/lineas {descripcion, codigoProveedor?, bultos, unidadesPorBulto, sueltas, neto, impuestos, total, productoId?, aprender?}`
- `PATCH /compras/:id/lineas/:lineaId` (parcial; recalcula cantidad y costo; aprende)
- `DELETE /compras/:id/lineas/:lineaId`

En compras `manual` los totales se recalculan con cada cambio de líneas; en `pdf` mandan los del documento (M1).

---

## 8. Pantallas (`src/web/pantallas/admin/Compras.tsx`, menú «Compras» ⇩, encargado+)

- **V25 Compras** (`/admin/compras`): tabla fecha · proveedor · documento (con «N sin vincular») · unidades · total · estado · quién cargó; filtro por estado; botón «Cargar factura»; sección plegada **Proveedores** con alta/edición (nombre, RUT, «cómo llegan sus documentos»).
- **V26 Cargar factura** (`/admin/compras/nueva`): elegir PDF → `POST /compras/leer` → banner con el lector usado, advertencias, proveedor (reconocido, o «Crear «Embotelladora Andina S.A.»» prellenado, o elegir/crear), documento editable (tipo, número, fecha, «Entra a»), tabla de líneas con Vincular por fila (diálogo con buscador del maestro + unidades por bulto + cálculo en vivo; si el producto no existe, «crearlo» ahí mismo con los 4 campos de V6 —nombre prellenado con la descripción, categoría propuesta «snacks», precio de venta con el costo unitario como referencia, código de barras— y queda vinculado en el acto; pedido del dueño 2026-09-10), totales, «Guardar borrador». Si ningún lector entiende el PDF: aviso + primeras filas plegadas + modo «digitar a mano» (crea el borrador vacío).
- **V27 Detalle** (`/admin/compras/:id`): cabecera, fecha y ubicación editables en borrador, advertencias, líneas con «X → Y» de stock, Vincular/Editar/Quitar, «Agregar línea», «Recibir mercadería» (confirmación con unidades, ubicación y las líneas que quedarán fuera), «Anular borrador» con nota. Recibida: solo lectura y enlace a Stock (el kardex de E2 muestra el movimiento con referencia a la compra).

## 9. Plan

- **Fase 1 (C1–C6) — hecha en local el 2026-09-10.** Verificado por HTTP con la factura real: lectura 8 líneas / $177.813 cuadrado, proveedor por RUT con lector automático, borrador, 409 por duplicado, vinculación que aprende (releer trae `aprendida`), 422 sin vincular, recepción (Coca 350: bodega 43 → 91, `costoReferencia` 708; Monster nuevo: 0 → 24 y control encendido), kardex con referencia a la compra, 409 al anular/editar una recibida, compra manual con línea y totales recalculados, anulación de borrador. 16 tests nuevos (147 en total).
- **Fase 2 — costo promedio ponderado** (C7): `Producto.costoPromedio` recalculado al recibir; `costoReferencia` pasa a ser «último».
- **Fase 3 — margen** (C8): reporte por producto/categoría/canal sobre `VentaLinea` × costo vigente al vender (congelar `costoUnitario` en la línea de venta desde entonces).
- **Fase 4 — reposición y OC** (C9).
- **Lectores nuevos (C10):** cuando llegue el PDF de otro distribuidor: `docs/pdf/` + `lectores/<clave>.ts` + test con sus celdas + valor en `LectorFactura` (al final del enum) + `LECTOR_POR_RUT`.

## 10. Criterios de aceptación (Fase 1)

1. ✅ La factura 097397951 se lee entera: 8 líneas, neto 138.598, total 177.813, sin advertencias.
2. ✅ Cargar la misma factura dos veces → 409.
3. ✅ Vincular una línea una vez → la siguiente lectura la trae vinculada.
4. ✅ Recibir suma exactamente `cantidad` por línea en la ubicación elegida, deja `costoReferencia` y enciende el control (E2 M5), todo en una transacción.
5. ✅ Una compra recibida no se edita ni se anula.
6. ✅ Un vendedor no ve compras (403).
7. ⏳ El encargado carga en producción la próxima factura de Andina de punta a punta sin ayuda (del dueño).
8. ⏳ Un segundo distribuidor con su lector (cuando llegue su PDF).

## 11. Riesgos

- **Cambio de formato de Andina.** El lector lee desde la derecha y por patrones (`COD` de 5–7 dígitos, `CAJ/BOT` `n/nn`), pero un rediseño del PDF lo rompe: el síntoma es «No se reconoció ninguna línea» y la salida es digitar y avisar. El test con las celdas reales detecta regresiones nuestras, no cambios de ellos.
- **`pdfjs-dist` en Hostinger.** Es dependencia de producción (externa al bundle). Verificar en staging que `legacy/build/pdf.mjs` carga en Node 22 del LVE (no usa canvas ni workers).
- **Unidades por bulto equivocadas** (12 vs 6) multiplican el stock. La vista previa muestra `cajas × unidades = total` y el detalle muestra «X → Y» antes de recibir; el costo unitario resultante (487 vs 974) también delata el error.
