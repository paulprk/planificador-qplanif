/**
 * Tabla editable del lote de procesos: alta/baja de filas, recoloreo de las
 * muestras de color, y lectura de la tabla como una lista de procesos lista
 * para pasarle a los algoritmos.
 */
import { PALETTE } from './colors.js';

const procBody = document.getElementById('procBody');
const procTable = document.getElementById('procTable');
let nextOrder = 0;

export function defaultRows() {
  return [
    { name: 'P1', arrival: 0, burst: 5, priority: 2 },
    { name: 'P2', arrival: 1, burst: 3, priority: 1 },
    { name: 'P3', arrival: 2, burst: 8, priority: 3 }
  ];
}

export function addRow(data) {
  const tr = document.createElement('tr');
  const order = nextOrder++;
  tr.dataset.order = order;

  const tdColor = document.createElement('td');
  const sw = document.createElement('span');
  sw.className = 'swatch';
  sw.style.background = `var(--${PALETTE[order % PALETTE.length]})`;
  tdColor.appendChild(sw);

  const tdName = document.createElement('td');
  const nameWrap = document.createElement('div');
  nameWrap.className = 'name-row';
  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.className = 'name-cell';
  nameInput.value = data.name;
  nameInput.id = `name-${order}`;
  nameWrap.appendChild(nameInput);
  tdName.appendChild(nameWrap);

  const tdArr = document.createElement('td');
  const arrInput = document.createElement('input');
  arrInput.type = 'number'; arrInput.min = '0'; arrInput.className = 'num-cell';
  arrInput.value = data.arrival; arrInput.id = `arr-${order}`;
  tdArr.appendChild(arrInput);

  const tdBurst = document.createElement('td');
  const burstInput = document.createElement('input');
  burstInput.type = 'number'; burstInput.min = '1'; burstInput.className = 'num-cell';
  burstInput.value = data.burst; burstInput.id = `burst-${order}`;
  tdBurst.appendChild(burstInput);

  const tdPri = document.createElement('td');
  tdPri.className = 'pri-col';
  const priInput = document.createElement('input');
  priInput.type = 'number'; priInput.min = '0'; priInput.className = 'num-cell';
  priInput.value = data.priority; priInput.id = `pri-${order}`;
  tdPri.appendChild(priInput);

  const tdRm = document.createElement('td');
  const rmBtn = document.createElement('button');
  rmBtn.type = 'button'; rmBtn.className = 'rm-btn'; rmBtn.textContent = '✕';
  rmBtn.setAttribute('aria-label', 'Quitar proceso');
  rmBtn.addEventListener('click', () => { tr.remove(); recolor(); });
  tdRm.appendChild(rmBtn);

  tr.append(tdColor, tdName, tdArr, tdBurst, tdPri, tdRm);
  procBody.appendChild(tr);
}

export function addDefaultRow() {
  const n = procBody.querySelectorAll('tr').length + 1;
  addRow({ name: `P${n}`, arrival: 0, burst: 1, priority: 0 });
}

function recolor() {
  procBody.querySelectorAll('tr').forEach((tr, i) => {
    tr.querySelector('.swatch').style.background = `var(--${PALETTE[i % PALETTE.length]})`;
  });
}

/** Vacía la tabla y la repuebla con la lista de procesos dada. */
export function replaceRows(dataArray) {
  procBody.innerHTML = '';
  nextOrder = 0;
  dataArray.forEach(addRow);
}

export function loadDefault() {
  replaceRows(defaultRows());
}

export function readProcesses() {
  const rows = procBody.querySelectorAll('tr');
  const procs = [];
  rows.forEach((tr, i) => {
    const name = tr.querySelector('input.name-cell').value || `P${i + 1}`;
    const arrival = parseInt(tr.querySelector('input[id^="arr-"]').value, 10);
    const burst = parseInt(tr.querySelector('input[id^="burst-"]').value, 10);
    const priority = parseInt(tr.querySelector('input[id^="pri-"]').value, 10);
    procs.push({
      id: `r${tr.dataset.order}`,
      order: i,
      name,
      arrival: isNaN(arrival) ? 0 : arrival,
      burst: isNaN(burst) ? 1 : burst,
      priority: isNaN(priority) ? 0 : priority
    });
  });
  return procs;
}

export function setPriorityColumnVisible(visible) {
  procTable.classList.toggle('hide-pri', !visible);
}
