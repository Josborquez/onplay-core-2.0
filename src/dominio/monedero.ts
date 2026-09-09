// Reglas puras del monedero — 07-SDD §6.1, §6.2 y §7.2.
// El saldo es SUM(monto) del libro append-only; nunca un campo materializado (M1).

export type MotivoMonedero =
  | 'carga'
  | 'consumo'
  | 'devolucion'
  | 'premio_evento'
  | 'ajuste'
  | 'reverso_carga';

/** saldo(cliente) = SUM(movimiento.monto) — §6.1 */
export function calcularSaldo(movimientos: ReadonlyArray<{ monto: number }>): number {
  return movimientos.reduce((suma, m) => suma + m.monto, 0);
}

export type ErrorPagoMonedero =
  | { codigo: 'SALDO_INSUFICIENTE'; saldo: number; solicitado: number; falta: number }
  | { codigo: 'LIMITE_CREDITO_EXCEDIDO'; saldo: number; solicitado: number; falta: number };

/**
 * Tope de un pago con saldo — §6.2 paso 3.
 * Sin crédito: monto <= saldo. Con crédito: monto <= saldo + limiteCredito.
 * Devuelve null si el pago cabe, o el error 422 correspondiente.
 */
export function validarPagoMonedero(args: {
  monto: number;
  saldo: number;
  permiteCredito: boolean;
  limiteCredito: number;
}): ErrorPagoMonedero | null {
  const { monto, saldo, permiteCredito, limiteCredito } = args;
  if (!permiteCredito) {
    if (monto > saldo) {
      return { codigo: 'SALDO_INSUFICIENTE', saldo, solicitado: monto, falta: monto - saldo };
    }
    return null;
  }
  const tope = saldo + limiteCredito;
  if (monto > tope) {
    return { codigo: 'LIMITE_CREDITO_EXCEDIDO', saldo, solicitado: monto, falta: monto - tope };
  }
  return null;
}

export type ErrorMovimientoManual =
  | { codigo: 'MOTIVO_NO_MANUAL' } // consumo/devolucion los genera el sistema desde una venta
  | { codigo: 'MONTO_INVALIDO' } // entero distinto de cero
  | { codigo: 'SIGNO_INVALIDO'; esperado: 'positivo' | 'negativo' }
  | { codigo: 'NOTA_REQUERIDA' };

/**
 * Reglas de POST /clientes/:id/monedero — §7.2.
 * - motivo nunca consumo ni devolucion
 * - monto entero ≠ 0; positivo en carga y premio_evento; negativo en
 *   reverso_carga; con signo libre en ajuste
 * - nota obligatoria en ajuste y reverso_carga
 */
export function validarMovimientoManual(args: {
  motivo: MotivoMonedero;
  monto: number;
  nota?: string | null;
}): ErrorMovimientoManual | null {
  const { motivo, monto, nota } = args;
  if (motivo === 'consumo' || motivo === 'devolucion') return { codigo: 'MOTIVO_NO_MANUAL' };
  if (!Number.isInteger(monto) || monto === 0) return { codigo: 'MONTO_INVALIDO' };
  if ((motivo === 'carga' || motivo === 'premio_evento') && monto < 0) {
    return { codigo: 'SIGNO_INVALIDO', esperado: 'positivo' };
  }
  if (motivo === 'reverso_carga' && monto > 0) {
    return { codigo: 'SIGNO_INVALIDO', esperado: 'negativo' };
  }
  if ((motivo === 'ajuste' || motivo === 'reverso_carga') && !nota?.trim()) {
    return { codigo: 'NOTA_REQUERIDA' };
  }
  return null;
}
