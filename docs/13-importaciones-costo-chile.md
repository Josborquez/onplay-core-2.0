# 13 — Costo de importación en Chile: qué se paga, quién lo cobra y cómo entra al sistema

| | |
|---|---|
| **Proyecto** | `onplay-core` 2.0 · Etapa 6 (compras) |
| **Fecha** | 11 de septiembre de 2026 (revisado el mismo día con los documentos reales de `docs/pdf/INTERNACIONAL/`) |
| **Estado** | Recopilación para el dueño (R-030), **confirmada con dos importaciones reales completas y una por courier**. C12b **construido el 2026-09-11** (R-031) tras confirmar el dueño que el contador recupera el IVA; §7 describe lo hecho |
| **Fuentes** | Aduana de Chile ([preguntas frecuentes de importación](https://www.aduana.cl/todas-las-preguntas-frecuentes-para-importaciones/aduana/2007-02-28/161116.html), [¿cuánto impuesto se paga al importar?](https://www.aduana.cl/cuanto-impuesto-se-paga-al-importar/aduana/2022-06-29/121230.html), [valoración de mercancías](https://www.aduana.cl/valoracion-de-mercancias/aduana/2019-01-04/161839.html), [TLC Chile–EE. UU.](https://www.aduana.cl/tratado-de-libre-comercio-chile-estados-unidos/aduana/2007-07-11/153552.html)), Ley del IVA art. 23 vía [Laudus](https://laudus.cl/contabilidad/el-iva-de-las-importaciones/), UPS Chile ([aranceles](https://www.ups.com/cl/es/shipping/international-shipping/tariffs)), [Aduanas Salazar](https://aduanasalazar.cl/ad-valorem-impuestos-aduana-2026/), [Seguros Equos](https://www.segurosequos.com/blog-de-seguros/valor-aduanero); **documentos reales** en `docs/pdf/INTERNACIONAL/` (§0) |

---

## 0. Los documentos reales que dejó el dueño (`docs/pdf/INTERNACIONAL/`)

| Archivo | Qué es | ¿Tiene texto legible por `pdfjs`? |
|---|---|---|
| `127395-5.pdf` | **DIN** (Declaración de Ingreso) 1150127395-5, importación de junio de 2026 desde Coqui | **Sí** (551 celdas): FOB, flete, seguro, CIF, ad valorem, IVA, total giro, tipo de cambio y **un ítem por código de Coqui** (`BAN2850164`, `FAB2602`, `FAB2601`, `FAB2513`) con su CIF, arancel e IVA |
| `37433.pdf` | Factura 37433 del **agente de aduanas** (Julio Salinas Barrientos y Cía., RUT 86.334.100-0) por esa importación + factura UPS 1121112 + comprobante de pago a Tesorería | **No**: son imágenes escaneadas (0 celdas). Un lector automático necesitaría OCR |
| `37849.pdf` | Lo mismo para la importación de agosto de 2026 (DIN 1150127858-2, factura 37849, UPS 1128488, pago TGR) | **No** (escaneado) |
| `Facturas - 6R5A37NRYZD (1).pdf` | Factura UPS 1131950 de un envío chico (7,7 kg) despachado **por UPS sin agente**, septiembre de 2026 | **Sí** (105 celdas) |

Con eso quedan cubiertos los tres caminos: importación grande con agente (dos veces), envío chico por courier (una vez) y la DIN.

## 1. Los tres impuestos y la base sobre la que se calculan

| Concepto | Cómo se calcula | Confirmado en la DIN real |
|---|---|---|
| **Valor CIF** (base de todo) | costo de la mercancía (FOB) + **flete internacional** + **seguro** | 4.735,16 + 318,80 + 94,70 = 5.148,66 ✓ |
| **Derecho ad valorem** | **6 % del CIF** | 308,93 = 6 % de 5.148,66 ✓ (código 223) |
| **IVA de importación** | **19 % sobre (CIF + ad valorem)** | 1.036,93 = 19 % de 5.457,59 ✓ (código 178) |
| Seguro cuando no hay póliza | Aduana usa un **seguro presunto del 2 % del FOB** | 94,70 = 2 % de 4.735,16 ✓ y 162,85 = 2 % de 8.142,28 ✓ |
| Flete | el real del documento de transporte | 318,80 y 654,45: es el «Shipping & Handling» que cobra Coqui (UPS marca el envío `B/T: P/P`, flete pagado por el remitente) |

Los impuestos se pagan en **pesos** al tipo de cambio que fija Aduana para la fecha de la declaración («dólar aduanero»: 894,79 en junio, 935,57 en agosto), no al del día en que se pagó a Coqui. El giro se paga en Tesorería (formulario 15) antes de retirar la carga; en las dos importaciones lo pagó el agente con la provisión del dueño.

## 2. Umbrales que cambian el trámite (envíos por courier como UPS)

| Valor del envío | Qué pasa | Caso real |
|---|---|---|
| **≤ US$ 30 CIF** | Sin impuestos. No aplica a una compra comercial | — |
| **≤ US$ 1.000 FOB** | El courier hace la «declaración de importación» simplificada; se pagan igual ad valorem + IVA. No hace falta agente | Envío 6R5A37NRYZD (7,7 kg): UPS cobró impuestos + un «manejo» de US$ 72,45 |
| **> US$ 1.000 FOB** | **Obligatorio un agente de aduanas**; DIN normal | Despachos 127395 (US$ 4.735 FOB) y 127858 (US$ 8.142 FOB) |

## 3. Quién cobra qué: las cifras reales

### 3.1 Importación con agente (dos casos)

| | Junio 2026 · DIN 1150127395-5 | Agosto 2026 · DIN 1150127858-2 |
|---|---|---|
| Carga | 4 cajas, 56,7 kg, UPS aéreo desde Miami | 7 cajas, 131,5 kg |
| Dólar aduanero | 894,79 | 935,57 |
| FOB (Coqui) | US$ 4.735,16 | US$ 8.142,28 |
| Flete (S&H de Coqui) | US$ 318,80 | US$ 654,45 |
| Seguro presunto 2 % | US$ 94,70 | US$ 162,85 |
| **CIF** | **US$ 5.148,66 = $4.606.969** | **US$ 8.959,58 = $8.382.314** |
| Ad valorem 6 % | US$ 308,93 = **$276.427** | US$ 537,57 = **$502.934** |
| IVA importación 19 % | US$ 1.036,93 = $927.835 | US$ 1.804,46 = $1.688.199 |
| Giro pagado a Tesorería | $1.204.262 (18-06-2026) | $2.191.133 (12-08-2026) |
| Agente · honorarios | $71.506 | $71.649 |
| Agente · gastos de despacho | $40.788 | $40.849 |
| Agente · neto / IVA / total | $112.294 / $21.336 / $133.630 | $112.498 / $21.375 / $133.873 |
| UPS · «cargo terminal» | US$ 136,90 = $122.497 neto + IVA $23.274 = $145.771 | US$ 161,20 = $150.814 neto + IVA $28.655 = $179.469 |
| Total liquidación del agente (giro + UPS + su factura) | $1.483.663 | $2.504.475 |
| Provisión que adelantó el dueño / saldo a favor | $1.461.670 / $21.993 | $2.471.970 / $32.505 |

Lo que se aprende de los dos casos:

- **El agente cobra casi lo mismo sin importar el monto**: ≈ $112.400 netos por despacho (honorarios ≈ $71.500 + gastos ≈ $40.800; varía unos pesos, seguramente está en UF). Es un costo **fijo por importación**, no un porcentaje.
- **UPS cobra un «cargo terminal»** por la carga aérea (US$ 137 por 57 kg, US$ 161 por 132 kg: una parte fija y otra por peso). No cobra flete porque lo pagó Coqui.
- **La factura del agente incluye «pagos a terceros»** (el giro de Aduana y la factura de UPS que él pagó con la provisión). Esos montos **no son gasto del agente**: el ad valorem y el IVA salen de la DIN y el cargo terminal sale de la factura de UPS. Contabilizar la factura del agente por su «total liquidación» duplicaría todo.
- **La DIN reparte el CIF por ítem** (con el código de Coqui como nombre del ítem: `BAN2850164` CIF 2.812,93, 36 unidades a US$ 71,86 FOB; `FAB2602` 848,02; `FAB2601` 587,75; `FAB2513` 899,96) y calcula arancel e IVA por ítem. Es exactamente el prorrateo por monto que hoy hace `convertirLineasAClp`.

### 3.2 Envío chico por courier, sin agente (factura UPS 1131950, 07-09-2026)

| Concepto | USD | CLP (t/c 925,25) | ¿Costo? |
|---|---|---|---|
| «Declaración de importación» (ad valorem + IVA que UPS pagó por la tienda, «no facturable») | 162,56 | 150.409 | ad valorem sí; IVA no |
| «Manejo» (gestión aduanera de UPS, afecto) | 72,45 | 67.034 | sí |
| IVA sobre el manejo | | 12.737 | no (crédito) |
| Total a cobrar por UPS | | **230.180** | |

Por peso (7,7 kg) y fecha (envío UPS 6R5A37NRYZD, 07-09-2026) casi seguro es el invoice 097440 de Coqui (US$ 685,21, 01-09-2026), aunque la factura de UPS no lo dice. UPS **no desglosa** cuánto de los US$ 162,56 es arancel y cuánto IVA; hay que pedirle la DIN simplificada (sale a nombre de la tienda) para recuperar el IVA. Si Aduana valoró la mercancía en ≈ US$ 622 (162,56 ÷ 26,14 %), serían ≈ US$ 37 de arancel ($34.500) y ≈ US$ 125 de IVA ($115.900).

## 4. Qué es costo y qué es crédito fiscal (esto cambia el costo unitario)

La tienda es contribuyente de IVA (emite boletas con IVA), así que:

- **El IVA de importación es crédito fiscal**, igual que el IVA de una factura chilena: Ley del IVA art. 23, «el pagado por la importación de las especies al territorio nacional». Se recupera en el F29 con la **DIN** como documento (código 914 en el registro de compras). El IVA que UPS y el agente cobran sobre sus servicios también es crédito (facturas afectas).
- **El ad valorem NO se recupera**: es costo. Lo mismo el flete, el seguro, los honorarios y gastos del agente y el cargo terminal o manejo de UPS (netos).

**Costo puesto en la tienda de una importación**:

```
costo = FOB + flete (lo que se paga al proveedor)
      + ad valorem (6 % del CIF)                     ← de la DIN, en pesos
      + honorarios y gastos del agente (netos)       ← fijo, ≈ $112.400
      + cargo terminal / manejo de UPS (neto)
      + póliza de seguro, solo si se contrató una
```

y **fuera del costo**: IVA de importación e IVA de los servicios, y el **seguro presunto** (el 2 % lo agrega Aduana solo para calcular los impuestos; cuando no hay póliza no se le paga a nadie).

**Consecuencia para D-E6-1** (11-SDD §5.3, «costo unitario con IVA e impuestos específicos»): para el margen da lo mismo, porque el precio de venta también lleva IVA y el 19 % se cancela; pero **el costo contable real es sin IVA**. Recomendación: guardar en la compra **ambos** (neto y bruto) como ya se hace por línea, mostrar el margen sobre bruto como hoy, y que la Fase 3 (margen) reporte también sobre neto para el contador. En las importaciones el IVA no debe entrar a `gastosExtra` (hoy es un solo número y el dueño podría sumarlo por error).

## 5. Las dos importaciones reales, cerradas: costo puesto en la tienda vs. desembolso

| | Junio 2026 | Agosto 2026 |
|---|---|---|
| FOB en pesos (al dólar aduanero) | $4.236.974 | $7.617.673 |
| FOB + flete en pesos (lo pagado a Coqui) | $4.522.233 | $8.229.957 |
| + ad valorem | $276.427 | $502.934 |
| + agente neto | $112.294 | $112.498 |
| + UPS neto | $122.497 | $150.814 |
| **= Costo puesto en la tienda** | **$5.033.451** | **$8.996.203** |
| IVA recuperable (importación + agente + UPS) | $972.445 | $1.738.229 |
| **Desembolso total** | **$6.005.896** | **$10.734.432** |
| Arancel + servicios sobre el CIF | **11,1 %** | **9,1 %** |
| Costo puesto en la tienda sobre el FOB | **+18,8 %** | **+18,1 %** |

(El seguro presunto —US$ 94,70 y 162,85— no está en la suma: solo sirvió para calcular los impuestos.)

Regla práctica para el dueño: **el costo real de lo que compra a Coqui es el precio FOB más un 18–19 %** (flete ≈ 7–8 %, arancel ≈ 6,5 % del FOB, agente + UPS ≈ 3–5 % según el tamaño del pedido). El desembolso es un 19 % más que eso, pero ese IVA vuelve en el F29. Como el agente y el cargo terminal son casi fijos, **un pedido más grande los diluye** (5 % del CIF en junio, 3 % en agosto). El sistema muestra esta cifra como «Sobre el FOB» en la compra.

Con la compra de junio: el ítem `BAN2850164` (36 unidades, FOB US$ 2.587,02 = 54,6 % del pedido) paga su parte del flete (US$ 174,18), 6 % de arancel sobre su CIF de US$ 2.812,93 ($151.019) y su parte de agente + UPS (54,6 % de $234.791 = $128.277): costo puesto en la tienda $2.749.990 → **$76.389 por unidad**, contra US$ 71,86 × 894,79 = $64.302 de FOB.

## 6. Tratado con Estados Unidos: cuándo el arancel es 0 %

El TLC Chile–EE. UU. deja en 0 % el ad valorem **solo para mercancía originaria de Estados Unidos** y con certificación de origen del exportador. Lo que Coqui vende (Bandai, Wizards, Ultimate Guard) se fabrica en Japón, China o Europa: la DIN real dice **país de origen Japón, país de adquisición EE. UU., acuerdo comercial «0»**, y cobró el 6 %. Chile tiene acuerdo con Japón, pero exige embarque directo desde Japón, que no es el caso. En la práctica, para estas compras el arancel es 6 % salvo que el proveedor emita certificación de origen estadounidense para lo que sí sea de allá.

## 7. Lo que hace el sistema (C12b «Costos de importación», construido el 2026-09-11 — 11-SDD §6.7)

Antes una compra en USD pedía **tipo de cambio** y un único **`gastosExtra` en CLP** que se repartía por monto (11-SDD §6.6): dejaba el cálculo de §4 en la cabeza del dueño, no distinguía lo que es crédito fiscal y no dejaba rastro de la DIN. Con los documentos reales quedó así (la propuesta original, ya construida):

1. **Sección «Importación» en la compra** (solo si `moneda ≠ CLP`), dos caminos:
   - **Con DIN** (agente): se **sube el PDF de la DIN** y un lector nuevo (`lectores/din.ts`, la DIN sí trae texto) saca número, fecha de aceptación, dólar aduanero, FOB, flete, seguro, CIF, ad valorem e IVA en USD y en pesos, y los ítems con su código de proveedor. Se cuadra contra la compra: Σ FOB de las líneas = FOB de la DIN (aviso si no).
   - **Sin DIN** (courier): se digitan los dos montos de la factura de UPS («declaración de importación» y «manejo»); el sistema estima el reparto arancel/IVA con la fórmula y lo marca «estimado hasta tener la DIN simplificada».
2. **Gastos de la importación** en una tabla `CompraGasto {compraId, tipo, descripcion, montoNeto, iva, documento, fecha}` con `tipo` en `arancel | agente | courier | otro`. Las facturas del agente son escaneadas (sin texto) → se digitan 4 números (honorarios, gastos, IVA, total); la de UPS por courier sí se puede leer. El **IVA de importación** se guarda aparte en la compra (`ivaImportacion`, `dinNumero`, `dinFecha`) marcado «crédito fiscal, no entra al costo», para el contador.
3. **Costo por línea** = reparto de (CIF + arancel + gastos netos) por monto FOB de cada línea, como hoy hace `convertirLineasAClp` con `gastosExtra`. `CompraLinea.neto` = ese costo; `impuestos` = 0; `total` = neto (sin IVA). **D-E6-1 se reescribe:** «costo unitario = costo puesto en la tienda sin IVA recuperable; los impuestos no recuperables (ad valorem, ILA) sí van». El tipo de cambio de la mercancía es el que **pagó el dueño** (banco/tarjeta); los impuestos entran en pesos tal como los giró Aduana.
4. **Tarjetas del detalle:** «Costo puesto en la tienda», «IVA a recuperar», «Desembolso», «% sobre FOB», para que el dueño vea el 20 % de §5 sin calcular.

Hecho: migración `20260911150000_e6_importacion` (`Compra.fob/flete/seguro/cif/arancelPct/tipoCambioAduana/arancel/ivaImportacion/dinNumero/dinFecha` + tabla `CompraGasto`), reglas puras en `dominio/compra.ts` (`calcularImportacion`, `resumenImportacion`, `convertirLineasAClp` con IVA aparte), lector `din` con fixture real de `127395-5.pdf`, rutas `POST /compras/leer-din`, `PUT /compras/:id/importacion`, `POST/DELETE /compras/:id/gastos`, y la sección «Importación» en el detalle de la compra (no en el flujo de carga: la DIN llega después de la factura). Verificado por HTTP con la DIN real y el invoice 097440 (costo puesto en la tienda $739.653 con el manejo de UPS, IVA a recuperar $142.392, desembolso $882.045). No se hizo lector para la factura de UPS por courier (se digita como gasto) ni OCR para las del agente.

## 8. Dudas para el contador (antes de construir)

- Confirmar que la tienda está recuperando el IVA de importación con la DIN (código 914) y que quiere el costo de inventario **neto** (§4). En las dos importaciones son $2,6 millones de IVA entre las dos.
- Para el envío por courier (§3.2): pedir a UPS la DIN simplificada del envío 6R5A37NRYZD, sin ella no hay documento para el crédito fiscal de esos ≈ $116.000.
- Si conviene contratar seguro real (una póliza suele costar menos que el 2 % presunto: US$ 163 en agosto) y si Coqui puede facturar CIF.
- Si Coqui puede emitir certificación de origen para lo que sí sea estadounidense (arancel 0 %).
