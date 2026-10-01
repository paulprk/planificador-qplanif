/**
 * Modo E/S: tareas con ráfagas alternadas de CPU y dispositivos, cada
 * dispositivo con su propia cola. Casos resueltos a mano.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { runDef, timeline } from './helpers.js';
import { computeMetrics } from '../js/metrics.js';

test('Ejemplo de la página: P1 libera la CPU mientras usa el dispositivo', () => {
  const r = runDef(`
    RECURSO "R1"
    TAREA "P1" INICIO=0 [CPU,2] [1,3] [CPU,1]
    TAREA "P2" INICIO=1 [CPU,4]`, { cpuAlgo: 'fcfs' });
  // P1 vuelve de R1 en t=5, pero la CPU la tiene P2 hasta t=6.
  assert.equal(timeline(r, 0), 'P1 0-2 | P2 2-6 | P1 6-7');
  assert.equal(timeline(r, 1), 'P1 2-5');
  assert.deepEqual(r.finish, { P1: 7, P2: 6 });
  assert.deepEqual(r.resources, ['CPU', 'R1']);
});

test('Un dispositivo atiende de a uno: el segundo que lo pide hace cola', () => {
  const r = runDef(`
    RECURSO "Disco"
    TAREA "A" INICIO=0 [CPU,1] [Disco,3] [CPU,1]
    TAREA "B" INICIO=0 [CPU,1] [Disco,2] [CPU,1]`, { cpuAlgo: 'fcfs' });
  assert.equal(timeline(r, 0), 'A 0-1 | B 1-2 | A 4-5 | B 6-7');
  assert.equal(timeline(r, 1), 'A 1-4 | B 4-6'); // B pide el disco en t=2 y espera hasta t=4
  assert.deepEqual(r.finish, { A: 5, B: 7 });

  const procs = r.tasks.map((t) => ({ id: t.id, name: t.name, arrival: t.arrival, burst: 2, priority: 0 }));
  const m = computeMetrics({ procs, segments: r.segments, finish: r.finish, numResources: 1 });
  assert.equal(m.perProc.B.waitDev, 2);
  assert.equal(m.perProc.B.io, 2);
  assert.equal(m.perProc.B.waitCpu, 1); // de t=0 a t=1, mientras ejecuta A
});

test('La cola del dispositivo puede ser FCFS o SJF', () => {
  const lote = `
    RECURSO "R"
    TAREA "A" INICIO=0 [CPU,1] [R,4] [CPU,1]
    TAREA "B" INICIO=0 [CPU,1] [R,3] [CPU,1]
    TAREA "C" INICIO=0 [CPU,1] [R,1] [CPU,1]`;
  // Cuando A libera R en t=5 esperan B (pide 3) y C (pide 1).
  assert.equal(timeline(runDef(lote, { cpuAlgo: 'fcfs', resourceAlgo: 'fcfs' }), 1), 'A 1-5 | B 5-8 | C 8-9');
  const sjf = runDef(lote, { cpuAlgo: 'fcfs', resourceAlgo: 'sjf' });
  assert.equal(timeline(sjf, 1), 'A 1-5 | C 5-6 | B 6-9');
  assert.equal(timeline(sjf, 0), 'A 0-1 | B 1-2 | C 2-3 | A 5-6 | C 6-7 | B 9-10');
});

test('Round Robin virtual: el que vuelve de E/S con quantum pendiente pasa por la cola auxiliar', () => {
  const lote = `
    RECURSO "R1"
    TAREA "A" INICIO=0 [CPU,1] [1,2] [CPU,2]
    TAREA "B" INICIO=0 [CPU,5]
    TAREA "C" INICIO=0 [CPU,5]`;
  // RR común (q=3): A vuelve de E/S en t=3 y se pone al final de la cola de listos.
  const rr = runDef(lote, { cpuAlgo: 'rr', quantum: 3 });
  assert.equal(timeline(rr, 0), 'A 0-1 | B 1-4 | C 4-7 | A 7-9 | B 9-11 | C 11-13');
  // VRR: A usó 1 de su quantum de 3, así que vuelve a la cola auxiliar con 2 pendientes y pasa antes que C.
  const vrr = runDef(lote, { cpuAlgo: 'vrr', quantum: 3 });
  assert.equal(timeline(vrr, 0), 'A 0-1 | B 1-4 | A 4-6 | C 6-9 | B 9-11 | C 11-13');
  assert.deepEqual(vrr.vrrLog.aux, [{ t: 3, id: 'A', resto: 2 }]);
  assert.equal(vrr.finish.A, 6);
  assert.equal(rr.finish.A, 9);
});

test('Una tarea puede terminar en un dispositivo', () => {
  const r = runDef(`
    RECURSO "R1"
    TAREA "A" INICIO=0 [CPU,2] [1,3]`, { cpuAlgo: 'fcfs' });
  assert.deepEqual(r.finish, { A: 5 });
});
