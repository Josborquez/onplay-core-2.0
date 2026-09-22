// R-036 (docs/14 §4 y criterio 12): días chilenos, cambios de horario y validación del rango.
import { describe, expect, it } from 'vitest';
import { ErrorRango, fechaChile, inicioDiaChile, lunesDe, periodoAnterior, periodoDe, rangoChile, sumarDias } from './fechas.js';

describe('días chilenos', () => {
  it('la medianoche local pertenece a su propio día, aunque en UTC ya sea el siguiente', () => {
    const inicio = inicioDiaChile('2026-09-15');
    expect(fechaChile(inicio)).toBe('2026-09-15');
    // 00:00 en Chile (-03) es 03:00 UTC del mismo día.
    expect(inicio.toISOString()).toBe('2026-09-15T03:00:00.000Z');
    // Un segundo antes todavía es el día anterior.
    expect(fechaChile(new Date(inicio.getTime() - 1))).toBe('2026-09-14');
  });

  it('en invierno el desfase es -04 y en verano -03: el inicio del día se ajusta solo', () => {
    expect(inicioDiaChile('2026-06-15').toISOString()).toBe('2026-06-15T04:00:00.000Z'); // invierno
    expect(inicioDiaChile('2026-01-15').toISOString()).toBe('2026-01-15T03:00:00.000Z'); // verano
  });

  it('el día del cambio de horario sigue empezando a las 00:00 locales', () => {
    // Chile adelanta el reloj el primer domingo de septiembre y lo atrasa el primero de abril.
    for (const dia of ['2026-09-06', '2026-09-07', '2026-04-05', '2026-04-06']) {
      expect(fechaChile(inicioDiaChile(dia))).toBe(dia);
    }
    // El día del salto dura 23 h; el siguiente vuelve a durar 24 h.
    const salto = inicioDiaChile('2026-09-07').getTime() - inicioDiaChile('2026-09-06').getTime();
    expect(salto).toBe(23 * 3_600_000);
  });

  it('fin de mes y año: sumarDias no se salta días', () => {
    expect(sumarDias('2026-01-31', 1)).toBe('2026-02-01');
    expect(sumarDias('2026-12-31', 1)).toBe('2027-01-01');
    expect(sumarDias('2028-02-28', 1)).toBe('2028-02-29'); // bisiesto
  });

  it('agrupar por semana usa el lunes; por mes, el año-mes', () => {
    expect(lunesDe('2026-09-22')).toBe('2026-09-21'); // martes → lunes anterior
    expect(lunesDe('2026-09-21')).toBe('2026-09-21');
    expect(periodoDe('semana', '2026-09-22')).toBe('2026-09-21');
    expect(periodoDe('mes', '2026-09-22')).toBe('2026-09');
    expect(periodoDe('dia', '2026-09-22')).toBe('2026-09-22');
  });
});

describe('rangoChile', () => {
  it('el límite superior es el INICIO del día siguiente (exclusivo): el rango incluye todo el último día', () => {
    const { inicio, fin } = rangoChile('2026-09-01', '2026-09-30');
    expect(inicio.toISOString()).toBe('2026-09-01T04:00:00.000Z');
    expect(fin.toISOString()).toBe('2026-10-01T03:00:00.000Z');
    // Una venta a las 23:59 del último día queda dentro.
    const tarde = new Date(inicioDiaChile('2026-10-01').getTime() - 60_000);
    expect(tarde < fin).toBe(true);
  });

  it('un solo día es un rango válido', () => {
    const { inicio, fin } = rangoChile('2026-09-22', '2026-09-22');
    expect(fin.getTime() - inicio.getTime()).toBe(24 * 3_600_000);
  });

  it('rechaza fechas inexistentes, rango invertido y más de 400 días', () => {
    expect(() => rangoChile('2026-02-30', '2026-03-01')).toThrow(ErrorRango);
    expect(() => rangoChile('no-es-fecha', '2026-03-01')).toThrow(ErrorRango);
    expect(() => rangoChile('2026-09-22', '2026-09-01')).toThrow('RANGO_INVERTIDO');
    expect(() => rangoChile('2024-01-01', '2026-09-22')).toThrow('RANGO_DEMASIADO_GRANDE');
  });
});

describe('periodoAnterior', () => {
  it('devuelve el bloque inmediatamente anterior de la misma duración, sin solaparse', () => {
    expect(periodoAnterior('2026-09-15', '2026-09-21')).toEqual({ desde: '2026-09-08', hasta: '2026-09-14' });
    expect(periodoAnterior('2026-09-22', '2026-09-22')).toEqual({ desde: '2026-09-21', hasta: '2026-09-21' });
  });

  it('un mes completo se compara contra los días inmediatamente anteriores', () => {
    const previo = periodoAnterior('2026-09-01', '2026-09-30');
    expect(previo).toEqual({ desde: '2026-08-02', hasta: '2026-08-31' }); // 30 días, no «agosto»
  });
});
