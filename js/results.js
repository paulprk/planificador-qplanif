/**
 * Tabla de TR/TE por proceso y fichas del lote (TPR, TPE y uso de la CPU;
 * en modo E/S también esperas promedio y uso de cada dispositivo).
 * Las explicaciones de cada sigla viven en infopopover.js, detrás del
 * botón "?" que se agrega junto a cada label.
 */
function infoButton(key, label) {
  const info = document.createElement('button');
  info.type = 'button';
  info.className = 'info-btn';
  info.dataset.infoKey = key;
  info.setAttribute('aria-label', `Qué es ${label}`);
  info.textContent = '?';
  return info;
}

function pct(x) {
  return `${(x * 100).toFixed(1)}%`;
}

function renderHead(ioMode) {
  const row = document.getElementById('resultsHead');
  row.innerHTML = '';
  const cols = [
    ['Proceso'], ['Llegada'], ['Ráfaga CPU'], ['Fin'],
    ['TR', 'tr'], ['TE', ioMode ? 'te-io' : 'te']
  ];
  if (ioMode) cols.push(['Espera CPU', 'wcpu'], ['Usa E/S', 'uio'], ['Espera E/S', 'wdev']);
  cols.forEach(([text, key]) => {
    const th = document.createElement('th');
    th.append(text);
    if (key) { th.append(' '); th.appendChild(infoButton(key, text)); }
    row.appendChild(th);
  });
}

/**
 * @param procs        [{ id, name, arrival, burst }]
 * @param finish       { id: instante de fin }
 * @param metrics      resultado de computeMetrics
 * @param resourceLabels null en modo simple; en modo E/S, ['CPU', 'R1', ...]
 */
export function renderResults(procs, finish, metrics, resourceLabels, switches = []) {
  const ioMode = !!resourceLabels;
  const body = document.getElementById('resultsBody');
  const statsGrid = document.getElementById('statsGrid');
  body.innerHTML = '';
  statsGrid.innerHTML = '';
  renderHead(ioMode);

  procs.forEach((p) => {
    const m = metrics.perProc[p.id];
    const cells = [p.name, p.arrival, p.burst, finish[p.id], m.tr, m.te];
    if (ioMode) cells.push(m.waitCpu, m.io, m.waitDev);
    const row = document.createElement('tr');
    cells.forEach((val, idx) => {
      const td = document.createElement('td');
      td.textContent = val;
      row.appendChild(td);
      if (idx === 0) td.style.textAlign = 'left';
    });
    body.appendChild(row);
  });

  const tiles = [
    ['TPR', 'tpr', metrics.tpr.toFixed(2)],
    ['TPE', 'tpe', metrics.tpe.toFixed(2)]
  ];
  if (ioMode) {
    tiles.push(
      ['Espera CPU prom.', 'wcpu', metrics.avgWaitCpu.toFixed(2)],
      ['Espera E/S prom.', 'wdev', metrics.avgWaitDev.toFixed(2)]
    );
  }
  tiles.push(['Uso de CPU', 'ucpu', pct(metrics.utilization[0])]);
  if (switches.length) {
    const total = switches.reduce((a, sw) => a + (sw.end - sw.start), 0);
    tiles.push(['Cambios de contexto', 'ctx', `${switches.length} (${total} u.)`]);
  }
  if (ioMode) {
    resourceLabels.slice(1).forEach((name, i) => {
      tiles.push([`Uso de ${name}`, 'udev', pct(metrics.utilization[i + 1])]);
    });
  }

  tiles.forEach(([label, key, value]) => {
    const tile = document.createElement('div');
    tile.className = 'stat-tile';
    const labRow = document.createElement('div'); labRow.className = 'label-row';
    const lab = document.createElement('span'); lab.className = 'label'; lab.textContent = label;
    labRow.append(lab, infoButton(key, label));
    const val = document.createElement('span'); val.className = 'value'; val.textContent = value;
    tile.append(labRow, val);
    statsGrid.appendChild(tile);
  });
}
