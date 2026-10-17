require('dotenv').config();

const crypto = require('crypto');
const path = require('path');
const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const { avisarCambioDeEstado, esEmail, formatearFecha } = require('./correo');
const { generarTema, enviarAviso, NTFY_URL } = require('./avisos');

const { SUPABASE_URL, SUPABASE_KEY, ADMIN_PASSWORD } = process.env;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Faltan SUPABASE_URL o SUPABASE_KEY en las variables de entorno.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const app = express();
const PORT = process.env.PORT || 3000;

// Railway pasa por un proxy HTTPS; así req.protocol devuelve "https".
app.set('trust proxy', 1);
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Genera un código corto y legible, por ejemplo "SOL-4F9A2C1B".
function generarCodigoSeguimiento() {
  return 'SOL-' + crypto.randomBytes(4).toString('hex').toUpperCase();
}

function sitioDe(req) {
  return `${req.protocol}://${req.get('host')}/`;
}

app.post('/solicitudes', async (req, res) => {
  const { nombre, contacto, email, fecha_hora } = req.body || {};

  if (!nombre || !contacto || !email || !fecha_hora) {
    return res.status(400).json({ error: 'Faltan campos: nombre, teléfono, email y fecha y hora son obligatorios.' });
  }

  if (!esEmail(email)) {
    return res.status(400).json({ error: 'El email no es válido.' });
  }

  if (Number.isNaN(Date.parse(fecha_hora))) {
    return res.status(400).json({ error: 'fecha_hora no es una fecha válida (usá formato ISO, ej. 2026-10-20T15:30:00).' });
  }

  const { data, error } = await supabase
    .from('solicitudes')
    .insert({
      nombre,
      contacto,
      email: email.trim(),
      fecha_hora,
      codigo_seguimiento: generarCodigoSeguimiento(),
      estado: 'pendiente',
    })
    .select()
    .single();

  if (error) {
    console.error('Error al guardar la solicitud:', error);
    return res.status(500).json({ error: 'No se pudo guardar la solicitud.' });
  }

  // El aviso a la dueña no debe demorar ni romper la respuesta a la clienta.
  avisarNuevaSolicitud(data, sitioDe(req)).catch((e) => console.error('Error al avisar a la dueña:', e.message));

  res.status(201).json({
    codigo_seguimiento: data.codigo_seguimiento,
    estado: data.estado,
  });
});

// Lo que ve cualquiera que tenga el código; los datos de contacto quedan solo para el panel.
const CAMPOS_PUBLICOS = 'codigo_seguimiento, nombre, fecha_hora, estado';
const CAMPOS_ADMIN = CAMPOS_PUBLICOS + ', contacto, email, created_at';

function noEncontrada(res, codigo) {
  return res.status(404).json({ error: `No existe una solicitud con el código ${codigo}.` });
}

async function leerAjuste(clave) {
  const { data, error } = await supabase
    .from('ajustes')
    .select('valor')
    .eq('clave', clave)
    .maybeSingle();

  if (error) throw error;
  return data ? data.valor : null;
}

const AJUSTE_TEMA_AVISOS = 'ntfy_tema';

async function avisarNuevaSolicitud(solicitud, sitio) {
  const tema = await leerAjuste(AJUSTE_TEMA_AVISOS);
  if (!tema) return;

  await enviarAviso(tema, {
    titulo: 'Nueva solicitud de cita',
    mensaje: `${solicitud.nombre} pidió una cita para el ${formatearFecha(solicitud.fecha_hora)}\nTel: ${solicitud.contacto}\nToca para responder en tu panel.`,
    enlace: sitio + 'admin',
  });
}

// La clave de administración se toma de ADMIN_PASSWORD si existe; si no, de la
// tabla "ajustes", donde la crea la dueña desde el panel la primera vez.
const AJUSTE_CLAVE = 'admin_password';
const LARGO_MINIMO_CLAVE = 8;

// Cifra la clave con scrypt y una sal aleatoria; se guarda como "sal:hash" en hex.
function cifrarClave(clave) {
  const sal = crypto.randomBytes(16);
  const hash = crypto.scryptSync(clave, sal, 64);
  return sal.toString('hex') + ':' + hash.toString('hex');
}

function claveCoincide(clave, guardada) {
  const [salHex, hashHex] = guardada.split(':');
  const esperado = Buffer.from(hashHex, 'hex');
  const calculado = crypto.scryptSync(String(clave), Buffer.from(salHex, 'hex'), esperado.length);
  return crypto.timingSafeEqual(calculado, esperado);
}

const claveDeEntorno = ADMIN_PASSWORD ? cifrarClave(ADMIN_PASSWORD) : null;

// Devuelve la clave cifrada, o null si todavía no se creó ninguna.
async function obtenerClaveGuardada() {
  if (claveDeEntorno) return claveDeEntorno;
  return leerAjuste(AJUSTE_CLAVE);
}

// Las rutas de administración requieren el header X-Admin-Password.
async function soloAdmin(req, res, next) {
  let guardada;
  try {
    guardada = await obtenerClaveGuardada();
  } catch (error) {
    console.error('Error al leer la clave de administración:', error);
    return res.status(500).json({ error: 'No se pudo verificar la clave.' });
  }

  if (!guardada) {
    return res.status(503).json({ error: 'Todavía no se creó la clave de administración.' });
  }
  if (!claveCoincide(req.get('X-Admin-Password') || '', guardada)) {
    return res.status(401).json({ error: 'Clave de administración incorrecta.' });
  }
  next();
}

app.get('/api/admin/estado', async (req, res) => {
  try {
    res.json({ claveCreada: Boolean(await obtenerClaveGuardada()) });
  } catch (error) {
    console.error('Error al leer la clave de administración:', error);
    res.status(500).json({ error: 'No se pudo verificar el panel.' });
  }
});

// Solo funciona una vez: cuando todavía no existe ninguna clave.
app.post('/api/admin/clave', async (req, res) => {
  const { clave } = req.body || {};

  if (typeof clave !== 'string' || clave.length < LARGO_MINIMO_CLAVE) {
    return res.status(400).json({ error: `La clave debe tener al menos ${LARGO_MINIMO_CLAVE} caracteres.` });
  }

  try {
    if (await obtenerClaveGuardada()) {
      return res.status(409).json({ error: 'La clave de administración ya fue creada.' });
    }
  } catch (error) {
    console.error('Error al leer la clave de administración:', error);
    return res.status(500).json({ error: 'No se pudo crear la clave.' });
  }

  // La clave primaria impide que se creen dos claves aunque lleguen dos pedidos a la vez.
  const { error } = await supabase
    .from('ajustes')
    .insert({ clave: AJUSTE_CLAVE, valor: cifrarClave(clave) });

  if (error) {
    if (error.code === '23505') {
      return res.status(409).json({ error: 'La clave de administración ya fue creada.' });
    }
    console.error('Error al guardar la clave de administración:', error);
    return res.status(500).json({ error: 'No se pudo crear la clave.' });
  }

  res.status(201).json({ ok: true });
});

app.get('/solicitudes/:codigo', async (req, res) => {
  const codigo = req.params.codigo.trim().toUpperCase();

  const { data, error } = await supabase
    .from('solicitudes')
    .select(CAMPOS_PUBLICOS)
    .eq('codigo_seguimiento', codigo)
    .maybeSingle();

  if (error) {
    console.error('Error al consultar la solicitud:', error);
    return res.status(500).json({ error: 'No se pudo consultar la solicitud.' });
  }

  if (!data) {
    return noEncontrada(res, codigo);
  }

  res.json(data);
});

function cambiarEstado(estado) {
  return async (req, res) => {
    const codigo = req.params.codigo.trim().toUpperCase();

    const { data, error } = await supabase
      .from('solicitudes')
      .update({ estado })
      .eq('codigo_seguimiento', codigo)
      .select(CAMPOS_ADMIN)
      .maybeSingle();

    if (error) {
      console.error(`Error al cambiar la solicitud a ${estado}:`, error);
      return res.status(500).json({ error: 'No se pudo actualizar la solicitud.' });
    }

    if (!data) {
      return noEncontrada(res, codigo);
    }

    // El cambio ya quedó guardado; si el correo falla, igual respondemos bien.
    const aviso = await avisarCambioDeEstado(data, sitioDe(req));

    res.json({ ...data, aviso });
  };
}

app.patch('/solicitudes/:codigo/confirmar', soloAdmin, cambiarEstado('confirmada'));
app.patch('/solicitudes/:codigo/rechazar', soloAdmin, cambiarEstado('rechazada'));

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.get('/api/admin/solicitudes', soloAdmin, async (req, res) => {
  const { data, error } = await supabase
    .from('solicitudes')
    .select(CAMPOS_ADMIN)
    .order('fecha_hora', { ascending: true });

  if (error) {
    console.error('Error al listar solicitudes:', error);
    return res.status(500).json({ error: 'No se pudieron cargar las solicitudes.' });
  }

  res.json(data);
});

// Avisos al celular: el panel muestra el tema de ntfy al que hay que suscribirse.
app.get('/api/admin/avisos', soloAdmin, async (req, res) => {
  try {
    const tema = await leerAjuste(AJUSTE_TEMA_AVISOS);
    res.json({ tema, servidor: NTFY_URL });
  } catch (error) {
    console.error('Error al leer el tema de avisos:', error);
    res.status(500).json({ error: 'No se pudo leer la configuración de avisos.' });
  }
});

app.post('/api/admin/avisos', soloAdmin, async (req, res) => {
  const { error } = await supabase
    .from('ajustes')
    .upsert({ clave: AJUSTE_TEMA_AVISOS, valor: generarTema(), actualizado: new Date().toISOString() });

  if (error) {
    console.error('Error al guardar el tema de avisos:', error);
    return res.status(500).json({ error: 'No se pudieron activar los avisos.' });
  }

  res.status(201).json({ tema: await leerAjuste(AJUSTE_TEMA_AVISOS), servidor: NTFY_URL });
});

app.post('/api/admin/avisos/prueba', soloAdmin, async (req, res) => {
  const tema = await leerAjuste(AJUSTE_TEMA_AVISOS).catch(() => null);
  if (!tema) {
    return res.status(409).json({ error: 'Primero activa los avisos.' });
  }

  const ok = await enviarAviso(tema, {
    titulo: 'Aviso de prueba',
    mensaje: 'Así te van a llegar las nuevas solicitudes de cita de Mabel Citas.',
    enlace: sitioDe(req) + 'admin',
  });

  if (!ok) {
    return res.status(502).json({ error: 'No se pudo enviar el aviso de prueba.' });
  }
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`Servidor escuchando en http://localhost:${PORT}`);
});
