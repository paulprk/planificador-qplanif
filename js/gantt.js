/**
 * Diagrama de Gantt: construcción del DOM (vista única / vista por proceso),
 * la leyenda, y la reproducción animada instante a instante.
 *
 * API pública:
 *   initPlayback()                      — engancha los controles (botones, slider, teclado, toggle de vista)
 *   renderSimulation({ procs, segments, finish, labelText, showPriority, quantumText })
 *                                        — pinta el resultado de una simulación nueva y arranca la reproducción
 */
import { PALETTE, colorFor } from './colors.js';

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
const AUTO_MAX_UNIT_PX = 34;
const MAX_UNIT_PX = 48;
const ZOOM_STEP = 6;

let segEls = [];
let playheadEl = null;
let gUnitPx = 34;
let gMaxEnd = 1;
let gPlayheadOffset = 0;
let viewMode = 'single';
let userUnitPx = null; // null = ajuste automático al ancho disponible

let lastProcs = null;
let lastSegments = [];
let lastShowPriority = false;
let lastQuantumText = null;

let currentInstant = 0;
let maxInstant = 0;
let playing = false;
let playTimer = null;

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
  const usable = avail - 24; // padding interno del track
  return Math.max(MIN_UNIT_PX, Math.min(AUTO_MAX_UNIT_PX, Math.floor(usable / maxEnd)));
}

function updateZoomBtn() {
  zoomFitBtn.classList.toggle('active', userUnitPx === null);
}

function rebuildKeepingInstant() {
  if (!lastProcs) return;
  setNoAnim(true);
  buildGantt(lastProcs, lastSegments, lastShowPriority, lastQuantumText);
  setInstant(currentInstant);
  requestAnimationFrame(() => setNoAnim(false));
}

function updatePlayBtn() {
  playPauseBtn.textContent = playing ? '⏸ Pausar' : '▶ Reproducir';
}

function setInstant(t) {
  currentInstant = Math.max(0, Math.min(maxInstant, t));
  instantSliderEl.value = currentInstant;
  instantLabelEl.textContent = `Instante: ${currentInstant} / ${maxInstant}`;
  updateReveal(currentInstant);
}

function startPlayback() {
  if (playing || maxInstant === 0) return;
  if (currentInstant >= maxInstant) currentInstant = 0;
  playing = true;
  updatePlayBtn();
  playTimer = setInterval(() => {
    if (currentInstant >= maxInstant) { pausePlayback(); return; }
    setInstant(currentInstant + 1);
  }, 420);
}

function pausePlayback() {
  playing = false;
  clearInterval(playTimer);
  updatePlayBtn();
}

function makeSeg(procs, s, container) {
  const div = document.createElement('div');
  const colorKey = colorFor(procs, s.id);
  div.className = 'seg';
  div.style.left = `${s.start * gUnitPx}px`;
  div.style.width = '0px';
  div.style.background = `var(--${colorKey}-soft)`;
  div.style.borderColor = `var(--${colorKey})`;
  const proc = procs.find((p) => p.id === s.id);
  div.dataset.label = proc ? proc.name : s.id;
  div.title = `${proc ? proc.name : s.id}: ${s.start} → ${s.end}`;
  container.appendChild(div);
  segEls.push({ el: div, seg: s });
}

function buildLegend(procs, showPriority, quantumText) {
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
}

function buildSingleTrack(procs, segments, maxEnd, unitPx) {
  ganttTrack.innerHTML = '';
  ganttAxis.innerHTML = '';
  ganttTrack.style.setProperty('--unit-px', `${unitPx}px`);
  const totalWidth = maxEnd * unitPx;
  ganttTrack.style.width = `${totalWidth}px`;
  ganttAxis.style.width = `${totalWidth}px`;

  segments.forEach((s) => makeSeg(procs, s, ganttTrack));

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

function buildLanes(procs, segments, maxEnd, unitPx) {
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

  procs.forEach((p, i) => {
    const label = document.createElement('div');
    label.className = 'lane-label';
    const sw = document.createElement('span');
    sw.className = 'swatch';
    sw.style.background = `var(--${PALETTE[i % PALETTE.length]})`;
    label.appendChild(sw);
    const name = document.createElement('span');
    name.textContent = p.name;
    label.appendChild(name);
    lanesLabels.appendChild(label);

    const track = document.createElement('div');
    track.className = 'lane-track';
    track.style.setProperty('--unit-px', `${unitPx}px`);
    lanesBody.appendChild(track);

    segments.filter((s) => s.id === p.id).forEach((s) => makeSeg(procs, s, track));
  });

  playheadEl = document.createElement('div');
  playheadEl.className = 'lanes-playhead';
  playheadEl.style.left = '0px';
  playheadEl.style.opacity = '0';
  lanesBody.appendChild(playheadEl);
  gPlayheadOffset = 0;
}

function buildGantt(procs, segments, showPriority, quantumText) {
  segEls = [];
  let maxEnd = 0;
  segments.forEach((s) => { if (s.end > maxEnd) maxEnd = s.end; });
  if (maxEnd === 0) maxEnd = 1;
  gMaxEnd = maxEnd;
  gUnitPx = userUnitPx != null ? userUnitPx : autoFitUnitPx(maxEnd);

  if (viewMode === 'lanes') {
    buildLanes(procs, segments, maxEnd, gUnitPx);
  } else {
    buildSingleTrack(procs, segments, maxEnd, gUnitPx);
  }
  buildLegend(procs, showPriority, quantumText);
}

function updateReveal(revealUpTo) {
  segEls.forEach(({ seg: s, el: div }) => {
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
  if (playheadEl) {
    playheadEl.style.left = `${gPlayheadOffset + revealUpTo * gUnitPx}px`;
    playheadEl.style.opacity = (revealUpTo > 0 && revealUpTo < gMaxEnd) ? '1' : '0';
  }
}

/** Pinta un nuevo resultado de simulación y arranca la reproducción desde el instante 0. */
export function renderSimulation({ procs, segments, finish, labelText, showPriority, quantumText }) {
  pausePlayback();
  lastProcs = procs;
  lastSegments = segments;
  lastShowPriority = showPriority;
  lastQuantumText = quantumText;

  algoLabelEl.textContent = labelText;

  maxInstant = 0;
  segments.forEach((s) => { if (s.end > maxInstant) maxInstant = s.end; });
  instantSliderEl.max = maxInstant;

  buildGantt(procs, segments, showPriority, quantumText);
  setNoAnim(true);
  setInstant(0);
  requestAnimationFrame(() => {
    setNoAnim(false);
    startPlayback();
  });
}

export function initPlayback() {
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
    if (e.code !== 'Space') return;
    const tag = (e.target && e.target.tagName || '').toLowerCase();
    if (['input', 'select', 'textarea', 'button'].includes(tag)) return;
    e.preventDefault();
    playing ? pausePlayback() : startPlayback();
  });

  document.querySelectorAll('.view-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (btn.dataset.view === viewMode) return;
      viewMode = btn.dataset.view;
      document.querySelectorAll('.view-btn').forEach((b) => b.classList.toggle('active', b === btn));
      singleWrap.hidden = viewMode !== 'single';
      lanesWrap.hidden = viewMode !== 'lanes';
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
