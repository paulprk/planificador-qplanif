/**
 * Parser del formato de tareas `.def` de qplanif, por ejemplo:
 *
 *   TAREA "1" INICIO=0 PRIORIDAD=2 [CPU,7]
 *   TAREA "2" INICIO=0 [CPU,15]
 *
 * Solo se admiten ráfagas de CPU (`[CPU,n]`); las referencias a otros recursos
 * (E/S) se detectan pero se ignoran, ya que el simulador todavía no las soporta.
 */
export function parseDefText(text) {
  const clean = text.split('\n').map((l) => l.replace(/#.*/, '')).join('\n');
  const blocks = clean.split(/\bTAREA\b/i).slice(1);
  const tasks = [];

  blocks.forEach((block, i) => {
    const nameM = block.match(/^\s*"([^"]*)"/);
    const name = nameM ? nameM[1] : `P${i + 1}`;
    const inicioM = block.match(/INICIO\s*=\s*(-?\d+)/i);
    const prioM = block.match(/PRIORIDAD\s*=\s*(-?\d+)/i);
    const arrival = inicioM ? parseInt(inicioM[1], 10) : 0;
    const priority = prioM ? parseInt(prioM[1], 10) : i + 1;

    let burst = 0;
    let hasCpu = false;
    let hasOther = false;
    const re = /\[\s*([^,\]]+)\s*,\s*(\d+)\s*\]/g;
    let m;
    while ((m = re.exec(block))) {
      const resource = m[1].trim();
      const dur = parseInt(m[2], 10);
      if (/^CPU$/i.test(resource)) {
        burst += dur;
        hasCpu = true;
      } else {
        hasOther = true;
      }
    }
    tasks.push({ name, arrival, priority, burst, hasCpu, hasOther });
  });

  return tasks;
}
