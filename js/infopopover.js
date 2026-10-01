/**
 * Popover de ayuda para las siglas TR/TE/TPR/TPE: un botón "ⓘ" que al
 * tocarlo o clickearlo muestra una explicación anclada al lado del botón.
 * Un solo popover compartido (position: fixed) que se reposiciona según el
 * botón clickeado y el espacio disponible, para que funcione igual de bien
 * en celular que en desktop.
 *
 * Los botones "ⓘ" pueden estar dentro de contenido que se vuelve a dibujar
 * en cada simulación (las fichas TPR/TPE), así que los clics se escuchan
 * por delegación en `document` en vez de engancharse a cada botón puntual.
 *
 * El mismo popover muestra, en pantallas táctiles, la descripción de los
 * elementos con clase `has-tip` (los bloques y marcas del Gantt): ahí el
 * `title` no aparece porque no hay mouse, así que se abre al tocarlos.
 */
const CONTENT = {
  tr: {
    title: 'TR — Tiempo de Retorno',
    body: 'Cuánto tardó el proceso en total, desde que llegó hasta que terminó de ejecutarse.',
    formula: 'TR = Fin − Llegada'
  },
  te: {
    title: 'TE — Tiempo de Espera',
    body: 'De ese tiempo total, cuánto pasó el proceso esperando en la cola de listos sin usar la CPU.',
    formula: 'TE = TR − Ráfaga'
  },
  'te-io': {
    title: 'TE — Tiempo de Espera (modo E/S)',
    body: 'Todo el tiempo del proceso que no fue CPU: incluye la espera en la cola de listos, la espera en la cola de cada dispositivo y el tiempo usando los dispositivos. Para ver cada parte por separado mirá las columnas de al lado.',
    formula: 'TE = TR − ráfagas de CPU'
  },
  wcpu: {
    title: 'Espera CPU',
    body: 'Tiempo que el proceso estuvo listo pero sin CPU: esperando su turno en la cola de listos (incluye las veces que lo sacaron de la CPU antes de terminar la ráfaga).',
    formula: ''
  },
  wdev: {
    title: 'Espera E/S',
    body: 'Tiempo que el proceso estuvo bloqueado haciendo cola porque el dispositivo que necesitaba estaba ocupado con otro proceso.',
    formula: ''
  },
  uio: {
    title: 'Usa E/S',
    body: 'Tiempo que el proceso estuvo efectivamente usando dispositivos de E/S (sin contar la espera en cola).',
    formula: ''
  },
  ucpu: {
    title: 'Uso de la CPU',
    body: 'Porcentaje del tiempo total de la simulación en que la CPU estuvo ejecutando algún proceso. Si es menor a 100% hubo momentos en que no había ningún proceso listo.',
    formula: 'Uso = tiempo ocupada / tiempo total'
  },
  udev: {
    title: 'Uso del dispositivo',
    body: 'Porcentaje del tiempo total de la simulación en que ese dispositivo estuvo atendiendo a algún proceso.',
    formula: 'Uso = tiempo ocupado / tiempo total'
  },
  ctx: {
    title: 'Cambios de contexto',
    body: 'Cuántas veces el SO tuvo que cambiar de un proceso a otro y cuántas unidades de tiempo consumió en total. Durante un cambio la CPU no ejecuta a ningún proceso, así que ese tiempo no cuenta como uso de la CPU y el proceso que se está cargando sigue esperando como "listo".',
    formula: ''
  },
  tpr: {
    title: 'TPR — Tiempo Promedio de Retorno',
    body: 'El promedio del TR de todos los procesos del lote. Sirve para comparar qué tan rápido responde el algoritmo en general.',
    formula: 'TPR = promedio(TR)'
  },
  tpe: {
    title: 'TPE — Tiempo Promedio de Espera',
    body: 'El promedio del TE de todos los procesos del lote. Sirve para comparar cuánto hacen esperar, en promedio, a los procesos.',
    formula: 'TPE = promedio(TE)'
  }
};

const popover = document.getElementById('infoPopover');
const titleEl = document.getElementById('infoPopoverTitle');
const bodyEl = document.getElementById('infoPopoverBody');

let activeBtn = null;

function positionAround(trigger) {
  const margin = 10;
  const r = trigger.getBoundingClientRect();
  popover.style.setProperty('--info-origin-x', '50%');

  const pw = popover.offsetWidth;
  const ph = popover.offsetHeight;
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  let left = r.left + r.width / 2 - pw / 2;
  left = Math.max(margin, Math.min(left, vw - pw - margin));

  const spaceBelow = vh - r.bottom;
  const openAbove = spaceBelow < ph + margin && r.top > spaceBelow;
  const top = openAbove ? r.top - ph - margin : r.bottom + margin;

  popover.style.left = `${left}px`;
  popover.style.top = `${Math.max(margin, top)}px`;
  popover.style.setProperty('--info-origin-y', openAbove ? '100%' : '0%');
}

function contentFor(trigger) {
  if (trigger.dataset.infoKey) return CONTENT[trigger.dataset.infoKey];
  const text = trigger.getAttribute('title');
  return text ? { title: '', body: text, formula: '' } : null;
}

function fillContent(btn) {
  const data = contentFor(btn);
  if (!data) return false;
  titleEl.textContent = data.title;
  titleEl.hidden = !data.title;
  bodyEl.innerHTML = '';
  bodyEl.append(document.createTextNode(data.body));
  if (data.formula) {
    const formula = document.createElement('span');
    formula.className = 'formula';
    formula.textContent = data.formula;
    bodyEl.append(document.createElement('br'), formula);
  }
  return true;
}

function openFor(btn) {
  if (!fillContent(btn)) return;
  activeBtn = btn;
  btn.classList.add('active');
  popover.hidden = false;
  positionAround(btn);
  requestAnimationFrame(() => popover.classList.add('open'));
}

function switchTo(btn) {
  if (!fillContent(btn)) return;
  activeBtn.classList.remove('active');
  activeBtn = btn;
  btn.classList.add('active');
  positionAround(btn);
}

function close() {
  if (!activeBtn) return;
  activeBtn.classList.remove('active');
  activeBtn = null;
  popover.classList.remove('open');
  setTimeout(() => { if (!activeBtn) popover.hidden = true; }, 160);
}

// Con mouse el `title` ya se ve al pasar por encima: los `has-tip` solo se abren con dedo o lápiz.
let lastPointerType = 'mouse';
document.addEventListener('pointerdown', (e) => { lastPointerType = e.pointerType; }, true);

document.addEventListener('click', (e) => {
  const btn = e.target.closest('.info-btn') || (lastPointerType !== 'mouse' ? e.target.closest('.has-tip') : null);
  if (btn) {
    e.stopPropagation();
    if (activeBtn === btn) close();
    else if (activeBtn) switchTo(btn);
    else openFor(btn);
    return;
  }
  if (activeBtn && !popover.contains(e.target)) close();
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && activeBtn) { const b = activeBtn; close(); b.focus(); }
});

window.addEventListener('resize', () => {
  if (!activeBtn) return;
  if (activeBtn.isConnected) positionAround(activeBtn);
  else close(); // el Gantt se redibuja al cambiar el ancho y el bloque tocado ya no existe
});
window.addEventListener('scroll', () => { if (activeBtn) close(); }, true);
