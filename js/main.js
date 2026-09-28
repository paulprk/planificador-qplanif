/**
 * Punto de entrada: conecta la tabla de procesos, el selector de algoritmo,
 * el cargador de código `.def` y el Gantt entre sí. No contiene lógica de
 * simulación ni de renderizado propia — solo orquesta los demás módulos.
 *
 * Modo E/S: si el código cargado declara recursos (RECURSO "...") y alguna
 * tarea los usa, la app deja de usar la tabla simple (una ráfaga de CPU por
 * proceso) y pasa a simular con iosim.js, que soporta tareas con ráfagas
 * alternadas entre la CPU y distintos recursos. "Restaurar ejemplo" vuelve
 * siempre al modo simple.
 */
import { PRIORITY_ALGOS, ALGO_NAMES, runAlgorithm } from './algorithms.js';
import { parseDefText } from './parser.js';
import { loadDefault, readProcesses, addDefaultRow, replaceRows, setPriorityColumnVisible } from './table.js';
import { initPlayback, renderSimulation } from './gantt.js';
import { renderResults } from './results.js';
import { initImageImport } from './imageimport.js';
import { initCodePreview, setCodePreviewEnabled } from './codepreview.js';
import { simulateWithResources } from './iosim.js';

const algoSel = document.getElementById('algo');
const quantumField = document.getElementById('quantumField');
const quantumInput = document.getElementById('quantum');
const resourceAlgoField = document.getElementById('resourceAlgoField');
const resourceAlgoSel = document.getElementById('resourceAlgo');
const errMsg = document.getElementById('errMsg');
const procTable = document.getElementById('procTable');
const addRowBtn = document.getElementById('addRow');
const ioSummary = document.getElementById('ioSummary');
const ioBadge = document.getElementById('ioBadge');

const RESOURCE_ALGO_NAMES = { fcfs: 'FCFS', sjf: 'SJF', pri: 'Prioridades' };

let ioMode = false;
let ioTasks = null;
let ioResourceNames = [];

function updateFieldVisibility() {
  const needsQuantum = algoSel.value === 'rr' || algoSel.value === 'pri_rr';
  quantumField.classList.toggle('show', needsQuantum);
  setPriorityColumnVisible(PRIORITY_ALGOS.includes(algoSel.value));
  resourceAlgoField.hidden = !ioMode;
}
algoSel.addEventListener('change', updateFieldVisibility);

document.getElementById('addRow').addEventListener('click', addDefaultRow);
document.getElementById('resetRows').addEventListener('click', () => {
  exitIoMode();
  loadDefault();
  runSimulation();
});

// --- Modo E/S: entrar/salir, y resumen de solo lectura del lote cargado ---
function exitIoMode() {
  ioMode = false;
  ioTasks = null;
  ioResourceNames = [];
  procTable.hidden = false;
  addRowBtn.hidden = false;
  ioSummary.hidden = true;
  ioBadge.hidden = true;
  setCodePreviewEnabled(true);
  updateFieldVisibility();
}

function burstSeqText(bursts) {
  return bursts
    .map((b) => (b.res === 0 ? `CPU:${b.dur}` : `${ioResourceNames[b.res - 1]}:${b.dur}`))
    .join(' → ');
}

function renderIoSummary() {
  ioSummary.innerHTML = '';
  const resLine = document.createElement('div');
  resLine.className = 'io-summary-resources';
  resLine.textContent = `Recursos declarados: ${ioResourceNames.join(', ') || '(ninguno)'}`;
  ioSummary.appendChild(resLine);

  ioTasks.forEach((t) => {
    const row = document.createElement('div');
    row.className = 'io-task';
    const name = document.createElement('span');
    name.className = 'name-tag';
    name.textContent = t.name;
    const meta = document.createElement('span');
    meta.className = 'meta';
    meta.textContent = `llega ${t.arrival}, prioridad ${t.priority}`;
    const seq = document.createElement('span');
    seq.className = 'seq';
    seq.textContent = burstSeqText(t.bursts);
    row.append(name, meta, seq);
    ioSummary.appendChild(row);
  });
}

function enterIoMode(tasks, resourceNames) {
  ioMode = true;
  ioTasks = tasks;
  ioResourceNames = resourceNames;
  procTable.hidden = true;
  addRowBtn.hidden = true;
  ioBadge.hidden = false;
  ioSummary.hidden = false;
  renderIoSummary();
  setCodePreviewEnabled(false);
  updateFieldVisibility();
}

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
  const { tasks, resourceNames } = parseDefText(raw);

  if (tasks.length === 0) {
    msg.textContent = 'No encontré ninguna TAREA en el texto. Revisá el formato.';
    msg.className = 'code-msg err';
    return;
  }
  const usable = tasks.filter((t) => t.hasCpu && t.bursts.some((b) => b.res === 0 && b.dur > 0));
  if (usable.length === 0) {
    msg.textContent = 'Ninguna tarea tiene ráfagas de CPU válidas ([CPU,n]).';
    msg.className = 'code-msg err';
    return;
  }

  if (usable.some((t) => t.usesResources)) {
    enterIoMode(usable, resourceNames);
    msg.textContent = `Cargadas ${usable.length} tarea(s) con ${resourceNames.length} recurso(s) de E/S. Modo E/S activado — mirá "01 Lote de procesos" arriba.`;
    msg.className = 'code-msg';
  } else {
    exitIoMode();
    replaceRows(usable.map((t) => ({
      name: t.name,
      arrival: t.arrival,
      priority: t.priority,
      burst: t.bursts.reduce((s, b) => s + b.dur, 0)
    })));
    const notes = [];
    if (usable.length !== tasks.length) notes.push(`${tasks.length - usable.length} tarea(s) sin ráfaga de CPU se ignoraron`);
    msg.textContent = `Cargadas ${usable.length} tarea(s).${notes.length ? ` ${notes.join('; ')}.` : ''}`;
    msg.className = notes.length ? 'code-msg warn' : 'code-msg';
  }
});

// --- Simulación ---
function runSimulation() {
  errMsg.classList.remove('show');

  if (ioMode) {
    runIoSimulation();
    return;
  }

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
    quantumText: needsQuantum ? quantumInput.value : null,
    algo,
    readyLog: result.readyLog
  });
}

function runIoSimulation() {
  const algo = algoSel.value;
  const quantum = parseInt(quantumInput.value, 10);
  const needsQuantum = algo === 'rr' || algo === 'pri_rr';
  if (needsQuantum && (isNaN(quantum) || quantum <= 0)) {
    errMsg.textContent = 'El quantum debe ser un número mayor a 0.';
    errMsg.classList.add('show');
    return;
  }

  const simTasks = ioTasks.map((t, i) => ({
    id: `io${i}`, order: i, name: t.name, arrival: t.arrival, priority: t.priority, bursts: t.bursts
  }));

  const resourceAlgo = resourceAlgoSel.value;
  const result = simulateWithResources({
    tasks: simTasks, resourceNames: ioResourceNames, cpuAlgo: algo, resourceAlgo, quantum
  });

  const procsForResults = simTasks.map((t) => ({
    id: t.id,
    name: t.name,
    arrival: t.arrival,
    burst: t.bursts.filter((b) => b.res === 0).reduce((s, b) => s + b.dur, 0),
    priority: t.priority
  }));

  const labelText = ALGO_NAMES[algo]
    + (needsQuantum ? ` · quantum = ${quantumInput.value}` : '')
    + ` · E/S: ${RESOURCE_ALGO_NAMES[resourceAlgo]}`;

  renderResults(procsForResults, result.finish);
  renderSimulation({
    procs: procsForResults,
    segments: result.segments,
    finish: result.finish,
    labelText,
    showPriority: PRIORITY_ALGOS.includes(algo) || resourceAlgo === 'pri',
    quantumText: needsQuantum ? quantumInput.value : null,
    algo,
    readyLog: null,
    resourceLabels: result.resources
  });
}

document.getElementById('simBtn').addEventListener('click', runSimulation);
resourceAlgoSel.addEventListener('change', () => { if (ioMode) runSimulation(); });

// --- Arranque ---
initPlayback();
initImageImport();
loadDefault();
initCodePreview();
updateFieldVisibility();
runSimulation();
