/**
 * "¿Cómo leo este gráfico?": guía desplegable para quien recién empieza.
 * Explica los carriles y estados del Gantt, cómo decide el algoritmo elegido
 * y, en modo E/S, qué es una ráfaga de E/S usando un proceso del lote real.
 */
const ALGO_TEXT = {
  fcfs: 'FCFS: usa la CPU el que llegó primero a la cola de listos. Nadie le quita la CPU: la suelta cuando termina (o cuando pide E/S, si hay).',
  sjf: 'SJF: entre los procesos listos va el que tiene la ráfaga de CPU más corta. Nadie le quita la CPU a mitad de ráfaga.',
  srtf: 'SRTF: como SJF, pero si llega (o vuelve de E/S) un proceso al que le falta menos tiempo que al que está en la CPU, se la quita.',
  rr: 'Round Robin: cada proceso usa la CPU como máximo un quantum seguido. Si no terminó, vuelve al final de la cola de listos y pasa el siguiente.',
  pri: 'Prioridades: va el listo con la prioridad más urgente (el número más bajo). Nadie le quita la CPU a mitad de ráfaga.',
  pri_exp: 'Prioridades expulsivo: igual, pero si aparece un proceso más urgente que el que está en la CPU, se la quita.',
  pri_rr: 'Prioridades + Round Robin: va el más urgente; entre procesos de la misma prioridad se turnan por quantums.'
};

const DEVICE_ALGO_TEXT = {
  fcfs: 'el que lo pidió antes',
  sjf: 'el que lo va a usar menos tiempo',
  pri: 'el de prioridad más urgente'
};

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function section(title) {
  const box = el('div', 'guide-sec');
  box.appendChild(el('h4', null, title));
  return box;
}

function swatchRow(kind, title, text) {
  const row = el('div', 'guide-row');
  const sw = el('span', `state-swatch seg-${kind}`);
  sw.style.setProperty('--c', 'var(--p4)');
  sw.style.setProperty('--c-soft', 'var(--p4-soft)');
  const body = el('span');
  body.append(el('strong', null, `${title}: `), document.createTextNode(text));
  row.append(sw, body);
  return row;
}

/** Secuencia de un proceso ("CPU 3 → Red 1 → CPU 2") a partir de los segmentos. */
function sequenceOf(p, segments, labels) {
  const mine = segments.filter((s) => s.id === p.id).sort((a, b) => a.start - b.start);
  const out = [];
  mine.forEach((s) => {
    const name = (s.res || 0) === 0 ? 'CPU' : labels[s.res];
    const last = out[out.length - 1];
    if (last && last.name === name) last.dur += s.end - s.start;
    else out.push({ name, dur: s.end - s.start });
  });
  return out.map((x) => `${x.name} ${x.dur}`).join(' → ');
}

export function renderGuide({ procs, segments, resourceLabels, algo, quantumText, resourceAlgo }) {
  const host = document.getElementById('guideBody');
  if (!host) return;
  host.innerHTML = '';
  const isIo = Boolean(resourceLabels);

  const how = section('Cómo decide el algoritmo elegido');
  const algoText = ALGO_TEXT[algo] || '';
  how.appendChild(el('p', null, algoText + (quantumText ? ` Acá el quantum es ${quantumText}.` : '')));
  if (isIo && DEVICE_ALGO_TEXT[resourceAlgo]) {
    how.appendChild(el('p', null, `Cada dispositivo atiende a un proceso por vez. Si está ocupado, los que lo piden hacen cola, y pasa primero ${DEVICE_ALGO_TEXT[resourceAlgo]}.`));
  }
  host.appendChild(how);

  if (isIo) {
    const what = section('Qué es la E/S');
    what.appendChild(el('p', null, 'Un proceso no usa solo la CPU: a veces necesita un dispositivo (disco, red, impresora). Esa parte se llama ráfaga de E/S. Mientras la hace, el proceso no necesita la CPU, así que la CPU se le da a otro. Cuando termina, vuelve a la cola de listos y espera su turno para seguir.'));
    const withIo = procs.find((p) => segments.some((s) => s.id === p.id && (s.res || 0) > 0));
    if (withIo) {
      const ex = el('p', 'guide-ex');
      ex.append('En este lote, ', el('strong', null, withIo.name), ` hace: ${sequenceOf(withIo, segments, resourceLabels)}. Cada tramo es un paso, y el número es cuántas unidades dura.`);
      what.appendChild(ex);
    }
    host.appendChild(what);
  }

  const read = section('Qué muestra cada parte del gráfico');
  const list = el('div', 'guide-list');
  if (isIo) {
    list.appendChild(el('p', null, 'Arriba están los carriles de la CPU y de cada dispositivo: muestran qué proceso los usa en cada momento (el número es el nombre del proceso). Abajo hay un carril por proceso, que cuenta qué hace ese proceso todo el tiempo:'));
  } else {
    list.appendChild(el('p', null, 'Cada carril es un proceso y muestra qué hace en cada momento:'));
  }
  list.appendChild(swatchRow('cpu', 'Barra llena', 'está usando la CPU.'));
  if (isIo) {
    list.appendChild(swatchRow('io', 'Rayado', 'está usando un dispositivo de E/S.'));
    list.appendChild(swatchRow('wait-dev', 'Columnas', 'el dispositivo está ocupado y espera en su cola.'));
  }
  list.appendChild(swatchRow('wait-cpu', 'Línea de puntos', 'está listo pero la CPU la tiene otro: espera su turno.'));
  list.appendChild(el('p', null, '▲ marca cuándo llega el proceso y ▼ cuándo termina. La línea vertical es el instante actual: al pasar el mouse por una barra ves de cuándo a cuándo dura.'));
  read.appendChild(list);
  host.appendChild(read);
}
