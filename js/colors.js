/**
 * Paleta categórica para procesos y helper para asignar color por id.
 * Cada clave corresponde a un par de variables CSS (--p0 / --p0-soft, etc.)
 * definidas en css/styles.css.
 */
export const PALETTE = ['p0', 'p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7'];

export function colorFor(procs, id) {
  const idx = procs.findIndex((p) => p.id === id);
  return PALETTE[idx % PALETTE.length];
}
