/**
 * Cola de listos: para el instante actual de la reproducción, qué procesos
 * están esperando (llegaron, no terminaron, no están corriendo) y en qué
 * orden serían atendidos. En modo simple hay una sola cola (CPU); en modo
 * E/S hay una fila por cada recurso (CPU + cada dispositivo declarado),
 * porque cada uno tiene su propia cola independiente.
 */
import { ioReadyQueueAt, ioAuxCountAt } from './iosim.js';
import { colorFor } from './colors.js';
import { flipRender, resetFlip, forgetKeys } from './flip.js';

const wrapEl = document.getElementById('readyQueueWrap');

let lastAlgo = null;
let lastProcs = null;
let lastSegments = [];
let lastFinish = {};
let lastReadyLog = null;
let lastIoMode = false;
let lastResourceLabels = null;
let lastVrrLog = null;

function makeRow(label, hint, opts = {}) {
  const row = document.createElement('div');
  row.className = 'ready-queue';
  const lab = document.createElement('span');
  lab.className = 'ready-queue-label';
  lab.textContent = label;
  row.appendChild(lab);
  if (opts.slotCap) {
    const g = document.createElement('div');
    g.className = 'rq-group';
    const cap = document.createElement('span');
    cap.className = 'rq-cap';
    cap.textContent = opts.slotCap;
    const slot = document.createElement('div');
    slot.className = 'rq-slot-items';
    slot.dataset.slotRes = opts.res;
    g.append(cap, slot);
    const arrow = document.createElement('span');
    arrow.className = 'rq-arrow';
    arrow.textContent = '◀';
    arrow.title = 'Los procesos de la cola pasan de a uno hacia acá';
    row.append(g, arrow);
  }
  const g2 = document.createElement('div');
  g2.className = 'rq-group';
  const cap2 = document.createElement('span');
  cap2.className = 'rq-cap';
  cap2.textContent = opts.queueCap || 'Cola de espera';
  const items = document.createElement('div');
  items.className = 'ready-queue-items';
  g2.append(cap2, items);
  row.appendChild(g2);
  if (hint) {
    const h = document.createElement('p');
    h.className = 'ready-queue-hint';
    h.textContent = hint;
    row.appendChild(h);
  }
  wrapEl.appendChild(row);
  return items;
}

const HINT_CPU = 'A la izquierda, el proceso que está usando la CPU. A la derecha, la cola de listos en el orden en que se atenderán: el 1 ("próximo") es el siguiente en pasar a la CPU, y los que llegan o vuelven se ponen al final.';
const HINT_CPU_VRR = 'Cola de listos normal: procesos que esperan la CPU y todavía no usaron su turno. Se atiende solo cuando la cola auxiliar está vacía. Cada uno recibe un quantum completo.';
const HINT_AUX = 'Acá esperan los procesos que volvieron de E/S sin haber gastado todo su quantum. Se atiende ANTES que la cola de listos, y cada proceso usa solo el quantum que le sobraba ("resta"). Así no pierde su turno por haber ido a E/S.';
const hintDevice = (label) => `A la izquierda, el proceso que está usando el dispositivo ${label}. A la derecha, los que esperan que se libere, en el orden en que se atenderán: el 1 ("próximo") es el siguiente.`;

function restoAt(id, t) {
  if (!lastVrrLog) return null;
  let r = null;
  for (const e of lastVrrLog.aux) {
    if (e.t > t) break;
    if (e.id === id) r = e.resto;
  }
  return r;
}

function renderChips(container, tasks, auxCount = 0, t = 0, emptyText = 'nadie espera', showNext = true) {
  container.innerHTML = '';
  if (tasks.length === 0) {
    const empty = document.createElement('span');
    empty.className = 'ready-queue-empty';
    empty.dataset.fade = '';
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

    if (i === 0 && showNext) {
      const next = document.createElement('span');
      next.className = 'next-tag';
      next.textContent = 'próximo';
      chip.appendChild(next);
    }

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
  const entry = document.createElement('span');
  entry.className = 'rq-entry';
  entry.dataset.fade = '';
  entry.textContent = '← los nuevos se suman acá';
  container.appendChild(entry);
}

function renderSlot(container, id) {
  container.innerHTML = '';
  const p = id != null ? lastProcs.find((x) => x.id === id) : null;
  if (!p) {
    const empty = document.createElement('span');
    empty.className = 'ready-queue-empty';
    empty.dataset.fade = '';
    empty.textContent = 'libre';
    container.appendChild(empty);
    return;
  }
  const colorKey = colorFor(lastProcs, p.id);
  const chip = document.createElement('span');
  chip.className = 'ready-chip running';
  chip.dataset.pid = p.id;
  chip.style.background = `var(--${colorKey}-soft)`;
  chip.style.borderColor = `var(--${colorKey})`;
  chip.textContent = p.name;
  container.appendChild(chip);
}

function runningAt(res, t) {
  const seg = lastSegments.find((s) => (s.res || 0) === res && s.start <= t && t < s.end);
  return seg ? seg.id : null;
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
        makeRow('Cola auxiliar (VRR)', HINT_AUX, { queueCap: 'Cola de espera' }).dataset.res = 'aux';
      }
      const hint = res === 0 ? (vrr ? HINT_CPU_VRR : HINT_CPU) : hintDevice(label);
      makeRow(label, hint, { slotCap: res === 0 ? 'Ejecutando' : 'Usando', queueCap: res === 0 ? 'Cola de listos' : 'Cola de espera', res }).dataset.res = res;
    });
  } else {
    makeRow('CPU', HINT_CPU, { slotCap: 'Ejecutando', queueCap: 'Cola de listos', res: 0 }).id = 'readyQueueItemsSimple';
  }
}

let shownT = -1;

export function renderReadyQueueAt(t) {
  if (!lastProcs) return;
  shownT = t;
  flipRender([wrapEl], () => drawReadyQueueAt(t), t, 'ready', document.getElementById('narrationEvents'), 'delay');
}

window.addEventListener('narration-start-replay', () => {
  if (shownT !== 0) return;
  forgetKeys('ready');
  renderReadyQueueAt(0);
});

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
      else if (res === 0 && vrr) renderChips(el, tasks.slice(auxCount), 0, t, 'nadie espera', auxCount === 0);
      else renderChips(el, tasks);
    });
    wrapEl.querySelectorAll('.rq-slot-items').forEach((el) => renderSlot(el, runningAt(Number(el.dataset.slotRes), t)));
    return;
  }

  const items = document.getElementById('readyQueueItemsSimple');
  if (!items) return;
  const ids = ioReadyQueueAt(lastReadyLog, 0, t);
  renderChips(items, ids.map((id) => lastProcs.find((p) => p.id === id)).filter(Boolean));
  wrapEl.querySelectorAll('.rq-slot-items').forEach((el) => renderSlot(el, runningAt(0, t)));
}
