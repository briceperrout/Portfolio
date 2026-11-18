// Utilitaires de texte purs, sans DOM, partagés par app.js, assistant.js, lexique.js et moteur.js.
export function echapper(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}
export function echapperRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
