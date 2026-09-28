/**
 * Importar el lote de procesos desde una foto/captura de una tabla tipo
 * "Job | Llegada | Unidades de CPU" (formato Silberschatz/Stallings típico
 * de la práctica). Usa Tesseract.js (OCR 100% en el navegador, sin API key
 * ni backend) para leer los números y reconstruye las filas agrupando
 * palabras por posición: primero por coordenada Y (fila), después por X
 * (columna) dentro de cada fila.
 *
 * Es heurístico, no un modelo entrenado para tablas — funciona bien con
 * fotos derechas y nítidas de tablas de 3 columnas numéricas, pero puede
 * fallar con fotos torcidas, borrosas o con formatos distintos. Por eso
 * siempre se le pide al usuario que revise los valores antes de simular.
 */
import { replaceRows } from './table.js';

const TESSERACT_SRC = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';

const dropZone = document.getElementById('imgDrop');
const input = document.getElementById('imgInput');
const msg = document.getElementById('imgMsg');

let tesseractLoadPromise = null;

function loadTesseract() {
  if (window.Tesseract) return Promise.resolve();
  if (tesseractLoadPromise) return tesseractLoadPromise;
  tesseractLoadPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = TESSERACT_SRC;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('No se pudo cargar la librería de OCR (revisá tu conexión).'));
    document.head.appendChild(script);
  });
  return tesseractLoadPromise;
}

/** Agrupa palabras numéricas en filas por cercanía vertical, y las ordena de izquierda a derecha dentro de cada fila. */
function wordsToRows(words) {
  const numeric = words
    .filter((w) => /^\d+$/.test(w.text.trim()))
    .map((w) => ({
      value: parseInt(w.text, 10),
      cx: (w.bbox.x0 + w.bbox.x1) / 2,
      cy: (w.bbox.y0 + w.bbox.y1) / 2,
      h: w.bbox.y1 - w.bbox.y0
    }));
  if (numeric.length === 0) return [];

  numeric.sort((a, b) => a.cy - b.cy);
  const avgH = numeric.reduce((s, w) => s + w.h, 0) / numeric.length;
  const rowGap = avgH * 0.7;

  const rows = [];
  let current = [];
  let currentY = null;
  numeric.forEach((w) => {
    if (currentY === null || Math.abs(w.cy - currentY) <= rowGap) {
      current.push(w);
      currentY = current.reduce((s, x) => s + x.cy, 0) / current.length;
    } else {
      rows.push(current);
      current = [w];
      currentY = w.cy;
    }
  });
  if (current.length) rows.push(current);

  return rows.map((row) => row.sort((a, b) => a.cx - b.cx).map((w) => w.value));
}

/** Espera exactamente 3 números por fila: Job, Llegada, Ráfaga de CPU. */
function rowsToProcesses(rows) {
  const procs = [];
  let skipped = 0;
  rows.forEach((row) => {
    if (row.length !== 3) { skipped++; return; }
    const [job, arrival, burst] = row;
    procs.push({ name: `P${job}`, arrival, burst, priority: procs.length + 1 });
  });
  return { procs, skipped };
}

function setMsg(text, kind) {
  msg.textContent = text;
  msg.className = 'code-msg' + (kind ? ` ${kind}` : '');
}

async function handleFile(file) {
  if (!file) return;
  if (!file.type.startsWith('image/')) {
    setMsg('Eso no es una imagen. Soltá una foto o captura de la tabla (JPG, PNG...).', 'err');
    return;
  }
  dropZone.setAttribute('aria-disabled', 'true');
  setMsg('Cargando el lector de imágenes…');

  try {
    await loadTesseract();
    setMsg('Leyendo la tabla de la imagen… puede tardar unos segundos.');

    const { data } = await window.Tesseract.recognize(file, 'eng');
    const rows = wordsToRows(data.words || []);
    const { procs, skipped } = rowsToProcesses(rows);

    if (procs.length === 0) {
      setMsg('No pude reconocer ninguna fila con 3 números (Job, Llegada, Ráfaga). Probá con una foto más nítida y derecha, o cargalo a mano.', 'err');
      return;
    }

    replaceRows(procs);
    const note = skipped > 0 ? ` (${skipped} fila(s) no se pudieron leer bien, revisalas)` : '';
    setMsg(`Se importaron ${procs.length} proceso(s) desde la imagen${note}. Revisá los números antes de simular — el OCR no es perfecto.`, skipped > 0 ? 'warn' : '');
  } catch (err) {
    setMsg(`No se pudo leer la imagen: ${err.message}`, 'err');
  } finally {
    dropZone.removeAttribute('aria-disabled');
    input.value = '';
  }
}

export function initImageImport() {
  dropZone.addEventListener('click', () => input.click());
  dropZone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); }
  });
  input.addEventListener('change', () => handleFile(input.files[0]));

  let dragCounter = 0;
  dropZone.addEventListener('dragenter', (e) => {
    e.preventDefault();
    dragCounter++;
    dropZone.classList.add('dragover');
  });
  dropZone.addEventListener('dragover', (e) => e.preventDefault());
  dropZone.addEventListener('dragleave', () => {
    dragCounter = Math.max(0, dragCounter - 1);
    if (dragCounter === 0) dropZone.classList.remove('dragover');
  });
  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dragCounter = 0;
    dropZone.classList.remove('dragover');
    handleFile(e.dataTransfer.files[0]);
  });

  // Evita que soltar la imagen fuera de la zona navegue a la imagen y pierda la página.
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => { if (e.target !== dropZone && !dropZone.contains(e.target)) e.preventDefault(); });
}
