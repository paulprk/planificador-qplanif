/**
 * Diagrama de Gantt: construcción del DOM (vista única / vista por proceso),
 * la leyenda, y la reproducción animada instante a instante.
 *
 * API pública:
 *   initPlayback()            — engancha los controles (botones, slider, teclado, toggle de vista)
 *   renderSimulation(result)  — pinta el resultado de una simulación nueva y arranca la reproducción
 *
 * El resultado en pantalla vive en un único objeto `sim`, que también reciben
 * la cola de listos y la narración: los tres módulos leen el mismo.
 */
import { PALETTE, colorFor } from './colors.js';
import { PRIORITY_ALGOS } from './iosim.js';
import { setFlipEnabled } from './flip.js';
import { setReadyQueueData, renderReadyQueueAt } from './readyqueue.js';
import { stateIntervals } from './metrics.js';
import { setNarrationData, renderNarrationAt, initNarrationMap } from './narrate.js';
import { renderGuide } from './guide.js';

const ganttTrack = document.getElementById('ganttTrack');
const ganttAxis = document.getElementById('ganttAxis');
const singleWrap = document.getElementById('singleWrap');
const lanesWrap = document.getElementById('lanesWrap');
const lanesLabels = document.getElementById('lanesLabels');
const lanesAxis = document.getElementById('lanesAxis');
const lanesBody = document.getElementById('lanesBody');
const legendEl = document.getElementById('legend');
const algoLabelEl = document.getElementById('algoLabel');
const instantSliderEl = document.getElementById('instantSlider');
const instantLabelEl = document.getElementById('instantLabel');
const playPauseBtn = document.getElementById('playPause');
const zoomOutBtn = document.getElementById('zoomOut');
const zoomInBtn = document.getElementById('zoomIn');
const zoomFitBtn = document.getElementById('zoomFit');

const MIN_UNIT_PX = 6;
const AUTO_MAX_UNIT_PX = 110;
const MAX_UNIT_PX = 110;
const ZOOM_STEP = 10;

let segEls = [];
let playheadEl = null;
let gUnitPx = 34;
let gMaxEnd = 1;
let gPlayheadOffset = 0;
let viewMode = 'lanes';
let userUnitPx = null; // null = ajuste automático al ancho disponible

let sim = null; // la simulación en pantalla (ver renderSimulation)
let markerEls = [];

let currentInstant = 0;
let maxInstant = 0;
let playing = false;
let playTimer = null;
const BASE_STEP_MS = 420;
const SPEED_KEY = 'planificador-cpu-speed';
const speedSel = document.getElementById('speedSel');
let speed = 1;

function setNoAnim(on) {
  ganttTrack.classList.toggle('no-anim', on);
  lanesWrap.classList.toggle('no-anim', on);
}

function scrollContainerEl() {
  return viewMode === 'lanes'
    ? lanesWrap.querySelector('.lanes-scroll')
    : singleWrap.querySelector('.gantt-scroll');
}

function autoFitUnitPx(maxEnd) {
  const el = scrollContainerEl();
  const avail = el ? el.clientWidth : 0;
  if (!avail) return AUTO_MAX_UNIT_PX;
  const usable = avail - 32; // padding horizontal real de .gantt-inner (1rem a cada lado)
  // Sin redondear: el navegador maneja bien los px fraccionarios, y redondear
  // para abajo es justo lo que dejaba ese resto de espacio en blanco al final.
  return Math.max(MIN_UNIT_PX, Math.min(AUTO_MAX_UNIT_PX, usable / maxEnd));
}

function updateZoomBtn() {
  zoomFitBtn.classList.toggle('active', userUnitPx === null);
}

function rebuildKeepingInstant() {
  if (!sim) return;
  setNoAnim(true);
  buildGantt();
  setInstant(currentInstant);
  requestAnimationFrame(() => setNoAnim(false));
}

function updatePlayBtn() {
  playPauseBtn.textContent = playing ? '⏸ Pausar' : '▶ Reproducir';
}

function setInstant(t) {
  currentInstant = Math.max(0, Math.min(maxInstant, t));
  instantSliderEl.value = currentInstant;
  instantSliderEl.setAttribute('aria-valuetext', `Instante ${currentInstant} de ${maxInstant}`);
  instantLabelEl.textContent = `Instante: ${currentInstant} / ${maxInstant}`;
  updateReveal(currentInstant);
  renderNarrationAt(currentInstant);
  renderReadyQueueAt(currentInstant);
}

function startPlayback() {
  if (playing || maxInstant === 0) return;
  if (currentInstant >= maxInstant) currentInstant = 0;
  playing = true;
  updatePlayBtn();
  setFlipEnabled(false);
  playTimer = setInterval(() => {
    if (currentInstant >= maxInstant) { pausePlayback(); return; }
    setInstant(currentInstant + 1);
  }, BASE_STEP_MS / speed);
}

function pausePlayback() {
  setFlipEnabled(true);
  playing = false;
  clearInterval(playTimer);
  updatePlayBtn();
}

/**
 * La descripción de un bloque o marca va en `title` (se ve al pasar el mouse) y en
 * `aria-label` (lectores de pantalla). En pantallas táctiles, donde `title` no
 * aparece, infopopover.js la muestra al tocar el elemento (clase `has-tip`).
 */
function describe(el, text) {
  el.title = text;
  el.setAttribute('role', 'img');
  el.setAttribute('aria-label', text);
  el.classList.add('has-tip');
}

function makeSeg(procs, s, container, resourceLabels) {
  const div = document.createElement('div');
  const colorKey = colorFor(procs, s.id);
  div.className = 'seg';
  div.style.left = `${s.start * gUnitPx}px`;
  div.style.width = '0px';
  div.style.background = `var(--${colorKey}-soft)`;
  div.style.borderColor = `var(--${colorKey})`;
  const proc = procs.find((p) => p.id === s.id);
  const name = proc ? proc.name : s.id;
  const resTag = resourceLabels && s.res != null ? ` (${resourceLabels[s.res]})` : '';
  div.dataset.label = name + resTag;
  describe(div, `${name}${resTag}: ${s.start} → ${s.end}`);
  container.appendChild(div);
  segEls.push({ el: div, seg: s });
}

function makeSwitchSeg(procs, sw, container) {
  const nameOf = (id) => (procs.find((p) => p.id === id) || { name: id }).name;
  const div = document.createElement('div');
  div.className = 'seg seg-switch';
  div.style.left = `${sw.start * gUnitPx}px`;
  div.style.width = '0px';
  div.dataset.label = 'SO';
  const n = sw.end - sw.start;
  describe(div, `Cambio de contexto ${nameOf(sw.from)} → ${nameOf(sw.to)}: t=${sw.start} a t=${sw.end} (${n} ${n === 1 ? 'unidad' : 'unidades'}). ${nameOf(sw.to)} sigue en la cola de listos hasta que termine.`);
  container.appendChild(div);
  segEls.push({ el: div, seg: { start: sw.start, end: sw.end } });
}

function buildLegend() {
  const { procs, showPriority, quantumText, agingText, ioMode: isIo } = sim;
  legendEl.innerHTML = '';
  procs.forEach((p, i) => {
    const item = document.createElement('div');
    item.className = 'legend-item';
    const sw = document.createElement('span');
    sw.className = 'swatch';
    sw.style.background = `var(--${PALETTE[i % PALETTE.length]})`;
    item.appendChild(sw);
    const label = document.createElement('span');
    let text = `${p.name} (llega ${p.arrival}, ráfaga ${p.burst}`;
    if (showPriority) text += `, prioridad ${p.priority}`;
    text += ')';
    label.textContent = text;
    item.appendChild(label);
    legendEl.appendChild(item);
  });
  if (quantumText != null) {
    const qItem = document.createElement('div');
    qItem.className = 'legend-item';
    qItem.style.fontWeight = '700';
    qItem.style.color = 'var(--ink)';
    qItem.textContent = `Quantum = ${quantumText}`;
    legendEl.appendChild(qItem);
  }
  if (agingText != null) {
    const aItem = document.createElement('div');
    aItem.className = 'legend-item';
    aItem.style.fontWeight = '700';
    aItem.style.color = 'var(--ink)';
    aItem.textContent = `Envejecimiento = cada ${agingText} ${agingText === 1 ? 'unidad' : 'unidades'}`;
    aItem.title = 'Cada tantas unidades esperando en la cola de listos, el proceso mejora su prioridad (en colas multinivel, sube a la cola de arriba). Al tomar la CPU vuelve a la original.';
    legendEl.appendChild(aItem);
  }

  const brk = document.createElement('div');
  brk.className = 'legend-break';
  legendEl.appendChild(brk);

  const states = [
    ['cpu', 'usando la CPU'],
    ...(isIo ? [['io', 'usando un dispositivo de E/S'], ['wait-dev', 'esperando que se libere el dispositivo']] : []),
    ['wait-cpu', 'listo: esperando la CPU'],
    ...(sim.switches.length ? [['switch', 'cambio de contexto (el SO carga al próximo)']] : [])
  ];
  states.forEach(([kind, text]) => {
    const item = document.createElement('div');
    item.className = 'legend-item';
    const sw = document.createElement('span');
    sw.className = `state-swatch seg-${kind}`;
    item.appendChild(sw);
    item.append(text);
    legendEl.appendChild(item);
  });
  [['mark-arr', 'llega'], ['mark-end', 'termina']].forEach(([cls, text]) => {
    const item = document.createElement('div');
    item.className = 'legend-item';
    const ico = document.createElement('span');
    ico.className = `mark ${cls} mark-static`;
    item.appendChild(ico);
    item.append(text);
    legendEl.appendChild(item);
  });
}

function buildSingleTrack(maxEnd, unitPx) {
  const { procs, segments, resourceLabels } = sim;
  ganttTrack.innerHTML = '';
  ganttAxis.innerHTML = '';
  ganttTrack.style.setProperty('--unit-px', `${unitPx}px`);
  const totalWidth = maxEnd * unitPx;
  ganttTrack.style.width = `${totalWidth}px`;
  ganttAxis.style.width = `${totalWidth}px`;

  segments.forEach((s) => makeSeg(procs, s, ganttTrack, resourceLabels));
  sim.switches.forEach((sw) => makeSwitchSeg(procs, sw, ganttTrack));

  playheadEl = document.createElement('div');
  playheadEl.className = 'playhead';
  playheadEl.style.left = '0px';
  playheadEl.style.opacity = '0';
  ganttTrack.appendChild(playheadEl);
  gPlayheadOffset = 0;

  for (let t = 0; t <= maxEnd; t++) {
    const tick = document.createElement('span');
    tick.className = 'tick';
    tick.style.left = `${t * unitPx}px`;
    tick.textContent = t;
    ganttAxis.appendChild(tick);
  }
}

const STATE_TEXT = { cpu: 'usa la CPU', io: 'usa', 'wait-dev': 'espera que se libere', 'wait-cpu': 'está listo y espera la CPU' };

function makeStateSeg(container, colorKey, iv, resourceLabels, procName) {
  const div = document.createElement('div');
  div.className = `seg seg-${iv.kind}`;
  div.style.setProperty('--c', `var(--${colorKey})`);
  div.style.setProperty('--c-soft', `var(--${colorKey}-soft)`);
  div.style.left = `${iv.start * gUnitPx}px`;
  div.style.width = '0px';
  const dev = resourceLabels && iv.res > 0 ? ` ${resourceLabels[iv.res]}` : '';
  div.dataset.label = iv.kind === 'cpu' ? 'CPU' : '';
  describe(div, `${procName} ${STATE_TEXT[iv.kind]}${iv.kind === 'io' || iv.kind === 'wait-dev' ? dev : ''} desde t=${iv.start} hasta t=${iv.end} (${iv.end - iv.start} ${iv.end - iv.start === 1 ? 'unidad' : 'unidades'})`);
  container.appendChild(div);
  segEls.push({ el: div, seg: iv });
}

function addMarker(container, colorKey, cls, at, title) {
  const m = document.createElement('span');
  m.className = `mark ${cls}`;
  m.style.setProperty('--c', `var(--${colorKey})`);
  m.style.left = `${at * gUnitPx}px`;
  describe(m, title);
  container.appendChild(m);
  markerEls.push({ el: m, at });
}

function buildLanes(maxEnd, unitPx) {
  const { procs, segments, resourceLabels, switches, finish } = sim;
  lanesLabels.innerHTML = '';
  lanesAxis.innerHTML = '';
  lanesBody.innerHTML = '';
  const totalWidth = maxEnd * unitPx;
  lanesAxis.style.width = `${totalWidth}px`;
  lanesBody.style.width = `${totalWidth}px`;

  for (let t = 0; t <= maxEnd; t++) {
    const tick = document.createElement('span');
    tick.className = 'tick';
    tick.style.left = `${t * unitPx}px`;
    tick.textContent = t;
    lanesAxis.appendChild(tick);
  }

  function addLane(labelText, swatch) {
    const label = document.createElement('div');
    label.className = 'lane-label';
    if (swatch) {
      const sw = document.createElement('span');
      sw.className = 'swatch';
      sw.style.background = `var(--${swatch})`;
      label.appendChild(sw);
    }
    const name = document.createElement('span');
    name.textContent = labelText;
    label.appendChild(name);
    lanesLabels.appendChild(label);

    const track = document.createElement('div');
    track.className = 'lane-track';
    track.style.setProperty('--unit-px', `${unitPx}px`);
    lanesBody.appendChild(track);
    return track;
  }

  markerEls = [];

  if (resourceLabels) {
    resourceLabels.forEach((name, i) => {
      const track = addLane(name, null);
      segments.filter((s) => s.res === i).forEach((s) => makeSeg(procs, s, track));
      if (i === 0) switches.forEach((sw) => makeSwitchSeg(procs, sw, track));
    });
    const gapLabel = document.createElement('div');
    gapLabel.className = 'lane-gap';
    lanesLabels.appendChild(gapLabel);
    const gapTrack = document.createElement('div');
    gapTrack.className = 'lane-gap';
    lanesBody.appendChild(gapTrack);
  }

  if (!resourceLabels && switches.length) {
    const track = addLane('Cambio de contexto', null);
    switches.forEach((sw) => makeSwitchSeg(procs, sw, track));
  }

  procs.forEach((p, i) => {
    const track = addLane(p.name, PALETTE[i % PALETTE.length]);
    const colorKey = PALETTE[i % PALETTE.length];
    stateIntervals(p, segments).forEach((iv) => makeStateSeg(track, colorKey, iv, resourceLabels, p.name));
    addMarker(track, colorKey, 'mark-arr', p.arrival, `${p.name} llega en t=${p.arrival}`);
    if (finish[p.id] != null) addMarker(track, colorKey, 'mark-end', finish[p.id], `${p.name} termina en t=${finish[p.id]}`);
  });

  playheadEl = document.createElement('div');
  playheadEl.className = 'lanes-playhead';
  playheadEl.style.left = '0px';
  playheadEl.style.opacity = '0';
  lanesBody.appendChild(playheadEl);
  gPlayheadOffset = 0;
}

function buildGantt() {
  segEls = [];
  const maxEnd = maxInstant || 1;
  gMaxEnd = maxEnd;
  gUnitPx = userUnitPx != null ? userUnitPx : autoFitUnitPx(maxEnd);

  if (viewMode === 'lanes') buildLanes(maxEnd, gUnitPx);
  else buildSingleTrack(maxEnd, gUnitPx);
  buildLegend();

  const lanesBtn = document.querySelector('.view-btn[data-view="lanes"]');
  if (lanesBtn) lanesBtn.textContent = sim.ioMode ? 'Recursos y procesos' : 'Vista por proceso';
}

function updateReveal(revealUpTo) {
  segEls.forEach(({ seg: s, el: div }) => {
    div.setAttribute('aria-hidden', String(s.start >= revealUpTo));
    if (s.start >= revealUpTo) {
      div.style.width = '0px';
      div.textContent = '';
      return;
    }
    const visEnd = Math.min(s.end, revealUpTo);
    const w = (visEnd - s.start) * gUnitPx;
    div.style.width = `${w}px`;
    div.textContent = w >= gUnitPx - 2 ? div.dataset.label : '';
  });
  markerEls.forEach(({ el, at }) => {
    el.style.opacity = at <= revealUpTo ? '1' : '0';
    el.setAttribute('aria-hidden', String(at > revealUpTo));
  });
  if (playheadEl) {
    playheadEl.style.left = `${gPlayheadOffset + revealUpTo * gUnitPx}px`;
    playheadEl.style.opacity = (revealUpTo > 0 && revealUpTo < gMaxEnd) ? '1' : '0';
  }
}

/**
 * "Vista única" solo tiene sentido cuando nunca hay dos cosas corriendo a la
 * vez (modo simple: una sola CPU). En modo E/S puede haber una tarea en la
 * CPU y otra en un recurso al mismo tiempo, y esa vista las mete en la misma
 * fila — los segmentos se superponen visualmente. Se oculta el botón ahí.
 */
function updateViewAvailability() {
  const singleBtn = document.querySelector('.view-btn[data-view="single"]');
  if (!singleBtn) return;
  singleBtn.hidden = sim.ioMode;
  if (sim.ioMode && viewMode === 'single') setViewMode('lanes');
}

function setViewMode(view) {
  viewMode = view;
  document.querySelectorAll('.view-btn').forEach((b) => {
    const on = b.dataset.view === view;
    b.classList.toggle('active', on);
    b.setAttribute('aria-pressed', String(on));
  });
  singleWrap.hidden = viewMode !== 'single';
  lanesWrap.hidden = viewMode !== 'lanes';
}

/**
 * Pinta un nuevo resultado de simulación y arranca la reproducción desde el instante 0.
 *
 * @param result lo que devuelve el motor (`segments`, `finish`, `readyLog`, `switches`, `agingLog`,
 *   `quantumTrace`, `vrrLog`) más `procs`, `algo`, `labelText`, `showPriority`, `quantumText`
 *   (null si el algoritmo no usa quantum), `aging` y, en modo E/S, `resourceLabels`
 *   (['CPU', 'R1', ...]) y `resourceAlgo`.
 */
export function renderSimulation(result) {
  pausePlayback();
  const resourceLabels = result.resourceLabels || null;
  const aging = result.aging || 0;
  sim = {
    ...result,
    finish: result.finish || {},
    switches: result.switches || [],
    agingLog: result.agingLog || [],
    quantumTrace: result.quantumTrace || null,
    vrrLog: result.vrrLog || null,
    readyLog: result.readyLog ?? null,
    resourceLabels, // null = modo simple (lanes = procesos); array = modo E/S (lanes = recursos)
    resourceAlgo: resourceLabels ? result.resourceAlgo : null,
    ioMode: Boolean(resourceLabels),
    quantum: result.quantumText ? parseInt(result.quantumText, 10) : null,
    aging,
    agingText: aging > 0 && PRIORITY_ALGOS.includes(result.algo) ? aging : null,
    hasSwitches: Boolean(result.switches && result.switches.length)
  };
  updateViewAvailability();

  renderGuide(sim);
  setReadyQueueData(sim);
  setNarrationData(sim, (t) => { pausePlayback(); setInstant(t); });
  algoLabelEl.textContent = sim.labelText;

  maxInstant = 0;
  sim.segments.forEach((s) => { if (s.end > maxInstant) maxInstant = s.end; });
  instantSliderEl.max = maxInstant;

  buildGantt();
  setNoAnim(true);
  setInstant(0);
  requestAnimationFrame(() => setNoAnim(false));
}

export function initPlayback() {
  initNarrationMap(() => currentInstant);
  try {
    const saved = localStorage.getItem(SPEED_KEY);
    if (saved && [...speedSel.options].some((o) => o.value === saved)) speedSel.value = saved;
  } catch (e) { /* sin localStorage */ }
  speed = parseFloat(speedSel.value) || 1;
  speedSel.addEventListener('change', () => {
    speed = parseFloat(speedSel.value) || 1;
    try { localStorage.setItem(SPEED_KEY, speedSel.value); } catch (e) { /* ignorar */ }
    if (playing) {
      clearInterval(playTimer);
      playing = false;
      startPlayback();
    }
  });
  playPauseBtn.addEventListener('click', () => { playing ? pausePlayback() : startPlayback(); });
  document.getElementById('stepStart').addEventListener('click', () => { pausePlayback(); setInstant(0); });
  document.getElementById('stepBack').addEventListener('click', () => { pausePlayback(); setInstant(currentInstant - 1); });
  document.getElementById('stepFwd').addEventListener('click', () => { pausePlayback(); setInstant(currentInstant + 1); });

  instantSliderEl.addEventListener('pointerdown', () => setNoAnim(true));
  instantSliderEl.addEventListener('pointerup', () => setNoAnim(false));
  instantSliderEl.addEventListener('input', (e) => {
    pausePlayback();
    setInstant(parseInt(e.target.value, 10));
  });

  document.addEventListener('keydown', (e) => {
    if (!['Space', 'ArrowLeft', 'ArrowRight'].includes(e.code)) return;
    if (document.body.dataset.mode === 'paging') return;
    const tag = (e.target && e.target.tagName || '').toLowerCase();
    if (['input', 'select', 'textarea', 'button'].includes(tag)) return;
    e.preventDefault();
    if (e.code === 'Space') {
      playing ? pausePlayback() : startPlayback();
    } else if (e.code === 'ArrowLeft') {
      pausePlayback();
      setInstant(currentInstant - 1);
    } else if (e.code === 'ArrowRight') {
      pausePlayback();
      setInstant(currentInstant + 1);
    }
  });

  document.querySelectorAll('.view-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (btn.dataset.view === viewMode) return;
      setViewMode(btn.dataset.view);
      rebuildKeepingInstant();
    });
  });

  zoomOutBtn.addEventListener('click', () => {
    userUnitPx = Math.max(MIN_UNIT_PX, (userUnitPx ?? gUnitPx) - ZOOM_STEP);
    updateZoomBtn();
    rebuildKeepingInstant();
  });
  zoomInBtn.addEventListener('click', () => {
    userUnitPx = Math.min(MAX_UNIT_PX, (userUnitPx ?? gUnitPx) + ZOOM_STEP);
    updateZoomBtn();
    rebuildKeepingInstant();
  });
  zoomFitBtn.addEventListener('click', () => {
    userUnitPx = null;
    updateZoomBtn();
    rebuildKeepingInstant();
  });

  let resizeTimer = null;
  window.addEventListener('resize', () => {
    if (userUnitPx !== null) return;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(rebuildKeepingInstant, 150);
  });
}
