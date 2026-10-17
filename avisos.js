// Notificaciones al celular de la dueña con ntfy (https://ntfy.sh): app gratuita,
// sin cuenta. Cada aviso se publica en un "tema" secreto al que ella se suscribe.
const crypto = require('crypto');

const NTFY_URL = process.env.NTFY_URL || 'https://ntfy.sh';

// Un nombre largo y aleatorio: quien no lo conozca no puede leer los avisos.
function generarTema() {
  return 'mabel-citas-' + crypto.randomBytes(12).toString('hex');
}

async function enviarAviso(tema, { titulo, mensaje, enlace }) {
  try {
    const respuesta = await fetch(NTFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        topic: tema,
        title: titulo,
        message: mensaje,
        click: enlace,
        tags: ['calendar'],
        priority: 4,
      }),
      signal: AbortSignal.timeout(5000),
    });
    if (!respuesta.ok) {
      console.error('ntfy respondió', respuesta.status);
    }
    return respuesta.ok;
  } catch (error) {
    console.error('Error al enviar el aviso a ntfy:', error.message);
    return false;
  }
}

module.exports = { generarTema, enviarAviso, NTFY_URL };
