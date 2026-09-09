// npm run renumerar-ind -- [--aplicar] [--admin <email>]
// R-010 (docs/08): productos con SKU maestro IND- cuyo SKU externo SÍ tiene forma Magic
// reconocible tras ampliar el patrón (sufijos «240p», «116s», «2013a», «259?» y The List
// PLST-SET-NUM). Sin --aplicar solo informa. Con --aplicar renombra en una transacción y deja
// un registro de Auditoria `editar` por producto (sku anterior → nuevo). El SKU maestro es
// interno y nunca se publicó (P3 no aplica); ninguna venta lo referencia por texto.
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { skuMaestroDesdeExterno } from '@onplay/dominio';

const prisma = new PrismaClient();

async function main() {
  const args = process.argv.slice(2);
  const aplicar = args.includes('--aplicar');
  const iAdmin = args.indexOf('--admin');
  const adminEmail = (iAdmin >= 0 && args[iAdmin + 1]) || 'admin@onplay.cl';

  const candidatos = await prisma.producto.findMany({
    where: { sku: { startsWith: 'IND-' } },
    include: { canales: { select: { canalId: true, externoSku: true } } },
    orderBy: { sku: 'asc' },
  });
  const existentes = new Set((await prisma.producto.findMany({ select: { sku: true } })).map((p) => p.sku));

  const renombrar: { id: string; de: string; a: string; externo: string }[] = [];
  const sinForma: string[] = [];
  const colisiones: { de: string; a: string }[] = [];
  const propuestos = new Set<string>();
  for (const p of candidatos) {
    const externo = p.canales.find((c) => c.externoSku)?.externoSku ?? null;
    const nuevo = skuMaestroDesdeExterno(externo);
    if (!nuevo) {
      sinForma.push(`${p.sku} (${externo ?? 'sin SKU externo'})`);
      continue;
    }
    if (existentes.has(nuevo) || propuestos.has(nuevo)) {
      colisiones.push({ de: p.sku, a: nuevo });
      continue;
    }
    propuestos.add(nuevo);
    renombrar.push({ id: p.id, de: p.sku, a: nuevo, externo: externo! });
  }

  console.log(`IND- en la base: ${candidatos.length}`);
  console.log(`Renombrables: ${renombrar.length} · sin forma reconocible: ${sinForma.length} · colisiones: ${colisiones.length}`);
  for (const r of renombrar.slice(0, 5)) console.log(`  ${r.de} → ${r.a}  (${r.externo})`);
  if (renombrar.length > 5) console.log(`  … y ${renombrar.length - 5} más`);
  for (const s of sinForma.slice(0, 10)) console.log(`  sin forma: ${s}`);
  for (const c of colisiones.slice(0, 10)) console.log(`  colisión: ${c.de} → ${c.a} ya existe`);

  if (!aplicar) {
    console.log('\nSimulación. Para aplicar: npm run renumerar-ind -- --aplicar');
    return;
  }
  const admin = await prisma.usuario.findUnique({ where: { email: adminEmail } });
  if (!admin) {
    console.error(`No existe el usuario ${adminEmail} para firmar la auditoría (--admin <email>).`);
    process.exit(1);
  }
  await prisma.$transaction(async (tx) => {
    for (const r of renombrar) {
      await tx.producto.update({ where: { id: r.id }, data: { sku: r.a } });
      await tx.auditoria.create({
        data: {
          usuarioId: admin.id,
          entidad: 'producto',
          entidadId: r.id,
          accion: 'editar',
          valorAnterior: { sku: r.de },
          valorNuevo: { sku: r.a, motivo: 'R-010: SKU maestro derivado del SKU externo (patrón ampliado)' },
        },
      });
    }
  });
  console.log(`\nAplicado: ${renombrar.length} productos renombrados y auditados.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
