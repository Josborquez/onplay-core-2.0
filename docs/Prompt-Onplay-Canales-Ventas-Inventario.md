# Prompt de implementación — Canales de venta y valor del inventario

Preparado el 22 de septiembre de 2026 para Claude Code o Codex.

## Revisión que fundamenta este prompt

Repositorio: https://github.com/Josborquez/onplay-core-2.0

Commit revisado: `d808adcc21afd4cd46217505d262d97e60c571cd`, del 21 de septiembre de 2026. Se revisaron código, esquema y especificaciones; no se consultó la base de producción ni se calcularon cifras reales de la empresa. Este entregable es un prompt; no se modificó la aplicación.

| Hallazgo verificado | Consecuencia para la implementación |
|---|---|
| `Canal` y `src/api/arranque/semillas.ts` identifican `tienda_fisica`, `onplay_cl` y `onplaygames_cl`. | Reutilizar esos tres canales. |
| El POS escribe `Venta`/`VentaLinea`; WooCommerce escribe `PedidoCanal`/`PedidoCanalLinea`. | Consolidar ambas fuentes sin crear ventas POS ficticias. |
| `ReporteVentas.tsx` consulta `/ventas/resumen-usuarios`, que suma `Venta.total` de ventas completadas. | El reporte actual no consolida las webs ni descuenta devoluciones. |
| `StockActual` mantiene cantidades por producto y ubicación; `ProductoCanal.stockCanal` es un espejo externo. | El stock de las webs no se suma al inventario propio. |
| `Producto.costoReferencia` existe; `VentaLinea` y `PedidoCanalLinea` no congelan costos. | La valorización inicial será a costo de referencia; el margen histórico no está garantizado. |
| E6 tiene compras implementadas y costo promedio/márgenes agendados. | Definir una ampliación acotada de E6 y actualizar su SDD. |
| `SRV-000001` registra cargas de monedero como líneas de venta. | Separarlas del ingreso comercial para evitar doble conteo cuando se usa el saldo. |
| La ingesta Woo comienza desde una marca de agua, y no es una importación de todo el historial. | Mostrar cobertura; cargar historial analítico sin volver a descontar stock. |

---

## PROMPT PARA COPIAR DESDE AQUÍ

Actúa como desarrollador senior del proyecto `onplay-core-2.0`. Implementa un módulo de **Análisis comercial e inventario** integrado al POS/ERP existente.

### 1. Objetivo de negocio y alcance autorizado

Necesito responder con datos trazables:

1. ¿Cuáles son nuestros canales de venta?
2. ¿Cuánto vende cada canal y qué porcentaje representa del total de la empresa?
3. ¿Qué productos, categorías y juegos aportan a cada canal?
4. ¿Cuánto vale el inventario disponible a costo de referencia y a precio de venta?
5. ¿Qué parte de los resultados puede estimarse con los costos conocidos y qué información falta para conocer la rentabilidad?

La empresa tiene tienda física y las webs onplay.cl y onplaygames.cl. Esta instrucción autoriza desarrollar la ampliación descrita, incluyendo especificación, migraciones aditivas, backend, interfaz y pruebas en desarrollo. Actualiza el alcance de E6 y registra las decisiones en la bitácora para respetar P1. No te detengas solamente en un diagnóstico ni implementes otras funcionalidades del roadmap. No despliegues ni ejecutes cargas o cambios sobre producción con esta instrucción.

Entrega un MVP completo con canales, matriz de aporte, valorización y calidad de datos. El costo promedio ponderado, contabilidad formal y utilidad neta después de gastos generales quedan para una fase posterior; no los presentes como implementados.

### 2. Inspección inicial obligatoria

Lee las instrucciones vigentes del repositorio, incluyendo `AGENTS.md` si existe y `CLAUDE.md`. Verifica el commit actual: esta propuesta se preparó sobre `d808adcc21afd4cd46217505d262d97e60c571cd` y puede haber cambios posteriores.

Revisa especialmente:

- `docs/01-SDD-general.md`, `docs/03-SDD-etapa2-inventario.md`, `docs/06-SDD-etapa3-sincronizacion.md`, `docs/07-SDD-etapa4-cliente-monedero.md`.
- `docs/08-bitacora-revision.md`, `docs/10-SDD-onplay-core-2.0-web-app.md`, `docs/11-SDD-etapa6-compras.md` y `docs/13-importaciones-costo-chile.md`.
- Las especificaciones y componentes vigentes de diseño.
- `prisma/schema.prisma`, `src/api/arranque/semillas.ts`.
- `src/api/rutas/ventas.ts`, `devoluciones.ts`, `compras.ts`, `stock.ts`, `canales.ts` y `sincronizacion.ts`.
- `src/api/sync/pedidos.ts`, `src/api/stock/libro.ts`, `src/woo/tipos.ts`, `src/woo/cliente.ts`.
- `src/dominio/venta.ts`, `devolucion.ts`, `compra.ts`, `sync.ts`.
- `src/web/pantallas/admin/ReporteVentas.tsx`, `Stock.tsx`, `PedidosOnline.tsx`, `src/web/App.tsx`, `src/web/components/BarraLateral.tsx` y `src/web/api.ts`.

Entrega un diagnóstico breve de lo que se reutiliza y lo que falta; continúa luego con la implementación. No supongas que los comentarios antiguos describen mejor el comportamiento que el código actual.

### 3. Clasificación de canales

| Canal | Identificador existente | Fuente operativa |
|---|---|---|
| Tienda física | `tienda_fisica` | `Venta` + `VentaLinea` + `Devolucion` |
| onplay.cl | `onplay_cl` | `PedidoCanal` + `PedidoCanalLinea` |
| onplaygames.cl | `onplaygames_cl` | `PedidoCanal` + `PedidoCanalLinea` |

Consulta `Canal` como catálogo; no dupliques estos registros ni limites toda la lógica a tres valores escritos a mano. Conserva canales inactivos que tengan ventas históricas.

Cada operación pertenece a un único canal. Un retiro en tienda de una compra web sigue perteneciendo a la web. Medio de pago, vendedor, ubicación de stock y categoría son dimensiones distintas. Eventos, singles, sellado, snacks y accesorios son líneas de negocio o categorías; no inventes canales para ellos. WhatsApp, Instagram o ferias requieren datos de atribución explícitos: déjalos como futura extensión, sin reclasificar ventas por suposición.

### 4. Consolidación y calidad de datos

Construye un servicio común de lectura que normalice las dos fuentes. Mantén la procedencia de cada operación (`fuente`, ID interno, canal y número/folio). No insertes pedidos web en `Venta`: exige turno de caja y podría alterar caja y stock.

Utiliza la unicidad de `Venta.idempotencyKey` y de `(PedidoCanal.canalId, externoId)`. Si agregas una proyección analítica, impón una clave única por fuente y operación; una recarga o reingesta debe actualizarla sin duplicar importes. No deduzcas duplicados solo por coincidencia de fecha y monto.

Reglas del MVP:

- POS: partir de ventas completadas y restar las devoluciones de sus líneas. Las anuladas no aportan y se cuentan aparte.
- Woo: respetar el criterio actual `processing/completed` y marcarlo como criterio operativo de venta, sin confundirlo con conciliación bancaria. Separar cancelados y reembolsados. Restar reembolsos parciales una sola vez; un reembolso total confirmado deja importe cero.
- Una cancelación pagada sin información suficiente sobre el reembolso debe generar un estado de revisión, no una devolución de dinero inventada.
- No usar `cantidad × precioUnitario` de Woo como reemplazo de `pedido.total`: el precio unitario puede ser neto, llevar decimales y no incluir impuestos/envío.
- Ampliar la captura financiera, cuando sea necesario, para conservar totales por línea, impuestos, descuentos, envío, cargos, moneda y reembolsos. Conservar los importes autoritativos del origen y conciliar sus componentes.
- Inspeccionar la rama de `procesarPedido` que solo actualiza marcas cuando no encuentra cambios de cantidades: un reembolso monetario sin unidades o una modificación del total también debe actualizar los datos financieros. Actualizar la proyección financiera sin repetir movimientos de stock ni reposiciones.
- Los totales de pedidos sin productos mapeados siguen aportando al canal. Para análisis por categoría, usar «Sin clasificar» y mostrar cobertura; no perder esos ingresos.
- Excluir las cargas de saldo `SRV-000001` de ventas comerciales y mostrarlas como movimiento de monedero separado. La venta de productos pagada con monedero se incluye una sola vez. Conservar intactos arqueos y registros operativos.
- No sumar pagos, aperturas de caja, ingresos/retiros de caja o cargas de saldo al total de ventas. Pagos mixtos no multiplican operaciones.
- En ventas mixtas, repartir descuentos globales con el patrón existente de resto mayor. Separar exactamente la porción comercial y la del monedero, incluyendo sus devoluciones.
- Todos los importes agregados se expresan en CLP. Una operación en otra moneda sin conversión documentada queda fuera del total CLP y se informa; no tratar USD como CLP.

**Tiempo y cobertura:** usa `America/Santiago`, almacenamiento UTC y límites `[inicio local, inicio del día siguiente)`. Valida fechas reales, orden del rango y máximo razonable, siguiendo el límite existente de 400 días. Prueba cambios de horario de Chile.

Para el MVP, agrupa por fecha de origen: `Venta.creadoEn` y `PedidoCanal.creadoEnCanal`. Rotula el reporte «Ventas originadas en el período, ajustadas por devoluciones conocidas a la fecha de consulta». Incluye la fecha de consulta y explica que una devolución posterior puede cambiar un período anterior. No mezcles este criterio con una vista de flujo de caja por fecha de reembolso.

Muestra última sincronización, primera fecha disponible y si hay lagunas, fallos o carga histórica incompleta. Un canal sin datos importados debe decir «Sin datos suficientes», no afirmar $0 vendido. Una primera fecha disponible no prueba por sí sola cobertura completa.

Si se necesita completar historial, implementa una tarea de importación **exclusivamente analítica**, con rango, simulación, paginación, progreso, reanudación y unicidad. No reutilices sin cambios la ingesta operativa: no debe modificar stock, caja, saldo de clientes, interruptores de publicación ni marcas de agua operativas. Puede usar una proyección separada para distinguir pedidos solo históricos de los operativos; ambas fuentes deben reconciliarse por canal e ID externo.

### 5. Matriz de aporte por canal

Agregar en Reportes una vista «Canales de venta», sin eliminar el reporte por usuario.

Matriz principal:

| Canal | Operaciones | Unidades netas | Importe antes de reembolsos | Reembolsos | Importe ajustado | Aporte % | Ticket promedio | Margen estimado* | Cobertura de costo |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Tienda física | | | | | | | | | |
| onplay.cl | | | | | | | | | |
| onplaygames.cl | | | | | | | | | |
| Total | | | | | | | | | |

Definiciones obligatorias:

- Importe antes de reembolsos: total comercial tras descuentos, excluidas cargas de monedero; incluye los impuestos y, en las webs, los cargos/envío incluidos en el total del pedido.
- Importe ajustado = importe anterior − reembolsos comerciales correspondientes. No llamar «sin IVA» a este valor.
- Aporte % = importe ajustado del canal / importe ajustado de todos los canales del universo seleccionado × 100. Si el denominador no es positivo, mostrar «No calculable». Si la cobertura es parcial, decir «Participación sobre datos disponibles».
- Operaciones: ventas comerciales válidas del período; un reembolso total mantiene la operación original en el conteo, y se informa también el número de operaciones totalmente reembolsadas. No contar operaciones de solo carga de saldo.
- Ticket promedio ajustado = importe ajustado / operaciones, con esa definición visible. Sin operaciones, mostrar «—».
- Unidades netas = unidades comerciales vendidas − unidades devueltas identificadas. Un reembolso solo de dinero no implica unidades devueltas.
- Totales y porcentajes se calculan sobre todo el resultado filtrado, no sobre la página visible. El total del ticket promedio se recalcula; no se promedian promedios ni márgenes porcentuales.

Agrega desglose que concilie mercadería/servicios, descuentos, envío, cargos, impuestos y reembolsos cuando existan datos. Si falta desglose, conserva el total del pedido y muestra «Desglose no disponible»; no asignes envío ni impuestos a productos arbitrariamente.

Permite rango de fechas, comparación con período anterior de igual duración y filtros por canal, categoría/subcategoría, juego y tipo de producto. Una segunda matriz cruza canales × categorías con monto y porcentaje. Los filtros de producto/categoría operan a nivel de línea, no incluyen el pedido completo por contener una coincidencia. Para esos filtros, calcula participación sobre mercadería/servicios identificados; identifica envío/cargos/reembolsos no atribuibles por separado y concilia el total sin repartirlos de forma oculta.

Incluye una evolución diaria/semanal/mensual y exportación CSV con los mismos filtros y definiciones. No es necesario agregar una dependencia de gráficos pesada.

### 6. Margen y aporte económico: límites explícitos

El primer aporte que se debe conocer es participación en ventas. El margen es una segunda medida y debe declarar cómo se obtuvo.

Actualmente `Producto.costoReferencia` es el último costo unitario registrado, no un promedio ni un costo histórico congelado. Las compras guardan componentes netos e impuestos; el código de recepción utiliza `CompraLinea.costoUnitario`, calculado sobre el total. En importaciones, también existen componentes de IVA recuperable. Respeta ese comportamiento y no renombres el costo bruto como costo contable neto.

Implementa:

1. Captura inmutable del costo de referencia disponible para nuevas líneas POS, con fecha, método y calidad. Hazlo dentro de la misma transacción que crea la venta. En pedidos web, distingue costo conocido al importar de costo vigente al vender: no son necesariamente iguales.
2. Histórico sin costo congelado: por defecto margen «No disponible». Una opción explícita puede mostrar una estimación a costo de referencia actual, claramente rotulada y separada del costo congelado. No rellenar históricos silenciosamente con el costo de hoy.
3. `null` significa desconocido; cero solo es un costo cero registrado y justificable. Servicios, ítems sueltos, productos sin mapear y premios no tienen automáticamente costo cero.
4. Margen estimado en CLP = ingreso de las líneas con base comparable − costo de referencia imputado a esas mismas líneas. Descontar devoluciones y separar pérdidas por artículos devueltos sin reposición, para que el costo del artículo dañado no desaparezca del resultado. Si Woo no permite verificar reposición, indicar esa limitación.
5. Margen % = margen estimado / ingreso de esas mismas líneas × 100. Mostrar cobertura por líneas y por importe comercial. Con cobertura parcial, presentar resultado del subconjunto conocido; el margen total de empresa queda no disponible.
6. Etiqueta visible: «Margen estimado sobre importes con impuestos, antes de comisiones y gastos». No mostrar «utilidad neta» ni mezclar ventas sin impuestos con costos con impuestos.

No inventes tasas de pasarelas, publicidad, fletes pagados, arriendo, remuneraciones o impuestos. La futura contribución después de costos variables requiere importes reales y una base tributaria homogénea; deja ese alcance documentado. No es condición para entregar el MVP.

### 7. Inventario valorizado

Agregar una vista «Valor del inventario» con fecha/hora de corte actual. Fuente única de cantidades: `StockActual`, conciliable con `MovimientoStock`.

Reglas:

- No sumar `ProductoCanal.stockCanal`: es el espejo de existencias publicadas, no inventario adicional.
- No repetir una unidad por estar publicada en ambas webs. El inventario propio se valora por producto y ubicación; no se reparte entre canales sin una regla real de asignación.
- Incluir existencias propias de productos inactivos; mostrarlas con su estado. Si aparecen saldos en ubicaciones inactivas, señalarlos y permitir verlos para que no desaparezcan del patrimonio operativo.
- Productos sin control de stock: cantidad y valor desconocidos, separados; no asumir cero. Servicios y cargas de saldo no son inventario físico.
- El libro permite excepcionalmente negativos por pedidos web pagados. Mostrar cantidades negativas y su importe a costo conocido como discrepancias. No esconderlos con `Math.max(0, cantidad)`.
- Presentar existencias positivas valorizadas, saldo negativo valorizado por separado y saldo algebraico del libro. Explicar que un saldo negativo es una inconsistencia por resolver, no un activo físico negativo.
- Costo desconocido: `null`; mostrar unidades y SKU sin valorizar. Costo cero validado es distinto.

Fórmulas para cada fila con datos conocidos:

```text
valorCostoReferencia = cantidad × Producto.costoReferencia
valorPrecioVenta = cantidad × Producto.precioVenta
diferenciaPotencial = valorPrecioVenta − valorCostoReferencia
```

Nombre de la medida inicial: **«Inventario a costo de referencia — estimado»**. Valor a precio de venta es potencial comercial; no es efectivo disponible ni utilidad realizada. La diferencia potencial se calcula solo sobre unidades con ambos valores conocidos, sin comparar un costo parcial con el precio de venta de todo el inventario.

Tarjetas: valor positivo a costo conocido, valor positivo a precio de venta, unidades físicas positivas registradas, SKU con existencias, unidades/SKU sin costo, discrepancias negativas y cobertura de valorización. Define cobertura por unidades y SKU; no calcules porcentaje por valor de un costo desconocido.

Tabla: SKU, producto, categoría, juego, ubicación, estado, cantidad, costo unitario, método/fecha de costo si existe, valor a costo, precio de venta, valor potencial y calidad del dato. Permite agrupar por ubicación/categoría/juego y filtrar sin costo, bajo stock, negativos e inactivos. Exporta CSV.

No ofrezcas una valorización histórica usando cantidades antiguas con costos o precios actuales como si fueran históricos. Si todavía no existe historia de costos, limita la vista al corte actual.

### 8. Implementación técnica

- Mantener Node 22, TypeScript, Fastify, Prisma 5/MySQL-MariaDB y React/Vite/Tailwind del repositorio. Un paquete, un proceso y una base; no agregar microservicios ni infraestructura externa.
- Proponer y documentar contratos tipados. Rutas orientativas bajo `/api/v1`: `/reportes/canales`, `/reportes/canales/categorias`, `/reportes/inventario-valorizado`, `/reportes/calidad-datos` y sus CSV. Ajustar nombres si existen equivalentes.
- Separar reglas puras en `src/dominio` de consultas y agregaciones en servicios de API. UI y CSV consumen el mismo cálculo.
- Reutilizar el formato CLP y componentes existentes. En cada tarjeta explicar qué se está midiendo en lenguaje simple.
- Proteger endpoints, detalles y exportaciones para encargado/admin en servidor, además de ocultarlos a vendedor. Los costos no deben filtrarse en respuestas de POS o catálogo offline por ampliar un `include` de Prisma.
- Usar migraciones aditivas, campos nuevos opcionales para históricos e índices por filtros reales. No editar migraciones ya aplicadas ni rellenar costos desconocidos con cero.
- Mantener `registrarMovimiento` como único escritor de `StockActual`, los libros append-only, el orden de bloqueos y la idempotencia. Un reporte no crea movimientos.
- No alterar los checkout, publicación de productos, precios, stock web o caja al consultar reportes. Respetar `SYNC_SOLO_LECTURA` y los interruptores existentes.
- Importes CLP enteros, prorrateos deterministas y sumas exactas; verificar rango seguro en agregaciones. Conservar precisión del origen hasta el redondeo y hacer explícitas diferencias de conciliación.
- Evitar multiplicar totales por joins entre pagos, líneas y devoluciones. Agregar cada relación antes de unirla y probar pedidos con múltiples pagos y múltiples reembolsos.
- Evitar N+1 y calcular totales sobre el conjunto completo. UI con detalle paginado; exportación con límites o procesamiento por lotes. Si hay tareas largas, reutilizar el patrón de segundo plano del proyecto.
- CSV UTF-8 con BOM, escape correcto y protección ante fórmulas de Excel en textos; descargar con la autenticación existente.

### 9. Criterios de aceptación y pruebas

Usa fixtures controlados, identificados como datos de prueba. No inventes resultados reales de la empresa.

1. Tres operaciones comerciales sin devoluciones: física $100.000, onplay.cl $60.000 y onplaygames.cl $40.000. Consolidado $200.000; aportes 50%, 30% y 20%.
2. Devolución física $10.000 y reembolso parcial onplay.cl $5.000: consolidado $185.000. La suma por canales coincide exactamente; porcentajes redondeados sin modificar importes.
3. Reingestar un pedido o sincronizarlo varias veces no duplica operaciones, ingresos, costos ni movimientos.
4. Un reembolso Woo de monto sin cantidades actualiza el reporte aunque no cambien las unidades; no repone stock automáticamente.
5. Venta anulada, pedido cancelado, reembolso total, pedido pendiente y pago mixto tienen los comportamientos documentados. Las filas con datos insuficientes no se convierten silenciosamente en ceros.
6. Carga de monedero $20.000 seguida de venta de producto $20.000 pagada con saldo: ingreso comercial $20.000. Probar también venta mixta, descuento global y devolución al monedero.
7. Diez unidades en mostrador y cinco en bodega, costo $1.000 y precio $1.500: inventario a referencia $15.000 y a venta $22.500. Publicar esas existencias en dos webs no modifica esos valores.
8. Producto sin costo, costo cero validado, sin control, servicio, producto inactivo con stock y stock negativo se presentan separados según su naturaleza.
9. Cambiar el costo actual no cambia una captura congelada; la estimación explícita a costo actual sí se identifica como variable. No se fabrica costo histórico durante backfill.
10. Devolución dañada sin reposición y devolución con reposición producen tratamientos de costo consistentes. Ingreso y costo parcial usan el mismo universo de líneas.
11. Filtros de categoría no suman pedidos completos ni duplican descuentos; envío/cargos no asignables permanecen conciliados aparte.
12. Totales de pantalla, detalle y CSV coinciden. Probar sin resultados, denominador cero, rango inválido, medianoche, cambio de horario, fin de mes y comparación con período anterior sin ventas.
13. Vendedor recibe 403 en endpoints y exportaciones restringidos y no obtiene costos por endpoints existentes. Encargado/admin acceden.
14. La carga histórica analítica no cambia `MovimientoStock`, `StockActual`, caja, monedero ni marcas de agua operativas. Probar interrupción/reanudación y solapamiento con pedidos ya ingeridos.

Ejecuta pruebas focalizadas de dominio y API con base desechable cuando corresponda, `npm run typecheck`, validación Prisma y `npm run build`. No conectes tests a producción: el test del migrador del proyecto crea y borra una base de prueba. Informa lo ejecutado y cualquier comprobación bloqueada por el entorno.

### 10. Orden de entrega

1. Diagnóstico y SDD de esta ampliación con definiciones, cobertura y alcance.
2. Modelo/proyección financiera mínima, captura de costos y correcciones necesarias de actualización de importes web.
3. Consolidación, matriz por canales y detalle por categorías.
4. Valorización de inventario y calidad de datos.
5. Interfaz, CSV, pruebas y documentación de carga histórica analítica.

Al finalizar entrega resumen de cambios, archivos relevantes, migraciones, pruebas ejecutadas y guía breve para el encargado. Indica qué cifras son observadas, estimadas, parciales o no calculables. Enumera los datos operativos necesarios para completar cobertura —recuentos, costos, mapeos e historial de pedidos— sin afirmar que ya están cargados.

El resultado debe permitir conocer el aporte comercial de cada canal y el capital aproximado representado por el inventario registrado, con acceso al detalle que explica cada total.

## FIN DEL PROMPT
