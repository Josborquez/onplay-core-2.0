# 14 — SDD Análisis comercial e inventario (R-036)

**Estado:** construido en local el 2026-09-22. Amplía el alcance de E6 (`docs/11`) con una capa de
**lectura**: no cambia cómo se vende, cómo se compra ni cómo se sincroniza. Vinculante para esta
ampliación; donde choque con 01/03/06/11, manda la spec de la etapa.

**Origen:** prompt del dueño `docs/Prompt-Onplay-Canales-Ventas-Inventario.md`, revisado contra el
código antes de construir (ver §11, «Lo que el prompt decía y lo que había»).

---

## 1. Qué responde

1. ¿Cuáles son nuestros canales de venta?
2. ¿Cuánto vende cada canal y qué porcentaje del total representa?
3. ¿Qué productos, categorías y juegos aportan a cada canal?
4. ¿Cuánto vale el inventario disponible, a costo y a precio de venta?
5. ¿Qué parte del resultado se puede estimar con los costos que hay, y qué falta para conocer la
   rentabilidad?

**Fuera de alcance (no se presenta como hecho):** costo promedio ponderado, contabilidad formal,
utilidad neta después de gastos generales, comisiones de pasarela, publicidad y fletes pagados.
Queda para E6 Fase 2 y siguientes.

## 2. Principios que no se negocian

- **`null` es desconocido; cero es un cero medido.** Nunca se rellena un desconocido con cero, ni
  «para que cuadre». Un canal sin datos dice «Sin datos suficientes», no «$0 vendido».
- **Nada se escribe.** Un reporte no crea movimientos de stock, ni caja, ni saldo (P5/P9). El único
  escritor de `StockActual` sigue siendo `registrarMovimiento` (03 §6.1).
- **La procedencia se conserva.** Cada operación sabe si viene del mostrador o de una tienda web,
  con su folio o número. No se insertan pedidos web como `Venta` (exigen turno de caja y moverían
  caja y stock).
- **Los nombres no mienten.** «Importe ajustado» no es «sin IVA»; «valor a precio de venta» no es
  dinero disponible; «margen estimado» no es «utilidad».

## 3. Vocabulario

| Término | Definición exacta |
|---|---|
| Operación | Una venta del mostrador o un pedido de una tienda web. Un pago mixto **no** son dos operaciones. |
| Importe antes de reembolsos | Importe comercial del período con impuestos y, en las webs, los cargos y el envío que el pedido cobró. Excluye cargas de monedero. |
| Reembolsos | Devoluciones del mostrador (`Devolucion.monto`) y reembolsos de Woo (`PedidoCanal.montoReembolsado`) conocidos a la fecha de consulta. |
| Importe ajustado | Importe antes de reembolsos − reembolsos. **No** es un valor sin impuestos. |
| Aporte % | Importe ajustado del canal / importe ajustado de todos los canales del universo consultado. Denominador no positivo → «No calculable». |
| Unidades netas | Unidades comerciales vendidas − unidades devueltas identificadas. Un reembolso de solo dinero no resta unidades. |
| Ticket promedio ajustado | Importe ajustado / operaciones. Sin operaciones → «—». El total se recalcula: no se promedian promedios. |
| Cobertura | Qué parte del universo tiene el dato que se está usando (costo, mapeo, historial). Se expresa en líneas, importe, unidades o SKU, nunca «por valor de lo desconocido». |

## 4. Consolidación de las dos fuentes

`src/api/reportes/consolidado.ts` normaliza y `src/dominio/analisis.ts` agrega. Unicidad: la
`Venta.idempotencyKey` y el par `(PedidoCanal.canalId, externoId)` que ya existen; no hay proyección
nueva, así que reingerir un pedido actualiza la misma fila y **no duplica**.

| Canal | Identificador | Fuente operativa |
|---|---|---|
| Tienda física | `tienda_fisica` | `Venta` + `VentaLinea` + `Devolucion` |
| onplay.cl | `onplay_cl` | `PedidoCanal` + `PedidoCanalLinea` |
| onplaygames.cl | `onplaygames_cl` | `PedidoCanal` + `PedidoCanalLinea` |

El catálogo se lee de `Canal`: no hay tres valores escritos a mano y los canales inactivos con
ventas históricas se conservan. Medio de pago, vendedor, ubicación y categoría son dimensiones
distintas, no canales. WhatsApp, Instagram o ferias necesitan atribución explícita: extensión
futura, sin reclasificar nada por suposición.

**Reglas de estado**

- POS: `completada` suma; `anulada` no suma y se cuenta aparte.
- Web: criterio operativo de venta `processing`/`completed` (el mismo de E3 §8). `cancelled`,
  `refunded` y `failed` no suman. **Un pedido ya ingerido (o sea, pagado) que aparece cancelado sin
  reembolso registrado queda `en revisión`**: no se inventa una devolución de dinero.
- Cargas de saldo (`SRV-000001`) se restan del importe comercial y se informan aparte. La venta
  pagada con monedero se cuenta **una vez**, como venta de productos.
- Pagos, aperturas de caja e ingresos/retiros nunca suman a ventas.
- Una operación en moneda distinta de CLP queda fuera de los importes y se informa aparte.

**Importes por línea.** En la web manda `PedidoCanalLinea.totalLinea` (total del canal, más su
impuesto); si el canal no lo entregó se usa `cantidad × precioUnitario` como respaldo. El reembolso
del pedido se reparte entre las líneas por importe, con resto mayor, de modo que la suma cuadra
exacta. Lo que el pedido cobró y no está en ninguna línea (envío, cargos) **no se reparte a
escondidas**: se informa como «no atribuible».

**Tiempo.** Zona `America/Santiago`, almacenamiento UTC, límites `[inicio local, inicio del día
siguiente)`, tope de 400 días (el mismo de R-026). `src/api/fechas.ts` es la única definición y la
comparte el reporte por usuario. Se agrupa por fecha de origen: `Venta.creadoEn` y
`PedidoCanal.creadoEnCanal`. Rótulo obligatorio: «Ventas originadas en el período, ajustadas por
devoluciones conocidas a la fecha de consulta». No es una vista de flujo de caja.

**Migración `20260922192554_r036_analisis_comercial`** (aditiva, todo opcional):
`PedidoCanal.moneda/totalImpuestos/totalEnvio/totalDescuento`,
`PedidoCanalLinea.totalLinea/impuestoLinea/costoUnitario/costoFuente/costoEn`,
`VentaLinea.costoUnitario/costoFuente/costoEn`, enum `CostoFuente {referencia, promedio}`.

**Corrección a la ingesta (E3 §8.2).** La rama «cambio sin efecto en el maestro» solo actualizaba
marcas: un reembolso de solo dinero no llegaba al reporte. Ahora refresca los importes del pedido y
de sus líneas —sin repetir movimientos de stock ni reposiciones— y el motivo pasa a ser «cambio sin
efecto en el stock: solo se actualizaron los importes».

## 5. Matriz por canal

`GET /reportes/canales`. Columnas: operaciones, unidades netas, importe antes de reembolsos,
reembolsos, importe ajustado, aporte %, ticket promedio, margen estimado y cobertura de costo.
Además: anuladas, reembolsadas por completo, en revisión, cargas de monedero y operaciones en otra
moneda.

Filtros: rango de fechas, agrupación día/semana/mes, canal, categoría (subárbol), juego y tipo.
Comparación con el período anterior de igual duración (`comparar=true`).

**Los filtros de producto operan por línea.** Cuando hay filtro de categoría, juego o tipo, el
universo se reconstruye desde las líneas que coinciden: un pedido no entra entero por tener una
coincidencia, y la participación se calcula sobre mercadería identificada, con el envío y los cargos
no atribuibles informados aparte. La pantalla lo dice cuando `filtrado` es true.

La segunda matriz cruza canal × categoría (`/reportes/canales/categorias`), con «Sin clasificar»
para las líneas sin producto mapeado: **esos ingresos no se pierden**. Hay evolución por período y
exportación CSV con los mismos filtros y definiciones (UTF-8 con BOM, CRLF, textos protegidos contra
fórmulas de Excel).

## 6. Margen: qué se puede afirmar

`Producto.costoReferencia` es el **último costo unitario bruto** recibido (E6), no un promedio ni un
costo histórico. Sobre eso:

1. **Captura inmutable.** `POST /ventas` congela `costoUnitario`, `costoFuente` y `costoEn` en cada
   línea, **dentro de la misma transacción** que crea la venta. Sin costo conocido queda `null`.
   La ingesta web congela el costo **conocido al ingerir**, que no es el costo vigente hoy.
2. **Histórico sin costo congelado → margen «No disponible».** Una opción explícita
   (`costoActual=true`, apagada por defecto) estima a costo de hoy y queda rotulada como estimación.
   Nunca se rellena el histórico en silencio.
3. **`null` ≠ 0.** Servicios, ítems sueltos, productos sin mapear y premios no tienen costo cero
   automático. Un cero registrado y justificable sí cuenta como costo cero.
4. **Fórmula.** Margen = ingreso de las líneas con costo conocido − costo imputado a esas mismas
   líneas, descontando devoluciones. El costo de las unidades devueltas **sin reposición** (dañadas)
   se conserva como pérdida y no desaparece del resultado. Woo no informa reposición: ahí no se
   asume pérdida y se declara la limitación.
5. **Cobertura** por líneas y por importe comercial. Con cobertura parcial se presenta el resultado
   del subconjunto conocido; el margen total de la empresa queda **no disponible**.
6. **Etiqueta visible:** «Margen estimado sobre importes con impuestos, antes de comisiones y
   gastos». No se muestra «utilidad neta».

## 7. Inventario valorizado

`GET /reportes/inventario-valorizado`, al corte actual, con fecha y hora. Cantidades: solo
`StockActual`, conciliable con `MovimientoStock`.

- No se suma `ProductoCanal.stockCanal` (espejo de lo publicado) ni se repite una unidad por estar
  publicada en dos webs. El inventario no se reparte entre canales sin una regla real.
- Los productos inactivos con existencias **sí** entran, marcados. Los saldos en ubicaciones
  inactivas se muestran.
- Productos sin control de stock: cantidad y valor **desconocidos**, contados aparte.
- Los negativos (excepción de R-016: pedido web pagado) se muestran con su importe como
  discrepancia; nunca se esconden con `Math.max(0, cantidad)`.
- Precio 0 = «sin precio puesto»: no valoriza a cero.

```text
valorCostoReferencia = cantidad × Producto.costoReferencia
valorPrecioVenta     = cantidad × Producto.precioVenta
diferenciaPotencial  = valorPrecioVenta − valorCostoReferencia   (solo con AMBOS conocidos)
```

Medida: **«Inventario a costo de referencia — estimado»**. El valor a precio de venta es potencial
comercial, no efectivo ni utilidad. Tarjetas: valor a costo, valor a precio, unidades positivas,
SKU con existencias, unidades y SKU sin costo, discrepancias negativas y cobertura de valorización
(por unidades y por SKU). Tabla con agrupación y filtros (sin costo, bajo stock, negativos,
inactivos, sin control) y CSV. **No** hay valorización histórica con costos de hoy: la vista es del
corte actual mientras no exista historia de costos.

## 8. Implementación

- Node 22 + Fastify + Prisma 5 + React/Vite/Tailwind, un paquete y un proceso (P6). Sin
  dependencias de gráficos.
- Reglas puras en `src/dominio/analisis.ts`; consultas en `src/api/reportes/*`; rutas en
  `src/api/rutas/reportes.ts`. La pantalla y el CSV consumen **el mismo cálculo**.
- Rutas (todas `GET`, encargado+): `/reportes/canales`, `/reportes/canales/categorias`,
  `/reportes/inventario-valorizado`, `/reportes/calidad-datos` y sus `.csv`.
- Los costos viven solo en estas rutas. Se cerraron dos filtraciones al construir: `GET /productos`
  quita `costoReferencia` cuando quien pregunta no alcanza rol encargado, y el detalle de venta
  (`GET /ventas`, `/ventas/:id`, `/mis-ventas`) devuelve la línea sin el costo congelado. El
  buscador del mostrador y el catálogo offline nunca los trajeron.
- Importes CLP enteros; prorrateo determinista con resto mayor; cada relación se agrega antes de
  unirse para que un pedido con varios pagos o reembolsos no multiplique importes.
- 422 del rango: `RANGO_INVALIDO`, `RANGO_INVERTIDO`, `RANGO_DEMASIADO_GRANDE`.

## 9. Criterios de aceptación

| # | Criterio | Estado |
|---|---|---|
| 1 | Física $100.000 + onplay $60.000 + onplaygames $40.000 → $200.000 y 50/30/20 | ✅ test de dominio |
| 2 | Devolución $10.000 y reembolso parcial $5.000 → $185.000, suma exacta | ✅ test de dominio |
| 3 | Reingerir un pedido no duplica importes ni movimientos | ✅ unicidad `(canalId, externoId)`; idempotencia verificada por HTTP |
| 4 | Reembolso de solo dinero actualiza el reporte y no repone stock | ✅ corrección de §4 (pendiente de verlo con un reembolso real en staging) |
| 5 | Anulada, cancelado, reembolso total, pendiente y pago mixto | ✅ test de dominio |
| 6 | Carga $20.000 + venta $20.000 con saldo → ingreso comercial $20.000 | ✅ test de dominio |
| 7 | 10 + 5 unidades, costo 1.000 y precio 1.500 → $15.000 y $22.500; publicar no altera | ✅ test de dominio |
| 8 | Sin costo, cero validado, sin control, servicio, inactivo con stock y negativo, separados | ✅ test de dominio |
| 9 | Cambiar el costo no altera una captura congelada; la estimación se identifica | ✅ verificado por HTTP (`costoActual`) |
| 10 | Devolución dañada vs. con reposición: costo consistente | ✅ test de dominio |
| 11 | Filtro de categoría no arrastra pedidos completos | ✅ verificado por HTTP: la matriz filtrada cuadra con la suma de categorías |
| 12 | Totales de pantalla, detalle y CSV coinciden; rango inválido, sin resultados, denominador cero | ✅ CSV desde el mismo cálculo; 422 verificados |
| 13 | Vendedor 403 en reportes y exportaciones | ✅ verificado por HTTP |
| 14 | La carga histórica analítica no toca stock, caja, monedero ni marcas | ⏳ no construida (agendada, §10) |

## 10. Lo que falta para cobertura completa

Datos operativos, no código:

1. **Historial de pedidos web anterior a la primera ingesta.** Hoy la web parte de la marca de agua
   de E3. La carga histórica **analítica** (rango, simulación, paginación, progreso, reanudación,
   unicidad, sin tocar stock/caja/saldo/marcas) queda **agendada**, no construida (P1).
2. **Costos de compra** de los productos sin `costoReferencia`: llegan cargando facturas (E6).
3. **Mapeo** de las líneas de pedidos web sin producto (V14).
4. **Recuento inicial** de los productos sin control de stock.

`GET /reportes/calidad-datos` enumera estos pendientes junto con la cobertura real.

## 11. Lo que el prompt decía y lo que había

- **Confirmado:** canales de la semilla; dos fuentes separadas; el reporte por usuario no consolida
  webs ni devoluciones; `stockCanal` es espejo; no había costo congelado; tope de 400 días.
- **Matiz:** `PedidoCanal` ya guardaba `total` y `montoReembolsado`; lo que faltaba era el desglose
  por línea (impuestos, envío, descuentos, moneda), agregado en esta migración.
- **Defecto real encontrado y corregido:** la rama de `procesarPedido` que solo actualizaba marcas
  (§4).
