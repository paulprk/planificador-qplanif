/**
 * Cálculos derivados de una simulación ya hecha (sin tocar el DOM):
 * estados de cada proceso en el tiempo y métricas de uso/espera.
 *
 * Un segmento es { id, start, end, res? }. `res` ausente o 0 = CPU;
 * 1..N = un dispositivo de E/S.
 */

/** Estados de un proceso entre su llegada y su fin, derivados de sus segmentos. */
export function stateIntervals(p, segments) {
  const mine = segments.filter((s) => s.id === p.id).sort((a, b) => a.start - b.start);
  const out = [];
  let cursor = p.arrival;
  mine.forEach((s) => {
    const res = s.res || 0;
    if (s.start > cursor) out.push({ kind: res === 0 ? 'wait-cpu' : 'wait-dev', start: cursor, end: s.start, res });
    out.push({ kind: res === 0 ? 'cpu' : 'io', start: s.start, end: s.end, res });
    cursor = s.end;
  });
  return out;
}

/**
 * @param procs     [{ id, name, arrival, burst, priority }]  (burst = suma de ráfagas de CPU)
 * @param segments  segmentos de la simulación
 * @param finish    { id: instante de fin }
 * @param numResources cantidad de dispositivos de E/S (0 en modo simple)
 */
export function computeMetrics({ procs, segments, finish, numResources = 0 }) {
  const perProc = {};
  let sumTR = 0;
  let sumTE = 0;
  let sumWaitCpu = 0;
  let sumWaitDev = 0;

  procs.forEach((p) => {
    const ivs = stateIntervals(p, segments);
    const sum = (kind) => ivs.filter((iv) => iv.kind === kind).reduce((a, iv) => a + (iv.end - iv.start), 0);
    const tr = finish[p.id] - p.arrival;
    const te = tr - p.burst;
    perProc[p.id] = {
      tr,
      te,
      cpu: sum('cpu'),
      io: sum('io'),
      waitCpu: sum('wait-cpu'),
      waitDev: sum('wait-dev')
    };
    sumTR += tr;
    sumTE += te;
    sumWaitCpu += perProc[p.id].waitCpu;
    sumWaitDev += perProc[p.id].waitDev;
  });

  let makespan = 0;
  procs.forEach((p) => { if (finish[p.id] > makespan) makespan = finish[p.id]; });

  const busy = new Array(numResources + 1).fill(0);
  segments.forEach((s) => { busy[s.res || 0] += s.end - s.start; });

  const n = procs.length || 1;
  return {
    perProc,
    tpr: sumTR / n,
    tpe: sumTE / n,
    avgWaitCpu: sumWaitCpu / n,
    avgWaitDev: sumWaitDev / n,
    makespan,
    busy,
    utilization: busy.map((b) => (makespan > 0 ? b / makespan : 0))
  };
}
