/**
 * Nombres de los algoritmos y punto de entrada del modo simple.
 * El modo simple usa el mismo motor que el modo E/S (iosim.js), con tareas de
 * una sola ráfaga de CPU y sin dispositivos, para que ambos modos coincidan.
 */
import { simulateWithResources } from './iosim.js';

export const ALGO_NAMES = {
  fcfs: 'FCFS — First Come First Served',
  sjf: 'SJF — Shortest Job First (no expulsivo)',
  srtf: 'SRTF — Shortest Remaining Time First (expulsivo)',
  rr: 'Round Robin',
  vrr: 'Round Robin virtual (VRR)',
  pri: 'Prioridades (no expulsivo)',
  pri_exp: 'Prioridades (expulsivo)',
  pri_rr: 'Prioridades + Round Robin'
};

export const PRIORITY_ALGOS = ['pri', 'pri_exp', 'pri_rr'];

/**
 * Corre el algoritmo pedido sobre procesos `{ id, order, name, arrival, burst, priority }`
 * y devuelve `{ ok, result }` (result = `{ segments, finish, readyLog, switches, agingLog }`)
 * o `{ ok: false, error }` si el quantum es inválido.
 */
export function runAlgorithm(algo, procs, quantum, { contextSwitch = 0, aging = 0 } = {}) {
  if (!ALGO_NAMES[algo]) return { ok: false, error: `Algoritmo desconocido: ${algo}` };
  if ((algo === 'rr' || algo === 'pri_rr') && (isNaN(quantum) || quantum <= 0)) {
    return { ok: false, error: 'El quantum debe ser un número mayor a 0.' };
  }
  const tasks = procs.map((p) => ({
    id: p.id, order: p.order, name: p.name, arrival: p.arrival, priority: p.priority,
    bursts: [{ res: 0, dur: p.burst }]
  }));
  const result = simulateWithResources({
    tasks, resourceNames: [], cpuAlgo: algo, resourceAlgo: 'fcfs', quantum, contextSwitch, aging
  });
  return { ok: true, result };
}
