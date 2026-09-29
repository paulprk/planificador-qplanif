/**
 * Cola de listos: para el instante actual de la reproducción, qué procesos
 * están esperando (llegaron, no terminaron, no están corriendo) y en qué
 * orden serían atendidos. En modo simple hay una sola cola (CPU); en modo
 * E/S hay una fila por cada recurso (CPU + cada dispositivo declarado),
 * porque cada uno tiene su propia cola independiente.
 */
import { readyQueueAt } from './algorithms.js';
import { ioReadyQueueAt, ioAuxCountAt } from './iosim.js';
import { colorFor } from './colors.js';

const wrapEl = document.getElementById('readyQueueWrap');

let lastAlgo = null;
let lastProcs = null;
let lastSegments = [];
let lastFinish = {};
let lastReadyLog = null;
let lastIoMode = false;
let lastResourceLabels = null;

function makeRow(label) {
  const row = document.createElement('div');
  row.className = 'ready-queue';
  const lab = document.createElement('span');
  lab.className = 'ready-queue-label';
  lab.textContent = label;
  const items = document.createElement('div');
  items.className = 'ready-queue-items';
  row.append(lab, items);
  wrapEl.appendChild(row);
  return items;
}

function renderChips(container, tasks, auxCount = 0) {
  container.innerHTML = '';
  if (tasks.length === 0) {
    const empty = document.createElement('span');
    empty.className = 'ready-queue-empty';
    empty.textContent = 'vacía';
    container.appendChild(empty);
    return;
  }
  tasks.forEach((p, i) => {
    const colorKey = colorFor(lastProcs, p.id);
    const chip = document.createElement('span');
    chip.className = 'ready-chip' + (i < auxCount ? ' aux' : '');
    if (i < auxCount) chip.title = 'Cola auxiliar: volvió de E/S con quantum pendiente y se atiende antes que la cola de listos.';
    chip.style.background = `var(--${colorKey}-soft)`;
    chip.style.borderColor = `var(--${colorKey})`;

    const pos = document.createElement('span');
    pos.className = 'pos';
    pos.textContent = String(i + 1);
    chip.appendChild(pos);

    const name = document.createElement('span');
    name.textContent = p.name;
    chip.appendChild(name);

    container.appendChild(chip);
  });
}

export function setReadyQueueData({ algo, procs, segments, finish, readyLog, ioMode, resourceLabels }) {
  lastAlgo = algo;
  lastProcs = procs;
  lastSegments = segments;
  lastFinish = finish;
  lastReadyLog = readyLog ?? null;
  lastIoMode = Boolean(ioMode);
  lastResourceLabels = resourceLabels || null;

  wrapEl.innerHTML = '';
  if (!procs) return;

  if (lastIoMode) {
    lastResourceLabels.forEach((label, res) => {
      const items = makeRow(label);
      items.dataset.res = res;
    });
  } else {
    makeRow('Cola de listos').id = 'readyQueueItemsSimple';
  }
}

export function renderReadyQueueAt(t) {
  if (!lastProcs) return;

  if (lastIoMode) {
    wrapEl.querySelectorAll('.ready-queue-items').forEach((el) => {
      const res = Number(el.dataset.res);
      const ids = ioReadyQueueAt(lastReadyLog, res, t);
      const tasks = ids.map((id) => lastProcs.find((p) => p.id === id)).filter(Boolean);
      renderChips(el, tasks, res === 0 && lastAlgo === 'vrr' ? ioAuxCountAt(lastReadyLog, t) : 0);
    });
    return;
  }

  const items = document.getElementById('readyQueueItemsSimple');
  if (!items) return;
  const queue = readyQueueAt(lastAlgo, lastProcs, lastSegments, lastFinish, lastReadyLog, t);
  renderChips(items, queue);
}
