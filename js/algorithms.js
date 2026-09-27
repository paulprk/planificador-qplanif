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
      continue;
    }
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
  return { segments: mergeSegments(segments), finish };
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

  let guard = 0;
  while (completed < procs.length && guard++ < 200000) {
    if (current === null) {
      const bp = bestPriority();
      if (bp === null) {
        if (arrivalPtr < sortedByArrival.length) {
          time = sortedByArrival[arrivalPtr].arrival;
          enqueueArrivalsUpTo(time);
          continue;
        } else break;
      }
      const id = queues[bp].shift();
      current = { id, prio: bp, quantumLeft: quantum };
    }
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
      continue;
    }
    const bp2 = bestPriority();
    if (bp2 !== null && bp2 < current.prio) {
      if (!queues[current.prio]) queues[current.prio] = [];
      queues[current.prio].push(current.id);
      current = null;
      continue;
    }
    if (current.quantumLeft === 0) {
      if (queues[current.prio] && queues[current.prio].length > 0) {
        queues[current.prio].push(current.id);
        current = null;
      } else {
        current.quantumLeft = quantum;
      }
    }
  }
  return { segments: mergeSegments(segments), finish };
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
