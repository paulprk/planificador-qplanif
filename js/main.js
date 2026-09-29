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

const QUANTUM_ALGOS = ['rr', 'vrr', 'pri_rr'];

function updateFieldVisibility() {
  const vrrOpt = algoSel.querySelector('option[value="vrr"]');
  vrrOpt.hidden = mode !== 'io';
  vrrOpt.disabled = mode !== 'io';
  if (mode !== 'io' && algoSel.value === 'vrr') algoSel.value = 'rr';
  const needsQuantum = QUANTUM_ALGOS.includes(algoSel.value);
  quantumField.classList.toggle('show', needsQuantum);
  setPriorityColumnVisible(PRIORITY_ALGOS.includes(algoSel.value));
  resourceAlgoField.classList.toggle('show', mode === 'io');
  agingField.classList.toggle('show', algoSel.value === 'pri' || algoSel.value === 'pri_exp');
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
function burstSeqText(t, taskIdx) {
  const frag = document.createDocumentFragment();
  t.bursts.forEach((b, i) => {
    if (i > 0) {
      const arrow = document.createElement('span');
      arrow.className = 'io-arrow';
      arrow.textContent = '→';
      frag.appendChild(arrow);
    }
    const span = document.createElement('span');
    span.className = b.res === 0 ? 'io-burst cpu' : 'io-burst';
    const label = document.createElement('span');
    if (b.res !== 0) label.dataset.resLabel = b.res;
    label.textContent = `${b.res === 0 ? 'CPU' : ioResourceNames[b.res - 1]} ${b.dur}`;
    span.appendChild(label);
    if (b.res !== 0) {
      const x = document.createElement('button');
      x.type = 'button';
      x.className = 'io-burst-x';
      x.textContent = '×';
      x.title = 'Quitar este pedido de E/S';
      x.setAttribute('aria-label', `Quitar pedido de E/S ${ioResourceNames[b.res - 1]}`);
      x.dataset.removeBurst = i;
      x.dataset.ioIdx = taskIdx;
      span.appendChild(x);
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

const DEVICE_SUGGESTIONS = ['Red', 'Impresora', 'Disco', 'Teclado', 'Pantalla', 'Scanner', 'USB'];

function nextDeviceName() {
  const taken = new Set(ioResourceNames.map((n) => n.toLowerCase()));
  const free = DEVICE_SUGGESTIONS.find((n) => !taken.has(n.toLowerCase()));
  if (free) return free;
  let k = ioResourceNames.length + 1;
  while (taken.has(`dispositivo ${k}`)) k++;
  return `Dispositivo ${k}`;
}

function cleanDeviceName(raw) {
  return raw.replace(/["\[\],#]/g, '').trim();
}

function isDeviceUsed(resIdx) {
  return ioTasks.some((t) => t.bursts.some((b) => b.res === resIdx));
}

function syncIoCode() {
  codeInput.value = defTextFromIoTasks(ioTasks, ioResourceNames);
}

function buildDevicesBlock() {
  const box = document.createElement('div');
  box.className = 'io-devices';

  const title = document.createElement('div');
  title.className = 'io-summary-resources';
  title.textContent = 'Dispositivos de E/S';
  box.appendChild(title);

  const list = document.createElement('div');
  list.className = 'io-device-list';
  ioResourceNames.forEach((name, i) => {
    const row = document.createElement('div');
    row.className = 'io-device';
    const num = document.createElement('span');
    num.className = 'io-device-num';
    num.textContent = i + 1;
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'name-cell';
    input.value = name;
    input.dataset.deviceIdx = i;
    input.setAttribute('aria-label', `Nombre del dispositivo ${i + 1}`);
    const rm = document.createElement('button');
    rm.type = 'button';
    rm.className = 'rm-btn';
    rm.textContent = '×';
    rm.dataset.removeDevice = i;
    const used = isDeviceUsed(i + 1);
    rm.disabled = used;
    rm.title = used ? 'Lo usa algún proceso: quitá primero sus pedidos de E/S' : 'Quitar dispositivo';
    rm.setAttribute('aria-label', `Quitar dispositivo ${name}`);
    row.append(num, input, rm);
    list.appendChild(row);
  });
  if (ioResourceNames.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'io-device-empty';
    empty.textContent = 'Todavía no hay dispositivos.';
    list.appendChild(empty);
  }
  box.appendChild(list);

  const foot = document.createElement('div');
  foot.className = 'io-device-foot';
  const add = document.createElement('button');
  add.type = 'button';
  add.dataset.addDevice = '1';
  add.textContent = '+ Agregar dispositivo';
  const hint = document.createElement('span');
  hint.className = 'io-device-hint';
  hint.textContent = 'Cada dispositivo atiende a un proceso por vez. Si está ocupado, el que lo pide espera en su cola.';
  foot.append(add, hint);
  box.appendChild(foot);
  return box;
}

function addIoControl(taskIdx) {
  const wrap = document.createElement('span');
  wrap.className = 'io-add';
  if (ioResourceNames.length === 0) return wrap;
  const sel = document.createElement('select');
  sel.className = 'io-add-sel';
  sel.dataset.addIoSel = taskIdx;
  sel.setAttribute('aria-label', 'Dispositivo para el nuevo pedido de E/S');
  ioResourceNames.forEach((n, i) => {
    const o = document.createElement('option');
    o.value = i + 1;
    o.textContent = n;
    sel.appendChild(o);
  });
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'io-add-btn';
  btn.textContent = '+ E/S';
  btn.title = 'Agrega un pedido de E/S de 2 unidades y una ráfaga de CPU de 1 al final';
  btn.dataset.addIo = taskIdx;
  wrap.append(sel, btn);
  return wrap;
}

function mergeAdjacentCpu(bursts) {
  const out = [];
  bursts.forEach((b) => {
    const last = out[out.length - 1];
    if (last && last.res === 0 && b.res === 0) last.dur += b.dur;
    else out.push({ ...b });
  });
  return out;
}

function renderIoSummary() {
  ioSummary.innerHTML = '';
  if (!ioTasks) return;

  ioSummary.appendChild(buildDevicesBlock());

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
    seq.appendChild(burstSeqText(t, i));
    seq.appendChild(addIoControl(i));

    row.append(name, meta, seq);
    ioSummary.appendChild(row);
  });
}

ioSummary.addEventListener('input', (e) => {
  if (e.target.dataset.deviceIdx !== undefined && ioTasks) {
    const i = Number(e.target.dataset.deviceIdx);
    const name = cleanDeviceName(e.target.value);
    const clash = ioResourceNames.some((n, j) => j !== i && n.toLowerCase() === name.toLowerCase());
    const bad = !name || /^cpu$/i.test(name) || /^\d+$/.test(name) || clash;
    e.target.classList.toggle('invalid', bad);
    if (bad) return;
    ioResourceNames[i] = name;
    ioSummary.querySelectorAll(`[data-res-label="${i + 1}"]`).forEach((el) => {
      el.textContent = `${name} ${el.textContent.split(' ').pop()}`;
    });
    ioSummary.querySelectorAll('.io-add-sel').forEach((sel) => { sel.options[i].textContent = name; });
    syncIoCode();
    return;
  }
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


ioSummary.addEventListener('focusout', (e) => {
  if (e.target.dataset.deviceIdx === undefined || !e.target.classList.contains('invalid')) return;
  e.target.value = ioResourceNames[Number(e.target.dataset.deviceIdx)];
  e.target.classList.remove('invalid');
});

ioSummary.addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  if (!btn || !ioTasks) return;
  const d = btn.dataset;
  if (d.addDevice) {
    ioResourceNames.push(nextDeviceName());
  } else if (d.removeDevice !== undefined) {
    const res = Number(d.removeDevice) + 1;
    if (isDeviceUsed(res)) return;
    ioResourceNames.splice(res - 1, 1);
    ioTasks.forEach((t) => t.bursts.forEach((b) => { if (b.res > res) b.res -= 1; }));
  } else if (d.addIo !== undefined) {
    const t = ioTasks[Number(d.addIo)];
    const sel = ioSummary.querySelector(`[data-add-io-sel="${d.addIo}"]`);
    t.bursts.push({ res: Number(sel.value), dur: 2 }, { res: 0, dur: 1 });
    t.usesResources = true;
  } else if (d.removeBurst !== undefined) {
    const t = ioTasks[Number(d.ioIdx)];
    t.bursts.splice(Number(d.removeBurst), 1);
    t.bursts = mergeAdjacentCpu(t.bursts);
    t.usesResources = t.bursts.some((b) => b.res !== 0);
  } else {
    return;
  }
  renderIoSummary();
  syncIoCode();
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
function readCpuOptions() {
  const contextSwitch = Math.max(0, parseInt(ctxInput.value, 10) || 0);
  const aging = Math.max(0, parseInt(agingInput.value, 10) || 0);
  return { contextSwitch, aging };
}

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
  const cpuOpts = readCpuOptions();
  const { ok, result, error } = runAlgorithm(algo, procs, quantum, cpuOpts);
  if (!ok) {
    errMsg.textContent = error;
    errMsg.classList.add('show');
    return;
  }

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
    agingLog: result.agingLog
  });
  showComparison({
    ioMode: false,
    numResources: 0,
    current: { algo, quantum: needsQuantum ? quantum : null },
    runOne: (a, q) => {
      const r = runAlgorithm(a, procs, q, cpuOpts).result;
      return { procs, segments: r.segments, finish: r.finish };
    }
  });
}

function runIoSimulation() {
  const algo = algoSel.value;
  const quantum = parseInt(quantumInput.value, 10);
  const needsQuantum = QUANTUM_ALGOS.includes(algo);
  if (needsQuantum && (isNaN(quantum) || quantum <= 0)) {
    errMsg.textContent = 'El quantum debe ser un número mayor a 0.';
    errMsg.classList.add('show');
    return;
  }

  const simTasks = ioTasks.map((t, i) => ({
    id: `io${i}`, order: i, name: t.name, arrival: t.arrival, priority: t.priority, bursts: t.bursts
  }));

  const cpuOpts = readCpuOptions();
  const resourceAlgo = resourceAlgoSel.value;
  const result = simulateWithResources({
    tasks: simTasks, resourceNames: ioResourceNames, cpuAlgo: algo, resourceAlgo, quantum, ...cpuOpts
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
    agingLog: result.agingLog,
    resourceLabels: result.resources,
    resourceAlgo
  });
  showComparison({
    ioMode: true,
    numResources: ioResourceNames.length,
    current: { algo, quantum: needsQuantum ? quantum : null },
    runOne: (a, q) => {
      const r = simulateWithResources({
        tasks: simTasks, resourceNames: ioResourceNames, cpuAlgo: a, resourceAlgo, quantum: q || 1, ...cpuOpts
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
