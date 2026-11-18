// Utilitaires de texte purs, sans DOM, partagés par app.js, assistant.js, lexique.js et moteur.js.
export function echapper(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}
export function echapperRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Arrondi « lisible » d'un capital pour les débutants (évite la fausse précision) : dizaine sous 1 000, centaine sous
// 100 000, millier sous 1 million, dizaine de milliers au-delà. Le signe est conservé.
export function arrondiLisible(v) {
  if (!Number.isFinite(v)) return v;
  const a = Math.abs(v);
  const pas = a < 1000 ? 10 : a < 100000 ? 100 : a < 1000000 ? 1000 : 10000;
  const r = Math.round(a / pas) * pas;
  return v < 0 ? -r : r;
}
const FORMAT_EUR_ARRONDI = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
export function eurArrondi(v) {
  return FORMAT_EUR_ARRONDI.format(arrondiLisible(v));
}
// Comme eurArrondi, précédé de « ≈ » sauf si l'arrondi vaut zéro (« ≈ 0 € » serait absurde).
export function eurEnviron(v) {
  return arrondiLisible(v) === 0 ? eurArrondi(0) : "≈ " + eurArrondi(v);
}
