/**
 * Utilidades compartidas por los tests: arman lotes como los arma la interfaz
 * y resumen el resultado del motor en un texto fácil de comparar a ojo.
 */
import { simulateWithResources } from '../js/iosim.js';
import { parseDefText } from '../js/parser.js';

/** Lote simple: filas `[nombre, llegada, ráfaga, prioridad?]`, con el nombre como id. */
export function simpleBatch(rows) {
  return rows.map(([name, arrival, burst, priority = 0], i) => ({ id: name, order: i, name, arrival, burst, priority }));
}

/** Corre un lote escrito en formato `.def` (el de qplanif) y devuelve el resultado del motor. */
export function runDef(text, { cpuAlgo, resourceAlgo = 'fcfs', quantum = 2, ...rest }) {
  const { tasks, resourceNames } = parseDefText(text);
  const simTasks = tasks.map((t, i) => ({ id: t.name, order: i, name: t.name, arrival: t.arrival, priority: t.priority, bursts: t.bursts }));
  return { ...simulateWithResources({ tasks: simTasks, resourceNames, cpuAlgo, resourceAlgo, quantum, ...rest }), tasks: simTasks };
}

/** Línea de tiempo de un recurso (0 = CPU), por ejemplo "P1 0-2 | P2 2-4". */
export function timeline(result, res = 0) {
  return result.segments
    .filter((s) => (s.res || 0) === res)
    .sort((a, b) => a.start - b.start)
    .map((s) => `${s.id} ${s.start}-${s.end}`)
    .join(' | ');
}
