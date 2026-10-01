/**
 * Código para compartir un ejercicio: los datos cargados (y el modo) viajan
 * dentro del código, comprimidos. Formato: PQ1.<modo>.<datos>.<control>
 *   modo: S (simple), E (E/S), M (colas multinivel), P (paginación)
 *   datos: JSON en base64url; empieza con "z" si va comprimido o "j" si no
 *   control: suma de verificación para detectar códigos cortados o mal copiados
 * No hay servidor: el mismo código sirve de link (?c=...).
 */
const VERSION = 'PQ1';
const MODE_LETTER = { simple: 'S', io: 'E', mlq: 'M', paging: 'P' };
const LETTER_MODE = { S: 'simple', E: 'io', M: 'mlq', P: 'paging' };
export const MODE_LABEL = { simple: 'Modo simple', io: 'Modo E/S', mlq: 'Colas multinivel', paging: 'Paginación' };

const canZip = typeof CompressionStream === 'function' && typeof DecompressionStream === 'function';

function toB64url(bytes) {
  let bin = '';
  bytes.forEach((b) => { bin += String.fromCharCode(b); });
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64url(s) {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  const bin = atob(b64);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

async function pipe(bytes, Stream) {
  const out = new Blob([bytes]).stream().pipeThrough(new Stream('deflate-raw'));
  return new Uint8Array(await new Response(out).arrayBuffer());
}

function check(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36).slice(0, 4).padStart(4, '0');
}

export async function encodeShare(mode, data) {
  const json = new TextEncoder().encode(JSON.stringify(data));
  let payload = `j${toB64url(json)}`;
  if (canZip) {
    try { payload = `z${toB64url(await pipe(json, CompressionStream))}`; } catch (e) { /* se queda sin comprimir */ }
  }
  const head = `${VERSION}.${MODE_LETTER[mode]}.${payload}`;
  return `${head}.${check(head)}`;
}

/** Devuelve { mode, data } o { error } con un mensaje para el usuario. */
export async function decodeShare(raw) {
  let text = String(raw || '').trim();
  const fromUrl = text.match(/[?&#]c=([^&#\s]+)/);
  if (fromUrl) text = decodeURIComponent(fromUrl[1]);
  text = text.replace(/\s+/g, '');
  if (!text) return { error: 'Pegá un código primero.' };
  const parts = text.split('.');
  if (!parts[0] || !parts[0].startsWith('PQ')) return { error: 'Eso no parece un código de este simulador (empiezan con PQ1).' };
  if (parts[0] !== VERSION) return { error: 'El código es de otra versión del simulador y no se puede leer.' };
  if (parts.length !== 4) return { error: 'El código está incompleto o mal copiado: revisá que lo hayas pegado entero.' };
  const [ver, letter, payload, ctl] = parts;
  if (check(`${ver}.${letter}.${payload}`) !== ctl) return { error: 'El código está incompleto o mal copiado: revisá que lo hayas pegado entero.' };
  const mode = LETTER_MODE[letter];
  if (!mode) return { error: 'El código no indica un modo válido.' };
  try {
    let bytes = fromB64url(payload.slice(1));
    if (payload[0] === 'z') {
      if (!canZip) return { error: 'Este navegador no puede leer códigos comprimidos. Probá actualizarlo o abrir el link en otro navegador.' };
      bytes = await pipe(bytes, DecompressionStream);
    }
    return { mode, data: JSON.parse(new TextDecoder().decode(bytes)) };
  } catch (e) {
    return { error: 'No se pudo leer el código: puede estar dañado.' };
  }
}

export function shareLink(code) {
  return `${location.origin}${location.pathname}?c=${code}`;
}
