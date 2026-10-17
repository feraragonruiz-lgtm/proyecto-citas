// Avisos por correo a las clientas cuando se confirma o rechaza su cita.
// Se envían desde una cuenta de Gmail con una "contraseña de aplicación".
const nodemailer = require('nodemailer');

const { GMAIL_USER, GMAIL_APP_PASSWORD } = process.env;
const ZONA_HORARIA = process.env.ZONA_HORARIA || 'America/Costa_Rica';

// Google muestra la contraseña de aplicación con espacios; se los quitamos.
const transporte = GMAIL_USER && GMAIL_APP_PASSWORD
  ? nodemailer.createTransport({
    service: 'gmail',
    auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD.replace(/\s/g, '') },
  })
  : null;

function esEmail(texto) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(texto).trim());
}

function escaparHtml(texto) {
  return String(texto)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatearFecha(fechaIso) {
  return new Date(fechaIso).toLocaleString('es-CR', {
    timeZone: ZONA_HORARIA,
    dateStyle: 'full',
    timeStyle: 'short',
  });
}

const TEXTOS = {
  confirmada: {
    asunto: 'Tu cita en Mabel Citas está confirmada ✔',
    mensaje: (fecha) => `Tu cita del ${fecha} quedó confirmada. ¡Te esperamos!`,
  },
  rechazada: {
    asunto: 'Sobre tu solicitud de cita en Mabel Citas',
    mensaje: (fecha) => `Lo sentimos, el horario del ${fecha} no está disponible. Por favor elige otro horario en nuestra página.`,
  },
};

function armarHtml(nombre, mensaje, codigo, sitio) {
  return `
<div style="background:#0b0b0b;padding:24px;font-family:Georgia,serif;color:#f3ead2">
  <div style="max-width:480px;margin:0 auto;border:1px solid #9c7a1e;border-radius:12px;padding:24px;background:#161616">
    <h1 style="margin:0 0 16px;color:#d4af37;font-style:italic">Mabel <span style="font-style:normal;font-size:16px;letter-spacing:6px">CITAS</span></h1>
    <p>Hola ${escaparHtml(nombre)},</p>
    <p>${escaparHtml(mensaje)}</p>
    <p>Tu código de seguimiento es <strong style="color:#f7e08a">${escaparHtml(codigo)}</strong>.</p>
    <p><a href="${escaparHtml(sitio)}" style="color:#d4af37">Ver mi cita en Mabel Citas</a></p>
  </div>
</div>`;
}

// Devuelve 'enviado', 'sin_email' (el contacto es un teléfono), 'no_configurado' o 'error'.
async function avisarCambioDeEstado(solicitud, sitio) {
  const textos = TEXTOS[solicitud.estado];
  if (!textos) return 'sin_email';
  if (!esEmail(solicitud.contacto)) return 'sin_email';
  if (!transporte) return 'no_configurado';

  const mensaje = textos.mensaje(formatearFecha(solicitud.fecha_hora));

  try {
    await transporte.sendMail({
      from: `"Mabel Citas" <${GMAIL_USER}>`,
      to: solicitud.contacto.trim(),
      subject: textos.asunto,
      text: `Hola ${solicitud.nombre},\n\n${mensaje}\n\nTu código de seguimiento es ${solicitud.codigo_seguimiento}.\n${sitio}`,
      html: armarHtml(solicitud.nombre, mensaje, solicitud.codigo_seguimiento, sitio),
    });
    return 'enviado';
  } catch (error) {
    console.error('Error al enviar el correo:', error.message);
    return 'error';
  }
}

module.exports = { avisarCambioDeEstado };
