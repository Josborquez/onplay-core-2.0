import { describe, expect, it } from 'vitest';
import { detectarDuplicadosCliente, nombreBusquedaCliente } from './cliente.js';

describe('nombreBusquedaCliente', () => {
  it('minúsculas, sin tildes, sin puntuación, espacios colapsados', () => {
    expect(nombreBusquedaCliente('  Pedro  Pérez-Soto ')).toBe('pedro perez soto');
    expect(nombreBusquedaCliente('JOSÉ Ñ.')).toBe('jose n');
  });
});

describe('detectarDuplicadosCliente — §6.6', () => {
  const existentes = [
    { id: 'a', rut: '12345678-5', email: 'pedro@mail.cl', telefono: '+56912345678', nombreBusqueda: 'pedro perez' },
    { id: 'b', rut: null, email: null, telefono: null, nombreBusqueda: 'maria soto' },
  ];

  it('rut idéntico → alta', () => {
    expect(detectarDuplicadosCliente({ nombre: 'Otro', rut: '12345678-5' }, existentes)).toEqual([
      { clienteId: 'a', campo: 'rut', confianza: 'alta' },
    ]);
  });

  it('email idéntico (case-insensitive) → alta', () => {
    expect(detectarDuplicadosCliente({ nombre: 'Otro', email: 'PEDRO@mail.cl' }, existentes)).toEqual([
      { clienteId: 'a', campo: 'email', confianza: 'alta' },
    ]);
  });

  it('teléfono idéntico ignorando formato → media', () => {
    expect(detectarDuplicadosCliente({ nombre: 'Otro', telefono: '+56 9 1234 5678' }, existentes)).toEqual([
      { clienteId: 'a', campo: 'telefono', confianza: 'media' },
    ]);
  });

  it('nombre normalizado idéntico → baja', () => {
    expect(detectarDuplicadosCliente({ nombre: 'María Soto' }, existentes)).toEqual([
      { clienteId: 'b', campo: 'nombre', confianza: 'baja' },
    ]);
  });

  it('una sola coincidencia por cliente: gana la de mayor confianza', () => {
    const dup = detectarDuplicadosCliente(
      { nombre: 'Pedro Pérez', rut: '12345678-5', email: 'pedro@mail.cl' },
      existentes,
    );
    expect(dup).toEqual([{ clienteId: 'a', campo: 'rut', confianza: 'alta' }]);
  });

  it('sin coincidencias → vacío', () => {
    expect(detectarDuplicadosCliente({ nombre: 'Nadie Nuevo' }, existentes)).toEqual([]);
  });
});
