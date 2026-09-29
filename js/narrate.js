/**
 * "Qué pasa en este instante": traduce los segmentos de una simulación ya
 * hecha a frases en castellano (quién llega, quién termina, quién pasa a la
 * CPU y por qué), más una foto de lo que hace cada recurso desde ese instante.
 *
 * `buildNarration` es puro (sin DOM) para poder auditarlo con Node; la parte
 * que dibuja el panel está al final del archivo.
 */
import { stateIntervals } from './metrics.js';
import { flipRender, fadeSwap, resetFlip } from './flip.js';
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
export function buildNarration({ procs, segments: rawSegments, finish, algo, quantum, resourceAlgo, resourceLabels, vrrLog, switches = [], agingLog = [], quantumTrace = null }) {
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
  const cap = (x) => x.charAt(0).toUpperCase() + x.slice(1);
  const push = (t, kind, text, id, why) => { (events[t] = events[t] || []).push({ kind, text, why: why || '', id }); };

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

  // Prioridad efectiva en el instante dt: la original, mejorada por el envejecimiento mientras espera en la cola de listos.
  const effPrio = (id, dt) => {
    const base = byId[id].priority;
    const iv = ivsOf[id].find((x) => x.kind === 'wait-cpu' && x.start <= dt && dt <= x.end);
    if (!iv) return base;
    let prio = base;
    agingLog.forEach((a) => { if (a.id === id && a.t >= iv.start && a.t <= dt) prio = a.prio; });
    return prio;
  };

  const cpuMetric = (c, dt) => {
    if (algo === 'fcfs') return c.entry;
    if (algo === 'sjf' || algo === 'srtf') return c.seg.rem;
    if (algo === 'pri' || algo === 'pri_exp') return effPrio(c.id, dt);
    if (algo === 'pri_rr') return byId[c.id].priority;
    return null;
  };

  // Con costo de cambio de contexto, la CPU se decide al empezar el cambio, no cuando el proceso ya está cargado.
  const switchInto = (seg) => switches.find((w) => w.to === seg.id && w.end === seg.start) || null;
  const decisionTime = (seg) => { const w = switchInto(seg); return w ? w.start : seg.start; };
  const switchAt = (t) => switches.find((w) => w.start <= t && t < w.end) || null;

  const vrrDispatch = (t, id) => (vrrLog ? vrrLog.dispatch.find((d) => d.t === t && d.id === id) : null);
  const vrrAux = (t, id) => (vrrLog ? vrrLog.aux.find((d) => d.t === t && d.id === id) : null);
  const unidades = (n) => `${n} ${n === 1 ? 'unidad' : 'unidades'}`;

  function whyCpu(t, seg) {
    const dt = decisionTime(seg);
    const vd = algo === 'vrr' ? vrrDispatch(dt, seg.id) : null;
    if (vd && vd.from === 'aux') return `viene de la cola auxiliar: volvió de E/S con ${unidades(vd.slice)} de su quantum sin usar, y esa cola se atiende antes que la de listos. Usa la CPU solo esas ${unidades(vd.slice)}.`;
    const mine = { id: seg.id, seg, entry: (ivsOf[seg.id].find((iv) => iv.kind === 'wait-cpu' && iv.end === t) || { start: t }).start };
    const others = waiting(dt, 0).filter((c) => c.id !== seg.id);
    if (others.length === 0) return 'es el único proceso listo.';
    if (algo === 'vrr') return `es el primero de la cola de listos (la auxiliar está vacía). Recibe un quantum completo de ${quantum}.`;
    if (algo === 'rr') return 'es el primero de la cola de listos (Round Robin atiende en el orden en que se formó la cola).';
    const mv = cpuMetric(mine, dt);
    const tie = others.some((c) => cpuMetric(c, dt) === mv);
    const showOthers = others.slice(0, 3);
    const more = others.length > 3 ? ', …' : '';
    const cmp = algo === 'fcfs'
      ? list(showOthers.map((c) => `${name(c.id)} entró en t=${cpuMetric(c, dt)}`)) + more
      : list(showOthers.map((c) => `${name(c.id)}: ${cpuMetric(c, dt)}`)) + more;
    let base;
    if (algo === 'fcfs') base = `entró antes que el resto a la cola de listos (entró en t=${mv}; ${cmp})`;
    else if (algo === 'sjf') base = `tiene la ráfaga de CPU más corta entre los listos (la suya es ${mv}; ${cmp})`;
    else if (algo === 'srtf') base = `es al que menos tiempo le falta entre los listos (le faltan ${mv}; ${cmp})`;
    else base = `tiene la mayor prioridad entre los listos (la suya es ${mv}; ${cmp}; el número más bajo es el más urgente)`;
    if (tie) base += algo === 'fcfs' ? '. Empatan en el instante de entrada: va primero el que se encoló antes (en un mismo instante: los que vuelven de E/S, después las llegadas y al final el desalojado)' : '. Hay empate: gana el que se encoló antes';
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

  const retornoWhy = (p) => `Retorno = fin − llegada = ${finish[p.id]} − ${p.arrival} = ${finish[p.id] - p.arrival}.`;

  procs.forEach((p) => {
    const inside = switches.find((w) => w.start < p.arrival && p.arrival < w.end);
    push(p.arrival, 'arrive', `${p.name} llega y entra a la cola de listos.`, p.id,
      inside ? `Hay un cambio de contexto en curso: ${name(inside.to)} ya fue elegido y esa decisión no se revisa, aunque llegue alguien mejor.` : '');
  });

  agingLog.forEach((a) => {
    push(a.t, 'aging', `${name(a.id)} mejora su prioridad a ${a.prio}.`, a.id,
      `Lleva ${unidades(a.waited)} esperando en la cola de listos (envejecimiento: cuanto más espera, más urgente se vuelve). Cuando tome la CPU vuelve a su prioridad original, ${byId[a.id].priority}.`);
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
          push(s.end, 'end', `${p.name} termina su ejecución en t=${finish[p.id]}.`, p.id, retornoWhy(p));
        } else if (next.res !== 0) {
          push(s.end, 'burst-end', `${p.name} termina su ráfaga de CPU y pide ${resName(next.res)}.`, p.id, 'Mientras usa el dispositivo no necesita la CPU: queda libre para otro proceso.');
          if (next.start > s.end) push(s.end, 'blocked', `${p.name} espera en la cola de ${resName(next.res)}.`, p.id, `${resName(next.res)} está ocupado y atiende a un proceso por vez.`);
        } else {
          const sw0 = switches.find((w) => w.start === s.end);
          const x = sw0 ? (segsOf[sw0.to].find((a) => a.start === sw0.end && a.res === 0) || null) : startsAt(s.end, 0);
          let reason = { main: 'deja la CPU y vuelve a la cola de listos.', why: '' };
          if (x && x.id !== p.id) {
            const xp = byId[x.id];
            if (algo === 'vrr') {
              const vd = vrrDispatch(decisionTime(s), p.id);
              reason = vd && vd.from === 'aux'
                ? { main: 'agota su quantum restante y vuelve a la cola de listos.', why: `Usó las ${unidades(vd.slice)} que le tocaban desde la cola auxiliar; ahora le toca al siguiente.` }
                : { main: 'agota su quantum y vuelve al final de la cola de listos.', why: `Usó ${quantum} unidades seguidas de CPU; ahora le toca al siguiente.` };
            } else if (algo === 'rr') reason = { main: 'agota su quantum y vuelve al final de la cola de listos.', why: `Usó ${quantum} unidades seguidas de CPU; ahora le toca al siguiente.` };
            else if (algo === 'srtf') reason = { main: `es expropiado por ${xp.name} y vuelve a la cola de listos.`, why: `${xp.name} necesita menos tiempo de CPU que él (${x.rem} < ${next.rem}), así que le quita la CPU.` };
            else if (algo === 'pri_exp') reason = { main: `es expropiado por ${xp.name} y vuelve a la cola de listos.`, why: `${xp.name} tiene mayor prioridad (${effPrio(x.id, s.end)} < ${p.priority}; el número más bajo es el más urgente).` };
            else if (algo === 'pri_rr') {
              reason = xp.priority < p.priority
                ? { main: `es expropiado por ${xp.name} y vuelve a la cola de listos.`, why: `${xp.name} tiene mayor prioridad (${xp.priority} < ${p.priority}; el número más bajo es el más urgente).` }
                : { main: 'agota su quantum y vuelve al final de su cola de listos.', why: `Usó ${quantum} unidades seguidas de CPU; ahora le toca al siguiente de su misma prioridad.` };
            }
          }
          push(s.end, 'preempt', `${p.name} ${reason.main}`, p.id, reason.why);
        }
      } else if (isLast) {
        push(s.end, 'end', `${p.name} termina de usar ${R} y finaliza en t=${finish[p.id]}.`, p.id, retornoWhy(p));
      } else if (next.res === 0) {
        const va = algo === 'vrr' ? vrrAux(s.end, p.id) : null;
        if (va) push(s.end, 'io-end', `${p.name} termina de usar ${R} y entra a la cola auxiliar.`, p.id, `Le quedaron ${unidades(va.resto)} de su quantum sin usar, así que espera en la cola auxiliar, que se atiende antes que la de listos.`);
        else push(s.end, 'io-end', `${p.name} termina de usar ${R} y vuelve a la cola de listos.`, p.id, algo === 'vrr' ? 'No le sobró quantum al pedir E/S, así que espera en la cola de listos común.' : 'Necesita CPU otra vez: espera su turno.');
      } else {
        push(s.end, 'io-end', `${p.name} termina de usar ${R} y pide ${resName(next.res)}.`, p.id);
        if (next.start > s.end) push(s.end, 'blocked', `${p.name} espera en la cola de ${resName(next.res)}.`, p.id, `${resName(next.res)} está ocupado y atiende a un proceso por vez.`);
      }
    });
  });

  procs.forEach((p) => {
    segsOf[p.id].forEach((s) => {
      if (s.res === 0) {
        const sw = switchInto(s);
        if (sw) {
          const n = sw.end - sw.start;
          const extra = algo === 'srtf' || algo === 'pri_exp' ? ' Un proceso recién cargado ejecuta al menos una unidad antes de poder ser desalojado.' : '';
          push(sw.start, 'switch', `${p.name} es elegido para la CPU: empieza el cambio de contexto (${unidades(n)}).`, p.id,
            `${cap(whyCpu(s.start, s))} Durante el cambio la CPU no ejecuta a nadie y ${p.name} sigue contando como listo (esas unidades son espera). La elección ya no se revisa.`);
          push(s.start, 'cpu', `${p.name} pasa a la CPU.`, p.id, `Terminó el cambio de contexto (t=${sw.start} a t=${sw.end}): recién ahora empieza a ejecutar.${extra}`);
        } else {
          push(s.start, 'cpu', `${p.name} pasa a la CPU.`, p.id, cap(whyCpu(s.start, s)));
        }
      } else {
        push(s.start, 'io', `${p.name} empieza a usar ${resName(s.res)}.`, p.id, cap(whyDevice(s.start, s)));
      }
    });
  });

  // Orden dentro de cada instante: llegadas, salidas, entradas.
  const ORDER = { arrive: 0, end: 1, 'burst-end': 1, 'io-end': 1, preempt: 1, blocked: 2, aging: 2, switch: 3, cpu: 3, io: 3 };
  Object.keys(events).forEach((t) => {
    events[t] = events[t].map((e, i) => ({ e, i })).sort((a, b) => ORDER[a.e.kind] - ORDER[b.e.kind] || a.i - b.i).map((x) => x.e);
  });
  push(makespan, 'done', 'Terminó la simulación: todos los procesos finalizaron.');

  const quantumAt = new Map();
  if (quantumTrace) quantumTrace.forEach((q) => quantumAt.set(q.t, q));

  function stateAt(t) {
    const numRes = resourceLabels ? resourceLabels.length : 1;
    const running = [];
    for (let r = 0; r < numRes; r++) {
      const s = segments.find((x) => (x.res || 0) === r && x.start <= t && t < x.end);
      if (!s) { running.push(null); continue; }
      const ann = segsOf[s.id].find((a) => a.start === s.start && a.res === r);
      const qt = r === 0 ? quantumAt.get(t) : null;
      running.push({ id: s.id, left: ann ? ann.rem - (t - s.start) : null, quantumLeft: qt && qt.id === s.id ? qt.left : null });
    }
    const readyIds = waiting(t, 0).map((c) => c.id);
    const devWaiting = [];
    for (let r = 1; r < numRes; r++) devWaiting.push(waiting(t, r).map((c) => c.id));
    return { running, readyIds, devWaiting, switching: switchAt(t) };
  }

  function locationsAt(t) {
    const loc = {};
    procs.forEach((p) => {
      if (t < p.arrival) loc[p.id] = 'pre';
      else if (t >= finish[p.id]) loc[p.id] = 'done';
      else loc[p.id] = 'ready';
    });
    if (t < makespan) {
      const st = stateAt(t);
      st.running.forEach((r, i) => { if (r) loc[r.id] = i === 0 ? 'cpu' : `dev${i}`; });
      st.devWaiting.forEach((ids, i) => ids.forEach((id) => { loc[id] = `dq${i + 1}`; }));
    }
    return loc;
  }

  return { events, stateAt, locationsAt, makespan };
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
  c.dataset.pid = id;
  c.append(dot(procs, id), document.createTextNode(` ${procs.find((p) => p.id === id).name}${extra || ''}`));
  return c;
}

function eventText(li, ev) {
  const p = ev.id != null ? data.procs.find((x) => x.id === ev.id) : null;
  const main = document.createElement('span');
  main.className = 'nar-main';
  if (p) {
    li.style.borderLeftColor = `var(--${colorFor(data.procs, p.id)})`;
    if (ev.text.startsWith(`${p.name} `)) main.append(dot(data.procs, p.id), document.createTextNode(` ${ev.text}`));
    else main.textContent = ev.text;
  } else main.textContent = ev.text;
  li.appendChild(main);
  if (ev.why) {
    const why = document.createElement('span');
    why.className = 'nar-why';
    why.textContent = ev.why;
    li.appendChild(why);
  }
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
  resetFlip();
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
      eventText(l, ev);
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


// --- Mapa (opcional) ---

let mapOpen = false;
try { mapOpen = localStorage.getItem('qp.map') === '1'; } catch (e) { /* sin storage */ }

function mapBox(title, chips, cls) {
  const box = document.createElement('div');
  box.className = `map-box ${cls || ''}`;
  const h = document.createElement('div');
  h.className = 'map-title';
  h.textContent = title;
  const body = document.createElement('div');
  body.className = 'map-body';
  if (chips.length === 0) {
    const e = document.createElement('span');
    e.className = 'nar-empty';
    e.textContent = 'vacía';
    body.appendChild(e);
  } else chips.forEach((c) => body.appendChild(c));
  box.append(h, body);
  return box;
}

function arrow(text) {
  const a = document.createElement('span');
  a.className = 'map-arrow';
  a.textContent = text;
  a.setAttribute('aria-hidden', 'true');
  return a;
}

function renderMap(t) {
  const host = document.getElementById('narrationMap');
  if (!host) return;
  host.hidden = !mapOpen;
  if (!mapOpen) return;
  host.innerHTML = '';

  const now = data.locationsAt(t);
  const before = t > 0 ? data.locationsAt(t - 1) : null;
  const labels = data.resourceLabels || ['CPU'];
  const mk = (id) => {
    const c = chip(data.procs, id);
    if (before && before[id] !== now[id] && before[id] !== 'pre') c.classList.add('moved');
    if (before && before[id] === 'pre' && now[id] !== 'pre') c.classList.add('moved');
    return c;
  };
  const at = (key) => data.procs.filter((p) => now[p.id] === key).map((p) => mk(p.id));

  const cpuChips = at('cpu');
  const run0 = data.stateAt(t).running[0];
  if (run0 && run0.quantumLeft != null && cpuChips.length === 1) {
    cpuChips[0].append(document.createTextNode(` · quantum restante ${run0.quantumLeft}`));
  }
  const sw = data.stateAt(t).switching;
  if (sw && cpuChips.length === 0) {
    const e = document.createElement('span');
    e.className = 'nar-empty';
    e.textContent = `cambio de contexto → ${data.procs.find((p) => p.id === sw.to).name}`;
    cpuChips.push(e);
  }
  const flow = document.createElement('div');
  flow.className = 'map-flow';
  flow.append(
    mapBox('Todavía no llegaron', at('pre'), 'map-muted'),
    arrow('→'),
    mapBox('Cola de listos', at('ready')),
    arrow('→'),
    mapBox('CPU', cpuChips, 'map-cpu'),
    arrow('→'),
    mapBox('Terminaron', at('done'), 'map-muted')
  );
  host.appendChild(flow);

  if (labels.length > 1) {
    const io = document.createElement('div');
    io.className = 'map-io';
    const cap = document.createElement('div');
    cap.className = 'map-io-cap';
    cap.textContent = 'Cuando un proceso pide E/S deja la CPU, pasa por la cola del dispositivo, lo usa, y después vuelve a la cola de listos.';
    io.appendChild(cap);
    for (let i = 1; i < labels.length; i++) {
      const row = document.createElement('div');
      row.className = 'map-flow';
      row.append(
        mapBox(`Cola de ${labels[i]}`, at(`dq${i}`)),
        arrow('→'),
        mapBox(labels[i], at(`dev${i}`), 'map-dev'),
        arrow('↩ vuelve a listos')
      );
      io.appendChild(row);
    }
    host.appendChild(io);
  }

  const note = document.createElement('div');
  note.className = 'map-note';
  note.textContent = 'Las fichas con borde marcado son las que cambiaron de lugar en este instante.';
  host.appendChild(note);
}

function syncMapToggle() {
  const btn = document.getElementById('mapToggle');
  if (!btn) return;
  btn.textContent = mapOpen ? 'Cerrar mapa' : 'Abrir mapa';
  btn.setAttribute('aria-expanded', String(mapOpen));
}

export function initNarrationMap(getT) {
  const btn = document.getElementById('mapToggle');
  if (!btn) return;
  syncMapToggle();
  btn.addEventListener('click', () => {
    mapOpen = !mapOpen;
    try { localStorage.setItem('qp.map', mapOpen ? '1' : '0'); } catch (e) { /* sin storage */ }
    syncMapToggle();
    renderNarrationAt(getT());
  });
}

export function renderNarrationAt(t) {
  if (!data) return;
  document.getElementById('narrationT').textContent = `Instante ${t}`;
  const ul = document.getElementById('narrationEvents');
  fadeSwap(ul, () => {
    ul.innerHTML = '';
    const evs = data.events[t] || [];
    if (evs.length === 0) {
      const li = document.createElement('li');
      li.className = 'nar-empty';
      li.textContent = 'No cambia nada en este instante: cada proceso sigue con lo que venía haciendo.';
      ul.appendChild(li);
    }
    if (t === 0 && data.makespan > 0) {
      const hint = document.createElement('li');
      hint.className = 'nar-hint';
      hint.textContent = 'Recién empieza. Tocá ▶ Reproducir, o avanzá de a un instante con la flecha → del teclado, y acá se explica qué decide el planificador y por qué.';
      ul.appendChild(hint);
    }
    evs.forEach((ev) => {
      const li = document.createElement('li');
      li.className = `nar-${ev.kind}`;
      if (ev.id != null) li.dataset.pid = ev.id;
      eventText(li, ev);
      ul.appendChild(li);
    });
  }, t, 'events');

  const box = document.getElementById('narrationState');
  flipRender([box, document.getElementById('narrationMap')], () => {
    renderMap(t);
    box.innerHTML = '';
    if (t >= data.makespan || mapOpen) {
      box.hidden = true;
    } else {
      box.hidden = false;
      const st = data.stateAt(t);
      const labels = data.resourceLabels || ['CPU'];
      st.running.forEach((r, i) => {
        if (i === 0 && !r && st.switching) {
          box.appendChild(stateRow(`En ${labels[0]}`, [document.createTextNode('cambio de contexto → '), chip(data.procs, st.switching.to, ' (se está cargando)')]));
          return;
        }
        box.appendChild(stateRow(`En ${labels[i]}`, r ? [chip(data.procs, r.id, r.left != null ? (r.quantumLeft != null ? ` (ráfaga restante ${r.left} · quantum restante ${r.quantumLeft})` : ` (le quedan ${r.left})`) : '')] : []));
      });
      box.appendChild(stateRow('Esperan CPU', st.readyIds.map((id) => chip(data.procs, id))));
      st.devWaiting.forEach((ids, i) => {
        box.appendChild(stateRow(`Esperan ${labels[i + 1]}`, ids.map((id) => chip(data.procs, id))));
      });
    }
  }, t, 'narration', ul);

  document.querySelectorAll('#narrationLog > li').forEach((li) => {
    li.classList.toggle('active', parseInt(li.dataset.t, 10) === t);
  });
}
