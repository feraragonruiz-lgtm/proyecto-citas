const formCrear = document.getElementById('form-crear');
const resultadoCrear = document.getElementById('resultado-crear');
const formConsultar = document.getElementById('form-consultar');
const resultadoConsultar = document.getElementById('resultado-consultar');

function mostrar(elemento, contenido, esError) {
  elemento.replaceChildren(...contenido);
  elemento.classList.toggle('error', esError);
  elemento.hidden = false;
}

// Crea un elemento con texto (textContent evita inyectar HTML).
function crear(tag, texto, clase) {
  const el = document.createElement(tag);
  el.textContent = texto;
  if (clase) el.className = clase;
  return el;
}

formCrear.addEventListener('submit', async (event) => {
  event.preventDefault();
  const datos = new FormData(formCrear);

  try {
    const respuesta = await fetch('/solicitudes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nombre: datos.get('nombre'),
        contacto: datos.get('contacto'),
        // datetime-local no trae zona horaria: la convertimos a ISO con la hora local del navegador.
        fecha_hora: new Date(datos.get('fecha_hora')).toISOString(),
      }),
    });
    const cuerpo = await respuesta.json();

    if (!respuesta.ok) {
      mostrar(resultadoCrear, [crear('span', cuerpo.error || 'No se pudo crear la solicitud.')], true);
      return;
    }

    mostrar(resultadoCrear, [
      crear('span', 'Solicitud creada. Tu código de seguimiento es: '),
      crear('span', cuerpo.codigo_seguimiento, 'codigo'),
    ], false);
    formConsultar.codigo.value = cuerpo.codigo_seguimiento;
    formCrear.reset();
  } catch {
    mostrar(resultadoCrear, [crear('span', 'No se pudo conectar con el servidor.')], true);
  }
});

formConsultar.addEventListener('submit', async (event) => {
  event.preventDefault();
  const codigo = formConsultar.codigo.value.trim();

  try {
    const respuesta = await fetch('/solicitudes/' + encodeURIComponent(codigo));
    const cuerpo = await respuesta.json();

    if (!respuesta.ok) {
      mostrar(resultadoConsultar, [crear('span', cuerpo.error || 'No se pudo consultar la solicitud.')], true);
      return;
    }

    mostrar(resultadoConsultar, [
      crear('p', 'Código: ' + cuerpo.codigo_seguimiento),
      crear('p', 'Nombre: ' + cuerpo.nombre),
      crear('p', 'Fecha y hora: ' + new Date(cuerpo.fecha_hora).toLocaleString('es')),
      crear('p', 'Estado: ' + cuerpo.estado, 'codigo'),
    ], false);
  } catch {
    mostrar(resultadoConsultar, [crear('span', 'No se pudo conectar con el servidor.')], true);
  }
});
