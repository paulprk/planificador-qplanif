/**
 * Mantiene el textarea de código sincronizado con el estado actual de la
 * tabla de procesos, sin importar cómo haya llegado ahí (tipeo manual,
 * botones +/✕, importación por código, importación por imagen o "Restaurar
 * ejemplo"). Un MutationObserver sobre #procBody cubre los cambios
 * estructurales (filas agregadas/quitadas/reemplazadas) y un listener de
 * "input" delegado cubre la edición de valores.
 *
 * Mientras el usuario está escribiendo directamente en el textarea, se deja
 * de sincronizar (no le pisamos el cursor ni lo que está tipeando) hasta que
 * lo carga con "Cargar código" — ese mismo "Cargar código" dispara igual el
 * MutationObserver de #procBody y vuelve a sincronizar el textarea con lo
 * que efectivamente quedó cargado.
 */
import { readProcesses } from './table.js';
import { defTextFromProcesses } from './parser.js';

const procBody = document.getElementById('procBody');
const codeInput = document.getElementById('codeInput');

function render() {
  if (document.activeElement === codeInput) return;
  const procs = readProcesses();
  codeInput.value = procs.length ? defTextFromProcesses(procs) : '';
}

export function initCodePreview() {
  render();
  procBody.addEventListener('input', render);
  codeInput.addEventListener('blur', render);
  new MutationObserver(render).observe(procBody, { childList: true, subtree: true });
}
