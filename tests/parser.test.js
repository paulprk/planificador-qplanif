/** Formato `.def` de qplanif: lectura, escritura y validación. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDefText, defTextFromProcesses, defTextFromIoTasks, cleanName, usableTasks } from '../js/parser.js';

test('Lee tareas, llegadas, prioridades y ráfagas', () => {
  const { tasks, resourceNames } = parseDefText(`
    # un comentario
    TAREA "1" INICIO=0 PRIORIDAD=2 [CPU,7]
    TAREA "2" [CPU,15]   # sin INICIO ni PRIORIDAD: valen 0`);
  assert.deepEqual(resourceNames, []);
  assert.deepEqual(tasks.map((t) => [t.name, t.arrival, t.priority, t.bursts]), [
    ['1', 0, 2, [{ res: 0, dur: 7 }]],
    ['2', 0, 0, [{ res: 0, dur: 15 }]]
  ]);
  assert.ok(tasks.every((t) => t.hasCpu && !t.usesResources));
});

test('Los recursos se pueden nombrar o numerar', () => {
  const { tasks, resourceNames } = parseDefText(`
    RECURSO "Disco"
    RECURSO "Red"
    TAREA "A" INICIO=3 [CPU,2] [Disco,4] [CPU,1] [2,5] [cpu,1]`);
  assert.deepEqual(resourceNames, ['Disco', 'Red']);
  assert.deepEqual(tasks[0].bursts, [
    { res: 0, dur: 2 }, { res: 1, dur: 4 }, { res: 0, dur: 1 }, { res: 2, dur: 5 }, { res: 0, dur: 1 }
  ]);
  assert.equal(tasks[0].usesResources, true);
});

test('Un recurso usado sin declarar se agrega solo', () => {
  assert.deepEqual(parseDefText('TAREA "A" [CPU,1] [2,3] [CPU,1]').resourceNames, ['R1', 'R2']);
  assert.deepEqual(parseDefText('TAREA "A" [CPU,1] [Cinta,3]').resourceNames, ['Cinta']);
});

test('El código que escribe la tabla vuelve a cargar el mismo lote', () => {
  const procs = [
    { name: 'P1', arrival: 0, burst: 5, priority: 2 },
    { name: 'Tarea larga', arrival: 3, burst: 12, priority: 0 }
  ];
  const { tasks } = parseDefText(defTextFromProcesses(procs));
  assert.deepEqual(tasks.map((t) => ({ name: t.name, arrival: t.arrival, burst: t.bursts[0].dur, priority: t.priority })), procs);
});

test('El código de un lote de E/S vuelve a cargar el mismo lote', () => {
  const original = parseDefText(`
    RECURSO "Disco"
    RECURSO "Red"
    TAREA "A" INICIO=0 PRIORIDAD=1 [CPU,4] [Disco,2] [CPU,2] [Red,3] [CPU,1]
    TAREA "B" INICIO=2 [CPU,3]`);
  const again = parseDefText(defTextFromIoTasks(original.tasks, original.resourceNames));
  assert.deepEqual(again, original);
});

test('Un nombre puede contener palabras del formato sin romper la lectura', () => {
  const { tasks, resourceNames } = parseDefText(`
    RECURSO "Recurso CPU"
    TAREA "Tarea 1" INICIO=2 [CPU,3] [1,2] [CPU,1]
    TAREA "INICIO=9 [CPU,99]" INICIO=4 [CPU,5]`);
  assert.deepEqual(resourceNames, ['Recurso CPU']);
  assert.deepEqual(tasks.map((t) => [t.name, t.arrival, t.bursts.length]), [['Tarea 1', 2, 3], ['INICIO=9 [CPU,99]', 4, 1]]);
});

test('Los nombres no pueden llevar comillas ni #: se quitan al escribir el código', () => {
  assert.equal(cleanName('P"1'), 'P1');
  assert.equal(cleanName('a#b"c'), 'abc');
  assert.equal(cleanName(undefined), '');
  const texto = defTextFromProcesses([{ name: 'P"1 # raro', arrival: 0, burst: 3, priority: 0 }]);
  assert.deepEqual(parseDefText(texto).tasks.map((t) => [t.name, t.bursts[0].dur]), [['P1  raro', 3]]);
});

test('usableTasks explica por qué un texto no se puede simular', () => {
  assert.match(usableTasks(parseDefText('hola').tasks).error, /ninguna TAREA/);
  assert.match(usableTasks(parseDefText('TAREA "A" [1,3]').tasks).error, /ráfagas de CPU válidas/);
  assert.match(usableTasks(parseDefText('TAREA "A" [CPU,0]').tasks).error, /ráfagas de CPU válidas/);
  assert.match(usableTasks(parseDefText('TAREA "A" [CPU,2] [1,0]').tasks).error, /duración 0/);
});

test('usableTasks deja afuera las tareas sin CPU y se queda con el resto', () => {
  const { usable } = usableTasks(parseDefText('TAREA "A" [CPU,2]\nTAREA "B" [1,3]').tasks);
  assert.deepEqual(usable.map((t) => t.name), ['A']);
});
