/**
 * Animación de fichas entre instantes (técnica FLIP): antes de redibujar se
 * mide dónde estaba cada ficha (`data-pid`), y después se la hace "viajar"
 * desde su lugar anterior hasta el nuevo, para que se note que, por ejemplo,
 * P2 bajó de la CPU al dispositivo R1. Solo anima cuando se avanza o
 * retrocede de a un instante.
 */
const lastT = new Map();
let duration = 550;

const reduced = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function setFlipDuration(ms) {
  duration = ms;
}

export function resetFlip() {
  lastT.clear();
}

export function flipRender(hosts, render, t, key) {
  const prev = lastT.get(key);
  lastT.set(key, t);
  const animate = prev !== undefined && Math.abs(t - prev) === 1 && !reduced();

  const before = new Map();
  if (animate) {
    hosts.forEach((h, hi) => {
      const o = h.getBoundingClientRect();
      h.querySelectorAll('[data-pid]').forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.width > 0) before.set(`${hi}:${el.dataset.pid}`, { x: r.left - o.left, y: r.top - o.top });
      });
    });
  }
  render();
  if (!animate) return;

  hosts.forEach((h, hi) => { const o = h.getBoundingClientRect(); h.querySelectorAll('[data-pid]').forEach((el) => {
    const old = before.get(`${hi}:${el.dataset.pid}`);
    const now = el.getBoundingClientRect();
    if (now.width === 0) return;
    if (!old) {
      el.animate(
        [{ opacity: 0, transform: 'scale(0.6)' }, { opacity: 1, transform: 'scale(1)' }],
        { duration: duration * 0.8, easing: 'ease-out' }
      );
      return;
    }
    const dx = old.x - (now.left - o.left);
    const dy = old.y - (now.top - o.top);
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
    el.style.position = 'relative';
    el.style.zIndex = '5';
    const anim = el.animate(
      [
        { transform: `translate(${dx}px, ${dy}px)`, boxShadow: '0 0 0 3px var(--accent-soft)' },
        { transform: 'translate(0, 0)', boxShadow: '0 0 0 0 transparent' }
      ],
      { duration, easing: 'cubic-bezier(0.3, 0.7, 0.2, 1)' }
    );
    anim.onfinish = anim.oncancel = () => { el.style.position = ''; el.style.zIndex = ''; };
  }); });
}
