/**
 * Mantiene el textarea de código sincronizado con el estado actual de la
 * tabla de procesos, sin importar cómo haya llegado ahí (tipeo manual,
 * botones +/✕, importación por código, importación por imagen o "Restaurar
 * ejemplo"). Un MutationObserver sobre #procBody cubre los cambios
 * estructurales (filas agregadas/quitadas/reemplazadas) y un listener de
 * "input" delegado cubre la edición de valores.
 *
 * Mientras el usuario está escribiendo directamente en el textarea, se deja
 * de sincronizar (no le pisamos el cursor ni lo que está tipeando). No hay
 * un listener de "blur" para volver a sincronizar al salir del campo: el
 * click en "Cargar código" también dispara blur ANTES que el propio click,
 * así que un blur-sync ahí pisaría lo que el usuario acaba de pegar justo
 * antes de que el handler del botón llegue a leerlo. En cambio, "Cargar
 * código" dispara igual el MutationObserver de #procBody (si el resultado
 * fue al modo simple) y ese sí vuelve a sincronizar el textarea con lo que
 * efectivamente quedó cargado.
 *
 * En modo E/S (tareas con recursos, ver main.js) la tabla simple no se
 * toca, así que este módulo se desactiva por completo — si no, el próximo
 * blur del textarea pisaría el código de E/S recién cargado con la
 * representación de la tabla simple desactualizada.
 */
import { readProcesses } from './table.js';
import { defTextFromProcesses } from './parser.js';

const procBody = document.getElementById('procBody');
const codeInput = document.getElementById('codeInput');

let enabled = true;

function render() {
  if (!enabled || document.activeElement === codeInput) return;
  const procs = readProcesses();
  codeInput.value = procs.length ? defTextFromProcesses(procs) : '';
}

export function setCodePreviewEnabled(value) {
  enabled = value;
  if (enabled) render();
}

// --- Tamaño de la letra del código (botones A− / A+), recordado entre visitas ---
const CODE_SIZE_KEY = 'codeFontSize';
const CODE_SIZE_MIN = 0.75;
const CODE_SIZE_MAX = 2;
let codeSize = 1.05;

function applyCodeSize(delta) {
  codeSize = Math.min(CODE_SIZE_MAX, Math.max(CODE_SIZE_MIN, +(codeSize + delta).toFixed(2)));
  codeInput.style.setProperty('--code-size', `${codeSize}rem`);
  document.getElementById('codeSmaller').disabled = codeSize <= CODE_SIZE_MIN;
  document.getElementById('codeBigger').disabled = codeSize >= CODE_SIZE_MAX;
  try { localStorage.setItem(CODE_SIZE_KEY, String(codeSize)); } catch (e) { /* ignorar */ }
}

function initCodeSize() {
  try {
    const saved = parseFloat(localStorage.getItem(CODE_SIZE_KEY));
    if (saved >= CODE_SIZE_MIN && saved <= CODE_SIZE_MAX) codeSize = saved;
  } catch (e) { /* sin almacenamiento: se usa el tamaño por defecto */ }
  document.getElementById('codeSmaller').addEventListener('click', () => applyCodeSize(-0.1));
  document.getElementById('codeBigger').addEventListener('click', () => applyCodeSize(0.1));
  applyCodeSize(0);
}

export function initCodePreview() {
  initCodeSize();
  render();
  procBody.addEventListener('input', render);
  new MutationObserver(render).observe(procBody, { childList: true, subtree: true });
}
