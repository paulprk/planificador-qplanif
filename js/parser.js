/**
 * Parser del formato de tareas `.def` de qplanif, por ejemplo:
 *
 *   RECURSO "R1"
 *   TAREA "1" INICIO=0 PRIORIDAD=2 [CPU,7] [R1,3] [CPU,2]
 *   TAREA "2" INICIO=0 [CPU,15]
 *
 * Cada tarea es una secuencia de ráfagas alternadas: `[CPU,n]` ocupa la CPU,
 * y `[recurso,n]` (por nombre declarado con RECURSO, o por índice 1..N)
 * ocupa ese dispositivo de E/S. Si el texto no declara ningún recurso ni
 * hace referencia a uno, el resultado es el mismo lote "solo CPU" de
 * siempre.
 */
/**
 * El formato no tiene forma de escapar comillas ni `#` (que abre un comentario),
 * así que un nombre no puede llevarlos: se quitan para que el código vuelva a
 * cargar el mismo lote.
 */
export function cleanName(raw) {
  return String(raw ?? '').replace(/["#]/g, '');
}

/**
 * Tareas que se pueden simular (con al menos una ráfaga de CPU de duración > 0).
 * Devuelve `{ usable }` o `{ error }` con un mensaje para el usuario.
 */
export function usableTasks(tasks) {
  if (tasks.length === 0) return { error: 'No encontré ninguna TAREA en el texto. Revisá el formato.' };
  const usable = tasks.filter((t) => t.bursts.some((b) => b.res === 0 && b.dur > 0));
  if (usable.length === 0) return { error: 'Ninguna tarea tiene ráfagas de CPU válidas ([CPU,n]).' };
  const zero = usable.find((t) => t.bursts.some((b) => b.dur <= 0));
  if (zero) return { error: `La tarea "${zero.name}" tiene una ráfaga de duración 0: todas las ráfagas deben durar al menos 1.` };
  return { usable };
}

export function parseDefText(text) {
  // Los textos entre comillas (nombres) se apartan antes de buscar las palabras clave, para que
  // un proceso llamado "Tarea 1" o "INICIO" no se confunda con la sintaxis.
  const strings = [];
  const clean = text
    .split('\n').map((l) => l.replace(/#.*/, '')).join('\n')
    .replace(/"([^"]*)"/g, (_, str) => `"${strings.push(str) - 1}"`);
  const unquote = (token) => {
    const m = token.match(/^"(\d+)"$/);
    return m ? strings[Number(m[1])] : token;
  };

  const resourceNames = [];
  const resourceDeclRe = /\bRECURSO\s+("\d+")/gi;
  let rm;
  while ((rm = resourceDeclRe.exec(clean))) {
    resourceNames.push(unquote(rm[1]));
  }

  function resourceIndex(label) {
    const trimmed = unquote(label.trim()).trim();
    if (/^CPU$/i.test(trimmed)) return 0;
    const asNum = Number(trimmed);
    if (Number.isInteger(asNum) && asNum >= 1) {
      while (resourceNames.length < asNum) resourceNames.push(`R${resourceNames.length + 1}`);
      return asNum;
    }
    let idx = resourceNames.findIndex((n) => n.toLowerCase() === trimmed.toLowerCase());
    if (idx === -1) {
      resourceNames.push(trimmed);
      idx = resourceNames.length - 1;
    }
    return idx + 1;
  }

  const blocks = clean.split(/\bTAREA\b/i).slice(1);
  const tasks = [];

  blocks.forEach((block, i) => {
    const nameM = block.match(/^\s*("\d+")/);
    const name = nameM ? unquote(nameM[1]) : `P${i + 1}`;
    const inicioM = block.match(/INICIO\s*=\s*(-?\d+)/i);
    const prioM = block.match(/PRIORIDAD\s*=\s*(-?\d+)/i);
    const arrival = inicioM ? parseInt(inicioM[1], 10) : 0;
    const priority = prioM ? parseInt(prioM[1], 10) : 0;

    const bursts = [];
    const re = /\[\s*([^,\]]+)\s*,\s*(\d+)\s*\]/g;
    let m;
    while ((m = re.exec(block))) {
      bursts.push({ res: resourceIndex(m[1]), dur: parseInt(m[2], 10) });
    }
    const hasCpu = bursts.some((b) => b.res === 0);
    const usesResources = bursts.some((b) => b.res !== 0);
    tasks.push({ name, arrival, priority, bursts, hasCpu, usesResources });
  });

  return { tasks, resourceNames };
}

/** PRIORIDAD solo se escribe si no es la de por defecto (0). */
function prioText(priority) {
  return priority === 0 ? '' : ` PRIORIDAD=${priority}`;
}

/** El inverso de parseDefText para lotes simples (una sola ráfaga de CPU por proceso). */
export function defTextFromProcesses(procs) {
  return procs
    .map((p) => `TAREA "${cleanName(p.name)}"\nINICIO=${p.arrival}${prioText(p.priority)} [CPU,${p.burst}]`)
    .join('\n\n');
}

/** El inverso de parseDefText para lotes de E/S (tareas con ráfagas alternadas CPU/recurso). */
export function defTextFromIoTasks(tasks, resourceNames) {
  const resLines = resourceNames.map((name) => `RECURSO "${name}"`);
  const taskLines = tasks.map((t) => {
    const brackets = t.bursts
      .map((b) => (b.res === 0 ? `[CPU,${b.dur}]` : `[${b.res},${b.dur}]`))
      .join(' ');
    return `TAREA "${cleanName(t.name)}"\nINICIO=${t.arrival}${prioText(t.priority)} ${brackets}`;
  });
  const resBlock = resLines.join('\n');
  return [resBlock, ...taskLines].filter(Boolean).join('\n\n');
}
