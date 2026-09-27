/**
 * Tabla de TR/TE por proceso y las fichas de TPR/TPE del lote.
 * Las explicaciones de cada sigla viven en infopopover.js, detrás del
 * botón "ⓘ" que se agrega junto a cada label.
 */
export function renderResults(procs, finish) {
  const body = document.getElementById('resultsBody');
  const statsGrid = document.getElementById('statsGrid');
  body.innerHTML = '';
  statsGrid.innerHTML = '';

  let sumTR = 0;
  let sumTE = 0;
  procs.forEach((p) => {
    const f = finish[p.id];
    const tr = f - p.arrival;
    const te = tr - p.burst;
    sumTR += tr;
    sumTE += te;
    const row = document.createElement('tr');
    [p.name, p.arrival, p.burst, f, tr, te].forEach((val, idx) => {
      const td = document.createElement('td');
      td.textContent = val;
      if (idx === 0) td.style.textAlign = 'left';
      row.appendChild(td);
    });
    body.appendChild(row);
  });

  const tpr = (sumTR / procs.length).toFixed(2);
  const tpe = (sumTE / procs.length).toFixed(2);

  [['TPR', tpr], ['TPE', tpe]].forEach(([label, value]) => {
    const tile = document.createElement('div');
    tile.className = 'stat-tile';
    const labRow = document.createElement('div'); labRow.className = 'label-row';
    const lab = document.createElement('span'); lab.className = 'label'; lab.textContent = label;
    const info = document.createElement('button');
    info.type = 'button';
    info.className = 'info-btn';
    info.dataset.infoKey = label.toLowerCase();
    info.setAttribute('aria-label', `Qué es ${label}`);
    info.textContent = 'ⓘ';
    labRow.append(lab, info);
    const val = document.createElement('span'); val.className = 'value'; val.textContent = value;
    tile.append(labRow, val);
    statsGrid.appendChild(tile);
  });
}
