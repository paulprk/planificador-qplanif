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

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'Método no permitido.' });
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
    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: PROMPT },
              { inlineData: { mimeType, data: base64Data } }
            ]
          }],
          generationConfig: { responseMimeType: 'application/json' }
        })
      }
    );

    if (!geminiRes.ok) {
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
