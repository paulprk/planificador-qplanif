/**
 * Selector de tema (claro / oscuro / automático). El valor elegido se guarda
 * en localStorage y se aplica como `data-theme` en <html>; "automático"
 * significa que no se fuerza nada y manda `prefers-color-scheme` del sistema.
 * El <head> ya aplica el tema guardado de forma síncrona para evitar el
 * parpadeo al cargar la página; este módulo solo sincroniza los botones y
 * atiende los clics.
 */
const STORAGE_KEY = 'planificador-cpu-theme';
const buttons = document.querySelectorAll('.theme-btn');

function apply(choice) {
  if (choice === 'light' || choice === 'dark') {
    document.documentElement.setAttribute('data-theme', choice);
  } else {
    document.documentElement.removeAttribute('data-theme');
  }
  buttons.forEach((b) => b.classList.toggle('active', b.dataset.themeChoice === choice));
}

function initTheme() {
  let saved = 'auto';
  try {
    saved = localStorage.getItem(STORAGE_KEY) || 'auto';
  } catch (e) { /* localStorage no disponible */ }

  apply(saved);

  buttons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const choice = btn.dataset.themeChoice;
      apply(choice);
      try { localStorage.setItem(STORAGE_KEY, choice); } catch (e) { /* localStorage no disponible */ }
    });
  });
}

initTheme();
