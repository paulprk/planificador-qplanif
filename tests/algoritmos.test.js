/**
 * Casos con respuesta conocida, resueltos a mano, para cada política de CPU.
 * Si un cambio en el motor altera alguno de estos diagramas, el test avisa.
 *
 * Para sumar un ejercicio del TP: copiá un test, pegá el lote y escribí el
 * Gantt esperado tal como queda en la resolución de la cátedra.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { runAlgorithm } from '../js/algorithms.js';
import { computeMetrics } from '../js/metrics.js';
import { simpleBatch, timeline } from './helpers.js';

// El lote de ejemplo de la página: P1 llega en 0 (ráfaga 5), P2 en 1 (3), P3 en 2 (8).
const LOTE = simpleBatch([['P1', 0, 5, 2], ['P2', 1, 3, 1], ['P3', 2, 8, 3]]);

function run(algo, procs = LOTE, quantum = 2, opts = {}) {
  const { ok, result, error } = runAlgorithm(algo, procs, quantum, opts);
  assert.ok(ok, error);
  assert.equal(result.completed, result.total, 'la simulación tiene que terminar');
  return result;
}

test('FCFS atiende en orden de llegada', () => {
  const r = run('fcfs');
  assert.equal(timeline(r), 'P1 0-5 | P2 5-8 | P3 8-16');
  assert.deepEqual(r.finish, { P1: 5, P2: 8, P3: 16 });
});

test('SJF no expulsa: P1 termina aunque llegue uno más corto', () => {
  assert.equal(timeline(run('sjf')), 'P1 0-5 | P2 5-8 | P3 8-16');
});

test('SJF elige la ráfaga más corta entre los que ya llegaron', () => {
  const lote = simpleBatch([['A', 0, 4], ['B', 1, 6], ['C', 2, 2]]);
  assert.equal(timeline(run('sjf', lote)), 'A 0-4 | C 4-6 | B 6-12');
});

test('SRTF expulsa cuando llega uno al que le falta menos', () => {
  // En t=1 a P1 le quedan 4 y llega P2 con 3: P2 le quita la CPU.
  const r = run('srtf');
  assert.equal(timeline(r), 'P1 0-1 | P2 1-4 | P1 4-8 | P3 8-16');
  assert.deepEqual(r.finish, { P1: 8, P2: 4, P3: 16 });
});

test('SRTF: un empate no desaloja al que está ejecutando', () => {
  // En t=2 a A le quedan 2 y llega B con 2: sigue A.
  const lote = simpleBatch([['A', 0, 4], ['B', 2, 2]]);
  assert.equal(timeline(run('srtf', lote)), 'A 0-4 | B 4-6');
});

test('Round Robin q=2: el desalojado va detrás de los que llegaron en ese instante', () => {
  // En t=2 la cola queda P2, P3 (recién llegado), P1 (desalojado).
  const r = run('rr');
  assert.equal(timeline(r), 'P1 0-2 | P2 2-4 | P3 4-6 | P1 6-8 | P2 8-9 | P3 9-11 | P1 11-12 | P3 12-16');
  assert.deepEqual(r.finish, { P1: 12, P2: 9, P3: 16 });
});

test('Round Robin: si no hay nadie más en la cola, el proceso sigue con otro quantum', () => {
  const lote = simpleBatch([['A', 0, 5]]);
  assert.equal(timeline(run('rr', lote)), 'A 0-5');
});

test('Prioridades no expulsivo: el número más bajo pasa primero, pero sin sacar al que ejecuta', () => {
  const lote = simpleBatch([['A', 0, 4, 3], ['B', 1, 2, 1], ['C', 2, 3, 2]]);
  assert.equal(timeline(run('pri', lote)), 'A 0-4 | B 4-6 | C 6-9');
});

test('Prioridades expulsivo: el más prioritario le quita la CPU al que ejecuta', () => {
  const r = run('pri_exp');
  assert.equal(timeline(r), 'P1 0-1 | P2 1-4 | P1 4-8 | P3 8-16');
});

test('Prioridades + Round Robin: RR entre los de igual prioridad', () => {
  // A y B comparten la prioridad 1 y se turnan de a 2; C (prioridad 2) espera a que terminen.
  const lote = simpleBatch([['A', 0, 4, 1], ['B', 0, 4, 1], ['C', 0, 2, 2]]);
  assert.equal(timeline(run('pri_rr', lote)), 'A 0-2 | B 2-4 | A 4-6 | B 6-8 | C 8-10');
});

test('Colas multinivel sin apropiación: el más prioritario espera a que se agote el quantum', () => {
  // B (prioridad 1) llega en t=1, pero A recién deja la CPU en t=2, al agotar su quantum.
  const lote = simpleBatch([['A', 0, 4, 2], ['B', 1, 2, 1]]);
  assert.equal(timeline(run('pri_rr_ne', lote)), 'A 0-2 | B 2-4 | A 4-6');
  // Con apropiación B entra apenas llega.
  assert.equal(timeline(run('pri_rr', lote)), 'A 0-1 | B 1-3 | A 3-6');
});

test('La CPU queda ociosa si nadie llegó todavía', () => {
  const lote = simpleBatch([['A', 0, 2], ['B', 5, 2]]);
  const r = run('fcfs', lote);
  assert.equal(timeline(r), 'A 0-2 | B 5-7');
  const m = computeMetrics({ procs: lote, segments: r.segments, finish: r.finish });
  assert.equal(m.utilization[0], 4 / 7);
});

test('Cambio de contexto: cuesta tiempo al pasar de un proceso a otro distinto', () => {
  const lote = simpleBatch([['A', 0, 2], ['B', 0, 2]]);
  const r = run('fcfs', lote, 2, { contextSwitch: 1 });
  assert.equal(timeline(r), 'A 0-2 | B 3-5');
  assert.deepEqual(r.switches, [{ start: 2, end: 3, from: 'A', to: 'B' }]);
});

test('Envejecimiento: esperar mejora la prioridad', () => {
  // Sin envejecimiento, C (prioridad 1) pasa antes que B (prioridad 3) cuando A termina.
  const lote = simpleBatch([['A', 0, 6, 1], ['B', 0, 2, 3], ['C', 5, 2, 1]]);
  assert.equal(timeline(run('pri', lote)), 'A 0-6 | C 6-8 | B 8-10');
  // Con envejecimiento cada 2, B esperó 6 unidades: bajó de 3 a 0 y le gana a C.
  // Después C espera 2 unidades (t=5 a t=7) mientras ejecuta B, y también mejora.
  const r = run('pri', lote, 2, { aging: 2 });
  assert.equal(timeline(r), 'A 0-6 | B 6-8 | C 8-10');
  assert.deepEqual(
    r.agingLog.map((a) => `${a.id}→${a.prio} en t=${a.t}`),
    ['B→2 en t=2', 'B→1 en t=4', 'B→0 en t=6', 'C→0 en t=7']
  );
});

test('TR, TE y promedios del lote de ejemplo con FCFS', () => {
  const r = run('fcfs');
  const m = computeMetrics({ procs: LOTE, segments: r.segments, finish: r.finish });
  assert.deepEqual(
    LOTE.map((p) => [p.name, m.perProc[p.id].tr, m.perProc[p.id].te]),
    [['P1', 5, 0], ['P2', 7, 4], ['P3', 14, 6]]
  );
  assert.equal(m.tpr.toFixed(2), '8.67');
  assert.equal(m.tpe.toFixed(2), '3.33');
  assert.equal(m.utilization[0], 1);
});

test('El quantum tiene que ser mayor a 0', () => {
  assert.equal(runAlgorithm('rr', LOTE, 0).ok, false);
  assert.equal(runAlgorithm('rr', LOTE, NaN).ok, false);
  assert.equal(runAlgorithm('nada', LOTE, 2).ok, false);
});

// --- Propiedades que tienen que valer para cualquier política ---

const POLITICAS = ['fcfs', 'sjf', 'srtf', 'rr', 'pri', 'pri_exp', 'pri_rr', 'pri_rr_ne'];
const LOTES = {
  ejemplo: LOTE,
  'llegadas juntas': simpleBatch([['A', 0, 3, 2], ['B', 0, 5, 1], ['C', 0, 1, 2], ['D', 0, 4, 3]]),
  'con huecos': simpleBatch([['A', 2, 3, 1], ['B', 10, 2, 2], ['C', 11, 6, 1]]),
  largo: simpleBatch([['A', 0, 9, 3], ['B', 1, 7, 1], ['C', 3, 12, 2], ['D', 4, 1, 1], ['E', 6, 5, 2], ['F', 20, 8, 1]])
};

for (const [nombre, lote] of Object.entries(LOTES)) {
  for (const algo of POLITICAS) {
    for (const opts of [{}, { contextSwitch: 2 }, { aging: 3 }]) {
      test(`${algo} · lote "${nombre}" · ${JSON.stringify(opts)}: resultado coherente`, () => {
        const r = run(algo, lote, 3, opts);
        const cpu = r.segments.slice().sort((a, b) => a.start - b.start);
        // La CPU atiende a uno por vez.
        cpu.forEach((s, i) => { if (i > 0) assert.ok(s.start >= cpu[i - 1].end, `se pisan ${JSON.stringify(cpu[i - 1])} y ${JSON.stringify(s)}`); });
        lote.forEach((p) => {
          const mine = cpu.filter((s) => s.id === p.id);
          // Cada proceso usa exactamente su ráfaga, nunca antes de llegar, y termina cuando usa la última unidad.
          assert.equal(mine.reduce((a, s) => a + s.end - s.start, 0), p.burst, `CPU total de ${p.name}`);
          assert.ok(mine[0].start >= p.arrival, `${p.name} no puede ejecutar antes de llegar`);
          assert.equal(r.finish[p.id], mine[mine.length - 1].end, `fin de ${p.name}`);
        });
        // Un cambio de contexto nunca se superpone con un proceso ejecutando.
        r.switches.forEach((w) => cpu.forEach((s) => assert.ok(s.end <= w.start || s.start >= w.end, 'cambio de contexto superpuesto')));
      });
    }
  }
}
