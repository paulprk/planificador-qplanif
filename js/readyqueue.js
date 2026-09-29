/**
 * Cola de listos: para el instante actual de la reproducción, qué procesos
 * están esperando (llegaron, no terminaron, no están corriendo) y en qué
 * orden serían atendidos. En modo simple hay una sola cola (CPU); en modo
 * E/S hay una fila por cada recurso (CPU + cada dispositivo declarado),
 * porque cada uno tiene su propia cola independiente.
 */
import { ioReadyQueueAt, ioAuxCountAt } from './iosim.js';
import { colorFor } from './colors.js';
import { flipRender, resetFlip } from './flip.js';

const wrapEl = document.getElementById('readyQueueWrap');

let lastAlgo = null;
let lastProcs = null;
let lastSegments = [];
let lastFinish = {};
let lastReadyLog = null;
let lastIoMode = false;
let lastResourceLabels = null;
let lastVrrLog = null;

function makeRow(label, hint) {
  const row = document.createElement('div');
  row.className = 'ready-queue';
  const lab = document.createElement('span');
  lab.className = 'ready-queue-label';
  lab.textContent = label;
  const items = document.createElement('div');
  items.className = 'ready-queue-items';
  row.append(lab, items);
  if (hint) {
    const h = document.createElement('p');
    h.className = 'ready-queue-hint';
    h.textContent = hint;
    row.appendChild(h);
  }
  wrapEl.appendChild(row);
  return items;
}

const HINT_CPU = 'Procesos listos esperando la CPU, en el orden en que se atenderán: el 1 es el próximo en ejecutarse.';
const HINT_CPU_VRR = 'Cola de listos normal: procesos que esperan la CPU y todavía no usaron su turno. Se atiende solo cuando la cola auxiliar está vacía. Cada uno recibe un quantum completo.';
const HINT_AUX = 'Acá esperan los procesos que volvieron de E/S sin haber gastado todo su quantum. Se atiende ANTES que la cola de listos, y cada proceso usa solo el quantum que le sobraba ("resta"). Así no pierde su turno por haber ido a E/S.';
const hintDevice = (label) => `Procesos esperando que el dispositivo ${label} se libere, en el orden en que se atenderán.`;

function restoAt(id, t) {
  if (!lastVrrLog) return null;
  let r = null;
  for (const e of lastVrrLog.aux) {
    if (e.t > t) break;
    if (e.id === id) r = e.resto;
  }
  return r;
}

function renderChips(container, tasks, auxCount = 0, t = 0, emptyText = 'vacía') {
  container.innerHTML = '';
  if (tasks.length === 0) {
    const empty = document.createElement('span');
    empty.className = 'ready-queue-empty';
    empty.textContent = emptyText;
    container.appendChild(empty);
    return;
  }
  tasks.forEach((p, i) => {
    const colorKey = colorFor(lastProcs, p.id);
    const chip = document.createElement('span');
    chip.className = 'ready-chip' + (i < auxCount ? ' aux' : '');
    chip.dataset.pid = p.id;
    if (i < auxCount) chip.title = 'Volvió de E/S con quantum pendiente: se atiende antes que la cola de listos.';
    chip.style.background = `var(--${colorKey}-soft)`;
    chip.style.borderColor = `var(--${colorKey})`;

    const pos = document.createElement('span');
    pos.className = 'pos';
    pos.textContent = String(i + 1);
    chip.appendChild(pos);

    const name = document.createElement('span');
    name.textContent = p.name;
    chip.appendChild(name);

    if (i < auxCount) {
      const resto = restoAt(p.id, t);
      if (resto != null) {
        const r = document.createElement('span');
        r.className = 'resto';
        r.textContent = `resta ${resto}`;
        chip.appendChild(r);
      }
    }

    container.appendChild(chip);
  });
}

export function setReadyQueueData({ algo, procs, segments, finish, readyLog, ioMode, resourceLabels, vrrLog }) {
  lastAlgo = algo;
  lastProcs = procs;
  lastSegments = segments;
  lastFinish = finish;
  lastReadyLog = readyLog ?? null;
  lastIoMode = Boolean(ioMode);
  lastResourceLabels = resourceLabels || null;
  lastVrrLog = vrrLog || null;
  resetFlip();

  wrapEl.innerHTML = '';
  if (!procs) return;

  if (lastIoMode) {
    const vrr = algo === 'vrr';
    lastResourceLabels.forEach((label, res) => {
      if (res === 0 && vrr) {
        makeRow('Cola auxiliar (VRR)', HINT_AUX).dataset.res = 'aux';
      }
      const hint = res === 0 ? (vrr ? HINT_CPU_VRR : HINT_CPU) : hintDevice(label);
      makeRow(label, hint).dataset.res = res;
    });
  } else {
    makeRow('Cola de listos', HINT_CPU).id = 'readyQueueItemsSimple';
  }
}

export function renderReadyQueueAt(t) {
  if (!lastProcs) return;
  flipRender([wrapEl], () => drawReadyQueueAt(t), t, 'ready');
}

function drawReadyQueueAt(t) {

  if (lastIoMode) {
    const vrr = lastAlgo === 'vrr';
    const auxCount = vrr ? ioAuxCountAt(lastReadyLog, t) : 0;
    wrapEl.querySelectorAll('.ready-queue-items').forEach((el) => {
      const isAux = el.dataset.res === 'aux';
      const res = isAux ? 0 : Number(el.dataset.res);
      const ids = ioReadyQueueAt(lastReadyLog, res, t);
      const tasks = ids.map((id) => lastProcs.find((p) => p.id === id)).filter(Boolean);
      if (isAux) renderChips(el, tasks.slice(0, auxCount), auxCount, t, 'vacía: nadie volvió de E/S con quantum pendiente');
      else renderChips(el, res === 0 && vrr ? tasks.slice(auxCount) : tasks);
    });
    return;
  }

  const items = document.getElementById('readyQueueItemsSimple');
  if (!items) return;
  const ids = ioReadyQueueAt(lastReadyLog, 0, t);
  renderChips(items, ids.map((id) => lastProcs.find((p) => p.id === id)).filter(Boolean));
}
