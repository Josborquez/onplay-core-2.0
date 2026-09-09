// npm run renumerar-ind -- [--aplicar] [--admin <email>]
// Versión de línea de comandos (desarrollo) de R-010. En producción se usa
// POST /api/v1/admin/renumerar-ind?dryRun=false (10-SDD §5.5). La lógica es la misma:
// src/api/arranque/renumerar.ts.
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { aplicarRenumeracion, planRenumeracion } from '../src/api/arranque/renumerar.js';

const prisma = new PrismaClient();

async function main() {
  const args = process.argv.slice(2);
  const aplicar = args.includes('--aplicar');
  const iAdmin = args.indexOf('--admin');
  const adminEmail = (iAdmin >= 0 && args[iAdmin + 1]) || 'admin@onplay.cl';

  const plan = await planRenumeracion(prisma);
  console.log(`IND- en la base: ${plan.totalInd}`);
  console.log(`Renombrables: ${plan.renombrar.length} · sin forma reconocible: ${plan.sinForma.length} · colisiones: ${plan.colisiones.length}`);
  for (const r of plan.renombrar.slice(0, 5)) console.log(`  ${r.de} → ${r.a}  (${r.externo})`);
  if (plan.renombrar.length > 5) console.log(`  … y ${plan.renombrar.length - 5} más`);
  for (const s of plan.sinForma.slice(0, 10)) console.log(`  sin forma: ${s}`);
  for (const c of plan.colisiones.slice(0, 10)) console.log(`  colisión: ${c.de} → ${c.a} ya existe`);

  if (!aplicar) {
    console.log('\nSimulación. Para aplicar: npm run renumerar-ind -- --aplicar');
    return;
  }
  const admin = await prisma.usuario.findUnique({ where: { email: adminEmail } });
  if (!admin) {
    console.error(`No existe el usuario ${adminEmail} para firmar la auditoría (--admin <email>).`);
    process.exit(1);
  }
  const n = await aplicarRenumeracion(prisma, plan, admin.id);
  console.log(`\nAplicado: ${n} productos renombrados y auditados.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
