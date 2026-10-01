/**
 * Motor de eventos discretos con CPU + recursos de E/S, fiel al SistemaCls
 * de qplanif: cada tarea es una secuencia de ráfagas alternadas entre la
 * CPU (recurso 0) y recursos declarados (1..N); cada recurso tiene su
 * propia cola con su propia política de selección (para recursos, solo
 * FCFS/SJF/Prioridades no-expulsiva, igual que el original).
 */

/** Familias de políticas de CPU: las usa el motor y las reutiliza la interfaz. */
export const MLQ_ALGOS = ['pri_rr', 'pri_rr_ne'];
export const QUANTUM_ALGOS = ['rr', 'vrr', ...MLQ_ALGOS];
export const PRIORITY_ALGOS = ['pri', 'pri_exp', ...MLQ_ALGOS];

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
      return [task.remaining, task.queueEnterTime, task.queueSeq];
    case 'pri':
    case 'pri_exp':
      return [task.priority, task.queueEnterTime, task.queueSeq];
    case 'fcfs':
      return [task.queueEnterTime, task.queueSeq];
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

/**
 * Devuelve, entre otras cosas, `completed` y `total`: si `completed < total` la simulación se
 * cortó sin terminar (lote inválido, o más largo que `maxTime`) y el resto del resultado no sirve.
 */
export function simulateWithResources({ tasks, resourceNames, cpuAlgo, resourceAlgo, quantum, contextSwitch = 0, aging = 0, maxTime = Infinity }) {
  const numResources = resourceNames.length;
  const state = tasks.map((t) => ({
    ...t,
    burstIdx: 0,
    remaining: t.bursts[0].dur,
    queueEnterTime: t.arrival,
    quantumLeft: 0,
    resto: 0,
    basePriority: t.priority,
    waitAge: 0
  }));

  const queues = [];
  for (let i = 0; i <= numResources; i++) queues.push([]);
  const running = new Array(numResources + 1).fill(null);
  const priorityQueues = { 0: {} };
  const isVrr = cpuAlgo === 'vrr';
  // Colas multinivel: una cola RR por prioridad; entre colas manda la prioridad (pri_rr con apropiación, pri_rr_ne sin).
  const isMlq = MLQ_ALGOS.includes(cpuAlgo);
  const mlqPreempt = cpuAlgo === 'pri_rr';
  const topLevel = state.length ? Math.min(...state.map((k) => k.priority)) : 0;
  const usesQuantum = QUANTUM_ALGOS.includes(cpuAlgo);
  const aux = [];
  const vrrLog = { aux: [], dispatch: [] };
  const quantumTrace = [];
  const agingOn = aging > 0 && PRIORITY_ALGOS.includes(cpuAlgo);
  const agingLog = [];
  const switches = [];
  let switching = null;
  let lastRan = null;

  const segments = [];
  const finish = {};
  const arrivalsSorted = state.slice().sort((a, b) => a.arrival - b.arrival || a.order - b.order);
  let arrivalPtr = 0;

  const openSeg = new Array(numResources + 1).fill(null);
  let enqueueSeq = 0;
  const readyLog = [];

  function flatQueueFor(res) {
    if (res === 0 && isMlq) {
      const keys = Object.keys(priorityQueues[0]).map(Number).sort((a, b) => a - b);
      const out = [];
      keys.forEach((k) => priorityQueues[0][k].forEach((task) => out.push(task.id)));
      return out;
    }
    if (res === 0 && isVrr) return aux.concat(queues[0]).map((task) => task.id);
    const policy = policyForResource(res);
    if (policy === 'rr') return queues[res].map((task) => task.id);
    return queues[res].slice().sort((a, b) => compareKeys(pickKey(policy, a), pickKey(policy, b))).map((task) => task.id);
  }
  function snapAllQueues(time) {
    for (let res = 0; res <= numResources; res++) {
      const snap = { t: time, res, queue: flatQueueFor(res), auxCount: res === 0 ? aux.length : 0 };
      if (res === 0 && isMlq) {
        snap.levels = {};
        Object.keys(priorityQueues[0]).forEach((k) => { snap.levels[k] = priorityQueues[0][k].map((task) => task.id); });
      }
      readyLog.push(snap);
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
    if (res === 0 && isVrr && task.resto > 0) {
      aux.push(task);
      vrrLog.aux.push({ t, id: task.id, resto: task.resto });
    } else if (res === 0 && isMlq) {
      const p = task.priority;
      if (!priorityQueues[0][p]) priorityQueues[0][p] = [];
      priorityQueues[0][p].push(task);
    } else {
      queues[res].push(task);
    }
  }

  function pickFromQueue(res) {
    if (res === 0 && isVrr && aux.length > 0) return aux.shift();
    const policy = policyForResource(res);
    if (res === 0 && isMlq) {
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

  // Tope de iteraciones, por si un lote inválido no puede terminar. Cada unidad de trabajo puede
  // venir precedida de un cambio de contexto completo, así que el costo entra en la cuenta.
  const totalWork = state.reduce((s, t) => s + t.bursts.reduce((a, b) => a + b.dur, 0), 0);
  const maxArrival = state.length ? Math.max(...state.map((t) => t.arrival)) : 0;
  const limit = totalWork * (1 + contextSwitch) + maxArrival + numResources * 20 + 200;

  function processArrivalsAt(time) {
    while (arrivalPtr < arrivalsSorted.length && arrivalsSorted[arrivalPtr].arrival <= time) {
      const task = arrivalsSorted[arrivalPtr];
      enqueue(task.bursts[0].res, task, time);
      arrivalPtr++;
    }
  }

  function settleResource(res) {
    const task = running[res];
    if (!task) return;

    if (task.remaining === 0) {
      closeSeg(res, t);
      if (res === 0 && isVrr) task.resto = task.quantumLeft > 0 ? task.quantumLeft : 0;
      if (task.burstIdx === task.bursts.length - 1) {
        finish[task.id] = t;
        completed++;
      } else {
        task.burstIdx++;
        task.remaining = task.bursts[task.burstIdx].dur;
        enqueue(task.bursts[task.burstIdx].res, task, t);
      }
      running[res] = null;
      return;
    }

    if (res === 0 && isMlq) {
      const bp = bestPriorityKey();
      if (mlqPreempt && bp !== null && bp < task.priority) {
        // Alguien de mejor prioridad llegó: expulsión inmediata, sin esperar el quantum.
        closeSeg(0, t);
        enqueue(0, task, t);
        running[0] = null;
      } else if (task.quantumLeft === 0) {
        // Al agotar el quantum se vuelve a elegir: pasa el primero de la cola más prioritaria con procesos (la propia incluida).
        if (bp !== null && bp <= task.priority) {
          closeSeg(0, t);
          enqueue(0, task, t);
          running[0] = null;
        } else {
          task.quantumLeft = quantum;
        }
      }
    } else if (res === 0 && (cpuAlgo === 'rr' || isVrr) && task.quantumLeft === 0) {
      if (queues[0].length > 0 || aux.length > 0) {
        closeSeg(0, t);
        enqueue(0, task, t);
        running[0] = null;
      } else {
        task.quantumLeft = quantum;
      }
    }
  }

  let completed = 0;
  let t = 0;
  let guard = 0;

  processArrivalsAt(t); // arribos en t=0, antes de la primera decisión

  while (completed < state.length && t <= maxTime && guard++ < limit * 4 + 2000) {
    let justLoaded = false;
    if (switching && switching.left === 0) {
      const k = switching.task;
      switching = null;
      running[0] = k;
      startSeg(0, k, t);
      lastRan = k.id;
      k.priority = k.basePriority;
      k.waitAge = 0;
      justLoaded = true;
    }

    if (!justLoaded && (cpuAlgo === 'srtf' || cpuAlgo === 'pri_exp') && running[0] && queues[0].length > 0) {
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
      if (running[res] || (res === 0 && switching)) continue;
      const next = pickFromQueue(res);
      if (!next) continue;
      if (res === 0) {
        if (usesQuantum) {
          if (isVrr && next.resto > 0) {
            next.quantumLeft = next.resto;
            vrrLog.dispatch.push({ t, id: next.id, from: 'aux', slice: next.resto });
          } else {
            next.quantumLeft = quantum;
            if (isVrr) vrrLog.dispatch.push({ t, id: next.id, from: 'ready', slice: quantum });
          }
          next.resto = 0;
        }
        if (contextSwitch > 0 && lastRan !== null && lastRan !== next.id) {
          switching = { task: next, left: contextSwitch };
          switches.push({ start: t, end: t + contextSwitch, from: lastRan, to: next.id });
          continue;
        }
        lastRan = next.id;
        next.priority = next.basePriority;
        next.waitAge = 0;
      }
      running[res] = next;
      startSeg(res, next, t);
    }
    snapAllQueues(t); // después de despachar: refleja quién espera mientras corre lo recién asignado

    if (completed >= state.length) break;

    const anyRunning = switching !== null || running.some((r) => r !== null);
    if (!anyRunning) {
      if (arrivalPtr < arrivalsSorted.length) {
        t = arrivalsSorted[arrivalPtr].arrival;
        processArrivalsAt(t);
        snapAllQueues(t);
        continue;
      }
      break;
    }

    if (agingOn && isMlq) {
      // Envejecimiento entre colas: cada `aging` unidades esperando sube a la cola de arriba (al final de ella), hasta la cola más prioritaria.
      const waiting = [];
      Object.keys(priorityQueues[0]).map(Number).sort((a, b) => a - b).forEach((k) => priorityQueues[0][k].forEach((task) => waiting.push(task)));
      if (switching) switching.task.waitAge++;
      waiting.forEach((k) => {
        k.waitAge++;
        if (k.waitAge % aging === 0 && k.priority > topLevel) {
          const q = priorityQueues[0][k.priority];
          q.splice(q.indexOf(k), 1);
          k.priority--;
          k.queueSeq = enqueueSeq++;
          if (!priorityQueues[0][k.priority]) priorityQueues[0][k.priority] = [];
          priorityQueues[0][k.priority].push(k);
          agingLog.push({ t: t + 1, id: k.id, prio: k.priority, waited: k.waitAge });
        }
      });
    } else if (agingOn) {
      const waiting = queues[0].slice();
      if (switching) waiting.push(switching.task);
      waiting.forEach((k) => {
        k.waitAge++;
        if (k.waitAge % aging === 0 && k.priority > 0) {
          k.priority--;
          agingLog.push({ t: t + 1, id: k.id, prio: k.priority, waited: k.waitAge });
        }
      });
    }
    if (switching) switching.left--;

    for (let res = 0; res <= numResources; res++) {
      const task = running[res];
      if (!task) continue;
      task.remaining--;
      if (res === 0 && usesQuantum) {
        quantumTrace.push({ t, id: task.id, left: task.quantumLeft });
        task.quantumLeft--;
      }
    }
    t++;
    // Dentro de un mismo instante (igual que qplanif): primero vuelven los que terminan E/S, después las llegadas nuevas y al final el desalojado.
    for (let res = 1; res <= numResources; res++) settleResource(res);
    processArrivalsAt(t);
    settleResource(0);
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

  return { segments: merged, finish, resources: ['CPU', ...resourceNames], readyLog, vrrLog: isVrr ? vrrLog : null, quantumTrace: usesQuantum ? quantumTrace : null, switches, agingLog, guard, completed, total: state.length };
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

/** Colas multinivel: `{ prioridad: [ids] }` de la CPU en el instante `t`. */
export function ioLevelsAt(readyLog, t) {
  let levels = {};
  for (const snap of readyLog) {
    if (snap.t > t) break;
    if (snap.res === 0 && snap.levels) levels = snap.levels;
  }
  return levels;
}

/** Cuántos de los primeros de la cola de la CPU vienen de la cola auxiliar (VRR). */
export function ioAuxCountAt(readyLog, t) {
  let n = 0;
  for (const snap of readyLog) {
    if (snap.t > t) break;
    if (snap.res === 0) n = snap.auxCount || 0;
  }
  return n;
}
