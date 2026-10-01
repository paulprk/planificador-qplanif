/** Código para compartir (share.js) y tabla de comparación (compare.js). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeShare, decodeShare } from '../js/share.js';
import { parseQuantums, contextSwitches, buildRows } from '../js/compare.js';
import { runAlgorithm } from '../js/algorithms.js';
import { simpleBatch } from './helpers.js';

test('Un código compartido vuelve con el mismo modo y los mismos datos', async () => {
  const data = { a: 'rr', q: '2', cs: '0', ag: '0', p: [['P1', 0, 5, 2], ['Ñandú', 1, 3, 1]] };
  const code = await encodeShare('simple', data);
  assert.match(code, /^PQ1\.S\./);
  assert.deepEqual(await decodeShare(code), { mode: 'simple', data });
  // También sirve pegado como link, y con espacios o saltos de línea de más.
  assert.deepEqual(await decodeShare(`https://ejemplo.test/?c=${code}`), { mode: 'simple', data });
  assert.deepEqual(await decodeShare(`  ${code.slice(0, 10)}\n${code.slice(10)}  `), { mode: 'simple', data });
});

test('Un código cortado o ajeno se rechaza con un mensaje', async () => {
  const code = await encodeShare('io', { a: 'fcfs', d: 'TAREA "A" [CPU,2]' });
  assert.match((await decodeShare(code.slice(0, -3))).error, /incompleto o mal copiado/);
  assert.match((await decodeShare(code.replace('PQ1', 'PQ9'))).error, /otra versión/);
  assert.match((await decodeShare('hola')).error, /no parece un código/);
  assert.match((await decodeShare('')).error, /Pegá un código/);
});

test('parseQuantums limpia la lista de quantums a comparar', () => {
  assert.deepEqual(parseQuantums('4, 1  2;2, 0, -3, x'), [1, 2, 4]);
  assert.deepEqual(parseQuantums(''), []);
  assert.equal(parseQuantums('1 2 3 4 5 6 7 8').length, 6);
});

test('contextSwitches cuenta los pasos de un proceso a otro distinto', () => {
  const lote = simpleBatch([['P1', 0, 5], ['P2', 1, 3], ['P3', 2, 8]]);
  assert.equal(contextSwitches(runAlgorithm('fcfs', lote, 2).result.segments), 2);
  assert.equal(contextSwitches(runAlgorithm('rr', lote, 2).result.segments), 7);
});

test('buildRows arma una fila por política y deja afuera las corridas incompletas', () => {
  const lote = simpleBatch([['P1', 0, 5, 2], ['P2', 1, 3, 1], ['P3', 2, 8, 3]]);
  const runOne = (algo, q) => {
    const r = runAlgorithm(algo, lote, q).result;
    return { procs: lote, segments: r.segments, finish: r.finish, incomplete: algo === 'sjf' };
  };
  const rows = buildRows({ quantums: [1, 2], runOne, numResources: 0 });
  assert.deepEqual(rows.map((r) => r.label), [
    'FCFS', 'SRTF', 'Prioridades (no exp.)', 'Prioridades (exp.)',
    'Round Robin · q=1', 'Round Robin · q=2',
    'Prioridades + RR (multinivel con aprop.) · q=1', 'Prioridades + RR (multinivel con aprop.) · q=2'
  ]);
  const fcfs = rows[0];
  assert.equal(fcfs.tpr.toFixed(2), '8.67');
  assert.equal(fcfs.makespan, 16);
  assert.equal(fcfs.switches, 2);
});
