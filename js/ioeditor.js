/**
 * Editor del lote de E/S (Modo E/S y Colas multinivel): la lista de
 * dispositivos y, por cada tarea, su nombre, llegada, prioridad y la
 * secuencia de ráfagas CPU / dispositivo. Es el dueño del lote de E/S: los
 * demás módulos lo leen con `getIoLote()` y lo reemplazan con `setIoLote()`.
 * Cada edición reescribe el código del lote en el textarea.
 */
import { parseDefText, defTextFromIoTasks, cleanName } from './parser.js';
import { PALETTE } from './colors.js';

const ioSummary = document.getElementById('ioSummary');
const codeInput = document.getElementById('codeInput');

const DEFAULT_IO_TEXT = `RECURSO "R1"

TAREA "P1"
INICIO=0 [CPU,2] [1,3] [CPU,1]

TAREA "P2"
INICIO=1 [CPU,4]`;

const DEFAULT_MLQ_TEXT = `RECURSO "R1"
RECURSO "R2"
RECURSO "R3"

TAREA "P1"
INICIO=0 PRIORIDAD=1 [CPU,4] [1,2] [CPU,2] [2,3] [CPU,2] [1,3] [CPU,1]

TAREA "P2"
INICIO=1 PRIORIDAD=2 [CPU,3] [3,2] [CPU,1] [3,2] [CPU,1]

TAREA "P3"
INICIO=2 PRIORIDAD=3 [CPU,4] [1,1] [CPU,1]

TAREA "P4"
INICIO=3 PRIORIDAD=2 [CPU,1] [2,2] [CPU,4] [2,3] [CPU,2]

TAREA "P5"
INICIO=5 PRIORIDAD=1 [CPU,2] [1,3] [CPU,2] [3,3] [CPU,1]`;

const DEVICE_SUGGESTIONS = ['Red', 'Impresora', 'Disco', 'Teclado', 'Pantalla', 'Scanner', 'USB'];

let ioTasks = null;
let ioResourceNames = [];

/** El lote cargado: `{ tasks, names }` (`tasks` es null si todavía no hay ninguno). */
export function getIoLote() {
  return { tasks: ioTasks, names: ioResourceNames };
}

/** Reemplaza el lote; con `null` lo deja vacío. No redibuja: después va `renderIoEditor()`. */
export function setIoLote(lote) {
  ioTasks = lote ? lote.tasks : null;
  ioResourceNames = lote ? lote.names : [];
}

/** Carga el ejemplo por defecto (el de colas multinivel si `mlq`). */
export function loadDefaultIoLote(mlq) {
  const parsed = parseDefText(mlq ? DEFAULT_MLQ_TEXT : DEFAULT_IO_TEXT);
  ioTasks = parsed.tasks;
  ioResourceNames = parsed.resourceNames;
}

/** El lote en formato `.def`, igual al que se ve en el textarea. */
export function ioCodeText() {
  return defTextFromIoTasks(ioTasks || [], ioResourceNames);
}

function syncIoCode() {
  codeInput.value = ioCodeText();
}

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
    name.append(sw, ioField('text', t.name, 'name', i, { ariaLabel: 'Nombre del proceso' }));

    const meta = document.createElement('span');
    meta.className = 'meta';
    meta.append(
      'llega ',
      ioField('number', t.arrival, 'arrival', i, { min: 0, ariaLabel: `Instante de llegada de ${t.name}` }),
      ', prioridad ',
      ioField('number', t.priority, 'priority', i, { min: 0, ariaLabel: `Prioridad de ${t.name}` })
    );

    const seq = document.createElement('span');
    seq.className = 'seq';
    seq.appendChild(burstSeqText(t, i));
    seq.appendChild(addIoControl(i));

    row.append(name, meta, seq);
    ioSummary.appendChild(row);
  });
}

/** Dibuja el editor con el lote actual y actualiza el código del textarea. */
export function renderIoEditor() {
  renderIoSummary();
  syncIoCode();
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
    const clean = cleanName(e.target.value);
    if (clean !== e.target.value) e.target.value = clean;
    task.name = clean || `P${idx + 1}`;
  } else {
    const n = parseInt(e.target.value, 10);
    task[field] = isNaN(n) ? 0 : n;
  }
  syncIoCode();
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
  renderIoEditor();
});
