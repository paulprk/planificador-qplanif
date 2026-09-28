/**
 * Cola de listos: fila horizontal que muestra, para el instante actual de la
 * reproducción, qué procesos están en memoria esperando CPU (llegaron, no
 * terminaron, no están corriendo) y en qué orden serían atendidos.
 */
import { readyQueueAt } from './algorithms.js';
import { colorFor } from './colors.js';

const itemsEl = document.getElementById('readyQueueItems');

let lastAlgo = null;
let lastProcs = null;
let lastSegments = [];
let lastFinish = {};
let lastReadyLog = null;
let lastIoMode = false;

export function setReadyQueueData({ algo, procs, segments, finish, readyLog, ioMode }) {
  lastAlgo = algo;
  lastProcs = procs;
  lastSegments = segments;
  lastFinish = finish;
  lastReadyLog = readyLog ?? null;
  lastIoMode = Boolean(ioMode);
}

export function renderReadyQueueAt(t) {
  if (!lastProcs) return;
  if (lastIoMode) {
    itemsEl.innerHTML = '';
    const note = document.createElement('span');
    note.className = 'ready-queue-empty';
    note.textContent = 'no disponible en modo E/S (hay una cola por cada recurso)';
    itemsEl.appendChild(note);
    return;
  }
  const queue = readyQueueAt(lastAlgo, lastProcs, lastSegments, lastFinish, lastReadyLog, t);

  itemsEl.innerHTML = '';
  if (queue.length === 0) {
    const empty = document.createElement('span');
    empty.className = 'ready-queue-empty';
    empty.textContent = 'vacía';
    itemsEl.appendChild(empty);
    return;
  }

  queue.forEach((p, i) => {
    const colorKey = colorFor(lastProcs, p.id);
    const chip = document.createElement('span');
    chip.className = 'ready-chip';
    chip.style.background = `var(--${colorKey}-soft)`;
    chip.style.borderColor = `var(--${colorKey})`;

    const pos = document.createElement('span');
    pos.className = 'pos';
    pos.textContent = String(i + 1);
    chip.appendChild(pos);

    const name = document.createElement('span');
    name.textContent = p.name;
    chip.appendChild(name);

    itemsEl.appendChild(chip);
  });
}
