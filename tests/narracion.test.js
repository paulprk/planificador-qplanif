/** "Qué pasa en este instante": las frases salen del resultado de la simulación. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildNarration } from '../js/narrate.js';
import { runAlgorithm } from '../js/algorithms.js';
import { simpleBatch } from './helpers.js';

const LOTE = simpleBatch([['P1', 0, 5, 2], ['P2', 1, 3, 1], ['P3', 2, 8, 3]]);

function narrar(algo, quantum = null) {
  const { result } = runAlgorithm(algo, LOTE, quantum ?? 2);
  return buildNarration({ procs: LOTE, algo, quantum, resourceAlgo: null, resourceLabels: null, ...result });
}

test('FCFS: cada instante cuenta quién llega, quién termina y quién pasa a la CPU', () => {
  const n = narrar('fcfs');
  assert.deepEqual(n.events[0].map((e) => e.text), ['P1 llega y entra a la cola de listos.', 'P1 pasa a la CPU.']);
  assert.deepEqual(n.events[5].map((e) => e.text), ['P1 termina su ejecución en t=5.', 'P2 pasa a la CPU.']);
  assert.match(n.events[5][1].why, /Entró antes que el resto/);
  assert.equal(n.makespan, 16);
  assert.equal(n.events[16].at(-1).text, 'Terminó la simulación: todos los procesos finalizaron.');
});

test('SRTF: explica la expropiación con los tiempos restantes', () => {
  const n = narrar('srtf');
  const ev = n.events[1].find((e) => e.kind === 'preempt');
  assert.equal(ev.text, 'P1 es expropiado por P2 y vuelve a la cola de listos.');
  assert.match(ev.why, /3 < 4/);
});

test('stateAt y locationsAt dicen dónde está cada proceso', () => {
  const n = narrar('rr', 2);
  const st = n.stateAt(3); // P2 ejecuta de 2 a 4; esperan P3 y P1
  assert.equal(st.running[0].id, 'P2');
  assert.deepEqual(st.readyIds.sort(), ['P1', 'P3']);
  assert.deepEqual(n.locationsAt(0), { P1: 'cpu', P2: 'pre', P3: 'pre' });
  assert.deepEqual(n.locationsAt(16), { P1: 'done', P2: 'done', P3: 'done' });
});
