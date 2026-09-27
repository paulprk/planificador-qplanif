/**
 * Punto de entrada: conecta la tabla de procesos, el selector de algoritmo,
 * el cargador de código `.def` y el Gantt entre sí. No contiene lógica de
 * simulación ni de renderizado propia — solo orquesta los demás módulos.
 */
import { PRIORITY_ALGOS, ALGO_NAMES, runAlgorithm } from './algorithms.js';
import { parseDefText } from './parser.js';
import { loadDefault, readProcesses, addDefaultRow, replaceRows, setPriorityColumnVisible } from './table.js';
import { initPlayback, renderSimulation } from './gantt.js';
import { renderResults } from './results.js';

const algoSel = document.getElementById('algo');
const quantumField = document.getElementById('quantumField');
const quantumInput = document.getElementById('quantum');
const errMsg = document.getElementById('errMsg');

function updateFieldVisibility() {
  const needsQuantum = algoSel.value === 'rr' || algoSel.value === 'pri_rr';
  quantumField.classList.toggle('show', needsQuantum);
  setPriorityColumnVisible(PRIORITY_ALGOS.includes(algoSel.value));
}
algoSel.addEventListener('change', updateFieldVisibility);

document.getElementById('addRow').addEventListener('click', addDefaultRow);
document.getElementById('resetRows').addEventListener('click', loadDefault);

// --- Carga de procesos por código (formato .def de qplanif) ---
const codeBox = document.getElementById('codeBox');
document.getElementById('toggleCode').addEventListener('click', () => {
  codeBox.hidden = !codeBox.hidden;
  if (!codeBox.hidden) document.getElementById('codeInput').focus();
});

document.getElementById('loadCode').addEventListener('click', () => {
  const msg = document.getElementById('codeMsg');
  msg.className = 'code-msg';
  const raw = document.getElementById('codeInput').value;
  const tasks = parseDefText(raw);

  if (tasks.length === 0) {
    msg.textContent = 'No encontré ninguna TAREA en el texto. Revisá el formato.';
    msg.className = 'code-msg err';
    return;
  }
  const usable = tasks.filter((t) => t.hasCpu && t.burst > 0);
  if (usable.length === 0) {
    msg.textContent = 'Ninguna tarea tiene ráfagas de CPU válidas ([CPU,n]).';
    msg.className = 'code-msg err';
    return;
  }

  replaceRows(usable);

  const notes = [];
  if (usable.length !== tasks.length) {
    notes.push(`${tasks.length - usable.length} tarea(s) sin ráfaga de CPU se ignoraron`);
  }
  if (tasks.some((t) => t.hasOther)) {
    notes.push('las referencias a recursos de E/S se ignoraron (no soportado todavía)');
  }
  msg.textContent = `Cargadas ${usable.length} tarea(s).${notes.length ? ` ${notes.join('; ')}.` : ''}`;
  msg.className = notes.length ? 'code-msg warn' : 'code-msg';
});

// --- Simulación ---
function runSimulation() {
  errMsg.classList.remove('show');

  const procs = readProcesses();
  if (procs.length === 0) {
    errMsg.textContent = 'Agregá al menos un proceso.';
    errMsg.classList.add('show');
    return;
  }
  if (procs.some((p) => p.burst <= 0)) {
    errMsg.textContent = 'La ráfaga de CPU debe ser mayor a 0 para todos los procesos.';
    errMsg.classList.add('show');
    return;
  }

  const algo = algoSel.value;
  const quantum = parseInt(quantumInput.value, 10);
  const { ok, result, error } = runAlgorithm(algo, procs, quantum);
  if (!ok) {
    errMsg.textContent = error;
    errMsg.classList.add('show');
    return;
  }

  const needsQuantum = algo === 'rr' || algo === 'pri_rr';
  const labelText = ALGO_NAMES[algo] + (needsQuantum ? ` · quantum = ${quantumInput.value}` : '');

  renderResults(procs, result.finish);
  renderSimulation({
    procs,
    segments: result.segments,
    finish: result.finish,
    labelText,
    showPriority: PRIORITY_ALGOS.includes(algo),
    quantumText: needsQuantum ? quantumInput.value : null
  });
}

document.getElementById('simBtn').addEventListener('click', runSimulation);

// --- Arranque ---
initPlayback();
loadDefault();
updateFieldVisibility();
runSimulation();
