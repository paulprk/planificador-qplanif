/**
 * Motor de eventos discretos con CPU + recursos de E/S, fiel al SistemaCls
 * de qplanif: cada tarea es una secuencia de ráfagas alternadas entre la
 * CPU (recurso 0) y recursos declarados (1..N); cada recurso tiene su
 * propia cola con su propia política de selección (para recursos, solo
 * FCFS/SJF/Prioridades no-expulsiva, igual que el original).
 */
/**
 * Clave de orden de una cola, igual que las colas del qplanif original
 * (ColasCls.hh): la métrica de la política, después el instante en que la
 * tarea entró a esa cola y por último su índice en el lote. Solo Round Robin
 * es una FIFO pura (orden de inserción).
 */
function pickKey(policy, task) {
  switch (policy) {
    case 'sjf':
    case 'srtf':
      return [task.remaining, task.queueEnterTime, task.order];
    case 'pri':
    case 'pri_exp':
      return [task.priority, task.queueEnterTime, task.order];
    case 'fcfs':
      return [task.queueEnterTime, task.order];
    default:
      return [task.queueSeq];
  }
}

function compareKeys(ka, kb) {
  for (let i = 0; i < ka.length; i++) {
    if (ka[i] !== kb[i]) return ka[i] - kb[i];
  }
  return 0;
}

export function simulateWithResources({ tasks, resourceNames, cpuAlgo, resourceAlgo, quantum }) {
  const numResources = resourceNames.length;
  const state = tasks.map((t) => ({
    ...t,
    burstIdx: 0,
    remaining: t.bursts[0].dur,
    queueEnterTime: t.arrival,
    quantumLeft: 0
  }));

  const queues = [];
  for (let i = 0; i <= numResources; i++) queues.push([]);
  const running = new Array(numResources + 1).fill(null);
  const priorityQueues = { 0: {} };

  const segments = [];
  const finish = {};
  const arrivalsSorted = state.slice().sort((a, b) => a.arrival - b.arrival || a.order - b.order);
  let arrivalPtr = 0;

  const openSeg = new Array(numResources + 1).fill(null);
  let enqueueSeq = 0;
  const readyLog = [];

  function flatQueueFor(res) {
    if (res === 0 && cpuAlgo === 'pri_rr') {
      const keys = Object.keys(priorityQueues[0]).map(Number).sort((a, b) => a - b);
      const out = [];
      keys.forEach((k) => priorityQueues[0][k].forEach((task) => out.push(task.id)));
      return out;
    }
    return queues[res].map((task) => task.id);
  }
  function snapAllQueues(time) {
    for (let res = 0; res <= numResources; res++) {
      readyLog.push({ t: time, res, queue: flatQueueFor(res) });
    }
  }

  function policyForResource(res) { return res === 0 ? cpuAlgo : resourceAlgo; }

  function bestPriorityKey() {
    const keys = Object.keys(priorityQueues[0]).map(Number).filter((k) => priorityQueues[0][k].length > 0);
    if (keys.length === 0) return null;
    return Math.min(...keys);
  }

  function enqueue(res, task, t) {
    task.queueEnterTime = t;
    task.queueSeq = enqueueSeq++;
    if (res === 0 && cpuAlgo === 'pri_rr') {
      const p = task.priority;
      if (!priorityQueues[0][p]) priorityQueues[0][p] = [];
      priorityQueues[0][p].push(task);
    } else {
      queues[res].push(task);
    }
  }

  function pickFromQueue(res) {
    const policy = policyForResource(res);
    if (res === 0 && policy === 'pri_rr') {
      const bp = bestPriorityKey();
      if (bp === null) return null;
      return priorityQueues[0][bp].shift();
    }
    const q = queues[res];
    if (q.length === 0) return null;
    let bestIdx = 0;
    let bestKey = pickKey(policy, q[0]);
    for (let i = 1; i < q.length; i++) {
      const k = pickKey(policy, q[i]);
      if (compareKeys(k, bestKey) < 0) { bestKey = k; bestIdx = i; }
    }
    return q.splice(bestIdx, 1)[0];
  }

  function closeSeg(res, t) {
    if (openSeg[res]) {
      segments.push({ id: openSeg[res].id, res, start: openSeg[res].start, end: t });
      openSeg[res] = null;
    }
  }
  function startSeg(res, task, t) { openSeg[res] = { id: task.id, start: t }; }

  const totalWork = state.reduce((s, t) => s + t.bursts.reduce((a, b) => a + b.dur, 0), 0);
  const maxArrival = state.length ? Math.max(...state.map((t) => t.arrival)) : 0;
  const limit = totalWork + maxArrival + numResources * 20 + 200;

  function processArrivalsAt(time) {
    while (arrivalPtr < arrivalsSorted.length && arrivalsSorted[arrivalPtr].arrival <= time) {
      const task = arrivalsSorted[arrivalPtr];
      enqueue(task.bursts[0].res, task, time);
      arrivalPtr++;
    }
  }

  let completed = 0;
  let t = 0;
  let guard = 0;

  processArrivalsAt(t); // arribos en t=0, antes de la primera decisión

  while (completed < state.length && guard++ < limit * 4 + 2000) {
    if ((cpuAlgo === 'srtf' || cpuAlgo === 'pri_exp') && running[0] && queues[0].length > 0) {
      const runTask = running[0];
      const runMetric = cpuAlgo === 'srtf' ? runTask.remaining : runTask.priority;
      let bestKey = null;
      queues[0].forEach((c) => {
        const k = pickKey(cpuAlgo, c);
        if (bestKey === null || compareKeys(k, bestKey) < 0) bestKey = k;
      });
      // Solo expulsa si el candidato es estrictamente mejor (un empate no desaloja).
      if (bestKey !== null && bestKey[0] < runMetric) {
        closeSeg(0, t);
        enqueue(0, runTask, t);
        running[0] = null;
      }
    }

    for (let res = 0; res <= numResources; res++) {
      if (!running[res]) {
        const next = pickFromQueue(res);
        if (next) {
          running[res] = next;
          startSeg(res, next, t);
          if (res === 0 && (cpuAlgo === 'rr' || cpuAlgo === 'pri_rr')) next.quantumLeft = quantum;
        }
      }
    }
    snapAllQueues(t); // después de despachar: refleja quién espera mientras corre lo recién asignado

    if (completed >= state.length) break;

    const anyRunning = running.some((r) => r !== null);
    if (!anyRunning) {
      if (arrivalPtr < arrivalsSorted.length) {
        t = arrivalsSorted[arrivalPtr].arrival;
        processArrivalsAt(t);
        snapAllQueues(t);
        continue;
      }
      break;
    }

    for (let res = 0; res <= numResources; res++) {
      const task = running[res];
      if (!task) continue;
      task.remaining--;
      if (res === 0 && (cpuAlgo === 'rr' || cpuAlgo === 'pri_rr')) task.quantumLeft--;
    }
    t++;
    processArrivalsAt(t); // los que llegan justo ahora ya cuentan para las decisiones de este instante

    for (let res = 0; res <= numResources; res++) {
      const task = running[res];
      if (!task) continue;

      if (task.remaining === 0) {
        closeSeg(res, t);
        if (task.burstIdx === task.bursts.length - 1) {
          finish[task.id] = t;
          completed++;
        } else {
          task.burstIdx++;
          task.remaining = task.bursts[task.burstIdx].dur;
          enqueue(task.bursts[task.burstIdx].res, task, t);
        }
        running[res] = null;
        continue;
      }

      if (res === 0 && cpuAlgo === 'pri_rr') {
        const bp = bestPriorityKey();
        if (bp !== null && bp < task.priority) {
          // Alguien de mejor prioridad llegó: expulsión inmediata, sin esperar el quantum.
          closeSeg(0, t);
          enqueue(0, task, t);
          running[0] = null;
        } else if (task.quantumLeft === 0) {
          if (bp !== null && bp === task.priority) {
            closeSeg(0, t);
            enqueue(0, task, t);
            running[0] = null;
          } else {
            task.quantumLeft = quantum;
          }
        }
      } else if (res === 0 && cpuAlgo === 'rr' && task.quantumLeft === 0) {
        if (queues[0].length > 0) {
          closeSeg(0, t);
          enqueue(0, task, t);
          running[0] = null;
        } else {
          task.quantumLeft = quantum;
        }
      }
    }
    snapAllQueues(t);
  }

  const sorted = segments.sort((a, b) => a.start - b.start || a.res - b.res);
  const merged = [];
  sorted.forEach((s) => {
    const last = merged[merged.length - 1];
    if (last && last.id === s.id && last.res === s.res && last.end === s.start) {
      last.end = s.end;
    } else {
      merged.push({ ...s });
    }
  });

  return { segments: merged, finish, resources: ['CPU', ...resourceNames], readyLog, guard, completed, total: state.length };
}

/** Cola de listos de un recurso puntual (0=CPU, 1..N=recursos) en el instante `t`. */
export function ioReadyQueueAt(readyLog, res, t) {
  let ids = [];
  for (const snap of readyLog) {
    if (snap.t > t) break;
    if (snap.res === res) ids = snap.queue;
  }
  return ids;
}
