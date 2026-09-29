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

const stagger = () => Math.min(100, duration * 0.15);
const isStep = (prev, t) => prev !== undefined && Math.abs(t - prev) === 1;
const isStart = (prev, t) => prev === undefined && t === 0;

/**
 * Con `cueHost` (la lista de explicaciones, con `data-pid` en cada renglón),
 * las fichas de un proceso con explicación esperan a que termine de aparecer
 * su renglón y salen desde el texto hasta su nuevo lugar. Solo al avanzar
 * hacia adelante (o al arrancar en t = 0).
 */
export function flipRender(hosts, render, t, key, cueHost) {
  const prev = lastT.get(key);
  lastT.set(key, t);
  const cued = !!cueHost && !reduced() && ((isStep(prev, t) && t > prev) || isStart(prev, t));
  const animate = (isStep(prev, t) || cued) && !reduced();

  const before = new Map();
  if (animate && !isStart(prev, t)) {
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

  const cues = new Map();
  if (cued) {
    [...cueHost.children].forEach((li, i) => {
      if (li.dataset.pid === undefined) return;
      const delay = i * stagger() + duration * 0.9;
      cues.set(li.dataset.pid, { delay, from: (li.querySelector('.chip-dot') || li.querySelector('.nar-main') || li).getBoundingClientRect() });
      const d = li.querySelector('.chip-dot');
      if (d) d.animate([{ transform: 'scale(1)' }, { transform: 'scale(2)', offset: 0.4 }, { transform: 'scale(1)' }], { duration: duration * 0.7, delay, easing: 'ease-in-out' });
    });
  }

  hosts.forEach((h, hi) => { const o = h.getBoundingClientRect(); h.querySelectorAll('[data-pid]').forEach((el) => {
    const old = before.get(`${hi}:${el.dataset.pid}`);
    const now = el.getBoundingClientRect();
    if (now.width === 0) return;
    const cue = cues.get(el.dataset.pid);
    const moved = old && (Math.abs(old.x - (now.left - o.left)) >= 1 || Math.abs(old.y - (now.top - o.top)) >= 1);
    if (cue && (!old || moved)) {
      el.style.position = 'relative';
      el.style.zIndex = '5';
      const a = el.animate(
        [
          { opacity: 0, transform: `translate(${cue.from.left - now.left}px, ${cue.from.top - now.top}px)`, boxShadow: '0 0 0 4px var(--accent-soft)', offset: 0 },
          { opacity: 1, transform: `translate(${cue.from.left - now.left}px, ${cue.from.top - now.top}px)`, boxShadow: '0 0 0 4px var(--accent-soft)', offset: 0.1, easing: 'cubic-bezier(0.4, 0, 0.2, 1)' },
          { opacity: 1, transform: 'translate(0, 0)', boxShadow: '0 0 0 0 transparent', offset: 1 }
        ],
        { duration: duration * 1.4, delay: cue.delay, easing: 'linear', fill: 'backwards' }
      );
      a.onfinish = a.oncancel = () => { el.style.position = ''; el.style.zIndex = ''; };
      return;
    }
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
      { duration, delay: cue ? cue.delay : 0, easing: 'cubic-bezier(0.3, 0.7, 0.2, 1)', fill: 'backwards' }
    );
    anim.onfinish = anim.oncancel = () => { el.style.position = ''; el.style.zIndex = ''; };
  }); });
}

/** Cambio de texto entre instantes: los renglones nuevos aparecen de a uno y la altura se ajusta de a poco, para que no salte todo lo de abajo. */
export function fadeSwap(host, render, t, key) {
  const prev = lastT.get(key);
  lastT.set(key, t);
  const animate = (isStep(prev, t) || isStart(prev, t)) && !reduced();
  const oldH = host.offsetHeight;
  render();
  if (!animate) return;
  const newH = host.offsetHeight;
  [...host.children].forEach((li, i) => {
    li.animate(
      [{ opacity: 0, transform: 'translateY(10px)' }, { opacity: 1, transform: 'translateY(0)' }],
      { duration: duration * 0.8, delay: i * stagger(), easing: 'ease-out', fill: 'backwards' }
    );
  });
  if (oldH !== newH) {
    host.style.overflow = 'hidden';
    const a = host.animate(
      [{ height: `${oldH}px` }, { height: `${newH}px` }],
      { duration: duration * 0.8, easing: 'ease-out' }
    );
    a.onfinish = a.oncancel = () => { host.style.overflow = ''; };
  }
}
