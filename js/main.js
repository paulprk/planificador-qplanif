/**
 * Punto de entrada: conecta la tabla de procesos, el selector de algoritmo,
 * el cargador de código `.def` y el Gantt entre sí. No contiene lógica de
 * simulación ni de renderizado propia — solo orquesta los demás módulos.
 *
 * Modo simple / Modo E/S / Colas multinivel: son configuraciones
 * independientes que la app recuerda por separado — la tabla simple (una
 * ráfaga de CPU por proceso, en table.js) y el último lote de E/S de cada
 * modo (tareas con ráfagas alternadas CPU/recurso, en ioeditor.js). El
 * selector de modo solo cambia cuál se está viendo/simulando, no borra las
 * otras — así no hace falta volver a pegar el código de E/S cada vez que se
 * pasa a modo simple y se vuelve. "Restaurar ejemplo" sí resetea el modo actual.
 */
import { PRIORITY_ALGOS, QUANTUM_ALGOS, MLQ_ALGOS, ALGO_NAMES, runAlgorithm } from './algorithms.js';
import { parseDefText, usableTasks } from './parser.js';
import { initPaging, getPagingState, setPagingState } from './paging.js';
import { loadDefault, readProcesses, addDefaultRow, replaceRows, setPriorityColumnVisible } from './table.js';
import { initPlayback, renderSimulation } from './gantt.js';
import { renderResults } from './results.js';
import { computeMetrics } from './metrics.js';
import { buildRows, renderComparison, parseQuantums } from './compare.js';
import { initCodePreview, setCodePreviewEnabled } from './codepreview.js';
import { simulateWithResources } from './iosim.js';
import { getIoLote, setIoLote, loadDefaultIoLote, ioCodeText, renderIoEditor } from './ioeditor.js';
import { initSharePanel } from './sharepanel.js';

const algoSel = document.getElementById('algo');
const quantumField = document.getElementById('quantumField');
const quantumInput = document.getElementById('quantum');
const agingField = document.getElementById('agingField');
const ctxInput = document.getElementById('ctxCost');
const agingInput = document.getElementById('aging');
const resourceAlgoField = document.getElementById('resourceAlgoField');
const resourceAlgoSel = document.getElementById('resourceAlgo');
const errMsg = document.getElementById('errMsg');
const procTable = document.getElementById('procTable');
const addRowBtn = document.getElementById('addRow');
const ioSummary = document.getElementById('ioSummary');
const codeInput = document.getElementById('codeInput');

const RESOURCE_ALGO_NAMES = { fcfs: 'FCFS', sjf: 'SJF', pri: 'Prioridades' };
const MLQ_NAMES = { pri_rr: 'Colas multinivel con apropiación', pri_rr_ne: 'Colas multinivel sin apropiación' };

let mode = 'simple'; // 'simple' | 'io' | 'mlq' | 'paging'
const lotePorModo = { io: null, mlq: null };
const isIoLike = (m = mode) => m === 'io' || m === 'mlq';

function loadDefaultIo() {
  loadDefaultIoLote(mode === 'mlq');
  if (mode === 'mlq') quantumInput.value = '3';
}

function showError(text) {
  errMsg.textContent = text;
  errMsg.classList.add('show');
}

function updateFieldVisibility() {
  const mlq = mode === 'mlq';
  [...algoSel.options].forEach((o) => {
    const show = mlq ? MLQ_ALGOS.includes(o.value) : o.value !== 'pri_rr_ne' && (o.value !== 'vrr' || mode === 'io');
    o.hidden = !show;
    o.disabled = !show;
  });
  algoSel.querySelector('option[value="pri_rr"]').textContent = mlq ? 'Con apropiación entre colas' : 'Prioridades + Round Robin';
  document.querySelector('label[for="algo"]').textContent = mlq ? 'Apropiación' : 'Algoritmo de scheduling';
  if (algoSel.selectedOptions[0] && algoSel.selectedOptions[0].disabled) algoSel.value = mlq ? 'pri_rr_ne' : (algoSel.value === 'pri_rr_ne' ? 'pri_rr' : 'rr');
  quantumField.classList.toggle('show', QUANTUM_ALGOS.includes(algoSel.value));
  setPriorityColumnVisible(PRIORITY_ALGOS.includes(algoSel.value));
  resourceAlgoField.classList.toggle('show', isIoLike());
  agingField.classList.toggle('show', PRIORITY_ALGOS.includes(algoSel.value));
}
algoSel.addEventListener('change', updateFieldVisibility);

addRowBtn.addEventListener('click', addDefaultRow);
document.getElementById('resetRows').addEventListener('click', () => {
  if (isIoLike()) {
    loadDefaultIo();
    setMode(mode);
  } else {
    loadDefault();
    setMode('simple');
  }
});

// --- Selector de modo ---
const modeIndicator = document.getElementById('modeIndicator');
function moveModeIndicator() {
  const activeBtn = document.querySelector('.mode-btn.active');
  if (!activeBtn || !modeIndicator) return;
  modeIndicator.style.width = `${activeBtn.offsetWidth}px`;
  modeIndicator.style.height = `${activeBtn.offsetHeight}px`;
  modeIndicator.style.transform = `translate(${activeBtn.offsetLeft}px, ${activeBtn.offsetTop}px)`;
}

function markActiveMode() {
  document.querySelectorAll('.mode-btn').forEach((b) => {
    const on = b.dataset.mode === mode;
    b.classList.toggle('active', on);
    b.setAttribute('aria-pressed', String(on));
  });
  moveModeIndicator();
}

function setMode(newMode, { keepLote = false } = {}) {
  document.body.dataset.mode = newMode;
  if (newMode === 'paging') {
    if (isIoLike()) lotePorModo[mode] = getIoLote();
    mode = newMode;
    markActiveMode();
    initPaging();
    return;
  }
  if (newMode !== mode) {
    if (isIoLike()) lotePorModo[mode] = getIoLote();
    if (isIoLike(newMode) && !keepLote) setIoLote(lotePorModo[newMode]);
  }
  mode = newMode;
  document.getElementById('mlqIntro').hidden = mode !== 'mlq';
  markActiveMode();

  const isIo = isIoLike();
  procTable.hidden = isIo;
  addRowBtn.hidden = isIo;
  ioSummary.hidden = !isIo;
  setCodePreviewEnabled(!isIo);
  if (isIo) {
    if (!getIoLote().tasks) loadDefaultIo();
    renderIoEditor();
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
  const { tasks, resourceNames } = parseDefText(codeInput.value);
  const { usable, error } = usableTasks(tasks);
  if (error) {
    msg.textContent = error;
    msg.className = 'code-msg err';
    return;
  }

  if (usable.some((t) => t.usesResources) || mode === 'mlq') {
    setIoLote({ tasks: usable, names: resourceNames });
    setMode(mode === 'mlq' ? 'mlq' : 'io', { keepLote: true });
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
// Tope de instantes simulados: un lote más largo dejaría colgada la pestaña (el motor avanza de a una
// unidad y el Gantt dibuja cada una). Los ejercicios reales quedan muy por debajo.
const MAX_SIM_TIME = 5000;
const INCOMPLETE_MSG = `La simulación se cortó: el lote necesita más de ${MAX_SIM_TIME} unidades de tiempo. Achicá las ráfagas, las llegadas o el costo de cambio de contexto.`;

function readCpuOptions() {
  const contextSwitch = Math.max(0, parseInt(ctxInput.value, 10) || 0);
  const aging = Math.max(0, parseInt(agingInput.value, 10) || 0);
  return { contextSwitch, aging, maxTime: MAX_SIM_TIME };
}

function runSimulation() {
  errMsg.classList.remove('show');
  errMsg.textContent = '';

  if (isIoLike()) {
    if (getIoLote().tasks) runIoSimulation();
    return;
  }

  const procs = readProcesses();
  if (procs.length === 0) return showError('Agregá al menos un proceso.');
  if (procs.some((p) => p.burst <= 0)) return showError('La ráfaga de CPU debe ser mayor a 0 para todos los procesos.');

  const algo = algoSel.value;
  const quantum = parseInt(quantumInput.value, 10);
  const cpuOpts = readCpuOptions();
  const { ok, result, error } = runAlgorithm(algo, procs, quantum, cpuOpts);
  if (!ok) return showError(error);
  if (result.completed < result.total) return showError(INCOMPLETE_MSG);

  const needsQuantum = QUANTUM_ALGOS.includes(algo);
  const labelText = ALGO_NAMES[algo] + (needsQuantum ? ` · quantum = ${quantumInput.value}` : '');

  const metrics = computeMetrics({ procs, segments: result.segments, finish: result.finish });
  renderResults(procs, result.finish, metrics, null, result.switches);
  renderSimulation({
    procs,
    segments: result.segments,
    finish: result.finish,
    labelText,
    showPriority: PRIORITY_ALGOS.includes(algo),
    quantumText: needsQuantum ? quantumInput.value : null,
    algo,
    readyLog: result.readyLog,
    switches: result.switches,
    quantumTrace: result.quantumTrace,
    agingLog: result.agingLog,
    aging: cpuOpts.aging
  });
  showComparison({
    ioMode: false,
    numResources: 0,
    current: { algo, quantum: needsQuantum ? quantum : null },
    runOne: (a, q) => {
      const r = runAlgorithm(a, procs, q, cpuOpts).result;
      return { procs, segments: r.segments, finish: r.finish, incomplete: r.completed < r.total };
    }
  });
}

function runIoSimulation() {
  const { tasks: ioTasks, names: ioResourceNames } = getIoLote();
  const algo = algoSel.value;
  const quantum = parseInt(quantumInput.value, 10);
  const needsQuantum = QUANTUM_ALGOS.includes(algo);
  if (needsQuantum && (isNaN(quantum) || quantum <= 0)) return showError('El quantum debe ser un número mayor a 0.');

  const simTasks = ioTasks.map((t, i) => ({
    id: `io${i}`, order: i, name: t.name, arrival: t.arrival, priority: t.priority, bursts: t.bursts
  }));

  const cpuOpts = readCpuOptions();
  const resourceAlgo = resourceAlgoSel.value;
  const result = simulateWithResources({
    tasks: simTasks, resourceNames: ioResourceNames, cpuAlgo: algo, resourceAlgo, quantum, ...cpuOpts
  });
  if (result.completed < result.total) return showError(INCOMPLETE_MSG);

  const procsForResults = simTasks.map((t) => ({
    id: t.id,
    name: t.name,
    arrival: t.arrival,
    burst: t.bursts.filter((b) => b.res === 0).reduce((s, b) => s + b.dur, 0),
    priority: t.priority
  }));

  const labelText = (mode === 'mlq' ? MLQ_NAMES[algo] : ALGO_NAMES[algo])
    + (needsQuantum ? ` · quantum = ${quantumInput.value}` : '')
    + ` · E/S: ${RESOURCE_ALGO_NAMES[resourceAlgo]}`;

  const metrics = computeMetrics({
    procs: procsForResults, segments: result.segments, finish: result.finish, numResources: ioResourceNames.length
  });
  renderResults(procsForResults, result.finish, metrics, result.resources, result.switches);
  renderSimulation({
    procs: procsForResults,
    segments: result.segments,
    finish: result.finish,
    labelText,
    showPriority: PRIORITY_ALGOS.includes(algo) || resourceAlgo === 'pri',
    quantumText: needsQuantum ? quantumInput.value : null,
    algo,
    readyLog: result.readyLog,
    vrrLog: result.vrrLog,
    switches: result.switches,
    quantumTrace: result.quantumTrace,
    agingLog: result.agingLog,
    aging: cpuOpts.aging,
    resourceLabels: result.resources,
    resourceAlgo
  });
  showComparison({
    ioMode: true,
    algos: mode === 'mlq' ? MLQ_ALGOS : undefined,
    numResources: ioResourceNames.length,
    current: { algo, quantum: needsQuantum ? quantum : null },
    runOne: (a, q) => {
      const r = simulateWithResources({
        tasks: simTasks, resourceNames: ioResourceNames, cpuAlgo: a, resourceAlgo, quantum: q || 1, ...cpuOpts
      });
      return { procs: procsForResults, segments: r.segments, finish: r.finish, incomplete: r.completed < r.total };
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
  const { runOne, numResources, ioMode, current, algos } = lastComparison;
  let quantums = parseQuantums(cmpQuantums.value);
  if (current.quantum && !quantums.includes(current.quantum)) {
    quantums = [...quantums, current.quantum].sort((a, b) => a - b);
  }
  if (quantums.length === 0) quantums = [2];
  const rows = buildRows({ quantums, runOne, numResources, algos });
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
resourceAlgoSel.addEventListener('change', () => { if (isIoLike()) runSimulation(); });

// --- Compartir: qué datos viajan en el código y cómo se aplican al recibirlo ---
// Un código puede venir de cualquiera, así que se acota lo que se acepta antes de dibujarlo.
const SHARE_MAX_TASKS = 50;
const SHARE_NO_DATA = 'El código no tiene datos que se puedan cargar.';
const SHARE_TOO_BIG = 'El código trae un lote demasiado grande para este simulador: no se cargó.';

function shareData() {
  if (mode === 'paging') return getPagingState();
  const opts = { a: algoSel.value, q: quantumInput.value, cs: ctxInput.value, ag: agingInput.value };
  if (isIoLike()) return { ...opts, ra: resourceAlgoSel.value, d: ioCodeText() };
  return { ...opts, p: readProcesses().map((p) => [p.name, p.arrival, p.burst, p.priority]) };
}

function applyOptions(d) {
  const num = (v, min) => (Number.isFinite(Number(v)) && Number(v) >= min ? String(Math.floor(Number(v))) : null);
  if (num(d.q, 1)) quantumInput.value = num(d.q, 1);
  if (num(d.cs, 0)) ctxInput.value = num(d.cs, 0);
  if (num(d.ag, 0)) agingInput.value = num(d.ag, 0);
  if (d.ra && [...resourceAlgoSel.options].some((o) => o.value === d.ra)) resourceAlgoSel.value = d.ra;
  const opt = [...algoSel.options].find((o) => o.value === d.a);
  if (opt && !opt.disabled) algoSel.value = d.a;
  updateFieldVisibility();
  runSimulation();
}

/** Carga en `target` los datos de un código compartido. Devuelve null, o el mensaje de error. */
function applyShare(target, d) {
  if (target === 'paging') {
    setMode('paging');
    setPagingState(d || {});
    return null;
  }
  if (target === 'simple') {
    const rows = (Array.isArray(d.p) ? d.p : []).slice(0, SHARE_MAX_TASKS).map(([name, arrival, burst, priority]) => ({
      name: String(name ?? '').slice(0, 20), arrival: Number(arrival) || 0, burst: Number(burst) || 1, priority: Number(priority) || 0
    }));
    if (!rows.length) return SHARE_NO_DATA;
    const time = rows.reduce((s, r) => s + r.burst, 0) + Math.max(...rows.map((r) => r.arrival));
    if (!(time <= MAX_SIM_TIME)) return SHARE_TOO_BIG;
    replaceRows(rows);
    setMode('simple');
  } else {
    const { tasks, resourceNames } = parseDefText(String(d.d || ''));
    const { usable, error } = usableTasks(tasks);
    if (error) return SHARE_NO_DATA;
    const lote = usable.slice(0, SHARE_MAX_TASKS);
    const time = lote.reduce((s, t) => s + t.bursts.reduce((a, b) => a + b.dur, 0), 0) + Math.max(...lote.map((t) => t.arrival));
    if (!(time <= MAX_SIM_TIME) || resourceNames.length > SHARE_MAX_TASKS) return SHARE_TOO_BIG;
    setIoLote({ tasks: lote, names: resourceNames });
    setMode(target, { keepLote: true });
  }
  applyOptions(d);
  return null;
}

// --- Arranque ---
initPlayback();
loadDefault();
initCodePreview();
updateFieldVisibility();
markActiveMode();
window.addEventListener('resize', moveModeIndicator);
runSimulation();
initSharePanel({ getMode: () => mode, getData: shareData, apply: applyShare });
