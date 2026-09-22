// R-036 — Valor del inventario al corte actual (docs/14 §7).
// Fuente ÚNICA de cantidades: `StockActual` (que solo escribe `registrarMovimiento`, E2 §6.1).
// NO se suma `ProductoCanal.stockCanal`: es el espejo de lo publicado, no existencias extra, y una
// unidad publicada en las dos webs sigue siendo una unidad.
import { valorizarInventario, type ExistenciaAnalitica, type FilaInventario, type ResumenInventario } from '@onplay/dominio';
import { prisma } from '../db.js';
import { idsSubarbol } from '../categorias.js';

export interface FiltrosInventario {
  ubicacionId?: string;
  categoriaId?: string;
  juego?: string;
  /** sin_costo · negativos · inactivos · bajo_stock · sin_control */
  marca?: string;
  q?: string;
}

export interface ReporteInventario {
  cortadoEn: string;
  medida: string;
  filas: FilaInventario[];
  resumen: ResumenInventario;
  /** Productos con `controlaStock=false`: cantidad y valor DESCONOCIDOS, nunca cero (§7). */
  sinControl: { productos: number; skus: string[] };
  ubicaciones: { id: string; nombre: string; activa: boolean }[];
}

export async function reporteInventario(f: FiltrosInventario): Promise<ReporteInventario> {
  const categoriaIds = f.categoriaId ? await idsSubarbol(f.categoriaId) : null;
  const filasStock = await prisma.stockActual.findMany({
    where: {
      ...(f.ubicacionId ? { ubicacionId: f.ubicacionId } : {}),
      producto: {
        ...(categoriaIds ? { categoriaId: { in: categoriaIds } } : {}),
        ...(f.juego ? { juego: f.juego } : {}),
        ...(f.q ? { OR: [{ nombre: { contains: f.q } }, { sku: { contains: f.q } }] } : {}),
      },
    },
    select: {
      cantidad: true,
      ubicacion: { select: { id: true, nombre: true, activa: true } },
      producto: {
        select: {
          id: true,
          sku: true,
          nombre: true,
          activo: true,
          controlaStock: true,
          costoReferencia: true,
          precioVenta: true,
          stockMinimo: true,
          juego: true,
          categoria: { select: { nombre: true } },
        },
      },
    },
  });

  const existencias: (ExistenciaAnalitica & { stockMinimo: number | null })[] = filasStock.map((s) => ({
    productoId: s.producto.id,
    sku: s.producto.sku,
    nombre: s.producto.nombre,
    ubicacionId: s.ubicacion.id,
    ubicacion: s.ubicacion.nombre,
    categoria: s.producto.categoria?.nombre ?? null,
    juego: s.producto.juego,
    activo: s.producto.activo,
    controlaStock: s.producto.controlaStock,
    cantidad: s.cantidad,
    costoReferencia: s.producto.costoReferencia,
    // Un precio 0 es «sin precio puesto»: no se valoriza a cero (§7).
    precioVenta: s.producto.precioVenta > 0 ? s.producto.precioVenta : null,
    stockMinimo: s.producto.stockMinimo,
  }));

  const { filas, resumen } = valorizarInventario(existencias);
  const conMarca = filas.filter((fila, i) => {
    if (!f.marca) return true;
    if (f.marca === 'sin_costo') return fila.cantidad > 0 && fila.costoReferencia === null;
    if (f.marca === 'negativos') return fila.cantidad < 0;
    if (f.marca === 'inactivos') return !fila.activo;
    if (f.marca === 'sin_control') return !fila.controlaStock;
    if (f.marca === 'bajo_stock') {
      const minimo = existencias[i]!.stockMinimo ?? 0;
      return minimo > 0 && fila.cantidad <= minimo;
    }
    return true;
  });

  const dondeSinControl = { activo: true, controlaStock: false, tipo: { not: 'servicio' as const } };
  const [productosSinControl, muestraSinControl] = await Promise.all([
    prisma.producto.count({ where: dondeSinControl }),
    prisma.producto.findMany({ where: dondeSinControl, select: { sku: true }, take: 50, orderBy: { sku: 'asc' } }),
  ]);

  return {
    cortadoEn: new Date().toISOString(),
    medida: 'Inventario a costo de referencia — estimado',
    filas: conMarca.sort((a, b) => (b.valorCosto ?? 0) - (a.valorCosto ?? 0)),
    // El resumen SIEMPRE se calcula sobre todo el resultado filtrado, no sobre lo que se ve (§5).
    resumen: f.marca ? valorizarInventario(conMarca).resumen : resumen,
    sinControl: { productos: productosSinControl, skus: muestraSinControl.map((p) => p.sku) },
    ubicaciones: await prisma.ubicacion.findMany({ orderBy: { orden: 'asc' }, select: { id: true, nombre: true, activa: true } }),
  };
}
