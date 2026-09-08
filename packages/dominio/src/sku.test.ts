import { describe, expect, it } from 'vitest';
import { formatearSkuCorrelativo, skuMaestroDesdeExterno } from './sku.js';

describe('skuMaestroDesdeExterno (§6.4)', () => {
  it('One Piece: OP-{FILEBASE} → OPT-{FILEBASE}', () => {
    expect(skuMaestroDesdeExterno('OP-EB04-001-P1')).toBe('OPT-EB04-001-P1');
  });

  it('Magic: {SET}-{Nº}-{COND}-{IDIOMA} → MTG con número a 3 dígitos', () => {
    expect(skuMaestroDesdeExterno('MOM-75-NM-EN')).toBe('MTG-MOM-075-NM-EN');
    expect(skuMaestroDesdeExterno('MOM-075-NM-EN')).toBe('MTG-MOM-075-NM-EN');
    expect(skuMaestroDesdeExterno('BLB-123-LP-ES')).toBe('MTG-BLB-123-LP-ES');
  });

  it('R-010: sufijo del número (promo, showcase, variante) y The List', () => {
    expect(skuMaestroDesdeExterno('PTDM-240p-NM-EN')).toBe('MTG-PTDM-240p-NM-EN');
    expect(skuMaestroDesdeExterno('PEOE-20p-NM-EN')).toBe('MTG-PEOE-020p-NM-EN');
    expect(skuMaestroDesdeExterno('PTLA-116s-NM-EN')).toBe('MTG-PTLA-116s-NM-EN');
    expect(skuMaestroDesdeExterno('PGPX-2013a-NM-EN')).toBe('MTG-PGPX-2013a-NM-EN');
    expect(skuMaestroDesdeExterno('PRAV-247?-NM-EN')).toBe('MTG-PRAV-247?-NM-EN');
    expect(skuMaestroDesdeExterno('PLST-5DN-107-NM-EN')).toBe('MTG-PLST-5DN-107-NM-EN');
    expect(skuMaestroDesdeExterno('PLST-BBD-73-LP-ES')).toBe('MTG-PLST-BBD-073-LP-ES');
    // dos letras de sufijo no es una forma conocida
    expect(skuMaestroDesdeExterno('PTDM-240pp-NM-EN')).toBeNull();
  });

  it('R-018: acepta el sufijo -F de foil de la recarga ManaBox y lo conserva', () => {
    expect(skuMaestroDesdeExterno('HOB-5-NM-EN-F')).toBe('MTG-HOB-005-NM-EN-F');
    expect(skuMaestroDesdeExterno('PRCQ-3-NM-EN-F')).toBe('MTG-PRCQ-003-NM-EN-F');
    expect(skuMaestroDesdeExterno('HOB-5-NM-EN-FF')).toBeNull();
    expect(skuMaestroDesdeExterno('HOB-5-NM-EN-X')).toBeNull();
  });

  it('condiciones válidas: NM, LP, MP, HP, DMG', () => {
    expect(skuMaestroDesdeExterno('MOM-75-DMG-EN')).toBe('MTG-MOM-075-DMG-EN');
    expect(skuMaestroDesdeExterno('MOM-75-XX-EN')).toBeNull();
  });

  it('sin forma reconocible → null (el llamador reserva correlativo)', () => {
    expect(skuMaestroDesdeExterno('')).toBeNull();
    expect(skuMaestroDesdeExterno(null)).toBeNull();
    expect(skuMaestroDesdeExterno('cualquiera')).toBeNull();
  });
});

describe('formatearSkuCorrelativo (§7.1)', () => {
  it('correlativo a 6 dígitos por tipo', () => {
    expect(formatearSkuCorrelativo('sellado', 142)).toBe('SLD-000142');
    expect(formatearSkuCorrelativo('accesorio', 73)).toBe('ACC-000073');
    expect(formatearSkuCorrelativo('snack', 18)).toBe('SNK-000018');
    expect(formatearSkuCorrelativo('juego_mesa', 68)).toBe('JDM-000068');
  });

  it('eventos llevan el año y 4 dígitos', () => {
    expect(formatearSkuCorrelativo('evento', 93, 2026)).toBe('EVT-2026-0093');
  });
});
