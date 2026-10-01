/**
 * Modo Paginación: memoria principal, espacio de direcciones del proceso,
 * tabla de páginas y tabla de marcos, más un traductor de direcciones
 * (lógica → física y física → lógica) que avanza de a un paso y marca en los
 * gráficos qué se está usando en cada uno.
 */
const $ = (id) => document.getElementById(id);
const MAX_ROWS = 64;
const PALETTE = ['p0', 'p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7'];
const reduced = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const DEFAULTS = { pageSize: 256, pageUnit: 'B', memSize: 2, memUnit: 'KiB', procSize: 900, procUnit: 'B', name: 'P1', table: [5, 2, 7, 0] };

let cfg = null;
let model = null;
let steps = [];
let stepIdx = -1;
let timer = null;
let direction = 'l2p';
let expandedFrame = null;

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function bytesOf(valueId, unitId) {
  const raw = $(valueId).value.trim();
  if (raw === '') return null;
  const v = Number(raw.replace(',', '.'));
  if (!Number.isFinite(v) || v <= 0) return NaN;
  const b = v * ($(unitId).value === 'KiB' ? 1024 : 1);
  return Number.isInteger(b) ? b : NaN;
}

function readCfg() {
  const table = [...document.querySelectorAll('#pgTableEditor input')].map((i) => (i.value.trim() === '' ? null : Number(i.value)));
  return {
    pageSize: bytesOf('pgPageSize', 'pgPageUnit'),
    memSize: bytesOf('pgMemSize', 'pgMemUnit'),
    procSize: bytesOf('pgProcSize', 'pgProcUnit'),
    name: $('pgName').value.trim() || 'P1',
    table
  };
}

function buildModel(c) {
  const errors = [];
  const notes = [];
  if (c.pageSize == null || Number.isNaN(c.pageSize)) errors.push('El tamaño de página tiene que ser un número entero de bytes mayor a 0.');
  if (Number.isNaN(c.memSize)) errors.push('La memoria principal tiene que ser un número entero de bytes mayor a 0 (o dejala vacía si no se sabe).');
  if (Number.isNaN(c.procSize)) errors.push('El tamaño del proceso tiene que ser un número entero de bytes mayor a 0 (o dejalo vacío si no se sabe).');
  c.table.forEach((f, p) => {
    if (f != null && (!Number.isInteger(f) || f < 0)) errors.push(`El marco de la página ${p} tiene que ser un entero mayor o igual a 0.`);
  });
  if (errors.length) return { errors, notes };

  const ps = c.pageSize;
  const used = c.table.map((f, p) => ({ f, p })).filter((x) => x.f != null);
  const seen = {};
  used.forEach(({ f, p }) => {
    if (seen[f] != null) errors.push(`Las páginas ${seen[f]} y ${p} están en el mismo marco (${f}): cada marco guarda una sola página.`);
    seen[f] = p;
  });

  let numFrames;
  if (c.memSize != null) {
    numFrames = Math.floor(c.memSize / ps);
    if (c.memSize % ps) notes.push(`La memoria (${c.memSize} B) no es múltiplo del tamaño de página: los ${c.memSize % ps} bytes del final no forman un marco completo y no se usan.`);
    used.forEach(({ f, p }) => { if (f >= numFrames) errors.push(`La página ${p} apunta al marco ${f}, pero la memoria tiene marcos 0 a ${numFrames - 1}.`); });
  } else {
    numFrames = used.length ? Math.max(...used.map((x) => x.f)) + 1 : 1;
    notes.push(`No se indicó el tamaño de la memoria: se dibujan los marcos 0 a ${numFrames - 1} (hasta el más alto que aparece en la tabla).`);
  }

  let numPages;
  if (c.procSize != null) {
    numPages = Math.ceil(c.procSize / ps);
    if (c.table.length < numPages) notes.push(`El proceso necesita ${numPages} páginas, pero la tabla tiene ${c.table.length} entradas: las páginas que faltan no se pueden traducir.`);
    if (c.table.length > numPages) notes.push(`La tabla tiene más entradas que páginas del proceso (${numPages}): las de más se ignoran.`);
  } else {
    numPages = c.table.length;
    notes.push('No se indicó el tamaño del proceso: se toma que usa completas todas las páginas de la tabla.');
  }
  if (numFrames > MAX_ROWS) errors.push(`La memoria tiene ${numFrames} marcos: es demasiado para dibujarla (máximo ${MAX_ROWS}).`);
  if (numPages > MAX_ROWS) errors.push(`El proceso tiene ${numPages} páginas: es demasiado para dibujarlo (máximo ${MAX_ROWS}).`);
  if (numPages === 0) errors.push('Cargá al menos una página en la tabla.');
  if (errors.length) return { errors, notes };

  const pageFrame = Array.from({ length: numPages }, (_, p) => (c.table[p] != null ? c.table[p] : null));
  const frameOwner = Array(numFrames).fill(null);
  pageFrame.forEach((f, p) => { if (f != null) frameOwner[f] = p; });
  const logicalSize = c.procSize != null ? c.procSize : numPages * ps;
  const lastUsed = logicalSize - (numPages - 1) * ps;
  return { errors, notes, ps, numFrames, numPages, pageFrame, frameOwner, logicalSize, lastUsed, memKnown: c.memSize != null, procKnown: c.procSize != null, memSize: c.memSize, name: c.name };
}

const color = (p) => PALETTE[p % PALETTE.length];
const usedOf = (p) => (p === model.numPages - 1 ? model.lastUsed : model.ps);

// --- Datos ---

function renderTableEditor(table) {
  const box = $('pgTableEditor');
  box.innerHTML = '';
  table.forEach((f, p) => {
    const row = el('label', 'pg-te-row');
    row.append(el('span', 'pg-te-page', `Página ${p}`), el('span', 'pg-te-arrow', '→ marco'));
    const inp = el('input', 'num-cell');
    inp.type = 'number';
    inp.min = '0';
    inp.id = `pgFrame${p}`;
    inp.value = f == null ? '' : f;
    inp.setAttribute('aria-label', `Marco de la página ${p}`);
    row.appendChild(inp);
    box.appendChild(row);
  });
}

function renderSummary() {
  const s = $('pgSummary');
  s.innerHTML = '';
  if (!model) return;
  const m = model;
  const items = [
    ['Marcos de memoria', m.memKnown ? `${m.memSize} / ${m.ps} = ${m.numFrames} marcos (0 a ${m.numFrames - 1})` : `al menos ${m.numFrames} (0 a ${m.numFrames - 1})`],
    ['Páginas del proceso', m.procKnown ? `⌈${m.logicalSize} / ${m.ps}⌉ = ${m.numPages} páginas (0 a ${m.numPages - 1})` : `${m.numPages} (las de la tabla)`],
    ['Espacio lógico', `direcciones 0 a ${m.logicalSize - 1}`],
    ['Fragmentación interna', m.procKnown ? `${m.numPages} × ${m.ps} − ${m.logicalSize} = ${m.numPages * m.ps - m.logicalSize} bytes (en la página ${m.numPages - 1})` : 'no se puede calcular sin el tamaño del proceso'],
    ['Dirección física de un marco', `marco × ${m.ps}`]
  ];
  items.forEach(([k, v]) => {
    const d = el('div', 'pg-sum-item');
    d.append(el('span', 'pg-sum-k', k), el('span', 'pg-sum-v', v));
    s.appendChild(d);
  });
}

// --- Gráficos ---

function block(kind, idx, p, label, range, ownerText) {
  const b = el('div', `pg-block ${kind}`);
  b.dataset.idx = idx;
  const fill = el('div', 'pg-fill');
  if (p != null) {
    b.style.setProperty('--c', `var(--${color(p)})`);
    b.style.setProperty('--cs', `var(--${color(p)}-soft)`);
    b.classList.add('owned');
    const u = usedOf(p);
    if (u < model.ps) {
      fill.style.width = `${(u / model.ps) * 100}%`;
      const waste = el('div', 'pg-waste');
      waste.style.left = `${(u / model.ps) * 100}%`;
      waste.title = `Sin usar: ${model.ps - u} bytes (fragmentación interna)`;
      b.appendChild(waste);
    }
  }
  b.appendChild(fill);
  const txt = el('div', 'pg-block-text');
  txt.append(el('span', 'pg-block-label', label));
  if (ownerText) txt.append(el('span', 'pg-block-owner', ownerText));
  txt.append(el('span', 'pg-block-range', range));
  b.appendChild(txt);
  return b;
}

function renderDrawings() {
  const L = $('pgLogical');
  const PT = $('pgPageTable');
  const M = $('pgMemory');
  const FT = $('pgFrameTable');
  [L, PT, M, FT].forEach((x) => { x.innerHTML = ''; });
  $('pgLogicalTitle').textContent = `Espacio de direcciones de ${model.name}`;
  if (!model) return;
  const m = model;

  L.appendChild(el('div', 'pg-colhead', 'direcciones lógicas'));
  for (let p = 0; p < m.numPages; p++) {
    const end = p === m.numPages - 1 ? m.logicalSize - 1 : (p + 1) * m.ps - 1;
    const b = block('pg-page', p, p, `Página ${p}`, `${p * m.ps} – ${end}`, '');
    if (usedOf(p) < m.ps) b.title = `La página ${p} usa ${usedOf(p)} de ${m.ps} bytes; el rayado (${m.ps - usedOf(p)} bytes) es fragmentación interna.`;
    L.appendChild(b);
  }

  const ph = el('div', 'pg-row pg-colhead pg-trow');
  ph.append(el('span', null, 'Página'), el('span', null, 'Marco'), el('span', null, 'Base física'));
  PT.appendChild(ph);
  for (let p = 0; p < m.numPages; p++) {
    const f = m.pageFrame[p];
    const r = el('div', 'pg-row pg-trow');
    r.dataset.idx = p;
    r.style.setProperty('--c', `var(--${color(p)})`);
    r.append(el('span', 'pg-tcell-page', String(p)), el('span', 'pg-tcell-frame', f == null ? '—' : String(f)), el('span', 'pg-tcell-base', f == null ? '—' : `${f} × ${m.ps} = ${f * m.ps}`));
    PT.appendChild(r);
  }

  M.appendChild(el('div', 'pg-colhead', 'direcciones físicas'));
  const fh = el('div', 'pg-row pg-colhead pg-trow pg-ftrow');
  fh.append(el('span', null, 'Marco'), el('span', null, 'Estado'));
  FT.appendChild(fh);
  for (let f = 0; f < m.numFrames; f++) {
    const p = m.frameOwner[f];
    // Los marcos libres del final (después del último ocupado) se dibujan como un solo recuadro, salvo el que se usa en la traducción.
    let to = f;
    if (p == null && f !== expandedFrame) {
      while (to + 1 < m.numFrames && m.frameOwner[to + 1] == null && to + 1 !== expandedFrame) to++;
      if (to !== m.numFrames - 1) to = f;
    }
    if (to > f) {
      const g = block('pg-frame pg-group', f, null, `Marcos ${f}–${to}`, `${f * m.ps} – ${(to + 1) * m.ps - 1}`, '');
      g.title = `Los marcos ${f} a ${to} están libres: se agrupan para no ocupar tanto lugar.`;
      M.appendChild(g);
      const r = el('div', 'pg-row pg-trow pg-ftrow pg-group');
      r.append(el('span', null, `${f}–${to}`), el('span', 'pg-free', `libres (${to - f + 1} marcos)`));
      FT.appendChild(r);
      f = to;
      continue;
    }
    M.appendChild(block('pg-frame', f, p, `Marco ${f}`, `${f * m.ps} – ${(f + 1) * m.ps - 1}`, p != null ? `pág. ${p}` : 'libre'));
    const r = el('div', 'pg-row pg-trow pg-ftrow');
    r.dataset.idx = f;
    if (p != null) r.style.setProperty('--c', `var(--${color(p)})`);
    r.append(el('span', null, String(f)), el('span', p != null ? 'pg-busy' : 'pg-free', p != null ? `${m.name} · página ${p}` : 'libre'));
    FT.appendChild(r);
  }
}

// --- Traducción ---

const fmt = (n) => String(n);

function buildSteps(dir, addr) {
  const m = model;
  const out = [];
  const add = (title, detail, hl = {}, end) => out.push({ title, detail, hl, end });
  if (dir === 'l2p') {
    const L = addr;
    if (m.procKnown && L >= m.logicalSize) {
      add('¿La dirección es del proceso?', `${m.name} ocupa las direcciones lógicas 0 a ${m.logicalSize - 1}, y ${L} está afuera.`, {}, { ok: false, text: `La dirección lógica ${L} no corresponde al espacio de ${m.name}: no tiene dirección física.` });
      return out;
    }
    add('¿La dirección es del proceso?', m.procKnown ? `Sí: ${m.name} ocupa las direcciones lógicas 0 a ${m.logicalSize - 1}, y ${L} está adentro.` : 'No se conoce el tamaño del proceso: alcanza con que su página esté en la tabla.', { lmark: L });
    const p = Math.floor(L / m.ps);
    const d = L % m.ps;
    add('Separo página y desplazamiento', `página = ⌊${L} / ${m.ps}⌋ = ${p}\ndesplazamiento = ${L} mod ${m.ps} = ${d}\n(${L} = ${p} × ${m.ps} + ${d})`, { page: p, lmark: L });
    if (p >= m.numPages || m.pageFrame[p] == null) {
      add('Busco la página en la tabla', `La página ${p} no figura en la tabla de páginas que se dio.`, { page: p < m.numPages ? p : null, lmark: L }, { ok: false, text: `No se puede traducir ${L}: la página ${p} no está en la tabla.` });
      return out;
    }
    const f = m.pageFrame[p];
    add('Busco la página en la tabla de páginas', `La página ${p} está en el marco ${f}.`, { page: p, row: p, lmark: L, lines: 1 });
    add('Ubico el marco en memoria', `El marco ${f} empieza en la dirección física ${f} × ${m.ps} = ${f * m.ps}.`, { page: p, row: p, frame: f, lmark: L, lines: 2 });
    const F = f * m.ps + d;
    add('Sumo el desplazamiento', `dirección física = ${f * m.ps} + ${d} = ${F}`, { page: p, row: p, frame: f, lmark: L, fmark: F, lines: 2 }, { ok: true, value: F, text: `La dirección lógica ${L} es la dirección física ${F}.` });
    return out;
  }
  const F = addr;
  if (m.memKnown && F >= m.numFrames * m.ps) {
    add('¿La dirección existe en memoria?', `La memoria va de 0 a ${m.numFrames * m.ps - 1}, y ${F} está afuera.`, {}, { ok: false, text: `La dirección física ${F} no existe en esta memoria.` });
    return out;
  }
  const f = Math.floor(F / m.ps);
  const d = F % m.ps;
  add('Separo marco y desplazamiento', `marco = ⌊${F} / ${m.ps}⌋ = ${f}\ndesplazamiento = ${F} mod ${m.ps} = ${d}\n(${F} = ${f} × ${m.ps} + ${d})`, { frame: f < m.numFrames ? f : null, fmark: f < m.numFrames ? F : null });
  const p = f < m.numFrames ? m.frameOwner[f] : null;
  if (p == null) {
    add('¿Qué hay en ese marco?', f < m.numFrames ? `En la tabla de marcos, el marco ${f} figura libre: ninguna página de ${m.name} está ahí.` : `El marco ${f} no aparece en la tabla de páginas de ${m.name}.`, { frame: f < m.numFrames ? f : null, fmark: f < m.numFrames ? F : null }, { ok: false, text: `La dirección física ${F} no corresponde a ${m.name}.` });
    return out;
  }
  add('¿Qué hay en ese marco?', `En la tabla de marcos, el marco ${f} tiene la página ${p} de ${m.name} (en la tabla de páginas: página ${p} → marco ${f}).`, { frame: f, row: p, fmark: F, lines: 2 });
  const L = p * m.ps + d;
  if (L >= m.logicalSize) {
    add('Armo la dirección lógica', `dirección lógica = ${p} × ${m.ps} + ${d} = ${L}\nPero ${m.name} solo usa hasta la ${m.logicalSize - 1}: esa parte del marco es la sobra de la última página (fragmentación interna).`, { frame: f, row: p, page: p, fmark: F, lines: 2 }, { ok: false, text: `La dirección física ${F} cae en la parte sin usar de la página ${p}: no corresponde a ninguna dirección lógica de ${m.name}.` });
    return out;
  }
  add('Armo la dirección lógica', `dirección lógica = página × ${m.ps} + desplazamiento = ${p} × ${m.ps} + ${d} = ${L}`, { frame: f, row: p, page: p, fmark: F, lmark: L, lines: 2 }, { ok: true, value: L, text: `La dirección física ${F} es la dirección lógica ${L} de ${m.name}.` });
  return out;
}

function placeMark(container, sel, idx, offset, cls) {
  const b = container.querySelector(`${sel}[data-idx="${idx}"]`);
  if (!b) return null;
  const mk = el('div', `pg-mark ${cls}`);
  mk.style.left = `${(offset / model.ps) * 100}%`;
  b.appendChild(mk);
  return mk;
}

function clearHighlights() {
  document.querySelectorAll('#pgStage .hl').forEach((x) => x.classList.remove('hl'));
  document.querySelectorAll('#pgStage .pg-mark').forEach((x) => x.remove());
  $('pgLines').innerHTML = '';
}

function center(r, o, side) {
  return { x: (side === 'l' ? r.left : side === 'r' ? r.right : (r.left + r.right) / 2) - o.left, y: (r.top + r.bottom) / 2 - o.top };
}

function drawLines(hl) {
  const svg = $('pgLines');
  svg.innerHTML = '';
  if (!hl.lines) return;
  const stage = $('pgStage');
  const o = stage.getBoundingClientRect();
  svg.setAttribute('width', o.width);
  svg.setAttribute('height', o.height);
  svg.setAttribute('viewBox', `0 0 ${o.width} ${o.height}`);
  const row = $('pgPageTable').querySelector(`.pg-trow[data-idx="${hl.row}"]`);
  const page = $('pgLogical').querySelector(`.pg-block[data-idx="${hl.page != null ? hl.page : hl.row}"]`);
  const frame = hl.frame != null ? $('pgMemory').querySelector(`.pg-block[data-idx="${hl.frame}"]`) : null;
  if (!row || !page) return;
  const rr = row.getBoundingClientRect();
  const stacked = rr.top > page.getBoundingClientRect().bottom;
  if (stacked) return;
  const seg = (a, b, delay) => {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    const mx = (a.x + b.x) / 2;
    path.setAttribute('d', stacked ? `M${a.x},${a.y} L${b.x},${b.y}` : `M${a.x},${a.y} C${mx},${a.y} ${mx},${b.y} ${b.x},${b.y}`);
    path.setAttribute('class', 'pg-line');
    path.setAttribute('marker-end', 'url(#pgArrow)');
    svg.appendChild(path);
    if (!reduced()) {
      const len = path.getTotalLength();
      path.animate([{ strokeDasharray: `${len}`, strokeDashoffset: `${len}` }, { strokeDasharray: `${len}`, strokeDashoffset: '0' }], { duration: 500, delay, easing: 'ease-out', fill: 'backwards' });
    }
  };
  svg.innerHTML = '<defs><marker id="pgArrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" class="pg-arrowhead"/></marker></defs>';
  const pr = page.getBoundingClientRect();
  const fromL2P = direction === 'l2p';
  const a1 = stacked ? center(pr, o, 'c') : center(pr, o, 'r');
  const b1 = stacked ? center(rr, o, 'c') : center(rr, o, 'l');
  if (fromL2P) seg(a1, b1, 0);
  if (frame && hl.lines >= 2) {
    const fr = frame.getBoundingClientRect();
    const a2 = stacked ? center(rr, o, 'c') : center(rr, o, 'r');
    const b2 = stacked ? center(fr, o, 'c') : center(fr, o, 'l');
    if (fromL2P) seg(a2, b2, 150);
    else {
      seg(b2, a2, 0);
      if (hl.lmark != null) seg(b1, a1, 250);
    }
  }
}

function applyStep(i) {
  stepIdx = i;
  clearHighlights();
  const list = $('pgSteps');
  [...list.children].forEach((li, k) => {
    li.hidden = k > i;
    li.classList.toggle('current', k === i);
  });
  const cur = steps[i];
  if (!cur) return;
  const hl = cur.hl;
  const lm = $('pgLogical');
  const mm = $('pgMemory');
  if (hl.page != null) lm.querySelector(`.pg-block[data-idx="${hl.page}"]`)?.classList.add('hl');
  if (hl.row != null) $('pgPageTable').querySelector(`.pg-trow[data-idx="${hl.row}"]`)?.classList.add('hl');
  if (hl.frame != null) {
    mm.querySelector(`.pg-block[data-idx="${hl.frame}"]`)?.classList.add('hl');
    $('pgFrameTable').querySelector(`.pg-trow[data-idx="${hl.frame}"]`)?.classList.add('hl');
  }
  if (hl.lmark != null) {
    const p = Math.floor(hl.lmark / model.ps);
    placeMark(lm, '.pg-block', p, hl.lmark % model.ps, 'logical')?.setAttribute('data-label', String(hl.lmark));
  }
  if (hl.fmark != null) {
    const f = Math.floor(hl.fmark / model.ps);
    placeMark(mm, '.pg-block', f, hl.fmark % model.ps, 'physical')?.setAttribute('data-label', String(hl.fmark));
  }
  drawLines(hl);
  const res = $('pgResult');
  res.hidden = !cur.end;
  if (cur.end) renderResult(cur.end);
  $('pgPrev').disabled = i <= 0;
  $('pgNext').disabled = i >= steps.length - 1;
  $('pgStepCount').textContent = `Paso ${i + 1} de ${steps.length}`;
}

function renderResult(end) {
  const res = $('pgResult');
  res.innerHTML = '';
  res.className = `pg-result ${end.ok ? 'ok' : 'bad'}`;
  res.appendChild(el('strong', null, end.text));
  const mine = $('pgAnswer').value.trim();
  if (mine !== '') {
    const saidNo = /^(no|-|x|ninguna|no corresponde)$/i.test(mine);
    const right = end.ok ? Number(mine) === end.value : saidNo;
    const c = el('span', `pg-check ${right ? 'right' : 'wrong'}`, right ? `✓ Tu respuesta (${mine}) es correcta.` : `✗ Tu respuesta fue ${mine}. ${end.ok ? `El resultado es ${end.value}.` : 'Esa dirección no tiene traducción.'}`);
    res.appendChild(c);
  }
}

function stopAuto() {
  clearInterval(timer);
  timer = null;
  $('pgPlay').textContent = '▶ Reproducir pasos';
}

function startAuto(fromStart) {
  stopAuto();
  if (fromStart || stepIdx >= steps.length - 1) applyStep(0);
  $('pgPlay').textContent = '⏸ Pausar';
  timer = setInterval(() => {
    if (stepIdx >= steps.length - 1) { stopAuto(); return; }
    applyStep(stepIdx + 1);
  }, 1400);
}

function translate() {
  const msg = $('pgAddrMsg');
  msg.textContent = '';
  if (!model || model.errors.length) return;
  const raw = $('pgAddr').value.trim();
  const a = Number(raw);
  if (raw === '' || !Number.isInteger(a) || a < 0) {
    msg.textContent = 'Escribí una dirección: un número entero mayor o igual a 0.';
    return;
  }
  steps = buildSteps(direction, a);
  const target = steps.map((st) => st.hl.frame).find((f) => f != null);
  expandedFrame = target != null ? target : null;
  renderDrawings();
  const list = $('pgSteps');
  list.innerHTML = '';
  steps.forEach((s) => {
    const li = el('li', 'pg-step');
    li.append(el('span', 'pg-step-title', s.title));
    const d = el('span', 'pg-step-detail', s.detail);
    li.appendChild(d);
    list.appendChild(li);
  });
  $('pgStepper').hidden = false;
  if (reduced()) applyStep(steps.length - 1);
  else startAuto(true);
}

function resetTranslation() {
  stopAuto();
  steps = [];
  stepIdx = -1;
  $('pgSteps').innerHTML = '';
  $('pgStepper').hidden = true;
  $('pgResult').hidden = true;
  clearHighlights();
  if (expandedFrame != null) {
    expandedFrame = null;
    if (model && !model.errors.length) renderDrawings();
  }
}

function refresh() {
  cfg = readCfg();
  model = buildModel(cfg);
  const msgs = $('pgMsgs');
  msgs.innerHTML = '';
  model.errors.forEach((e) => msgs.appendChild(el('p', 'pg-msg err', e)));
  model.notes.forEach((n) => msgs.appendChild(el('p', 'pg-msg note', n)));
  resetTranslation();
  const ok = !model.errors.length;
  $('pgDrawPanel').hidden = !ok;
  if (!ok) { $('pgSummary').innerHTML = ''; return; }
  renderSummary();
  renderDrawings();
}

function setDirection(dir) {
  direction = dir;
  document.querySelectorAll('.pg-dir-btn').forEach((b) => {
    b.classList.toggle('active', b.dataset.dir === dir);
    b.setAttribute('aria-pressed', String(b.dataset.dir === dir));
  });
  $('pgAddrLabel').textContent = dir === 'l2p' ? 'Dirección lógica' : 'Dirección física';
  $('pgAnswerLabel').textContent = dir === 'l2p' ? 'Tu dirección física (opcional)' : 'Tu dirección lógica (opcional)';
  $('pgAnswer').placeholder = dir === 'l2p' ? 'ej: 1880' : 'ej: 620';
  $('pgAnswer').value = '';
  resetTranslation();
}

function loadDefaults() {
  $('pgPageSize').value = DEFAULTS.pageSize;
  $('pgPageUnit').value = DEFAULTS.pageUnit;
  $('pgMemSize').value = DEFAULTS.memSize;
  $('pgMemUnit').value = DEFAULTS.memUnit;
  $('pgProcSize').value = DEFAULTS.procSize;
  $('pgProcUnit').value = DEFAULTS.procUnit;
  $('pgName').value = DEFAULTS.name;
  renderTableEditor(DEFAULTS.table);
  refresh();
}

let inited = false;
export function initPaging() {
  if (inited) return;
  inited = true;
  const form = $('pagingPanel');
  form.addEventListener('input', (e) => { if (e.target.closest('.pg-form, #pgTableEditor')) refresh(); });
  form.addEventListener('change', (e) => { if (e.target.tagName === 'SELECT') refresh(); });
  $('pgAddPage').addEventListener('click', () => {
    const t = readCfg().table;
    if (t.length >= MAX_ROWS) return;
    renderTableEditor([...t, null]);
    $(`pgFrame${t.length}`).focus();
    refresh();
  });
  $('pgDelPage').addEventListener('click', () => {
    const t = readCfg().table;
    if (t.length <= 1) return;
    renderTableEditor(t.slice(0, -1));
    refresh();
  });
  $('pgReset').addEventListener('click', loadDefaults);
  document.querySelectorAll('.pg-dir-btn').forEach((b) => b.addEventListener('click', () => setDirection(b.dataset.dir)));
  $('pgGo').addEventListener('click', translate);
  [$('pgAddr'), $('pgAnswer')].forEach((i) => i.addEventListener('keydown', (e) => { if (e.key === 'Enter') translate(); }));
  $('pgPrev').addEventListener('click', () => { stopAuto(); if (stepIdx > 0) applyStep(stepIdx - 1); });
  $('pgNext').addEventListener('click', () => { stopAuto(); if (stepIdx < steps.length - 1) applyStep(stepIdx + 1); });
  $('pgPlay').addEventListener('click', () => (timer ? stopAuto() : startAuto(false)));
  document.addEventListener('keydown', (e) => {
    if (document.body.dataset.mode !== 'paging' || !steps.length) return;
    const tag = (e.target && e.target.tagName || '').toLowerCase();
    if (['input', 'select', 'textarea', 'button'].includes(tag)) return;
    if (e.code === 'ArrowLeft') { e.preventDefault(); $('pgPrev').click(); }
    if (e.code === 'ArrowRight') { e.preventDefault(); $('pgNext').click(); }
    if (e.code === 'Space') { e.preventDefault(); $('pgPlay').click(); }
  });
  window.addEventListener('resize', () => { if (stepIdx >= 0 && steps[stepIdx]) drawLines(steps[stepIdx].hl); });
  loadDefaults();
}

/** Datos cargados en Paginación, tal como están en el formulario (para el código para compartir). */
export function getPagingState() {
  return {
    ps: $('pgPageSize').value, pu: $('pgPageUnit').value,
    ms: $('pgMemSize').value, mu: $('pgMemUnit').value,
    s: $('pgProcSize').value, su: $('pgProcUnit').value,
    n: $('pgName').value,
    t: [...document.querySelectorAll('#pgTableEditor input')].map((i) => i.value)
  };
}

export function setPagingState(st) {
  initPaging();
  const unit = (u) => (u === 'KiB' ? 'KiB' : 'B');
  $('pgPageSize').value = st.ps ?? '';
  $('pgPageUnit').value = unit(st.pu);
  $('pgMemSize').value = st.ms ?? '';
  $('pgMemUnit').value = unit(st.mu);
  $('pgProcSize').value = st.s ?? '';
  $('pgProcUnit').value = unit(st.su);
  $('pgName').value = st.n || 'P1';
  const t = Array.isArray(st.t) && st.t.length ? st.t.slice(0, MAX_ROWS).map((v) => (v === '' || v == null ? null : Number(v))) : [null];
  renderTableEditor(t);
  refresh();
}
