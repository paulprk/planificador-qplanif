/**
 * "Qué pasa en este instante": traduce los segmentos de una simulación ya
 * hecha a frases en castellano (quién llega, quién termina, quién pasa a la
 * CPU y por qué), más una foto de lo que hace cada recurso desde ese instante.
 *
 * `buildNarration` es puro (sin DOM) para poder auditarlo con Node; la parte
 * que dibuja el panel está al final del archivo.
 */
import { stateIntervals } from './metrics.js';
import { colorFor } from './colors.js';

function list(items) {
  return items.join(', ');
}

/** Junta tramos consecutivos del mismo proceso en el mismo recurso (p. ej. quantums seguidos sin cambio de proceso). */
function mergeAdjacent(segs) {
  const out = [];
  segs.slice().sort((a, b) => a.start - b.start).forEach((s) => {
    const prev = out.find((o) => o.id === s.id && (o.res || 0) === (s.res || 0) && o.end === s.start);
    if (prev) prev.end = s.end;
    else out.push({ ...s, res: s.res || 0 });
  });
  return out;
}

/** Agrupa los tramos de CPU de cada proceso en ráfagas (cortadas por E/S) y anota cuánto le falta a cada tramo. */
function annotate(procs, segments) {
  const byProc = {};
  procs.forEach((p) => {
    const mine = segments
      .filter((s) => s.id === p.id)
      .sort((a, b) => a.start - b.start)
      .map((s) => ({ ...s, res: s.res || 0 }));
    let group = [];
    const closeGroup = () => {
      const total = group.reduce((a, s) => a + s.end - s.start, 0);
      let done = 0;
      group.forEach((s) => { s.rem = total - done; s.burstTotal = total; done += s.end - s.start; });
      group = [];
    };
    mine.forEach((s) => {
      if (s.res === 0) group.push(s);
      else { closeGroup(); s.rem = s.end - s.start; s.burstTotal = s.rem; }
    });
    closeGroup();
    byProc[p.id] = mine;
  });
  return byProc;
}

/**
 * @param procs [{ id, name, arrival, priority }]
 * @param segments [{ id, start, end, res? }]
 * @param finish { id: instante de fin }
 * @param algo algoritmo de la CPU
 * @param quantum número o null
 * @param resourceAlgo algoritmo de las colas de E/S ('fcfs' | 'sjf' | 'pri') o null en modo simple
 * @param resourceLabels null en modo simple; ['CPU', 'R1', ...] en modo E/S
 */
export function buildNarration({ procs, segments: rawSegments, finish, algo, quantum, resourceAlgo, resourceLabels }) {
  const segments = mergeAdjacent(rawSegments);
  const byId = {};
  procs.forEach((p) => { byId[p.id] = p; });
  const segsOf = annotate(procs, segments);
  const ivsOf = {};
  procs.forEach((p) => { ivsOf[p.id] = stateIntervals(p, segments); });
  const resName = (r) => (resourceLabels ? resourceLabels[r] : 'CPU');
  const name = (id) => byId[id].name;

  let makespan = 0;
  procs.forEach((p) => { if (finish[p.id] > makespan) makespan = finish[p.id]; });

  const events = {};
  const push = (t, kind, text) => { (events[t] = events[t] || []).push({ kind, text }); };

  // Quiénes esperan a la CPU (res=0) o a un dispositivo (res>0) en el instante t, con su próximo tramo.
  const waiting = (t, res) => {
    const out = [];
    procs.forEach((p) => {
      const ivs = ivsOf[p.id];
      const segs = segsOf[p.id];
      ivs.forEach((iv) => {
        if (iv.start > t || t >= iv.end) return;
        if (iv.kind !== (res === 0 ? 'wait-cpu' : 'wait-dev') || iv.res !== res) return;
        const next = segs.find((s) => s.start === iv.end && s.res === res);
        if (next) out.push({ id: p.id, entry: iv.start, seg: next });
      });
    });
    return out;
  };

  const cpuMetric = (c) => {
    if (algo === 'fcfs') return c.entry;
    if (algo === 'sjf' || algo === 'srtf') return c.seg.rem;
    if (algo === 'pri' || algo === 'pri_exp' || algo === 'pri_rr') return byId[c.id].priority;
    return null;
  };

  function whyCpu(t, seg) {
    const mine = { id: seg.id, seg, entry: (ivsOf[seg.id].find((iv) => iv.kind === 'wait-cpu' && iv.end === t) || { start: t }).start };
    const others = waiting(t, 0).filter((c) => c.id !== seg.id);
    if (others.length === 0) return 'es el único proceso listo.';
    if (algo === 'rr') return 'es el primero de la cola de listos (Round Robin atiende en orden de llegada a la cola).';
    const mv = cpuMetric(mine);
    const tie = others.some((c) => cpuMetric(c) === mv);
    const cmp = list(others.slice(0, 3).map((c) => `${name(c.id)}: ${cpuMetric(c)}`)) + (others.length > 3 ? ', …' : '');
    let base;
    if (algo === 'fcfs') base = `entró antes que el resto a la cola de listos (en el instante ${mv}; ${cmp})`;
    else if (algo === 'sjf') base = `tiene la ráfaga más corta entre los listos (${mv}; ${cmp})`;
    else if (algo === 'srtf') base = `es el que menos tiempo restante tiene entre los listos (${mv}; ${cmp})`;
    else base = `tiene la mayor prioridad entre los listos (prioridad ${mv}; ${cmp}; menor número = mayor prioridad)`;
    if (tie) base += algo === 'fcfs' ? '. Empatan en llegada, así que va primero el de menor orden en el lote' : '. Hay empate: gana el que entró antes a la cola';
    return `${base}.`;
  }

  function whyDevice(t, seg) {
    const others = waiting(t, seg.res).filter((c) => c.id !== seg.id);
    const R = resName(seg.res);
    const waited = ivsOf[seg.id].some((iv) => iv.kind === 'wait-dev' && iv.end === t);
    if (others.length === 0) return waited ? `se liberó y era el único que lo esperaba.` : `${R} estaba libre.`;
    const q = list(others.slice(0, 3).map((c) => name(c.id)));
    if (resourceAlgo === 'sjf') return `tiene la ráfaga más corta (${seg.rem}) entre los que esperan ${R} (${q}).`;
    if (resourceAlgo === 'pri') return `tiene la mayor prioridad entre los que esperan ${R} (${q}).`;
    return `es el primero de la cola de ${R} (esperan también: ${q}).`;
  }

  const startsAt = (t, res) => {
    for (const p of procs) {
      const s = segsOf[p.id].find((x) => x.start === t && x.res === res);
      if (s) return s;
    }
    return null;
  };

  procs.forEach((p) => {
    push(p.arrival, 'arrive', `${p.name} llega y entra a la cola de listos.`);
  });

  procs.forEach((p) => {
    const segs = segsOf[p.id];
    segs.forEach((s, i) => {
      const next = segs[i + 1];
      const isLast = !next;
      const R = resName(s.res);
      // Salidas
      if (s.res === 0) {
        if (isLast) {
          push(s.end, 'end', `${p.name} termina su ejecución (retorno = ${finish[p.id] - p.arrival}).`);
        } else if (next.res !== 0) {
          push(s.end, 'burst-end', `${p.name} termina su ráfaga de CPU y pide ${resName(next.res)}.`);
          if (next.start > s.end) push(s.end, 'blocked', `${resName(next.res)} está ocupado, así que ${p.name} espera en su cola.`);
        } else {
          const x = startsAt(s.end, 0);
          let reason = 'deja la CPU y vuelve a la cola de listos.';
          if (x && x.id !== p.id) {
            const xp = byId[x.id];
            if (algo === 'rr') reason = `agota su quantum (${quantum}) y vuelve al final de la cola de listos.`;
            else if (algo === 'srtf') reason = `es expropiado: ${xp.name} tiene menos tiempo restante (${x.rem} < ${next.rem}) y vuelve a la cola de listos.`;
            else if (algo === 'pri_exp') reason = `es expropiado: ${xp.name} tiene mayor prioridad (${xp.priority} < ${p.priority}) y vuelve a la cola de listos.`;
            else if (algo === 'pri_rr') {
              reason = xp.priority < p.priority
                ? `es expropiado: ${xp.name} tiene mayor prioridad (${xp.priority} < ${p.priority}) y vuelve a la cola de listos.`
                : `agota su quantum (${quantum}) y vuelve al final de su cola de listos.`;
            }
          }
          push(s.end, 'preempt', `${p.name} ${reason}`);
        }
      } else if (isLast) {
        push(s.end, 'end', `${p.name} termina de usar ${R} y finaliza (retorno = ${finish[p.id] - p.arrival}).`);
      } else if (next.res === 0) {
        push(s.end, 'io-end', `${p.name} termina de usar ${R} y vuelve a la cola de listos.`);
      } else {
        push(s.end, 'io-end', `${p.name} termina de usar ${R} y pide ${resName(next.res)}.`);
        if (next.start > s.end) push(s.end, 'blocked', `${resName(next.res)} está ocupado, así que ${p.name} espera en su cola.`);
      }
    });
  });

  procs.forEach((p) => {
    segsOf[p.id].forEach((s) => {
      if (s.res === 0) {
        push(s.start, 'cpu', `${p.name} pasa a la CPU: ${whyCpu(s.start, s)}`);
      } else {
        push(s.start, 'io', `${p.name} empieza a usar ${resName(s.res)}: ${whyDevice(s.start, s)}`);
      }
    });
  });

  // Orden dentro de cada instante: llegadas, salidas, entradas.
  const ORDER = { arrive: 0, end: 1, 'burst-end': 1, 'io-end': 1, preempt: 1, blocked: 2, cpu: 3, io: 3 };
  Object.keys(events).forEach((t) => {
    events[t] = events[t].map((e, i) => ({ e, i })).sort((a, b) => ORDER[a.e.kind] - ORDER[b.e.kind] || a.i - b.i).map((x) => x.e);
  });
  push(makespan, 'done', 'Terminó la simulación: todos los procesos finalizaron.');

  function stateAt(t) {
    const numRes = resourceLabels ? resourceLabels.length : 1;
    const running = [];
    for (let r = 0; r < numRes; r++) {
      const s = segments.find((x) => (x.res || 0) === r && x.start <= t && t < x.end);
      if (!s) { running.push(null); continue; }
      const ann = segsOf[s.id].find((a) => a.start === s.start && a.res === r);
      running.push({ id: s.id, left: ann ? ann.rem - (t - s.start) : null });
    }
    const readyIds = waiting(t, 0).map((c) => c.id);
    const devWaiting = [];
    for (let r = 1; r < numRes; r++) devWaiting.push(waiting(t, r).map((c) => c.id));
    return { running, readyIds, devWaiting };
  }

  return { events, stateAt, makespan };
}

// --- Panel ---

let data = null;
let onSeek = null;
let seekHooked = false;

function dot(procs, id) {
  const d = document.createElement('span');
  d.className = 'chip-dot';
  d.style.background = `var(--${colorFor(procs, id)})`;
  return d;
}

function chip(procs, id, extra) {
  const c = document.createElement('span');
  c.className = 'nar-chip';
  c.append(dot(procs, id), document.createTextNode(` ${procs.find((p) => p.id === id).name}${extra || ''}`));
  return c;
}

function stateRow(label, nodes) {
  const row = document.createElement('div');
  row.className = 'nar-state-row';
  const lab = document.createElement('span');
  lab.className = 'nar-state-label';
  lab.textContent = label;
  const items = document.createElement('span');
  items.className = 'nar-state-items';
  if (nodes.length === 0) {
    const e = document.createElement('span');
    e.className = 'nar-empty';
    e.textContent = 'nadie';
    items.appendChild(e);
  } else nodes.forEach((n) => items.appendChild(n));
  row.append(lab, items);
  return row;
}

export function setNarrationData(input, seek) {
  data = { ...buildNarration(input), procs: input.procs, resourceLabels: input.resourceLabels };
  onSeek = seek;
  const log = document.getElementById('narrationLog');
  log.innerHTML = '';
  Object.keys(data.events).map(Number).sort((a, b) => a - b).forEach((t) => {
    const li = document.createElement('li');
    li.dataset.t = t;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'nar-log-t';
    btn.textContent = `t = ${t}`;
    const ul = document.createElement('ul');
    data.events[t].forEach((ev) => {
      const l = document.createElement('li');
      l.textContent = ev.text;
      ul.appendChild(l);
    });
    li.append(btn, ul);
    log.appendChild(li);
  });
  if (!seekHooked) {
    seekHooked = true;
    log.addEventListener('click', (e) => {
      const li = e.target.closest('li[data-t]');
      if (li && e.target.closest('.nar-log-t') && onSeek) onSeek(parseInt(li.dataset.t, 10));
    });
  }
}

export function renderNarrationAt(t) {
  if (!data) return;
  document.getElementById('narrationT').textContent = `Instante ${t}`;
  const ul = document.getElementById('narrationEvents');
  ul.innerHTML = '';
  const evs = data.events[t] || [];
  if (evs.length === 0) {
    const li = document.createElement('li');
    li.className = 'nar-empty';
    li.textContent = 'No cambia nada en este instante: cada proceso sigue con lo que venía haciendo.';
    ul.appendChild(li);
  }
  evs.forEach((ev) => {
    const li = document.createElement('li');
    li.className = `nar-${ev.kind}`;
    li.textContent = ev.text;
    ul.appendChild(li);
  });

  const box = document.getElementById('narrationState');
  box.innerHTML = '';
  if (t >= data.makespan) {
    box.hidden = true;
  } else {
    box.hidden = false;
    const st = data.stateAt(t);
    const labels = data.resourceLabels || ['CPU'];
    st.running.forEach((r, i) => {
      box.appendChild(stateRow(`En ${labels[i]}`, r ? [chip(data.procs, r.id, r.left != null ? ` (le quedan ${r.left})` : '')] : []));
    });
    box.appendChild(stateRow('Esperan CPU', st.readyIds.map((id) => chip(data.procs, id))));
    st.devWaiting.forEach((ids, i) => {
      box.appendChild(stateRow(`Esperan ${labels[i + 1]}`, ids.map((id) => chip(data.procs, id))));
    });
  }

  document.querySelectorAll('#narrationLog > li').forEach((li) => {
    li.classList.toggle('active', parseInt(li.dataset.t, 10) === t);
  });
}
