// Détection et masquage des montants pour le mode discrétion (Alt+H). Module pur : aucun DOM.
// Reconnaît les montants en euros (€, k€, « euros »), en devises (symboles $, $US, $CA, US$, £, £GB, CHF,
// codes USD / CAD / GBP / EUR après le nombre, y compris la sortie de Intl.NumberFormat fr-FR) et les
// symboles préfixés ($1,234, £1,234). Les pourcentages, années, âges et nombres sans unité monétaire
// restent intacts. Le texte masqué ne contient jamais de chiffre suivi d'une unité : le masquer
// deux fois ne change rien, et un observateur de DOM ne boucle donc pas sur ses propres écritures.
// Le masquage réversible du DOM (registre des originaux) est dans app.js.

const SEP = "[ \\u00a0\\u202f]";
// Nombre : groupes de milliers (espace, insécable, fine insécable, point, virgule) puis décimales éventuelles
const NOMBRE = `(?:\\d{1,3}(?:[ \\u00a0\\u202f.,]\\d{3})*(?:[.,]\\d+)?|\\d+(?:[.,]\\d+)?)`;
// Le montant ne commence jamais au milieu d'un nombre : sans ce (?<!\d), une longue suite de chiffres
// sans unité était réexaminée à chaque position (coût quadratique : 58 s pour 200 000 chiffres).
const SIGNE = "(?<![\\d.,])[−\\-+]?";
// Multiplicateurs : k€, M€, Md€, Mds€ (avec ou sans espace avant le symbole)
const MULT = `(?:(?:k|M|Mds?)${SEP}?)`;
const UNITE = `${MULT}?€|${MULT}?\\$(?:US|CA)?(?![a-z])|US\\$|£(?:GB)?(?![a-z])|(?:millions?|milliards?)${SEP}(?:d['’]euros|de dollars)|(?:CHF|USD|CAD|GBP|EUR|euros?)(?![a-z])`;
const PREFIXE = "(?:US|CA)?[$£]";
const SOURCE = `${SIGNE}${NOMBRE}${SEP}?(?<unite>${UNITE})|(?<![\\w$£])[−\\-+]?(?<symbole>${PREFIXE})${SEP}?${NOMBRE}`;

/** Expression globale (replace / matchAll). Préférer contientMontant pour un simple test. */
export const RE_MONTANT = new RegExp(SOURCE, "gi");
const RE_TEST = new RegExp(SOURCE, "i");

/** Vrai si la chaîne contient au moins un montant monétaire (sans état : pas de piège lastIndex). */
export function contientMontant(s) {
  return typeof s === "string" && RE_TEST.test(s);
}

// « k € » → « k€ », « md€ » → « Md€ », « usd » → « USD », « Millions d'euros » → « millions d'euros »
function normaliserUnite(u) {
  const v = u.replace(/[   ]+/g, " ");
  if (/^(?:millions?|milliards?|euros?)\b/i.test(v)) return v.toLowerCase();
  const m = /^(k|mds?|m) ?(?=[€$])/i.exec(v);
  if (!m) return v.toUpperCase();
  const mult = m[1].toLowerCase() === "k" ? "k" : "M" + m[1].slice(1).toLowerCase();
  return mult + v.slice(m[0].length).toUpperCase();
}

/** Remplace chaque montant par •••• (•• pour les milliers k€/k$) suivi de l'unité d'origine normalisée. */
export function masquerTexte(s) {
  if (typeof s !== "string" || !s) return s;
  return s.replace(RE_MONTANT, (...args) => {
    const g = args[args.length - 1];
    if (g.symbole) return `${g.symbole.toUpperCase()}••••`;
    const u = normaliserUnite(g.unite);
    return `${u.startsWith("k") ? "••" : "••••"} ${u}`;
  });
}
