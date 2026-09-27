/**
 * Algoritmos de planificación de CPU.
 *
 * Cada simulador recibe la lista de procesos (`{ id, order, name, arrival, burst, priority }`)
 * y devuelve `{ segments, finish }`:
 *   - segments: [{ id, start, end }] en orden cronológico (ya fusionados si un mismo
 *     proceso ejecuta en tramos contiguos).
 *   - finish:   { [procId]: instante de finalización }
 *
 * Estas funciones son puras (no tocan el DOM), para que se puedan probar o reutilizar
 * de forma independiente de la interfaz.
 */

export function mergeSegments(segs) {
  const merged = [];
  segs.forEach((s) => {
    const last = merged[merged.length - 1];
    if (last && last.id === s.id && last.end === s.start) {
      last.end = s.end;
    } else {
      merged.push({ id: s.id, start: s.start, end: s.end });
    }
  });
  return merged;
}

export function simFCFS(procs) {
  const sorted = procs.slice().sort((a, b) => a.arrival - b.arrival || a.order - b.order);
  let time = 0;
  const segments = [];
  const finish = {};
  sorted.forEach((p) => {
    const start = Math.max(time, p.arrival);
    const end = start + p.burst;
    segments.push({ id: p.id, start, end });
    finish[p.id] = end;
    time = end;
  });
  return { segments, finish };
}

export function simSJF(procs) {
  const remaining = procs.slice();
  let time = 0;
  const segments = [];
  const finish = {};
  const done = {};
  let doneCount = 0;
  while (doneCount < remaining.length) {
    const available = remaining.filter((p) => !done[p.id] && p.arrival <= time);
    if (available.length === 0) {
      const nextArr = Math.min(...remaining.filter((p) => !done[p.id]).map((p) => p.arrival));
      time = nextArr;
      continue;
    }
    available.sort((a, b) => a.burst - b.burst || a.arrival - b.arrival || a.order - b.order);
    const p = available[0];
    const start = time;
    const end = start + p.burst;
    segments.push({ id: p.id, start, end });
    finish[p.id] = end;
    time = end;
    done[p.id] = true;
    doneCount++;
  }
  return { segments, finish };
}

/** Simulación genérica instante-a-instante para algoritmos expulsivos por métrica (SRTF, Prioridades expulsivo). */
function preemptiveSim(procs, metricFn) {
  const rem = {};
  procs.forEach((p) => { rem[p.id] = p.burst; });
  let time = 0;
  const segments = [];
  const finish = {};
  let completed = 0;
  let lastId = null;
  let segStart = null;
  const totalBurst = procs.reduce((s, p) => s + p.burst, 0);
  const maxArrival = Math.max(...procs.map((p) => p.arrival));
  const limit = totalBurst + maxArrival + 5;
  let iter = 0;
  while (completed < procs.length && iter < limit + 1000) {
    iter++;
    const available = procs.filter((p) => p.arrival <= time && rem[p.id] > 0);
    if (available.length === 0) {
      if (lastId !== null) { segments.push({ id: lastId, start: segStart, end: time }); lastId = null; }
      time++;
      continue;
    }
    available.sort((a, b) => metricFn(a, rem) - metricFn(b, rem) || a.arrival - b.arrival || a.order - b.order);
    const p = available[0];
    if (lastId !== p.id) {
      if (lastId !== null) segments.push({ id: lastId, start: segStart, end: time });
      lastId = p.id; segStart = time;
    }
    rem[p.id]--;
    time++;
    if (rem[p.id] === 0) { finish[p.id] = time; completed++; }
  }
  if (lastId !== null) segments.push({ id: lastId, start: segStart, end: time });
  return { segments: mergeSegments(segments), finish };
}

export function simSRTF(procs) {
  return preemptiveSim(procs, (p, rem) => rem[p.id]);
}

export function simPriExp(procs) {
  return preemptiveSim(procs, (p) => p.priority);
}

export function simPriNoExp(procs) {
  const remaining = procs.slice();
  let time = 0;
  const segments = [];
  const finish = {};
  const done = {};
  let doneCount = 0;
  while (doneCount < remaining.length) {
    const available = remaining.filter((p) => !done[p.id] && p.arrival <= time);
    if (available.length === 0) {
      const nextArr = Math.min(...remaining.filter((p) => !done[p.id]).map((p) => p.arrival));
      time = nextArr;
      continue;
    }
    available.sort((a, b) => a.priority - b.priority || a.arrival - b.arrival || a.order - b.order);
    const p = available[0];
    const start = time;
    const end = start + p.burst;
    segments.push({ id: p.id, start, end });
    finish[p.id] = end;
    time = end;
    done[p.id] = true;
    doneCount++;
  }
  return { segments, finish };
}

export function simRR(procs, quantum) {
  const rem = {};
  procs.forEach((p) => { rem[p.id] = p.burst; });
  const sortedByArrival = procs.slice().sort((a, b) => a.arrival - b.arrival || a.order - b.order);
  let arrivalPtr = 0;
  const queue = [];
  let time = 0;
  const segments = [];
  const finish = {};
  let completed = 0;
  const readyLog = [];

  function snap() { readyLog.push({ t: time, queue: queue.slice() }); }

  function enqueueArrivalsUpTo(t) {
    while (arrivalPtr < sortedByArrival.length && sortedByArrival[arrivalPtr].arrival <= t) {
      queue.push(sortedByArrival[arrivalPtr].id);
      arrivalPtr++;
    }
  }

  if (sortedByArrival.length > 0) {
    time = sortedByArrival[0].arrival;
    enqueueArrivalsUpTo(time);
  }
  snap();

  let guard = 0;
  while (completed < procs.length && guard < 100000) {
    guard++;
    if (queue.length === 0) {
      if (arrivalPtr < sortedByArrival.length) {
        time = sortedByArrival[arrivalPtr].arrival;
        enqueueArrivalsUpTo(time);
      } else {
        break;
      }
    } else {
      const id = queue.shift();
      const run = Math.min(quantum, rem[id]);
      const start = time, end = start + run;
      segments.push({ id, start, end });
      rem[id] -= run;
      time = end;
      enqueueArrivalsUpTo(time);
      if (rem[id] > 0) {
        queue.push(id);
      } else {
        finish[id] = time;
        completed++;
      }
    }
    snap();
  }
  return { segments: mergeSegments(segments), finish, readyLog };
}

export function simPriRR(procs, quantum) {
  const rem = {};
  procs.forEach((p) => { rem[p.id] = p.burst; });
  const sortedByArrival = procs.slice().sort((a, b) => a.arrival - b.arrival || a.order - b.order);
  let arrivalPtr = 0;
  const queues = {};
  const segments = [];
  const finish = {};
  let time = 0;
  let completed = 0;
  let current = null;
  const readyLog = [];

  function flatQueue() {
    const keys = Object.keys(queues).map(Number).sort((a, b) => a - b);
    const out = [];
    keys.forEach((k) => queues[k].forEach((id) => out.push(id)));
    return out;
  }
  function snap() { readyLog.push({ t: time, queue: flatQueue() }); }

  function enqueueArrivalsUpTo(t) {
    while (arrivalPtr < sortedByArrival.length && sortedByArrival[arrivalPtr].arrival <= t) {
      const p = sortedByArrival[arrivalPtr];
      if (!queues[p.priority]) queues[p.priority] = [];
      queues[p.priority].push(p.id);
      arrivalPtr++;
    }
  }
  function bestPriority() {
    const keys = Object.keys(queues).map(Number).filter((k) => queues[k].length > 0);
    if (keys.length === 0) return null;
    return Math.min(...keys);
  }

  if (sortedByArrival.length > 0) time = sortedByArrival[0].arrival;
  enqueueArrivalsUpTo(time);
  snap();

  let guard = 0;
  while (completed < procs.length && guard++ < 200000) {
    if (current === null) {
      const bp = bestPriority();
      if (bp === null) {
        if (arrivalPtr < sortedByArrival.length) {
          time = sortedByArrival[arrivalPtr].arrival;
          enqueueArrivalsUpTo(time);
        } else {
          break;
        }
      } else {
        const id = queues[bp].shift();
        current = { id, prio: bp, quantumLeft: quantum };
      }
    }
    if (current !== null) {
      const stepStart = time;
      rem[current.id]--;
      current.quantumLeft--;
      time++;
      segments.push({ id: current.id, start: stepStart, end: time });
      enqueueArrivalsUpTo(time);

      if (rem[current.id] === 0) {
        finish[current.id] = time;
        completed++;
        current = null;
      } else {
        const bp2 = bestPriority();
        if (bp2 !== null && bp2 < current.prio) {
          if (!queues[current.prio]) queues[current.prio] = [];
          queues[current.prio].push(current.id);
          current = null;
        } else if (current.quantumLeft === 0) {
          if (queues[current.prio] && queues[current.prio].length > 0) {
            queues[current.prio].push(current.id);
            current = null;
          } else {
            current.quantumLeft = quantum;
          }
        }
      }
    }
    snap();
  }
  return { segments: mergeSegments(segments), finish, readyLog };
}

function remainingAt(procs, segments, id, t) {
  const p = procs.find((pr) => pr.id === id);
  let executed = 0;
  segments.forEach((s) => {
    if (s.id !== id || s.start >= t) return;
    executed += Math.min(s.end, t) - s.start;
  });
  return p.burst - executed;
}

const READY_SORT_KEY = {
  fcfs: (p) => [p.arrival, p.order],
  sjf: (p) => [p.burst, p.arrival, p.order],
  pri: (p) => [p.priority, p.arrival, p.order],
  pri_exp: (p) => [p.priority, p.arrival, p.order]
};

/**
 * Cola de procesos listos (llegados, no terminados, no en ejecución) en el instante `t`,
 * en el orden en que el algoritmo los atendería. Para RR y Prioridades+RR usa el
 * `readyLog` real generado durante la simulación (el orden depende del historial de
 * encolados/desalojos); para el resto lo deriva del mismo criterio de selección que usa
 * el algoritmo, ya que en esos casos "el próximo de la cola" es siempre el que el
 * algoritmo elegiría a continuación.
 */
export function readyQueueAt(algo, procs, segments, finish, readyLog, t) {
  if (readyLog) {
    let ids = [];
    for (const snap of readyLog) {
      if (snap.t > t) break;
      ids = snap.queue;
    }
    return ids.map((id) => procs.find((p) => p.id === id)).filter(Boolean);
  }

  const running = segments.find((s) => s.start <= t && t < s.end);
  const runningId = running ? running.id : null;
  const eligible = procs.filter((p) => {
    if (p.arrival > t || p.id === runningId) return false;
    const f = finish[p.id];
    return f === undefined || f > t;
  });

  const keyFn = algo === 'srtf'
    ? (p) => [remainingAt(procs, segments, p.id, t), p.arrival, p.order]
    : (READY_SORT_KEY[algo] || ((p) => [p.arrival, p.order]));

  eligible.sort((a, b) => {
    const ka = keyFn(a);
    const kb = keyFn(b);
    for (let i = 0; i < ka.length; i++) {
      if (ka[i] !== kb[i]) return ka[i] - kb[i];
    }
    return 0;
  });
  return eligible;
}

export const ALGO_NAMES = {
  fcfs: 'FCFS — First Come First Served',
  sjf: 'SJF — Shortest Job First (no expulsivo)',
  srtf: 'SRTF — Shortest Remaining Time First (expulsivo)',
  rr: 'Round Robin',
  pri: 'Prioridades (no expulsivo)',
  pri_exp: 'Prioridades (expulsivo)',
  pri_rr: 'Prioridades + Round Robin'
};

export const PRIORITY_ALGOS = ['pri', 'pri_exp', 'pri_rr'];

/**
 * Punto de entrada único: corre el algoritmo pedido y devuelve un resultado
 * uniforme `{ ok, result }` o `{ ok: false, error }` (por ejemplo, quantum inválido),
 * para que quien llama no tenga que conocer los detalles de cada simulador.
 */
export function runAlgorithm(algo, procs, quantum) {
  switch (algo) {
    case 'fcfs': return { ok: true, result: simFCFS(procs) };
    case 'sjf': return { ok: true, result: simSJF(procs) };
    case 'srtf': return { ok: true, result: simSRTF(procs) };
    case 'pri': return { ok: true, result: simPriNoExp(procs) };
    case 'pri_exp': return { ok: true, result: simPriExp(procs) };
    case 'rr':
    case 'pri_rr': {
      if (isNaN(quantum) || quantum <= 0) {
        return { ok: false, error: 'El quantum debe ser un número mayor a 0.' };
      }
      const result = algo === 'rr' ? simRR(procs, quantum) : simPriRR(procs, quantum);
      return { ok: true, result };
    }
    default:
      return { ok: false, error: `Algoritmo desconocido: ${algo}` };
  }
}
