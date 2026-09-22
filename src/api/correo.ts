// R-032: correo saliente por SMTP. onplaygames.cl usa Titan (smtp.titan.email:465), no smtp.hostinger.com.
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

/** «EAUTH 535 5.7.8 Error: authentication failed» — código de nodemailer + respuesta del servidor, sin secretos. */
export function describirErrorSmtp(e: unknown): string {
  const err = e as { code?: string; responseCode?: number; response?: string; message?: string };
  return [err.code, err.responseCode, err.response ?? err.message].filter(Boolean).join(' ').slice(0, 300);
}
