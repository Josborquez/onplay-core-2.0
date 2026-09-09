// 10-SDD §6: en la Web App no se controla el entorno del sistema, así que la zona horaria del
// proceso se fija aquí, en el PRIMER import de index.ts (los imports ESM se evalúan en orden).
// Toda fecha del sistema es UTC; la hora Chile se aplica solo al presentar (R-014: UTC_TIMESTAMP).
process.env.TZ = 'UTC';
