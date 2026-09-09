// `npm run seed` / `prisma db seed` en desarrollo. En producción las semillas corren solas al
// arrancar (10-SDD §5.1 paso 4) y también por POST /api/v1/admin/sembrar. La lógica vive en
// src/api/arranque/semillas.ts para que sea la MISMA en los tres caminos.
import { PrismaClient } from '@prisma/client';
import { sembrar } from '../src/api/arranque/semillas.js';

const prisma = new PrismaClient();

sembrar(prisma)
  .then((r) => {
    console.log(`Semillas listas: ${r.canales} canales, ${r.categorias} categorías, SRV-000001, ${r.ubicaciones} ubicaciones, correlativo venta/${r.anioCorrelativo}.`);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
