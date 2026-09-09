// Entorno del PROCESO, fijado en el PRIMER import de index.ts (los imports ESM se evalúan en orden),
// porque en la Web App no se controla el entorno del sistema (10-SDD §6).
//
// TZ: toda fecha del sistema es UTC; la hora Chile se aplica solo al presentar (R-014: UTC_TIMESTAMP).
process.env.TZ = 'UTC';

// R-023: el motor de Prisma (tokio) abre un hilo por CPU visible (64 en el servidor compartido de
// Hostinger), pero el cgroup LVE del usuario admite unas pocas decenas de hilos EN TOTAL entre todos
// sus sitios; al agotarse, el motor cae con «PANIC: timer has gone away». Tokio respeta esta variable:
// 4 hilos bastan de sobra para un mostrador. El panel puede subirla; nunca dejarla sin fijar.
process.env.TOKIO_WORKER_THREADS ??= '4';
