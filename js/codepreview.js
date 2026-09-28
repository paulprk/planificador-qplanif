/**
 * Mantiene sincronizado el bloque de código de solo lectura con el estado
 * actual de la tabla de procesos, sin importar cómo haya llegado ahí (tipeo
 * manual, botones +/✕, importación por código, importación por imagen o
 * "Restaurar ejemplo"). Un MutationObserver sobre #procBody cubre los
 * cambios estructurales (filas agregadas/quitadas/reemplazadas) y un
 * listener de "input" delegado cubre la edición de valores.
 */
import { readProcesses } from './table.js';
import { defTextFromProcesses } from './parser.js';

const procBody = document.getElementById('procBody');
const previewEl = document.getElementById('codePreview');

function render() {
  const procs = readProcesses();
  previewEl.textContent = procs.length ? defTextFromProcesses(procs) : '(agregá al menos un proceso)';
}

export function initCodePreview() {
  render();
  procBody.addEventListener('input', render);
  new MutationObserver(render).observe(procBody, { childList: true, subtree: true });
}
