/**
 * Panel "Compartir el ejercicio": botones para copiar el código o el link,
 * el recuadro para pegar uno recibido y el aviso flotante (toast). El formato
 * del código vive en share.js; qué datos viajan y cómo se aplican lo decide
 * main.js, que los pasa en `initSharePanel`.
 */
import { encodeShare, decodeShare, shareLink, MODE_LABEL } from './share.js';

const shareCodeEl = document.getElementById('shareCode');
const shareInputEl = document.getElementById('shareInput');
const shareMsgEl = document.getElementById('shareMsg');
let toastTimer = null;

function showToast(text, kind = 'ok') {
  const t = document.getElementById('toast');
  t.textContent = text;
  t.className = `toast ${kind}`;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 4500);
}

function shareMsg(text, kind = 'ok') {
  shareMsgEl.textContent = text;
  shareMsgEl.className = `share-msg ${kind}`;
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (e) {
    shareCodeEl.value = text;
    shareCodeEl.select();
    try { return document.execCommand('copy'); } catch (e2) { return false; }
  }
}

/**
 * @param getMode () => modo actual ('simple' | 'io' | 'mlq' | 'paging')
 * @param getData () => datos del modo actual, listos para serializar
 * @param apply   (modo, datos) => null si se cargó, o un mensaje de error para el usuario
 */
export function initSharePanel({ getMode, getData, apply }) {
  async function loadShared(raw, { fromLink = false } = {}) {
    const res = await decodeShare(raw);
    const error = res.error || apply(res.mode, res.data || {});
    if (error) {
      shareMsg(error, 'err');
      if (fromLink) showToast(`No se pudo cargar el link: ${error}`, 'err');
      return;
    }
    const text = `Se cargó el código: corresponde a ${MODE_LABEL[res.mode]}.`;
    shareMsg(text, 'ok');
    showToast(text, 'ok');
    if (!fromLink) window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function makeCode() {
    const code = await encodeShare(getMode(), getData());
    shareCodeEl.value = code;
    return code;
  }

  document.getElementById('shareCopy').addEventListener('click', async () => {
    const code = await makeCode();
    const ok = await copyText(code);
    shareMsg(ok ? `Código copiado (${MODE_LABEL[getMode()]}). Pegalo donde quieras compartirlo.` : 'No pude copiar solo: seleccioná el código y copialo a mano.', ok ? 'ok' : 'warn');
  });
  document.getElementById('shareCopyLink').addEventListener('click', async () => {
    const link = shareLink(await makeCode());
    const ok = await copyText(link);
    if (!ok) shareCodeEl.value = link;
    shareMsg(ok ? 'Link copiado: quien lo abra ve el ejercicio ya cargado.' : 'No pude copiar solo: seleccioná el link y copialo a mano.', ok ? 'ok' : 'warn');
  });
  document.getElementById('sharePaste').addEventListener('click', async () => {
    try {
      const text = await navigator.clipboard.readText();
      shareInputEl.value = text;
      loadShared(text);
    } catch (e) {
      shareInputEl.focus();
      shareMsg('El navegador no dejó leer el portapapeles: pegá el código en el recuadro (Cmd+V) y tocá Cargar código.', 'warn');
    }
  });
  document.getElementById('shareLoad').addEventListener('click', () => loadShared(shareInputEl.value));

  // Link compartido (?c=...): se carga y se limpia la URL para que recargar no lo pise de nuevo.
  const sharedParam = new URLSearchParams(location.search).get('c');
  if (sharedParam) {
    loadShared(sharedParam, { fromLink: true }).then(() => {
      history.replaceState(null, '', location.pathname + location.hash);
    });
  }
}
