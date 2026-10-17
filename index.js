require('dotenv').config();

const crypto = require('crypto');
const path = require('path');
const express = require('express');
const { createClient } = require('@supabase/supabase-js');

const { SUPABASE_URL, SUPABASE_KEY } = process.env;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Faltan SUPABASE_URL o SUPABASE_KEY en las variables de entorno.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Genera un código corto y legible, por ejemplo "SOL-4F9A2C1B".
function generarCodigoSeguimiento() {
  return 'SOL-' + crypto.randomBytes(4).toString('hex').toUpperCase();
}

app.post('/solicitudes', async (req, res) => {
  const { nombre, contacto, fecha_hora } = req.body || {};

  if (!nombre || !contacto || !fecha_hora) {
    return res.status(400).json({ error: 'Faltan campos: nombre, contacto y fecha_hora son obligatorios.' });
  }

  if (Number.isNaN(Date.parse(fecha_hora))) {
    return res.status(400).json({ error: 'fecha_hora no es una fecha válida (usá formato ISO, ej. 2026-10-20T15:30:00).' });
  }

  const { data, error } = await supabase
    .from('solicitudes')
    .insert({
      nombre,
      contacto,
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

  res.status(201).json({
    codigo_seguimiento: data.codigo_seguimiento,
    estado: data.estado,
  });
});

const CAMPOS_PUBLICOS = 'codigo_seguimiento, nombre, contacto, fecha_hora, estado';

function noEncontrada(res, codigo) {
  return res.status(404).json({ error: `No existe una solicitud con el código ${codigo}.` });
}

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

app.patch('/solicitudes/:codigo/confirmar', async (req, res) => {
  const codigo = req.params.codigo.trim().toUpperCase();

  const { data, error } = await supabase
    .from('solicitudes')
    .update({ estado: 'confirmada' })
    .eq('codigo_seguimiento', codigo)
    .select(CAMPOS_PUBLICOS)
    .maybeSingle();

  if (error) {
    console.error('Error al confirmar la solicitud:', error);
    return res.status(500).json({ error: 'No se pudo confirmar la solicitud.' });
  }

  if (!data) {
    return noEncontrada(res, codigo);
  }

  res.json(data);
});

app.listen(PORT, () => {
  console.log(`Servidor escuchando en http://localhost:${PORT}`);
});
