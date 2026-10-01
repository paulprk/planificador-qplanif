/**
 * Límites del motor: qué pasa con lotes que no pueden terminar o que son
 * demasiado largos. La interfaz confía en `completed` y `total` para no
 * mostrar resultados a medias.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { runAlgorithm } from '../js/algorithms.js';
import { parseDefText, usableTasks } from '../js/parser.js';
import { simpleBatch, runDef } from './helpers.js';

test('Un cambio de contexto caro no corta la simulación', () => {
  // RR con q=1: 300 tramos de 1 unidad y 299 cambios de 20 unidades.
  const lote = simpleBatch([['A', 0, 100], ['B', 0, 100], ['C', 0, 100]]);
  const { result } = runAlgorithm('rr', lote, 1, { contextSwitch: 20 });
  assert.equal(result.completed, result.total);
  assert.equal(result.switches.length, 299);
  assert.equal(Math.max(...Object.values(result.finish)), 300 + 299 * 20);
});

test('Con maxTime, un lote más largo se corta y queda marcado como incompleto', () => {
  const lote = simpleBatch([['A', 0, 10], ['B', 0, 100000]]);
  const { result } = runAlgorithm('fcfs', lote, 2, { maxTime: 5000 });
  assert.equal(result.total, 2);
  assert.equal(result.completed, 1);
  assert.equal(result.finish.A, 10);
  assert.equal(result.finish.B, undefined);
});

test('Una llegada más allá de maxTime también corta', () => {
  const lote = simpleBatch([['A', 0, 2], ['B', 1e9, 2]]);
  const { result } = runAlgorithm('fcfs', lote, 2, { maxTime: 5000 });
  assert.equal(result.completed, 1);
});

test('Una ráfaga de duración 0 nunca termina: el motor lo informa y el parser la rechaza antes', () => {
  const texto = `
    RECURSO "R1"
    TAREA "A" INICIO=0 [CPU,2] [1,0] [CPU,1]
    TAREA "B" INICIO=0 [CPU,3]`;
  const r = runDef(texto, { cpuAlgo: 'fcfs' });
  assert.ok(r.completed < r.total);

  const { error, usable } = usableTasks(parseDefText(texto).tasks);
  assert.equal(usable, undefined);
  assert.match(error, /"A".*duración 0/);
});
