// Semillas obligatorias (02-SDD §4.3, 03 §5.3, 04 §6.3, 06 §8.2). Idempotentes: el arranque las
// corre siempre (10-SDD §5.1 paso 4, P10) y `npm run seed` / `POST /admin/sembrar` las reutilizan.
import type { PrismaClient } from '@prisma/client';

const CANALES = [
  { id: 'onplay_cl', nombre: 'onplay.cl', tipo: 'woocommerce', urlBase: 'https://onplay.cl' },
  { id: 'onplaygames_cl', nombre: 'onplaygames.cl', tipo: 'woocommerce', urlBase: 'https://onplaygames.cl' },
  { id: 'tienda_fisica', nombre: 'Tienda física', tipo: 'fisico', urlBase: null },
] as const;

// [nombre, slug, slugPadre]
const CATEGORIAS: Array<[string, string, string | null]> = [
  ['Cartas', 'cartas', null],
  ['Magic', 'cartas-magic', 'cartas'],
  ['One Piece', 'cartas-one-piece', 'cartas'],
  ['Pokémon', 'cartas-pokemon', 'cartas'],
  ['Riftbound', 'cartas-riftbound', 'cartas'],
  ['Star Wars', 'cartas-star-wars', 'cartas'],
  ['Flesh and Blood', 'cartas-flesh-and-blood', 'cartas'],
  ['Sellado', 'sellado', null],
  ['Accesorios', 'accesorios', null],
  ['Juegos de Mesa', 'juegos-de-mesa', null],
  ['Juegos de Rol', 'juegos-de-rol', null],
  ['Juguetes y Colección', 'juguetes-y-coleccion', null],
  ['Snacks', 'snacks', null],
  ['Bebidas', 'snacks-bebidas', 'snacks'],
  ['Aguas', 'snacks-aguas', 'snacks'],
  ['Energéticas', 'snacks-energeticas', 'snacks'],
  ['Confitería', 'snacks-confiteria', 'snacks'],
  ['Eventos', 'eventos', null], // destino de las categorías de evento del importador
  ['Sin clasificar', 'sin-clasificar', null], // destino por defecto sin coincidencia
];

const UBICACIONES = [
  { codigo: 'mostrador', nombre: 'Mostrador', esVenta: true, publicable: false, orden: 1 },
  { codigo: 'carpetas', nombre: 'Carpetas', esVenta: false, publicable: false, orden: 2 },
  { codigo: 'vitrina', nombre: 'Vitrina', esVenta: false, publicable: false, orden: 3 },
  { codigo: 'bodega', nombre: 'Bodega', esVenta: false, publicable: true, orden: 4 },
];

export interface ResumenSemillas {
  canales: number;
  categorias: number;
  ubicaciones: number;
  anioCorrelativo: number;
}

export async function sembrar(prisma: PrismaClient): Promise<ResumenSemillas> {
  for (const c of CANALES) {
    await prisma.canal.upsert({
      where: { id: c.id },
      update: { nombre: c.nombre, tipo: c.tipo, urlBase: c.urlBase },
      create: { id: c.id, nombre: c.nombre, tipo: c.tipo, urlBase: c.urlBase },
    });
  }

  const idPorSlug = new Map<string, string>();
  for (const [nombre, slug, slugPadre] of CATEGORIAS) {
    const padreId = slugPadre ? (idPorSlug.get(slugPadre) ?? null) : null;
    const cat = await prisma.categoria.upsert({
      where: { slug },
      update: { nombre, padreId },
      create: { nombre, slug, padreId },
    });
    idPorSlug.set(slug, cat.id);
  }

  // E4 §6.3 — producto semilla del monedero: la carga de saldo ES una venta
  // de este producto. Sin stock, precio 0 (el monto lo pone la línea de venta).
  await prisma.producto.upsert({
    where: { sku: 'SRV-000001' },
    update: { nombre: 'Carga de saldo', tipo: 'servicio', controlaStock: false },
    create: {
      sku: 'SRV-000001',
      nombre: 'Carga de saldo',
      tipo: 'servicio',
      controlaStock: false,
      precioVenta: 0,
    },
  });

  // E2 §5.3 — ubicaciones semilla (01 §9). `mostrador` es la única de venta;
  // `bodega` es la publicable para E3 (06 §4). NO se enciende controlaStock aquí (M5).
  for (const u of UBICACIONES) {
    await prisma.ubicacion.upsert({
      where: { codigo: u.codigo },
      update: { nombre: u.nombre, orden: u.orden },
      create: u,
    });
  }

  // E3 §8.2 — las corridas automáticas (cron) firman sus movimientos de stock con este
  // usuario. Inactivo: no puede iniciar sesión (auth exige activo) y su hash no es válido.
  await prisma.usuario.upsert({
    where: { email: 'sistema@onplay.cl' },
    update: { nombre: 'Sistema (sync)', activo: false },
    create: {
      email: 'sistema@onplay.cl',
      nombre: 'Sistema (sync)',
      passwordHash: 'sin-clave',
      rol: 'vendedor',
      activo: false,
    },
  });

  const anioCorrelativo = new Date().getUTCFullYear();
  await prisma.correlativo.upsert({
    where: { clave: 'venta' },
    update: {},
    create: { clave: 'venta', anio: anioCorrelativo, ultimo: 0 },
  });

  return { canales: CANALES.length, categorias: CATEGORIAS.length, ubicaciones: UBICACIONES.length, anioCorrelativo };
}
