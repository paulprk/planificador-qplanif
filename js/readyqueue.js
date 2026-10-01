/**
 * Cola de listos: para el instante actual de la reproducción, qué procesos
 * están esperando (llegaron, no terminaron, no están corriendo) y en qué
 * orden serían atendidos. En modo simple hay una sola cola (CPU); en modo
 * E/S hay una fila por cada recurso (CPU + cada dispositivo declarado),
 * porque cada uno tiene su propia cola independiente.
 */
import { ioReadyQueueAt, ioAuxCountAt, ioLevelsAt, MLQ_ALGOS } from './iosim.js';
import { colorFor } from './colors.js';
import { flipRender, resetFlip, forgetKeys } from './flip.js';

const wrapEl = document.getElementById('readyQueueWrap');

let sim = null; // la simulación en pantalla: el mismo objeto que arma gantt.js en renderSimulation

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
    if (opts.noQueue) row.appendChild(g);
    else row.append(g, arrow);
  }
  if (opts.noQueue) {
    if (hint) {
      const h = document.createElement('p');
      h.className = 'ready-queue-hint';
      h.textContent = hint;
      row.appendChild(h);
    }
    wrapEl.appendChild(row);
    return null;
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
const HINT_MLQ = 'Cada proceso entra por la izquierda de la cola de su prioridad y sale por la derecha hacia la CPU. La CPU atiende la cola más prioritaria que tenga procesos (la resaltada es la que está atendiendo ahora); dentro de cada cola, en orden (Round Robin). "Próximo" marca al que pasaría a la CPU si se liberara ahora.';
const hintDevice = (label) => `A la izquierda, el proceso que está usando el dispositivo ${label}. A la derecha, los que esperan que se libere, en el orden en que se atenderán: el 1 ("próximo") es el siguiente.`;

function restoAt(id, t) {
  if (!sim.vrrLog) return null;
  let r = null;
  for (const e of sim.vrrLog.aux) {
    if (e.t > t) break;
    if (e.id === id) r = e.resto;
  }
  return r;
}

function renderChips(container, tasks, auxCount = 0, t = 0, emptyText = 'nadie espera', showNext = true, entryText = '← los nuevos se suman acá') {
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
    const colorKey = colorFor(sim.procs, p.id);
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
  entry.textContent = entryText;
  container.appendChild(entry);
}

function renderSlot(container, id) {
  container.innerHTML = '';
  const p = id != null ? procById(id) : null;
  if (!p) {
    const empty = document.createElement('span');
    empty.className = 'ready-queue-empty';
    empty.dataset.fade = '';
    empty.textContent = 'libre';
    container.appendChild(empty);
    return;
  }
  const colorKey = colorFor(sim.procs, p.id);
  const chip = document.createElement('span');
  chip.className = 'ready-chip running';
  chip.dataset.pid = p.id;
  chip.style.background = `var(--${colorKey}-soft)`;
  chip.style.borderColor = `var(--${colorKey})`;
  chip.textContent = p.name;
  container.appendChild(chip);
}

function runningAt(res, t) {
  const seg = sim.segments.find((s) => (s.res || 0) === res && s.start <= t && t < s.end);
  return seg ? seg.id : null;
}

const procById = (id) => sim.procs.find((p) => p.id === id);
const procsOf = (ids) => ids.map(procById).filter(Boolean);
const isMlq = () => MLQ_ALGOS.includes(sim.algo);

/** Arma las filas (vacías) de la cola de listos para una simulación nueva; `renderReadyQueueAt` las llena. */
export function setReadyQueueData(simulation) {
  sim = simulation;
  resetFlip();

  wrapEl.innerHTML = '';
  if (!sim.procs) return;

  const { algo, procs } = sim;
  if (isMlq()) {
    const levels = [...new Set(procs.map((p) => p.priority))].sort((a, b) => a - b);
    const labels = sim.ioMode ? sim.resourceLabels : ['CPU'];
    buildMlqDiagram(levels);
    labels.slice(1).forEach((label, i) => {
      makeRow(label, hintDevice(label), { slotCap: 'Usando', queueCap: 'Cola de espera', res: i + 1 }).dataset.res = i + 1;
    });
    return;
  }

  if (sim.ioMode) {
    const vrr = algo === 'vrr';
    sim.resourceLabels.forEach((label, res) => {
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

function buildMlqDiagram(levels) {
  const { aging, quantum } = sim;
  const box = document.createElement('div');
  box.className = aging > 0 ? 'mlq-diagram with-aging' : 'mlq-diagram';
  const title = document.createElement('p');
  title.className = 'mlq-title';
  title.textContent = 'Colas de listos (de la más prioritaria a la menos)';
  const queues = document.createElement('div');
  queues.className = 'mlq-queues';
  levels.forEach((lv, i) => {
    const row = document.createElement('div');
    row.className = 'mlq-row';
    row.dataset.level = lv;
    const side = document.createElement('span');
    side.className = 'mlq-side';
    if (aging > 0 && i > 0) {
      side.textContent = `↑ sube si espera ${aging} u.`;
      side.title = `Envejecimiento: cada ${aging} unidades esperando en esta cola, el proceso sube a la de arriba. Al conseguir la CPU vuelve a su cola original.`;
    }
    const qbox = document.createElement('div');
    qbox.className = 'mlq-box';
    const head = document.createElement('div');
    head.className = 'mlq-box-head';
    const name = document.createElement('span');
    name.className = 'mlq-box-name';
    name.textContent = `Prioridad ${lv}`;
    const tag = document.createElement('span');
    tag.className = 'mlq-tag';
    tag.textContent = `Round Robin · q = ${quantum ?? '?'}`;
    head.append(name, tag);
    const items = document.createElement('div');
    items.className = 'ready-queue-items mlq-items';
    items.dataset.level = lv;
    qbox.append(head, items);
    const out = document.createElement('span');
    out.className = 'mlq-out';
    out.setAttribute('aria-hidden', 'true');
    row.append(side, qbox, out);
    queues.appendChild(row);
  });
  const cpu = document.createElement('div');
  cpu.className = 'mlq-cpu';
  const cap = document.createElement('span');
  cap.className = 'mlq-cpu-name';
  cap.textContent = 'CPU';
  const slot = document.createElement('div');
  slot.className = 'rq-slot-items mlq-slot';
  slot.dataset.slotRes = 0;
  const note = document.createElement('span');
  note.className = 'mlq-cpu-note';
  note.textContent = 'Si agota el quantum (o lo expropian), vuelve al final de su cola.';
  cpu.append(cap, slot, note);
  const grid = document.createElement('div');
  grid.className = 'mlq-grid';
  grid.append(queues, cpu);
  const hint = document.createElement('p');
  hint.className = 'ready-queue-hint';
  hint.textContent = HINT_MLQ;
  box.append(title, grid, hint);
  wrapEl.appendChild(box);
}

let shownT = -1;

export function renderReadyQueueAt(t) {
  if (!sim || !sim.procs) return;
  shownT = t;
  flipRender([wrapEl], () => drawReadyQueueAt(t), t, 'ready', document.getElementById('narrationEvents'), 'delay');
}

window.addEventListener('narration-start-replay', () => {
  if (shownT !== 0) return;
  forgetKeys('ready');
  renderReadyQueueAt(0);
});

function drawReadyQueueAt(t) {
  const { readyLog } = sim;
  const fillSlots = () => wrapEl.querySelectorAll('.rq-slot-items').forEach((el) => renderSlot(el, runningAt(Number(el.dataset.slotRes), t)));

  if (isMlq()) {
    const levels = ioLevelsAt(readyLog, t);
    let nextShown = false;
    wrapEl.querySelectorAll('.ready-queue-items').forEach((el) => {
      if (el.dataset.level !== undefined) {
        const tasks = procsOf(levels[el.dataset.level] || []);
        renderChips(el, tasks, 0, t, 'vacía', !nextShown, 'entran acá →');
        if (tasks.length) nextShown = true;
      } else {
        renderChips(el, procsOf(ioReadyQueueAt(readyLog, Number(el.dataset.res), t)), 0, t, 'nadie espera');
      }
    });
    fillSlots();
    const run = runningAt(0, t);
    const runLevel = run != null ? String(procById(run).priority) : null;
    wrapEl.querySelectorAll('.mlq-row').forEach((row) => {
      row.classList.toggle('serving', row.dataset.level === runLevel);
      row.classList.toggle('empty', !(levels[row.dataset.level] || []).length);
    });
    return;
  }

  if (sim.ioMode) {
    const vrr = sim.algo === 'vrr';
    const auxCount = vrr ? ioAuxCountAt(readyLog, t) : 0;
    wrapEl.querySelectorAll('.ready-queue-items').forEach((el) => {
      const isAux = el.dataset.res === 'aux';
      const res = isAux ? 0 : Number(el.dataset.res);
      const tasks = procsOf(ioReadyQueueAt(readyLog, res, t));
      if (isAux) renderChips(el, tasks.slice(0, auxCount), auxCount, t, 'vacía: nadie volvió de E/S con quantum pendiente');
      else if (res === 0 && vrr) renderChips(el, tasks.slice(auxCount), 0, t, 'nadie espera', auxCount === 0);
      else renderChips(el, tasks);
    });
    fillSlots();
    return;
  }

  const items = document.getElementById('readyQueueItemsSimple');
  if (!items) return;
  renderChips(items, procsOf(ioReadyQueueAt(readyLog, 0, t)));
  fillSlots();
}
