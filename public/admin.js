const seccionCrear = document.getElementById('seccion-crear');
const formCrearClave = document.getElementById('form-crear-clave');
const errorCrear = document.getElementById('error-crear');
const seccionLogin = document.getElementById('seccion-login');
const seccionPanel = document.getElementById('seccion-panel');
const formLogin = document.getElementById('form-login');
const errorLogin = document.getElementById('error-login');
const errorPanel = document.getElementById('error-panel');
const avisoPanel = document.getElementById('aviso-panel');

const AVISOS = {
  enviado: (s) => `Listo. Se le envió un correo a ${s.nombre} (${s.contacto}).`,
  sin_email: (s) => `Listo. Ahora toca «Avisar por WhatsApp» en la cita de ${s.nombre} para enviarle el mensaje.`,
  no_configurado: (s) => `Listo. Ahora toca «Avisar por correo» en la cita de ${s.nombre} para enviarle el mensaje.`,
  error: (s) => `Listo, pero el correo automático a ${s.nombre} falló. Toca «Avisar por correo» para enviárselo tú.`,
};

const CODIGO_PAIS = '506'; // Costa Rica
const ZONA_HORARIA = 'America/Costa_Rica';

function formatearFecha(fechaIso) {
  return new Date(fechaIso).toLocaleString('es-CR', { timeZone: ZONA_HORARIA, dateStyle: 'full', timeStyle: 'short' });
}

// Mensaje para avisarle a la clienta, según cómo quedó su cita.
function mensajeParaClienta(s) {
  const fecha = formatearFecha(s.fecha_hora);
  const cuerpo = s.estado === 'confirmada'
    ? `tu cita en Mabel Citas del ${fecha} está confirmada ✔. ¡Te esperamos!`
    : `lo sentimos, el horario del ${fecha} no está disponible. Por favor elige otro horario en ${location.origin}`;
  return `Hola ${s.nombre}, ${cuerpo}\nTu código de seguimiento es ${s.codigo_seguimiento}.`;
}

// Devuelve el número listo para WhatsApp (con código de país), o null si el contacto no es un teléfono.
function numeroWhatsapp(contacto) {
  if (contacto.includes('@')) return null;
  const digitos = contacto.replace(/\D/g, '');
  if (digitos.length === 8) return CODIGO_PAIS + digitos;
  if (digitos.length >= 10) return digitos;
  return null;
}

function botonAviso(s) {
  const mensaje = mensajeParaClienta(s);
  const numero = numeroWhatsapp(s.contacto);
  const enlace = document.createElement('a');
  enlace.className = 'boton secundario';
  enlace.target = '_blank';
  enlace.rel = 'noopener';

  if (numero) {
    enlace.textContent = 'Avisar por WhatsApp';
    enlace.href = `https://wa.me/${numero}?text=${encodeURIComponent(mensaje)}`;
  } else if (s.contacto.includes('@')) {
    enlace.textContent = 'Avisar por correo';
    const asunto = s.estado === 'confirmada' ? 'Tu cita en Mabel Citas está confirmada' : 'Sobre tu solicitud de cita en Mabel Citas';
    enlace.href = `mailto:${s.contacto.trim()}?subject=${encodeURIComponent(asunto)}&body=${encodeURIComponent(mensaje)}`;
  } else {
    return null;
  }
  return enlace;
}
const lista = document.getElementById('lista');

const ESTADOS = {
  pendiente: 'Pendiente',
  confirmada: 'Confirmada',
  rechazada: 'Rechazada',
};

// La clave se guarda solo mientras la pestaña esté abierta.
function leerClave() {
  try {
    return sessionStorage.getItem('clave-admin');
  } catch {
    return null;
  }
}

function guardarClave(clave) {
  try {
    if (clave) sessionStorage.setItem('clave-admin', clave);
    else sessionStorage.removeItem('clave-admin');
  } catch {
    // Sin sessionStorage la clave se pedirá de nuevo al recargar.
  }
}

let clave = leerClave();

function crear(tag, texto, clase) {
  const el = document.createElement(tag);
  if (texto !== undefined) el.textContent = texto;
  if (clase) el.className = clase;
  return el;
}

function mostrarError(elemento, mensaje) {
  elemento.textContent = mensaje;
  elemento.hidden = !mensaje;
}

async function pedir(url, opciones = {}) {
  const respuesta = await fetch(url, {
    ...opciones,
    headers: { 'X-Admin-Password': clave || '' },
  });
  const cuerpo = await respuesta.json().catch(() => ({}));
  return { respuesta, cuerpo };
}

function salir(mensaje) {
  clave = null;
  guardarClave(null);
  seccionPanel.hidden = true;
  seccionCrear.hidden = true;
  seccionLogin.hidden = false;
  mostrarError(errorLogin, mensaje || '');
}

// Si todavía no hay clave creada, muestra el formulario para crearla.
async function iniciar() {
  if (clave) {
    await cargarSolicitudes();
    return;
  }
  try {
    const respuesta = await fetch('/api/admin/estado');
    const cuerpo = await respuesta.json();
    if (respuesta.ok && !cuerpo.claveCreada) {
      seccionCrear.hidden = false;
      return;
    }
    salir(respuesta.ok ? '' : cuerpo.error);
  } catch {
    salir('No se pudo conectar con el servidor.');
  }
}

formCrearClave.addEventListener('submit', async (event) => {
  event.preventDefault();
  const nueva = formCrearClave.clave.value;

  if (nueva !== formCrearClave.repetir.value) {
    mostrarError(errorCrear, 'Las dos claves no coinciden.');
    return;
  }

  try {
    const respuesta = await fetch('/api/admin/clave', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clave: nueva }),
    });
    const cuerpo = await respuesta.json().catch(() => ({}));

    if (respuesta.status === 409) {
      formCrearClave.reset();
      salir(cuerpo.error + ' Ingresa con tu clave.');
      return;
    }
    if (!respuesta.ok) {
      mostrarError(errorCrear, cuerpo.error || 'No se pudo crear la clave.');
      return;
    }

    formCrearClave.reset();
    seccionCrear.hidden = true;
    clave = nueva;
    guardarClave(clave);
    await cargarSolicitudes();
  } catch {
    mostrarError(errorCrear, 'No se pudo conectar con el servidor.');
  }
});

async function cargarSolicitudes() {
  mostrarError(errorPanel, '');
  mostrarError(avisoPanel, '');
  try {
    const { respuesta, cuerpo } = await pedir('/api/admin/solicitudes');

    if (respuesta.status === 503) {
      // Todavía no hay clave creada: volver a mostrar el formulario para crearla.
      salir();
      seccionLogin.hidden = true;
      seccionCrear.hidden = false;
      return;
    }
    if (respuesta.status === 401) {
      salir(cuerpo.error);
      return;
    }
    if (!respuesta.ok) {
      mostrarError(errorPanel, cuerpo.error || 'No se pudieron cargar las solicitudes.');
      return;
    }

    seccionLogin.hidden = true;
    seccionPanel.hidden = false;
    dibujarLista(cuerpo);
  } catch {
    mostrarError(errorPanel, 'No se pudo conectar con el servidor.');
  }
}

function dibujarLista(solicitudes) {
  if (solicitudes.length === 0) {
    lista.replaceChildren(crear('p', 'Todavía no hay solicitudes.', 'vacio'));
    return;
  }

  lista.replaceChildren(...solicitudes.map((s) => {
    const item = crear('div', undefined, 'solicitud');
    item.append(
      crear('span', ESTADOS[s.estado] || s.estado, 'estado estado-' + s.estado),
      crear('p', new Date(s.fecha_hora).toLocaleString('es', { dateStyle: 'full', timeStyle: 'short' })),
      crear('p', 'Clienta: ' + s.nombre),
      crear('p', 'Contacto: ' + s.contacto),
      crear('p', 'Código: ' + s.codigo_seguimiento),
    );

    if (s.estado === 'pendiente') {
      const acciones = crear('div', undefined, 'acciones');
      const confirmar = crear('button', 'Confirmar');
      const rechazar = crear('button', 'Rechazar', 'secundario');
      confirmar.type = 'button';
      rechazar.type = 'button';
      confirmar.addEventListener('click', () => responder(s.codigo_seguimiento, 'confirmar', [confirmar, rechazar]));
      rechazar.addEventListener('click', () => responder(s.codigo_seguimiento, 'rechazar', [confirmar, rechazar]));
      acciones.append(confirmar, rechazar);
      item.append(acciones);
    } else {
      const aviso = botonAviso(s);
      if (aviso) {
        const acciones = crear('div', undefined, 'acciones');
        acciones.append(aviso);
        item.append(acciones);
      }
    }

    return item;
  }));
}

async function responder(codigo, accion, botones) {
  botones.forEach((b) => { b.disabled = true; });
  try {
    const { respuesta, cuerpo } = await pedir(
      '/solicitudes/' + encodeURIComponent(codigo) + '/' + accion,
      { method: 'PATCH' },
    );

    if (respuesta.status === 401) {
      salir(cuerpo.error);
      return;
    }
    if (!respuesta.ok) {
      mostrarError(errorPanel, cuerpo.error || 'No se pudo actualizar la solicitud.');
      botones.forEach((b) => { b.disabled = false; });
      return;
    }

    await cargarSolicitudes();
    mostrarError(avisoPanel, AVISOS[cuerpo.aviso] ? AVISOS[cuerpo.aviso](cuerpo) : '');
  } catch {
    mostrarError(errorPanel, 'No se pudo conectar con el servidor.');
    botones.forEach((b) => { b.disabled = false; });
  }
}

formLogin.addEventListener('submit', async (event) => {
  event.preventDefault();
  clave = formLogin.clave.value;
  guardarClave(clave);
  formLogin.reset();
  await cargarSolicitudes();
});

document.getElementById('boton-salir').addEventListener('click', () => salir());
document.getElementById('boton-actualizar').addEventListener('click', cargarSolicitudes);

iniciar();
