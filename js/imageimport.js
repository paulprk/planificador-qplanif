/**
 * Importar el lote de procesos desde una foto/captura de una tabla tipo
 * "Job | Llegada | Unidades de CPU". La imagen se reduce en el navegador
 * (para subir menos datos y respetar el límite de tamaño de la función) y
 * se manda a /api/parse-image, que le pide a Gemini que lea la tabla y
 * devuelva los procesos como JSON. La API key de Gemini vive solo en el
 * servidor (variable de entorno en Vercel), nunca acá.
 */
import { replaceRows } from './table.js';

const dropZone = document.getElementById('imgDrop');
const input = document.getElementById('imgInput');
const msg = document.getElementById('imgMsg');

const MAX_DIM = 1600;
const JPEG_QUALITY = 0.85;

/** Reduce la imagen a un tamaño manejable y la devuelve como data URL (JPEG). */
function toResizedDataURL(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      let { width, height } = img;
      if (width > MAX_DIM || height > MAX_DIM) {
        const scale = MAX_DIM / Math.max(width, height);
        width = Math.round(width * scale);
        height = Math.round(height * scale);
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      canvas.getContext('2d').drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/jpeg', JPEG_QUALITY));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('No se pudo leer el archivo como imagen.')); };
    img.src = url;
  });
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
  setMsg('Leyendo la tabla con IA… puede tardar unos segundos.');

  try {
    const dataUrl = await toResizedDataURL(file);

    const resp = await fetch('/api/parse-image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: dataUrl })
    });
    const result = await resp.json();

    if (!result.ok) {
      setMsg(result.error || 'No se pudo leer la imagen.', 'err');
      return;
    }
    if (result.procs.length === 0) {
      setMsg('No reconocí ninguna fila válida en la tabla. Probá con una foto más nítida, o cargalo a mano.', 'err');
      return;
    }

    replaceRows(result.procs);
    setMsg(`Se importaron ${result.procs.length} proceso(s) desde la imagen. Revisá los números antes de simular.`);
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
