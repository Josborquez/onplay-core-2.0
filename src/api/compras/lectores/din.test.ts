import { describe, expect, it } from 'vitest';
import { leerDin, reconoceDin } from './din.js';
import { detectarLector } from './index.js';
import type { PaginaTexto } from '../pdf.js';

// Celdas reales de la DIN 1150127395-5 (docs/pdf/INTERNACIONAL/127395-5.pdf), tal como las entrega pdfjs.
const PAGINAS: PaginaTexto[] = [
  [
    ['SERVICIO NACIONAL DE ADUANAS / CHILE', 'Form', 'NUMERO DE IDENTIFICACION'],
    ['07'],
    ['1150127395-5'],
    ['15'],
    ['DECLARACION DE INGRESO'],
    ['FECHA DE VENCIMIENTO'],
    ['15'],
    ['02/07/2026'],
    ['Aduana', 'Despachador', 'Tipo Operacion'],
    ['25', '26'],
    ['METROPOLITANA', '48', 'JULIO SALINAS BARRIENTOS', 'A15', 'IMPORT.CTDO/NORMAL', '101'],
    ['IDENTIFICACION'],
    ['Consignatario o Importador', 'Dirección', 'Comuna'],
    ['COMER. Y DISTRIBUIDORA BM LTDA', 'MERCED 832 LOCAL 54, SANTIAGO', '13101'],
    ['Cód.', 'RUT', 'Representante Legal', 'RUT'],
    ['03', '77.862.085-5', 'BORQUEZ ISRAEL', '18.327.595-K'],
    ['Consignante', 'Dirección', 'País', 'Cód.'],
    ['COQUI HOBBY DIST', '623 TRESTLE PT SUITE 2200', 'U.S.A.', '225'],
    ['ORIGEN, TRANSPORTE Y ALMACENAJE', 'REGIMEN SUSPENSIVO'],
    ['Pais Origen', 'Pais Adquisicion', 'Via Transp.', 'Dirección Almacenamiento', 'Comuna'],
    ['JAPON', '331', 'U.S.A.', '225', '11'],
    ['Cía. Transportadora', 'Cód. País', 'RUT', 'Número', 'Fecha', 'Aduana', 'Hojas Anexas'],
    ['UPS', '225', '78.953.470-5'],
    ['Docto. Transporte', 'Fecha', 'Regimen Importación', 'Cód.Bco. Comercial', 'Divisas'],
    ['6R5A37NPV4H', '09/06/2026', 'GENERAL', '01'],
    ['Almacenista', 'Cód.', 'Fecha de Recepción', 'Fecha de Retiro', 'Moneda', 'Gastos Hasta FOB'],
    ['UNITED PARCEL SERVICE', 'Z40', '15/06/2026', 'DOLAR USA', '013'],
    ['Registro Reconoc.', 'Regla 1 o Vº Bº', 'Clausula Compra', 'Forma Pago Gravámenes'],
    ['CFR', '2', 'CONT/CONT', '01'],
    ['DESCRIPCION DE MERCANCIAS'],
    ['ITEM I', 'Nombre', 'Cód.Arancel', 'Valor CIF Item'],
    ['1', 'BAN2850164', '; NAIPES; COQUI HOBBY DISTRIBUTION', '95044000', '2.812,93'],
    ['Atributo 1', 'Atributo 2', 'Ad Valorem', 'Cód.'],
    ['-F; BAN2850164; CARTAS, JUEGOS', 'DE MESA;', '6,000000', '223', '168,78'],
    ['Atributo 3', 'Atributo 4', 'Otro 1', 'Cód.'],
    ['19,000000', '178', '566,52'],
    ['Atributo 5', 'Atributo 6', 'Otro 2', 'Cód.'],
    ['0,00'],
    ['Ajuste', 'Cantidad Mercancia', 'Unidad Medida', 'Precio FOB Unitario', 'Otro 3', 'Cód.'],
    ['36,0000', 'U(JGO)', '12', '71,861667', '0,00'],
    ['Codigo Arancelario Tratado', 'Acuerdo Comercial', 'Observaciones', 'Otro 4', 'Cód.'],
    ['00000000', '0', '0', '0', '99', '00000036.000000 CAJAS', '0,00'],
    ['Observaciones', 'Observaciones', 'Observaciones'],
    ['Tipo Bulto', 'Cód.', 'Cantidad', 'Tipo Bulto', 'Cód.', 'Cantidad', 'Total Item', 'Valor FOB'],
    ['4', '4.735,16', 'CUENTAS Y VALORES'],
    ['CAJA DE CART', '022', '4'],
    ['Total Hojas', 'Flete'],
    ['2', '318,80', '223', '308,93'],
    ['Total Bultos', 'Seguro'],
    ['4', '94,70'],
    ['2'],
    ['Peso Bruto', 'Valor CIF'],
    ['56,70', '5.148,66'],
    ['IDENTIFICACION DE BULTOS', 'OBSERVACIONES BANCO CENTRAL - S.N.A.'],
    ['ROTULADO', 'MANDATO ENDOSO'],
    ['COMER. Y DISTRIB. BM LTDA'],
    ['178', '1.036,93'],
    ['AUTORIZA RETIRO MERCANCIAS', 'OPERACIONES CON PAGO DIFERIDO'],
    ['TOTAL GIRO US$', '191', '1.345,86'],
    ['Fecha Vencimiento', 'Valor US$'],
    ['Tipo de Inspección', 'Resultado', 'TOTAL DIFERIDO'],
    ['501', '601', '699'],
    ['SIN INSPECCION'],
    ['Nombre Fiscalizador', 'Código'],
    ['502', '602', 'CUOTA CONTADO', '199'],
    ['Observaciones', 'Tipo de Cambio'],
    ['503', '603', '61', '91', '1.204.262'],
    ['894,79'],
    ['504', '604', 'USO EXCLUSIVO SERVICIO DE TESORERIAS'],
  ],
  [
    ['Número identificación'],
    ['SERVICIO NACIONAL DE ADUANAS / CHILE'],
    ['1150127395-5'],
    ['DECLARACION DE INGRESO', 'Fecha Aceptación'],
    ['Hoja Continuación', 'DIA', '17', 'MES', '06', 'AÑO', '2026'],
    ['Aduana', 'Despachador', 'Tipo de Operación'],
    ['25', '48', '26', 'A15', '101'],
    ['METROPOLITANA', 'JULIO SALINAS BARRIENTOS', 'IMPORT.CTDO/NORMAL'],
    ['Consignate o Importador', 'Rut'],
    ['COMER. Y DISTRIBUIDORA BM LTDA', '77.862.085-5'],
    ['DESCRIPCION DE MERCANCIAS'],
    ['ITEM', 'Nombre', 'Cód.Arancel', 'Valor CIF Item'],
    ['2', 'FAB2602', '; NAIPES; COQUI HOBBY DISTRIBUTION', '95044000', '848,02'],
    ['Atributo 1', 'Atributo 2', 'Ad Valorem', 'Cód.'],
    ['-F; FAB2602/FAB2603; CARTAS, J', 'UEGOS DE MESA;', '6,000000', '223'],
    ['50,88'],
    ['Atributo 3', 'Atributo 4', 'Otro 1', 'Cód.'],
    ['19,000000', '178', '170,79'],
    ['Atributo 5', 'Atributo 6', 'Otro 2', 'Cód.'],
    ['Ajuste', 'Cantidad Mercancia', 'Unidad Medida', 'Precio FOB Unitario', 'Otro 3', 'Cód.'],
    ['6,0000', 'U(JGO)', '12', '129,985000'],
    ['Codigo Arancelario Tratado', 'Acuerdo Comercial', 'Observaciones', 'Otro 4', 'Cód.'],
    ['00000000', '0', '0', '0', '99', '00000006.000000 CAJAS'],
    ['Observaciones', 'Observaciones', 'Observaciones'],
    ['ITEM', 'Nombre', 'Cód.Arancel', 'Valor CIF Item'],
    ['3', 'FAB2601', '; NAIPES; COQUI HOBBY DISTRIBUTION', '95044000', '587,75'],
    ['Atributo 1', 'Atributo 2', 'Ad Valorem', 'Cód.'],
    ['-F; FAB2513; CARTAS, JUEGOS DE', 'MESA;', '6,000000', '223', '35,27'],
    ['Atributo 3', 'Atributo 4', 'Otro 1', 'Cód.'],
    ['19,000000', '178', '118,37'],
    ['Atributo 5', 'Atributo 6', 'Otro 2', 'Cód.'],
    ['Ajuste', 'Cantidad Mercancia', 'Unidad Medida', 'Precio FOB Unitario', 'Otro 3', 'Cód.'],
    ['6,0000', 'U(JGO)', '12', '90,091667'],
    ['Codigo Arancelario Tratado', 'Acuerdo Comercial', 'Observaciones', 'Otro 4', 'Cód.'],
    ['00000000', '0', '0', '0', '99', '00000006.000000 CAJAS'],
    ['Observaciones', 'Observaciones', 'Observaciones'],
    ['ITEM', 'Nombre', 'Cód.Arancel', 'Valor CIF Item'],
    ['4', 'FAB2513', '; NAIPES; COQUI HOBBY DISTRIBUTION', '95044000', '899,96'],
    ['Atributo 1', 'Atributo 2', 'Ad Valorem', 'Cód.'],
    ['-F; FAB2513; CARTAS, JUEGOS DE', 'MESA;', '6,000000', '223', '54,00'],
    ['Atributo 3', 'Atributo 4', 'Otro 1', 'Cód.'],
    ['19,000000', '178', '181,25'],
    ['Atributo 5', 'Atributo 6', 'Otro 2', 'Cód.'],
    ['Ajuste', 'Cantidad Mercancia', 'Unidad Medida', 'Precio FOB Unitario', 'Otro 3', 'Cód.'],
    ['24,0000', 'U(JGO)', '12', '34,486667'],
    ['Codigo Arancelario Tratado', 'Acuerdo Comercial', 'Observaciones', 'Otro 4', 'Cód.'],
    ['00000000', '0', '0', '0', '99', '00000024.000000 CAJAS'],
    ['Observaciones', 'Observaciones', 'Observaciones'],
    ['20', 'MERC. MAS DE UN MODELO'],
    ['ITEM', 'Nombre', 'Cód.Arancel', 'Valor CIF Item'],
    ['0', '*********'],
    ['Atributo 1', 'Atributo 2', 'Ad Valorem', 'Cód.'],
    ['***************'],
    ['Atributo 3', 'Atributo 4', 'Otro 1', 'Cód.'],
    ['***************'],
    ['54982449'],
    ['26/06/2026'],
    ['SERVICIO NACIONAL DE ADUANAS / CHILE', 'FIRMA IMPORTADOR O DESPACHADOR -'],
  ],
];

describe('lector DIN — declaración 1150127395-5 (Coqui, junio 2026)', () => {
  it('se reconoce como DIN y ningún lector de facturas la toma', () => {
    expect(reconoceDin(PAGINAS)).toBe(true);
    expect(detectarLector(PAGINAS)).toBeNull();
  });

  it('lee cabecera, valores aduaneros, impuestos y dólar aduanero', () => {
    const d = leerDin(PAGINAS);
    expect(d.numero).toBe('1150127395-5');
    expect(d.fechaAceptacion).toBe('2026-06-17');
    expect(d.despachador).toBe('JULIO SALINAS BARRIENTOS');
    expect(d.consignante).toBe('COQUI HOBBY DIST');
    expect(d.fob).toBe(4735.16);
    expect(d.flete).toBe(318.8);
    expect(d.seguro).toBe(94.7);
    expect(d.cif).toBe(5148.66);
    expect(d.arancelPct).toBe(6);
    expect(d.arancelOriginal).toBe(308.93);
    expect(d.ivaOriginal).toBe(1036.93);
    expect(d.totalGiroOriginal).toBe(1345.86);
    expect(d.tipoCambio).toBe(894.79);
    expect(d.totalGiro).toBe(1204262);
    expect(d.advertencias).toEqual([]);
  });

  it('lee los cuatro ítems con el código de Coqui, su CIF, arancel, IVA y cantidad (el «50,88» que cayó a la fila de abajo incluido)', () => {
    const d = leerDin(PAGINAS);
    expect(d.items.map((i) => i.codigo)).toEqual(['BAN2850164', 'FAB2602', 'FAB2601', 'FAB2513']);
    expect(d.items[0]).toEqual({ numero: 1, codigo: 'BAN2850164', cif: 2812.93, arancel: 168.78, iva: 566.52, cantidad: 36, fobUnitario: 71.861667 });
    expect(d.items[1]).toMatchObject({ codigo: 'FAB2602', cif: 848.02, arancel: 50.88, iva: 170.79, cantidad: 6 });
    expect(d.items[3]).toMatchObject({ codigo: 'FAB2513', cif: 899.96, arancel: 54, iva: 181.25, cantidad: 24 });
    expect(d.items.reduce((a, i) => a + i.cif, 0)).toBeCloseTo(5148.66, 2);
  });

  it('avisa lo que falta si solo viene la primera hoja', () => {
    const d = leerDin([PAGINAS[0]!]);
    expect(d.fechaAceptacion).toBeNull();
    expect(d.items).toHaveLength(1);
    expect(d.advertencias.some((a) => a.includes('fecha de aceptación'))).toBe(true);
    expect(d.advertencias.some((a) => a.includes('suman CIF'))).toBe(true);
  });
});
