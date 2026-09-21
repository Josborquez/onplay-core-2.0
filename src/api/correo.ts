// R-032: correo saliente por SMTP (Hostinger: smtp.hostinger.com:465 con una casilla del dominio).
// Un solo transporte perezoso; sin configuración, `correoDisponible()` es false y nadie envía.
import nodemailer, { type Transporter } from 'nodemailer';
import { entorno } from './entorno.js';

let transporte: Transporter | null = null;

export function correoDisponible(): boolean {
  return !!(entorno.smtp.host && entorno.smtp.usuario && entorno.smtp.clave && entorno.urlPublica);
}

function obtenerTransporte(): Transporter {
  transporte ??= nodemailer.createTransport({
    host: entorno.smtp.host,
    port: entorno.smtp.puerto,
    secure: entorno.smtp.puerto === 465,
    auth: { user: entorno.smtp.usuario, pass: entorno.smtp.clave },
  });
  return transporte;
}

export async function enviarCorreo(para: string, asunto: string, texto: string, html: string): Promise<void> {
  await obtenerTransporte().sendMail({
    from: `OnPlay Core <${entorno.smtp.remitente}>`,
    to: para,
    subject: asunto,
    text: texto,
    html,
  });
}
