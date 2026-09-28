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
import { computeMetrics } from './metrics.js';
import { buildRows, renderComparison, parseQuantums } from './compare.js';
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

const DEFAULT_IO_TEXT = `RECURSO "R1"
TAREA "P1" INICIO=0 PRIORIDAD=1 [CPU,2] [R1,3] [CPU,1]
TAREA "P2" INICIO=1 PRIORIDAD=2 [CPU,4]`;

let mode = 'simple'; // 'simple' | 'io'
let ioTasks = null;
let ioResourceNames = [];

function loadDefaultIo() {
  const parsed = parseDefText(DEFAULT_IO_TEXT);
  ioTasks = parsed.tasks;
  ioResourceNames = parsed.resourceNames;
}

function updateFieldVisibility() {
  const needsQuantum = algoSel.value === 'rr' || algoSel.value === 'pri_rr';
  quantumField.classList.toggle('show', needsQuantum);
  setPriorityColumnVisible(PRIORITY_ALGOS.includes(algoSel.value));
  resourceAlgoField.classList.toggle('show', mode === 'io');
}
algoSel.addEventListener('change', updateFieldVisibility);

document.getElementById('addRow').addEventListener('click', addDefaultRow);
document.getElementById('resetRows').addEventListener('click', () => {
  if (mode === 'io') {
    loadDefaultIo();
    setMode('io');
  } else {
    loadDefault();
    setMode('simple');
  }
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

function ioField(type, value, field, idx, extra) {
  const input = document.createElement('input');
  input.type = type;
  input.className = type === 'text' ? 'name-cell' : 'num-cell io-num';
  input.value = value;
  input.dataset.ioField = field;
  input.dataset.ioIdx = idx;
  if (extra) Object.assign(input, extra);
  return input;
}

function renderIoSummary() {
  ioSummary.innerHTML = '';
  if (!ioTasks) return;

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
    name.append(sw, ioField('text', t.name, 'name', i));

    const meta = document.createElement('span');
    meta.className = 'meta';
    meta.append(
      'llega ',
      ioField('number', t.arrival, 'arrival', i, { min: 0 }),
      ', prioridad ',
      ioField('number', t.priority, 'priority', i, { min: 0 })
    );

    const seq = document.createElement('span');
    seq.className = 'seq';
    seq.appendChild(burstSeqText(t));

    row.append(name, meta, seq);
    ioSummary.appendChild(row);
  });
}

ioSummary.addEventListener('input', (e) => {
  const field = e.target.dataset.ioField;
  if (!field || !ioTasks) return;
  const idx = Number(e.target.dataset.ioIdx);
  const task = ioTasks[idx];
  if (!task) return;

  if (field === 'name') {
    task.name = e.target.value || `P${idx + 1}`;
  } else {
    const n = parseInt(e.target.value, 10);
    task[field] = isNaN(n) ? 0 : n;
  }
  codeInput.value = defTextFromIoTasks(ioTasks, ioResourceNames);
});

const modeIndicator = document.getElementById('modeIndicator');
function moveModeIndicator() {
  const activeBtn = document.querySelector('.mode-btn.active');
  if (!activeBtn || !modeIndicator) return;
  modeIndicator.style.width = `${activeBtn.offsetWidth}px`;
  modeIndicator.style.transform = `translateX(${activeBtn.offsetLeft}px)`;
}

function setMode(newMode) {
  mode = newMode;
  document.querySelectorAll('.mode-btn').forEach((b) => b.classList.toggle('active', b.dataset.mode === mode));
  moveModeIndicator();

  const isIo = mode === 'io';
  procTable.hidden = isIo;
  addRowBtn.hidden = isIo;
  ioSummary.hidden = !isIo;
  setCodePreviewEnabled(!isIo);
  if (isIo) {
    if (!ioTasks) loadDefaultIo();
    renderIoSummary();
    codeInput.value = defTextFromIoTasks(ioTasks, ioResourceNames);
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

  const metrics = computeMetrics({ procs, segments: result.segments, finish: result.finish });
  renderResults(procs, result.finish, metrics, null);
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
  showComparison({
    ioMode: false,
    numResources: 0,
    current: { algo, quantum: needsQuantum ? quantum : null },
    runOne: (a, q) => {
      const r = runAlgorithm(a, procs, q).result;
      return { procs, segments: r.segments, finish: r.finish };
    }
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

  const metrics = computeMetrics({
    procs: procsForResults, segments: result.segments, finish: result.finish, numResources: ioResourceNames.length
  });
  renderResults(procsForResults, result.finish, metrics, result.resources);
  renderSimulation({
    procs: procsForResults,
    segments: result.segments,
    finish: result.finish,
    labelText,
    showPriority: PRIORITY_ALGOS.includes(algo) || resourceAlgo === 'pri',
    quantumText: needsQuantum ? quantumInput.value : null,
    algo,
    readyLog: result.readyLog,
    resourceLabels: result.resources,
    resourceAlgo
  });
  showComparison({
    ioMode: true,
    numResources: ioResourceNames.length,
    current: { algo, quantum: needsQuantum ? quantum : null },
    runOne: (a, q) => {
      const r = simulateWithResources({
        tasks: simTasks, resourceNames: ioResourceNames, cpuAlgo: a, resourceAlgo, quantum: q || 1
      });
      return { procs: procsForResults, segments: r.segments, finish: r.finish };
    }
  });
}

// --- Comparación de políticas ---
const cmpQuantums = document.getElementById('cmpQuantums');
let lastComparison = null;

function showComparison(cfg) {
  lastComparison = cfg;
  refreshComparison();
}

function refreshComparison() {
  if (!lastComparison) return;
  const { runOne, numResources, ioMode, current } = lastComparison;
  let quantums = parseQuantums(cmpQuantums.value);
  if (current.quantum && !quantums.includes(current.quantum)) {
    quantums = [...quantums, current.quantum].sort((a, b) => a - b);
  }
  if (quantums.length === 0) quantums = [2];
  const rows = buildRows({ quantums, runOne, numResources });
  renderComparison({
    rows,
    ioMode,
    current,
    onPick: (algo, quantum) => {
      algoSel.value = algo;
      if (quantum) quantumInput.value = quantum;
      updateFieldVisibility();
      runSimulation();
      document.getElementById('ganttPanel').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });
}
cmpQuantums.addEventListener('change', refreshComparison);

document.getElementById('simBtn').addEventListener('click', runSimulation);
resourceAlgoSel.addEventListener('change', () => { if (mode === 'io') runSimulation(); });

// --- Arranque ---
initPlayback();
loadDefault();
initCodePreview();
updateFieldVisibility();
moveModeIndicator();
runSimulation();
