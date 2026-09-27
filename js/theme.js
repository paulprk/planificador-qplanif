/**
 * Selector de tema (claro / oscuro / automático): un botón con ícono de sol
 * que despliega un menú con las 3 opciones. El valor elegido se guarda en
 * localStorage y se aplica como `data-theme` en <html>; "automático" significa
 * que no se fuerza nada y manda `prefers-color-scheme` del sistema.
 * El <head> ya aplica el tema guardado de forma síncrona para evitar el
 * parpadeo al cargar la página; este módulo solo sincroniza el menú y
 * atiende los clics.
 */
const STORAGE_KEY = 'planificador-cpu-theme';
const btn = document.getElementById('themeBtn');
const menu = document.getElementById('themeMenu');
const options = document.querySelectorAll('.theme-option');

function apply(choice) {
  if (choice === 'light' || choice === 'dark') {
    document.documentElement.setAttribute('data-theme', choice);
  } else {
    document.documentElement.removeAttribute('data-theme');
  }
  options.forEach((o) => o.classList.toggle('active', o.dataset.themeChoice === choice));
}

function openMenu() {
  menu.hidden = false;
  btn.setAttribute('aria-expanded', 'true');
}

function closeMenu() {
  menu.hidden = true;
  btn.setAttribute('aria-expanded', 'false');
}

function initTheme() {
  let saved = 'auto';
  try {
    saved = localStorage.getItem(STORAGE_KEY) || 'auto';
  } catch (e) { /* localStorage no disponible */ }

  apply(saved);

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    menu.hidden ? openMenu() : closeMenu();
  });

  options.forEach((opt) => {
    opt.addEventListener('click', () => {
      const choice = opt.dataset.themeChoice;
      apply(choice);
      try { localStorage.setItem(STORAGE_KEY, choice); } catch (e) { /* localStorage no disponible */ }
      closeMenu();
    });
  });

  document.addEventListener('click', (e) => {
    if (!menu.hidden && !menu.contains(e.target) && e.target !== btn) closeMenu();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !menu.hidden) { closeMenu(); btn.focus(); }
  });
}

initTheme();
