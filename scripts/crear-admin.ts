// npm run crear-admin -- <email> <nombre> [password]
// Crea el usuario admin inicial (02-SDD §4.3). Si no se pasa password, genera una.
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import argon2 from 'argon2';
import { randomBytes } from 'node:crypto';

const prisma = new PrismaClient();

async function main() {
  const [email, nombre, passwordArg] = process.argv.slice(2);
  if (!email || !nombre) {
    console.error('Uso: npm run crear-admin -- <email> <nombre> [password]');
    process.exit(1);
  }
  const existente = await prisma.usuario.findUnique({ where: { email } });
  if (existente) {
    console.error(`Ya existe un usuario con email ${email}.`);
    process.exit(1);
  }
  const password = passwordArg ?? randomBytes(9).toString('base64url');
  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
  await prisma.usuario.create({
    data: { email, nombre, passwordHash, rol: 'admin', activo: true },
  });
  console.log(`Admin creado: ${email}`);
  if (!passwordArg) console.log(`Password generada: ${password}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
