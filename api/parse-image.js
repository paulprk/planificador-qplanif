/**
 * Función serverless (Vercel): recibe una imagen en base64 y le pide a
 * Gemini que lea la tabla de procesos (Job/Llegada/Ráfaga) y la devuelva
 * como JSON. La API key vive solo acá (variable de entorno GEMINI_API_KEY
 * en la configuración del proyecto en Vercel), nunca en el código del
 * cliente ni en el repositorio.
 */
const MODEL = 'gemini-3.8-flash';

const PROMPT = `Esta imagen contiene una tabla de procesos para un ejercicio de planificación de CPU, con columnas como "Job"/"Proceso", "Llegada"/"Arrival" y "Ráfaga"/"Unidades de CPU"/"Burst" (a veces también "Prioridad"/"Priority").

Devolvé ÚNICAMENTE un array JSON (sin texto adicional, sin markdown) con un objeto por fila de datos (ignorá la fila de encabezado), con este formato exacto:
[{"name": "P1", "arrival": 0, "burst": 4, "priority": null}]

- "name": el identificador del proceso tal como aparece (si es un número como "1", usalo como "P1").
- "arrival": el instante de llegada, como número.
- "burst": la ráfaga/duración de CPU, como número.
- "priority": el valor de prioridad si la tabla tiene esa columna, si no, null.

Si no podés leer alguna fila con confianza, omitila en vez de inventar un valor.`;

const RETRYABLE_STATUS = new Set([429, 500, 503]);
const MAX_ATTEMPTS = 3;

// Límite simple por IP para que nadie le pegue directo a este endpoint (sin
// pasar por la página) y agote la cuota de la API key. Vive en memoria, así
// que se reinicia si la función "se enfría" — no es perfecto, pero alcanza
// para frenar el abuso casual de un proyecto personal.
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT_MAX = 8;
const requestLog = new Map();

function getClientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (fwd) return fwd.split(',')[0].trim();
  return req.socket?.remoteAddress || 'unknown';
}

function isRateLimited(ip) {
  const now = Date.now();
  const recent = (requestLog.get(ip) || []).filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  recent.push(now);
  requestLog.set(ip, recent);
  return recent.length > RATE_LIMIT_MAX;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Reintenta con backoff cuando Gemini está saturado (503) o hay rate limit (429): son errores temporales, no del código. */
async function callGeminiWithRetry(url, body) {
  let lastRes;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    lastRes = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (lastRes.ok || !RETRYABLE_STATUS.has(lastRes.status) || attempt === MAX_ATTEMPTS) {
      return lastRes;
    }
    await sleep(500 * attempt);
  }
  return lastRes;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'Método no permitido.' });
    return;
  }

  if (isRateLimited(getClientIp(req))) {
    res.status(429).json({ ok: false, error: 'Demasiados pedidos desde esta conexión. Esperá unos minutos y probá de nuevo.' });
    return;
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    res.status(500).json({ ok: false, error: 'Falta configurar GEMINI_API_KEY en el servidor.' });
    return;
  }

  const { image } = req.body || {};
  const match = typeof image === 'string' && image.match(/^data:(image\/[a-zA-Z+.-]+);base64,(.+)$/);
  if (!match) {
    res.status(400).json({ ok: false, error: 'Falta la imagen o el formato es inválido.' });
    return;
  }
  const [, mimeType, base64Data] = match;

  try {
    const geminiRes = await callGeminiWithRetry(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${apiKey}`,
      {
        contents: [{
          parts: [
            { text: PROMPT },
            { inlineData: { mimeType, data: base64Data } }
          ]
        }],
        generationConfig: { responseMimeType: 'application/json' }
      }
    );

    if (!geminiRes.ok) {
      if (RETRYABLE_STATUS.has(geminiRes.status)) {
        res.status(503).json({ ok: false, error: 'Gemini está con mucha demanda ahora mismo. Esperá unos segundos y probá de nuevo.' });
        return;
      }
      const errText = await geminiRes.text();
      res.status(502).json({ ok: false, error: `Gemini devolvió un error: ${errText.slice(0, 300)}` });
      return;
    }

    const data = await geminiRes.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      res.status(502).json({ ok: false, error: 'Gemini no devolvió contenido interpretable (puede haber rechazado la imagen).' });
      return;
    }

    let rows;
    try {
      rows = JSON.parse(text);
    } catch {
      res.status(502).json({ ok: false, error: 'La respuesta de Gemini no fue un JSON válido.' });
      return;
    }
    if (!Array.isArray(rows)) {
      res.status(502).json({ ok: false, error: 'La respuesta de Gemini no tiene el formato esperado.' });
      return;
    }

    const procs = rows
      .filter((r) => r && Number.isFinite(Number(r.arrival)) && Number.isFinite(Number(r.burst)))
      .map((r, i) => ({
        name: String(r.name || `P${i + 1}`),
        arrival: Number(r.arrival),
        burst: Number(r.burst),
        priority: Number.isFinite(Number(r.priority)) ? Number(r.priority) : i + 1
      }));

    res.status(200).json({ ok: true, procs });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message || 'Error inesperado del servidor.' });
  }
}
