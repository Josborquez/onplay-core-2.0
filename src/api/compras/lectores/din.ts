// Lector de la DIN (Declaración de Ingreso del Servicio Nacional de Aduanas) — 11-SDD §6.7, docs/13 §0.
// No es una factura: se sube en una compra en moneda extranjera para traer FOB, flete, seguro, CIF,
// ad valorem, IVA, total giro y dólar aduanero, más un ítem por código del proveedor (la DIN usa el
// código de Coqui como «Nombre» del ítem). Celdas reales de la DIN 1150127395-5 en `din.test.ts`.
// El formulario tiene etiquetas en una fila y valores en la siguiente; a veces un valor cae a la fila
// de más abajo («50,88» del ítem 2), así que cada dato se busca en la fila del rótulo y en las siguientes.
import { parsearNumeroCl } from '@onplay/dominio';
import type { PaginaTexto } from '../pdf.js';

export interface ItemDin {
  numero: number;
  codigo: string; // «Nombre» del ítem: el código del proveedor
  cif: number;
  arancel: number | null;
  iva: number | null;
  cantidad: number | null;
  fobUnitario: number | null;
}

export interface DinLeida {
  numero: string | null; // "1150127395-5"
  fechaAceptacion: string | null; // ISO
  tipoCambio: number | null; // dólar aduanero
  fob: number | null;
  flete: number | null;
  seguro: number | null;
  cif: number | null;
  arancelPct: number | null;
  arancelOriginal: number | null; // en la moneda de la DIN (dólar)
  ivaOriginal: number | null;
  totalGiroOriginal: number | null;
  totalGiro: number | null; // CLP girado
  despachador: string | null;
  consignante: string | null;
  items: ItemDin[];
  advertencias: string[];
}

export function reconoceDin(paginas: PaginaTexto[]): boolean {
  const primera = paginas[0] ?? [];
  const texto = primera.map((f) => f.join(' ')).join(' ');
  return /DECLARACION DE INGRESO/i.test(texto) && /SERVICIO NACIONAL DE ADUANAS/i.test(texto);
}

const ES_MONTO = /^-?\d{1,3}(\.\d{3})*,\d{2}$|^-?\d+,\d{2}$/; // "4.735,16" · "94,70"
const ES_PORCENTAJE = /^\d{1,2},\d{6}$/; // "6,000000"
const ES_CANTIDAD = /^\d+,\d{4}$/; // "36,0000"
const ES_UNITARIO = /^\d+,\d{6}$/; // "71,861667"
const ES_CLP = /^\d{1,3}(\.\d{3})+$/; // "1.204.262"

function monto(celda: string | undefined): number | null {
  return celda !== undefined && ES_MONTO.test(celda) ? parsearNumeroCl(celda) : null;
}

/** Primer monto (con coma) en la fila `desde` o en las `n` siguientes, saltando `omitir` montos. */
function montoCerca(pagina: PaginaTexto, desde: number, n = 2, omitir = 0): number | null {
  let saltados = 0;
  for (let i = desde; i < Math.min(pagina.length, desde + n + 1); i++) {
    for (const c of pagina[i]!) {
      const m = monto(c);
      if (m !== null) {
        if (saltados < omitir) saltados++;
        else return m;
      }
    }
  }
  return null;
}

/** Valor que sigue a un código de cuenta («223» ad valorem, «178» IVA) en la fila o en la siguiente. */
function montoTrasCodigo(pagina: PaginaTexto, fila: number, codigo: string): number | null {
  const f = pagina[fila]!;
  const idx = f.indexOf(codigo);
  if (idx < 0) return null;
  const m = monto(f[idx + 1]);
  if (m !== null) return m;
  return monto(pagina[fila + 1]?.[0]);
}

export function leerDin(paginas: PaginaTexto[]): DinLeida {
  const d: DinLeida = {
    numero: null,
    fechaAceptacion: null,
    tipoCambio: null,
    fob: null,
    flete: null,
    seguro: null,
    cif: null,
    arancelPct: null,
    arancelOriginal: null,
    ivaOriginal: null,
    totalGiroOriginal: null,
    totalGiro: null,
    despachador: null,
    consignante: null,
    items: [],
    advertencias: [],
  };

  for (const pagina of paginas) {
    let item: ItemDin | null = null;
    for (let i = 0; i < pagina.length; i++) {
      const fila = pagina[i]!;
      const texto = fila.join(' ');

      if (d.numero === null) {
        const c = fila.find((x) => /^\d{10}-[\dK]$/.test(x));
        if (c) d.numero = c;
      }
      if (d.fechaAceptacion === null) {
        const iDia = fila.indexOf('DIA');
        const iMes = fila.indexOf('MES');
        const iAno = fila.findIndex((x) => /^A[ÑN]O$/.test(x));
        if (iDia >= 0 && iMes >= 0 && iAno >= 0) {
          const dia = fila[iDia + 1];
          const mes = fila[iMes + 1];
          const ano = fila[iAno + 1];
          if (dia && mes && ano && /^\d{4}$/.test(ano)) d.fechaAceptacion = `${ano}-${mes.padStart(2, '0')}-${dia.padStart(2, '0')}`;
        }
      }
      if (/^Aduana$/.test(fila[0] ?? '') && fila.includes('Despachador')) {
        const datos = pagina[i + 1]?.length && pagina[i + 1]!.length >= 3 ? pagina[i + 1]! : pagina[i + 2];
        const nombre = datos?.find((c, k) => k > 0 && /^[A-ZÁÉÍÓÚÑ .]{8,}$/.test(c) && !/METROPOLITANA|IMPORT/.test(c));
        if (nombre && d.despachador === null) d.despachador = nombre;
      }
      if (fila[0] === 'Consignante' && d.consignante === null) {
        const c = pagina[i + 1]?.[0];
        if (c) d.consignante = c;
      }
      if (fila.includes('Valor FOB') && d.fob === null) d.fob = montoCerca(pagina, i + 1);
      if (fila.includes('Flete') && fila.length <= 3 && d.flete === null) {
        d.flete = montoCerca(pagina, i + 1);
        const arancel = montoTrasCodigo(pagina, i + 1, '223');
        if (arancel !== null) d.arancelOriginal = arancel;
      }
      if (fila.includes('Seguro') && fila.length <= 3 && d.seguro === null) d.seguro = montoCerca(pagina, i + 1);
      if (fila.includes('Valor CIF') && !fila.includes('Valor CIF Item') && d.cif === null) d.cif = montoCerca(pagina, i + 1, 1, 1) ?? montoCerca(pagina, i + 1, 1);
      if (fila.length === 2 && fila[0] === '178' && d.ivaOriginal === null) d.ivaOriginal = monto(fila[1]);
      if (/^TOTAL GIRO/.test(fila[0] ?? '') && d.totalGiroOriginal === null) d.totalGiroOriginal = monto(fila[fila.length - 1]);
      if (fila.includes('Tipo de Cambio')) {
        for (let k = i + 1; k <= i + 3 && k < pagina.length; k++) {
          for (const c of pagina[k]!) {
            if (d.tipoCambio === null && /^\d{1,4},\d{2,4}$/.test(c)) d.tipoCambio = parsearNumeroCl(c);
            if (d.totalGiro === null && ES_CLP.test(c)) d.totalGiro = parsearNumeroCl(c);
          }
        }
      }

      // Ítems: `N · CODIGO · ; descripción · 95044000 · CIF ítem`
      if (/^\d{1,2}$/.test(fila[0] ?? '') && fila.length >= 4 && /^[A-Z0-9][A-Z0-9/.-]{2,}$/.test(fila[1] ?? '') && fila.some((c) => /^\d{8}$/.test(c))) {
        const cif = monto(fila[fila.length - 1]);
        if (cif !== null) {
          item = { numero: Number(fila[0]), codigo: fila[1]!, cif, arancel: null, iva: null, cantidad: null, fobUnitario: null };
          d.items.push(item);
          continue;
        }
      }
      if (item && fila[0] === 'Atributo 1') {
        const datos = pagina[i + 1];
        if (datos) {
          const pct = datos.find((c) => ES_PORCENTAJE.test(c));
          if (pct && d.arancelPct === null) d.arancelPct = parsearNumeroCl(pct);
          item.arancel = montoTrasCodigo(pagina, i + 1, '223');
        }
      }
      if (item && fila[0] === 'Atributo 3') item.iva = montoTrasCodigo(pagina, i + 1, '178');
      if (item && fila[0] === 'Ajuste' && fila.includes('Cantidad Mercancia')) {
        const datos = pagina[i + 1] ?? [];
        const cant = datos.find((c) => ES_CANTIDAD.test(c));
        const unit = datos.find((c) => ES_UNITARIO.test(c));
        item.cantidad = cant ? parsearNumeroCl(cant) : null;
        item.fobUnitario = unit ? parsearNumeroCl(unit) : null;
      }
      if (/MERC\. MAS DE UN MODELO|\*{5,}/.test(texto)) item = null;
    }
  }

  if (d.numero === null) d.advertencias.push('No se encontró el número de la declaración.');
  if (d.fechaAceptacion === null) d.advertencias.push('No se encontró la fecha de aceptación (viene en la hoja de continuación).');
  if (d.fob === null || d.cif === null) d.advertencias.push('No se encontraron el FOB o el CIF: revisar los montos a mano.');
  if (d.tipoCambio === null) d.advertencias.push('No se encontró el tipo de cambio aduanero.');
  if (d.items.length === 0) d.advertencias.push('No se reconoció ningún ítem.');
  const sumaCif = d.items.reduce((a, it) => a + it.cif, 0);
  if (d.cif !== null && d.items.length && Math.abs(sumaCif - d.cif) > 0.05) {
    d.advertencias.push(`Los ítems suman CIF ${sumaCif.toFixed(2)} y la declaración dice ${d.cif.toFixed(2)}.`);
  }
  return d;
}
