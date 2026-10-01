/**
 * Comparación de políticas: corre el mismo lote con cada algoritmo (y con
 * varios quantums para Round Robin) y muestra las métricas lado a lado.
 * `buildRows` es puro (sin DOM) para poder auditarlo con Node.
 */
import { computeMetrics } from './metrics.js';
import { QUANTUM_ALGOS } from './iosim.js';

const SHORT_NAMES = {
  fcfs: 'FCFS',
  sjf: 'SJF',
  srtf: 'SRTF',
  pri: 'Prioridades (no exp.)',
  pri_exp: 'Prioridades (exp.)',
  rr: 'Round Robin',
  vrr: 'Round Robin virtual',
  pri_rr: 'Prioridades + RR (multinivel con aprop.)',
  pri_rr_ne: 'Multinivel sin aprop.'
};

const ORDER = ['fcfs', 'sjf', 'srtf', 'pri', 'pri_exp', 'rr', 'vrr', 'pri_rr', 'pri_rr_ne'];

/** "1, 2 4" -> [1, 2, 4] (enteros > 0, sin repetir, hasta 6). */
export function parseQuantums(text) {
  const out = [];
  String(text).split(/[\s,;]+/).forEach((tok) => {
    const n = parseInt(tok, 10);
    if (Number.isInteger(n) && n > 0 && !out.includes(n)) out.push(n);
  });
  return out.sort((a, b) => a - b).slice(0, 6);
}

/** Cambios de contexto: veces que la CPU pasa de un proceso a otro distinto. */
export function contextSwitches(segments) {
  const cpu = segments.filter((s) => !s.res).sort((a, b) => a.start - b.start);
  let n = 0;
  for (let i = 1; i < cpu.length; i++) if (cpu[i].id !== cpu[i - 1].id) n++;
  return n;
}

/**
 * @param quantums lista de quantums a probar en RR y Prioridades+RR
 * @param runOne (algo, quantum) => { procs, segments, finish, incomplete? } (cada modo sabe correr
 *        el lote; una corrida `incomplete` no llegó a terminar y se deja afuera de la tabla)
 * @param numResources cantidad de dispositivos (0 en modo simple)
 */
export function buildRows({ quantums, runOne, numResources, algos = ORDER.filter((a) => a !== 'pri_rr_ne') }) {
  const configs = [];
  algos.forEach((algo) => {
    if (algo === 'vrr' && !numResources) return;
    if (QUANTUM_ALGOS.includes(algo)) quantums.forEach((q) => configs.push({ algo, quantum: q }));
    else configs.push({ algo, quantum: null });
  });
  return configs.map((cfg) => ({ cfg, r: runOne(cfg.algo, cfg.quantum) })).filter(({ r }) => !r.incomplete).map(({ cfg, r }) => {
    const m = computeMetrics({ procs: r.procs, segments: r.segments, finish: r.finish, numResources });
    return {
      ...cfg,
      label: SHORT_NAMES[cfg.algo] + (cfg.quantum ? ` · q=${cfg.quantum}` : ''),
      tpr: m.tpr,
      tpe: m.tpe,
      avgWaitCpu: m.avgWaitCpu,
      avgWaitDev: m.avgWaitDev,
      makespan: m.makespan,
      cpuUse: m.utilization[0],
      switches: contextSwitches(r.segments)
    };
  });
}

// --- Panel ---

const bestOf = (rows, key) => Math.min(...rows.map((r) => r[key]));

function numCell(row, key, best, max, digits, suffix) {
  const td = document.createElement('td');
  const v = row[key];
  const wrap = document.createElement('div');
  wrap.className = 'cmp-num';
  const txt = document.createElement('span');
  txt.textContent = (digits === 0 ? String(v) : v.toFixed(digits)) + (suffix || '');
  if (best !== null && Math.abs(v - best) < 1e-9) { txt.classList.add('cmp-best'); }
  wrap.appendChild(txt);
  if (max > 0) {
    const bar = document.createElement('span');
    bar.className = 'cmp-bar';
    const fill = document.createElement('i');
    fill.style.width = `${Math.max(2, (v / max) * 100)}%`;
    bar.appendChild(fill);
    wrap.appendChild(bar);
  }
  td.appendChild(wrap);
  return td;
}

export function renderComparison({ rows, ioMode, current, onPick }) {
  const head = document.getElementById('cmpHead');
  const body = document.getElementById('cmpBody');
  head.innerHTML = '';
  body.innerHTML = '';

  const cols = [['Política'], ['TPR'], ['TPE']];
  if (ioMode) cols.push(['Espera CPU'], ['Espera E/S']);
  cols.push(['Tiempo total'], ['Uso CPU'], ['Cambios de contexto'], ['']);
  const tr = document.createElement('tr');
  cols.forEach(([t]) => { const th = document.createElement('th'); th.textContent = t; tr.appendChild(th); });
  head.appendChild(tr);

  const best = { tpr: bestOf(rows, 'tpr'), tpe: bestOf(rows, 'tpe'), makespan: bestOf(rows, 'makespan') };
  const max = (k) => Math.max(...rows.map((r) => r[k]));

  rows.forEach((row) => {
    const isCurrent = current && row.algo === current.algo && (row.quantum || null) === (current.quantum || null);
    const tr2 = document.createElement('tr');
    if (isCurrent) tr2.className = 'cmp-current';
    const name = document.createElement('td');
    name.style.textAlign = 'left';
    name.textContent = row.label;
    if (isCurrent) {
      const tag = document.createElement('span');
      tag.className = 'cmp-tag';
      tag.textContent = 'en el Gantt';
      name.append(' ', tag);
    }
    tr2.appendChild(name);
    tr2.appendChild(numCell(row, 'tpr', best.tpr, max('tpr'), 2));
    tr2.appendChild(numCell(row, 'tpe', best.tpe, max('tpe'), 2));
    if (ioMode) {
      tr2.appendChild(numCell(row, 'avgWaitCpu', null, 0, 2));
      tr2.appendChild(numCell(row, 'avgWaitDev', null, 0, 2));
    }
    tr2.appendChild(numCell(row, 'makespan', best.makespan, 0, 0));
    const use = document.createElement('td');
    use.textContent = `${(row.cpuUse * 100).toFixed(1)}%`;
    tr2.appendChild(use);
    tr2.appendChild(numCell(row, 'switches', null, 0, 0));
    const act = document.createElement('td');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'cmp-view';
    btn.textContent = 'Ver';
    btn.title = `Mostrar ${row.label} en el diagrama de Gantt`;
    btn.addEventListener('click', () => onPick(row.algo, row.quantum));
    act.appendChild(btn);
    tr2.appendChild(act);
    body.appendChild(tr2);
  });
}
