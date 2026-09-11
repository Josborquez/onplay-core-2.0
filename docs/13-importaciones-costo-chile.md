# 13 — Costo de importación en Chile: qué se paga, quién lo cobra y cómo entra al sistema

| | |
|---|---|
| **Proyecto** | `onplay-core` 2.0 · Etapa 6 (compras) |
| **Fecha** | 11 de septiembre de 2026 |
| **Estado** | Recopilación para el dueño (R-030). Propuesta de Fase 2 «costos de importación»; **no construida** (P1) |
| **Fuentes** | Aduana de Chile ([preguntas frecuentes de importación](https://www.aduana.cl/todas-las-preguntas-frecuentes-para-importaciones/aduana/2007-02-28/161116.html), [¿cuánto impuesto se paga al importar?](https://www.aduana.cl/cuanto-impuesto-se-paga-al-importar/aduana/2022-06-29/121230.html), [valoración de mercancías](https://www.aduana.cl/valoracion-de-mercancias/aduana/2019-01-04/161839.html), [TLC Chile–EE. UU.](https://www.aduana.cl/tratado-de-libre-comercio-chile-estados-unidos/aduana/2007-07-11/153552.html)), Ley del IVA art. 23 vía [Laudus](https://laudus.cl/contabilidad/el-iva-de-las-importaciones/), UPS Chile ([aranceles](https://www.ups.com/cl/es/shipping/international-shipping/tariffs), [costos de envío internacional](https://www.ups.com/cl/es/shipping/international-shipping/international-shipping-costs)), [Aduanas Salazar](https://aduanasalazar.cl/ad-valorem-impuestos-aduana-2026/), [Seguros Equos](https://www.segurosequos.com/blog-de-seguros/valor-aduanero) |

> **Qué se pide al dueño:** dejar en `docs/pdf/` una factura de UPS y una del agente de aduanas (más la DIN si la tiene) de una importación reciente. Con eso se confirman los cargos de §3 con cifras reales y se diseñan los campos de §5.

---

## 1. Los tres impuestos y la base sobre la que se calculan

| Concepto | Cómo se calcula | Fuente |
|---|---|---|
| **Valor CIF** (base de todo) | costo de la mercancía (FOB) + **flete internacional** + **seguro** | Aduana: «Valor CIF = producto + seguro + flete» |
| **Derecho ad valorem** | **6 % del CIF** por regla general | Aduana |
| **IVA de importación** | **19 % sobre (CIF + ad valorem)** — el IVA también grava el arancel | Aduana |
| Seguro cuando no hay póliza | Aduana usa un **seguro presunto del 2 % del FOB**; para el flete, si no se acredita, un presunto (≈ 5 %) | Res. 1.300/2006, Equos |

Ejemplo textual de Aduana: «Valor CIF US $1.000 / Derecho ad valorem (6 % de 1.000) US $60 / IVA (19 %) (sobre 1.060) US $201,40» → tributos **US $261,40** (26,1 % del CIF).

Los impuestos se pagan en **pesos** al tipo de cambio que fija Aduana para la fecha de la declaración («dólar aduanero»), no al del día de la compra.

## 2. Umbrales que cambian el trámite (envíos por courier como UPS)

| Valor del envío | Qué pasa |
|---|---|
| **≤ US$ 30 CIF** | Sin impuestos (envíos menores). Casi nunca aplica a una compra comercial |
| **≤ US$ 1.000 FOB** | El courier hace el trámite simplificado; se pagan igual ad valorem + IVA. No hace falta agente |
| **> US$ 1.000 FOB** | **Obligatorio contratar un agente de aduanas** (Aduana: «Si supera US$ 1.000 valor FOB, se requiere contratar un agente de aduanas»). El agente cobra honorarios por porcentaje con un mínimo |
| Mercancía sin carácter comercial | Trámite simplificado hasta US$ 4.050 FOB; no aplica a la tienda |

Las compras a Coqui (US$ 1.398,90 y US$ 685,21) caen en los dos casos: la primera exige agente; la segunda la puede despachar el courier.

## 3. Quién cobra qué (tres facturas por una importación)

| Quién | Qué cobra | ¿Es costo del producto? |
|---|---|---|
| **Proveedor** (Coqui) | mercancía (FOB) y a veces el flete («Shipping & Handling») | **Sí** (FOB + flete + seguro) |
| **Aduana / Tesorería** (vía DIN, «Declaración de Ingreso») | ad valorem 6 % + IVA 19 % | ad valorem **sí**; IVA **no** (ver §4) |
| **UPS** (o el courier) | flete internacional si no venía en la factura del proveedor; **gestión aduanera** («brokerage» / «gastos de despacho»); **cargo por adelanto de impuestos** (un % sobre los impuestos que UPS paga por ti, con mínimo); a veces almacenaje o corrección de dirección; **IVA 19 % sobre sus servicios** | servicios netos **sí**; su IVA **no** |
| **Agente de aduanas** (obligatorio > US$ 1.000) | **honorarios** (porcentaje del CIF con mínimo), gastos (Aduana, documentos, movilización), **IVA sobre honorarios** | honorarios y gastos netos **sí**; su IVA **no** |

UPS confirma que «el destinatario será el responsable de los derechos, impuestos y cargos necesarios para recibir el envío» y que la factura comercial es obligatoria; el código arancelario (HTS) en la factura evita que Aduana clasifique a ojo.

## 4. Qué es costo y qué es crédito fiscal (esto cambia el costo unitario)

La tienda es contribuyente de IVA (emite boletas con IVA), así que:

- **El IVA de importación es crédito fiscal**, igual que el IVA de una factura chilena: Ley del IVA art. 23, «el pagado por la importación de las especies al territorio nacional». Se recupera en el F29 con la **DIN** como documento (código 914 en el registro de compras); no va a la factura del agente ni a la de UPS.
- **El ad valorem NO se recupera**: es costo. Lo mismo el flete, el seguro, los honorarios del agente y los servicios de UPS (netos).
- El IVA que UPS y el agente cobran sobre sus servicios también es crédito fiscal (facturas afectas).

**Costo puesto en la tienda de una importación** (lo que debería llevar cada unidad):

```
costo = FOB + flete + seguro (real o 2 % presunto)   ← CIF
      + ad valorem (6 % del CIF, o 0 % con origen preferente)
      + honorarios y gastos del agente (netos)
      + gestión aduanera y adelanto de impuestos de UPS (netos)
```

y **fuera del costo**: IVA de importación e IVA de los servicios.

**Consecuencia para D-E6-1** (11-SDD §5.3, «costo unitario con IVA e impuestos específicos»): para el margen da lo mismo, porque el precio de venta también lleva IVA y el 19 % se cancela; pero **el costo contable real es sin IVA**. Recomendación: guardar en la compra **ambos** (neto y bruto) como ya se hace por línea, mostrar el margen sobre bruto como hoy, y que la Fase 3 (margen) reporte también sobre neto para el contador. En las importaciones el IVA no debe entrar a `gastosExtra` (hoy es un solo número y el dueño podría sumarlo por error).

## 5. Ejemplo con el invoice 097440 de Coqui (11-09-2026)

Supuestos: sin certificado de origen (arancel 6 %), sin póliza (seguro presunto 2 %), tipo de cambio de referencia $950; los cargos de UPS/agente son estimaciones hasta ver sus facturas.

| Concepto | USD | CLP (× 950) | ¿Costo? |
|---|---|---|---|
| Mercancía (Sales Total) | 528,50 | 502.075 | sí |
| Envío (Shipping & Handling, en el invoice) | 156,71 | 148.875 | sí |
| Seguro presunto 2 % del FOB | 10,57 | 10.042 | sí |
| **CIF** | **695,78** | **660.991** | |
| Ad valorem 6 % del CIF | 41,75 | 39.659 | sí |
| IVA 19 % sobre (CIF + ad valorem) = 737,53 | 140,13 | 133.124 | **no** (crédito fiscal) |
| Gestión aduanera UPS (estimado) | ≈ 25 | ≈ 24.000 | sí |
| Adelanto de impuestos UPS (≈ 2–3 % de 181,88, con mínimo) | ≈ 5 | ≈ 5.000 | sí |
| IVA de los servicios de UPS | | ≈ 5.500 | **no** |
| **Costo puesto en la tienda** | | **≈ 739.700** | |
| **Desembolso total** (incluye los IVA que se recuperan) | | **≈ 878.300** | |

Los kits gratis (6 de 9 líneas) no cargan nada: el costo se reparte entre las líneas con monto. Con estos supuestos, el display de Digimon (US$ 273 de mercancía, 4 displays × 24 sobres = 96 sobres) queda en ≈ $3.980 por sobre; con arancel 0 % bajaría ≈ $210.

## 6. Tratado con Estados Unidos: cuándo el arancel es 0 %

El TLC Chile–EE. UU. deja en 0 % el ad valorem **solo para mercancía originaria de Estados Unidos** (fabricada o transformada allí, según las reglas de origen del capítulo 4) y con certificación de origen del exportador. Lo que Coqui vende (Bandai, Wizards, Ultimate Guard) se fabrica en Japón, China o Europa: **al reexportarse desde EE. UU. no califica** y paga el 6 %. Chile tiene acuerdo con Japón, pero exige embarque directo desde Japón, que no es el caso. En la práctica, para estas compras el arancel es 6 % salvo que el proveedor emita certificación de origen estadounidense.

## 7. Propuesta para el sistema (E6 Fase 2 · C12b «Costos de importación») — agendada

Hoy una compra en USD pide **tipo de cambio** y un único **`gastosExtra` en CLP** que se reparte por monto (11-SDD §6.6). Sirve, pero deja el cálculo de §4 en la cabeza del dueño y no distingue lo que es crédito fiscal. Propuesta:

1. **Sección «Importación» en la compra** (solo si `moneda ≠ CLP`), con campos separados y en su moneda:
   - FOB (del documento) · flete internacional (del documento o de la factura del courier) · seguro (real o «2 % presunto», por defecto) → **CIF** calculado.
   - Arancel: 6 % por defecto; 0 % si «con certificado de origen».
   - Tipo de cambio: **dólar aduanero de la DIN** (no el de la compra), con el de la compra como sugerencia.
   - Gastos de agente y de courier **netos**, en CLP, con su detalle (honorarios, gestión aduanera, adelanto de impuestos, otros).
   - IVA de importación: **calculado y mostrado, marcado «crédito fiscal, no entra al costo»**, con el número de DIN para el contador.
2. **Costo por línea** = reparto de (CIF + arancel + gastos netos) por monto FOB de cada línea, como hoy hace `convertirLineasAClp` con `gastosExtra`. `CompraLinea.neto` = ese costo; `impuestos` = 0; `total` = neto (sin IVA). D-E6-1 se reescribe: «costo unitario = costo puesto en la tienda sin IVA recuperable; los impuestos no recuperables (ad valorem, ILA) sí van».
3. **Documentos anexos**: la compra guarda referencias a la factura del courier, la del agente y la DIN (número, fecha, monto), y su suma se compara con el desembolso total.
4. **Lectores nuevos** para la factura de UPS y la del agente cuando lleguen sus PDF (mismo patrón de `lectores/`).

Alcance estimado: una migración (`Compra.fob/flete/seguro/cif/arancelPct/arancel/ivaImportacion/dinNumero/dinFecha` + tabla `CompraGasto {compraId, tipo, descripcion, montoNeto, iva, documento}`), reglas puras en `dominio/compra.ts` (`calcularImportacion`), una pantalla más en el flujo por pasos (paso «Importación» entre Moneda y Proveedor) y ajustes en `POST /compras/leer` y `POST /compras`. Queda como C12b en 11-SDD §3.

## 8. Dudas para el contador (antes de construir)

- Confirmar que la tienda recupera el IVA de importación con la DIN y que el contador quiere el costo de inventario **neto** (§4).
- Si UPS despacha como «envío expreso» bajo US$ 1.000, qué documento entrega para el crédito fiscal (DIN simplificada) y a nombre de quién sale.
- Si conviene contratar seguro real (la póliza suele costar menos que el 2 % presunto) y si el proveedor puede facturar CIF.
- Si Coqui puede emitir certificación de origen para lo que sí sea estadounidense.
