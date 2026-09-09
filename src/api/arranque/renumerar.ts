// R-010 (docs/08): productos con SKU maestro IND- cuyo SKU externo SÍ tiene forma Magic
// reconocible tras ampliar el patrón (sufijos «240p», «116s», «2013a», «259?», The List
// PLST-SET-NUM y foil -F). Sin `aplicar` solo informa. Con `aplicar` renombra en una transacción y
// deja un registro de Auditoria `editar` por producto (sku anterior → nuevo). El SKU maestro es
// interno y nunca se publicó (P3 no aplica); ninguna venta lo referencia por texto.
// 2.0 §5.5: misma lógica para el script de desarrollo y para POST /admin/renumerar-ind.
import type { PrismaClient } from '@prisma/client';
import { skuMaestroDesdeExterno } from '@onplay/dominio';

export interface PlanRenumeracion {
  totalInd: number;
  renombrar: { id: string; de: string; a: string; externo: string }[];
  sinForma: string[];
  colisiones: { de: string; a: string }[];
}

export async function planRenumeracion(prisma: PrismaClient): Promise<PlanRenumeracion> {
  const candidatos = await prisma.producto.findMany({
    where: { sku: { startsWith: 'IND-' } },
    include: { canales: { select: { canalId: true, externoSku: true } } },
    orderBy: { sku: 'asc' },
  });
  const existentes = new Set((await prisma.producto.findMany({ select: { sku: true } })).map((p) => p.sku));

  const plan: PlanRenumeracion = { totalInd: candidatos.length, renombrar: [], sinForma: [], colisiones: [] };
  const propuestos = new Set<string>();
  for (const p of candidatos) {
    const externo = p.canales.find((c) => c.externoSku)?.externoSku ?? null;
    const nuevo = skuMaestroDesdeExterno(externo);
    if (!nuevo) {
      plan.sinForma.push(`${p.sku} (${externo ?? 'sin SKU externo'})`);
      continue;
    }
    if (existentes.has(nuevo) || propuestos.has(nuevo)) {
      plan.colisiones.push({ de: p.sku, a: nuevo });
      continue;
    }
    propuestos.add(nuevo);
    plan.renombrar.push({ id: p.id, de: p.sku, a: nuevo, externo: externo! });
  }
  return plan;
}

/** Aplica el plan en una transacción; `usuarioId` firma la auditoría. Devuelve cuántos renombró. */
export async function aplicarRenumeracion(prisma: PrismaClient, plan: PlanRenumeracion, usuarioId: string): Promise<number> {
  await prisma.$transaction(async (tx) => {
    for (const r of plan.renombrar) {
      await tx.producto.update({ where: { id: r.id }, data: { sku: r.a } });
      await tx.auditoria.create({
        data: {
          usuarioId,
          entidad: 'producto',
          entidadId: r.id,
          accion: 'editar',
          valorAnterior: { sku: r.de },
          valorNuevo: { sku: r.a, motivo: 'R-010: SKU maestro derivado del SKU externo (patrón ampliado)' },
        },
      });
    }
  });
  return plan.renombrar.length;
}
