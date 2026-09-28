/**
 * Punto de entrada: conecta la tabla de procesos, el selector de algoritmo,
 * el cargador de código `.def` y el Gantt entre sí. No contiene lógica de
 * simulación ni de renderizado propia — solo orquesta los demás módulos.
 *
 * Modo simple / Modo E/S: son dos configuraciones independientes que la app
 * recuerda por separado — la tabla simple (una ráfaga de CPU por proceso) y
 * el último lote de E/S cargado por código (tareas con ráfagas alternadas
 * CPU/recurso, simuladas con iosim.js). El toggle de abajo de "01 Lote de
 * procesos" solo cambia cuál de las dos se está viendo/simulando, no borra
 * la otra — así no hace falta volver a pegar el código de E/S cada vez que
 * se pasa a modo simple y se vuelve. "Restaurar ejemplo" sí resetea todo.
 */
import { PRIORITY_ALGOS, ALGO_NAMES, runAlgorithm } from './algorithms.js';
import { parseDefText, defTextFromIoTasks } from './parser.js';
import { loadDefault, readProcesses, addDefaultRow, replaceRows, setPriorityColumnVisible } from './table.js';
import { initPlayback, renderSimulation } from './gantt.js';
import { renderResults } from './results.js';
import { initCodePreview, setCodePreviewEnabled } from './codepreview.js';
import { simulateWithResources } from './iosim.js';
import { PALETTE } from './colors.js';

const algoSel = document.getElementById('algo');
const quantumField = document.getElementById('quantumField');
const quantumInput = document.getElementById('quantum');
const resourceAlgoField = document.getElementById('resourceAlgoField');
const resourceAlgoSel = document.getElementById('resourceAlgo');
const errMsg = document.getElementById('errMsg');
const procTable = document.getElementById('procTable');
const addRowBtn = document.getElementById('addRow');
const ioSummary = document.getElementById('ioSummary');
const codeInput = document.getElementById('codeInput');

const RESOURCE_ALGO_NAMES = { fcfs: 'FCFS', sjf: 'SJF', pri: 'Prioridades' };

let mode = 'simple'; // 'simple' | 'io'
let ioTasks = null;
let ioResourceNames = [];

function updateFieldVisibility() {
  const needsQuantum = algoSel.value === 'rr' || algoSel.value === 'pri_rr';
  quantumField.classList.toggle('show', needsQuantum);
  setPriorityColumnVisible(PRIORITY_ALGOS.includes(algoSel.value));
  resourceAlgoField.classList.toggle('show', mode === 'io');
}
algoSel.addEventListener('change', updateFieldVisibility);

document.getElementById('addRow').addEventListener('click', addDefaultRow);
document.getElementById('resetRows').addEventListener('click', () => {
  ioTasks = null;
  ioResourceNames = [];
  loadDefault();
  setMode('simple');
});

// --- Toggle Modo simple / Modo E/S ---
function burstSeqText(t) {
  const spans = t.bursts.map((b) => {
    const span = document.createElement('span');
    span.className = b.res === 0 ? 'io-burst cpu' : 'io-burst';
    span.textContent = b.res === 0 ? `CPU ${b.dur}` : `${ioResourceNames[b.res - 1]} ${b.dur}`;
    return span;
  });
  const frag = document.createDocumentFragment();
  spans.forEach((span, i) => {
    if (i > 0) {
      const arrow = document.createElement('span');
      arrow.className = 'io-arrow';
      arrow.textContent = '→';
      frag.appendChild(arrow);
    }
    frag.appendChild(span);
  });
  return frag;
}

function renderIoSummary() {
  ioSummary.innerHTML = '';

  if (!ioTasks) {
    const empty = document.createElement('div');
    empty.className = 'io-summary-empty';
    empty.textContent = 'Todavía no cargaste ningún lote con E/S. Abrí "Ver / cargar código", escribí RECURSO/TAREA con ráfagas de recurso (ej: [R1,3]) y tocá "Cargar código".';
    ioSummary.appendChild(empty);
    return;
  }

  const resLine = document.createElement('div');
  resLine.className = 'io-summary-resources';
  resLine.textContent = `Recursos declarados: ${ioResourceNames.join(', ') || '(ninguno)'}`;
  ioSummary.appendChild(resLine);

  ioTasks.forEach((t, i) => {
    const row = document.createElement('div');
    row.className = 'io-task';

    const name = document.createElement('span');
    name.className = 'name-tag';
    const sw = document.createElement('span');
    sw.className = 'swatch';
    sw.style.background = `var(--${PALETTE[i % PALETTE.length]})`;
    name.append(sw, document.createTextNode(t.name));

    const meta = document.createElement('span');
    meta.className = 'meta';
    meta.textContent = `llega ${t.arrival}, prioridad ${t.priority}`;

    const seq = document.createElement('span');
    seq.className = 'seq';
    seq.appendChild(burstSeqText(t));

    row.append(name, meta, seq);
    ioSummary.appendChild(row);
  });
}

function setMode(newMode) {
  mode = newMode;
  document.querySelectorAll('.mode-btn').forEach((b) => b.classList.toggle('active', b.dataset.mode === mode));

  const isIo = mode === 'io';
  procTable.hidden = isIo;
  addRowBtn.hidden = isIo;
  ioSummary.hidden = !isIo;
  setCodePreviewEnabled(!isIo);
  if (isIo) {
    renderIoSummary();
    if (ioTasks) {
      codeInput.value = defTextFromIoTasks(ioTasks, ioResourceNames);
    } else {
      codeInput.focus();
    }
  }
  updateFieldVisibility();
  runSimulation();
}

document.querySelectorAll('.mode-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    if (btn.dataset.mode === mode) return;
    setMode(btn.dataset.mode);
  });
});

// --- Carga de procesos por código (formato .def de qplanif) ---
document.getElementById('loadCode').addEventListener('click', () => {
  const msg = document.getElementById('codeMsg');
  msg.className = 'code-msg';
  const raw = codeInput.value;
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
    ioTasks = usable;
    ioResourceNames = resourceNames;
    setMode('io');
    msg.textContent = `Cargadas ${usable.length} tarea(s) con ${resourceNames.length} recurso(s) de E/S.`;
    msg.className = 'code-msg';
  } else {
    replaceRows(usable.map((t) => ({
      name: t.name,
      arrival: t.arrival,
      priority: t.priority,
      burst: t.bursts.reduce((s, b) => s + b.dur, 0)
    })));
    setMode('simple');
    const notes = [];
    if (usable.length !== tasks.length) notes.push(`${tasks.length - usable.length} tarea(s) sin ráfaga de CPU se ignoraron`);
    msg.textContent = `Cargadas ${usable.length} tarea(s).${notes.length ? ` ${notes.join('; ')}.` : ''}`;
    msg.className = notes.length ? 'code-msg warn' : 'code-msg';
  }
});

// --- Simulación ---
function runSimulation() {
  errMsg.classList.remove('show');

  if (mode === 'io') {
    if (ioTasks) runIoSimulation();
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
resourceAlgoSel.addEventListener('change', () => { if (mode === 'io') runSimulation(); });

// --- Arranque ---
initPlayback();
loadDefault();
initCodePreview();
updateFieldVisibility();
runSimulation();
