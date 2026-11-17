// Devises et comptes à l'étranger : calculs purs (aucun DOM, aucun appel réseau).
// Convention des taux : « 1 EUR = x devise » (comme la BCE). Un montant en devise se convertit en euros par montant / taux.
import { PLAN } from "./plan.js";

// ---------------------------------------------------------------- exposition des ETF (déplacé depuis app.js)
export const DEVISES = ["USD", "EUR", "GBP", "CHF", "JPY", "Autres"];
export const NOM_DEVISE = { USD: "Dollar (USD)", EUR: "Euro (EUR)", GBP: "Livre (GBP)", CHF: "Franc suisse (CHF)", JPY: "Yen (JPY)", Autres: "Autres devises" };
// Exposition par défaut d'un ETF : celle du plan, sinon déduite du nom de l'indice
export function devisesParDefaut(x) {
  const ref = (x.devises ? x : PLAN.investissementBourse?.find((y) => y.nom === x.nom)) ?? {};
  if (ref.devises) {
    const o = {}; for (const [k, v] of Object.entries(ref.devises)) { const c = DEVISES.find((d) => k.includes(`(${d})`)) ?? "Autres"; o[c] = (o[c] ?? 0) + v; } return o;
  }
  const n = x.nom.toLowerCase();
  if (/s&p|nasdaq|usa|etats-unis|états-unis|\bus\b/.test(n)) return { USD: 100 };
  if (/europe 600|stoxx 600|msci europe/.test(n)) return { EUR: 51, GBP: 23, CHF: 15, Autres: 11 };
  if (/world|monde|acwi/.test(n)) return { USD: 72, EUR: 9, JPY: 5, GBP: 4, CHF: 3, Autres: 7 };
  if (/émergent|emergent|emerging|\bem\b/.test(n)) return { Autres: 100 };
  if (/cac|euro stoxx|emu|zone euro/.test(n)) return { EUR: 100 };
  return null;
}

// ---------------------------------------------------------------- comptes à l'étranger
export const DEVISES_COMPTES = ["EUR", "USD", "CAD", "CHF", "GBP"];
const DEVISES_A_TAUX = ["USD", "CAD", "CHF", "GBP"];

// Taux de référence embarqués (BCE, 17 novembre 2026) : repli hors ligne, remplacés par les taux du jour quand on les a.
export const TAUX_REFERENCE = Object.freeze({
  date: "2026-11-17",
  source: "BCE",
  taux: Object.freeze({ USD: 1.0989, CAD: 1.5704, CHF: 0.9233, GBP: 0.83305 }),
});

export const TYPES_COMPTES_ETRANGERS = Object.freeze({
  retraiteEtrangere: { libelle: "Retraite étrangère", exemples: ["401(k)", "IRA / Roth IRA", "REER", "Pilier 3a"] },
  epargneEtrangere: { libelle: "Épargne étrangère", exemples: ["CELI", "Compte-titres étranger", "Compte courant ou d'épargne"] },
});

const fini = (x) => typeof x === "number" && Number.isFinite(x);

/** Valide une réponse { date, taux } : ne garde que USD/CAD/CHF/GBP plausibles. Renvoie { date, source, taux } ou null. */
export function analyserTaux(obj) {
  if (!obj || typeof obj !== "object") return null;
  const date = obj.date;
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) return null;
  const brut = obj.taux && typeof obj.taux === "object" ? obj.taux : {};
  const taux = {};
  for (const d of DEVISES_A_TAUX) { const v = brut[d]; if (fini(v) && v > 0.05 && v < 20) taux[d] = v; }
  return Object.keys(taux).length ? { date, source: "BCE", taux } : null;
}

/**
 * Taux retenus par devise. Priorité : taux saisi (profil.tauxChange) > taux du jour > taux de référence embarqué.
 * → { taux: { EUR: 1, USD, … }, origine: { USD: "manuel" | "jour" | "reference", … }, date }
 */
export function tauxEffectifs(profil, tauxDuJour = null) {
  const taux = { EUR: 1 }, origine = {};
  let jourUtilise = false;
  for (const d of DEVISES_A_TAUX) {
    const manuel = Number(profil?.tauxChange?.[d]);
    const jour = tauxDuJour?.taux?.[d];
    if (fini(manuel) && manuel > 0) { taux[d] = manuel; origine[d] = "manuel"; }
    else if (fini(jour) && jour > 0) { taux[d] = jour; origine[d] = "jour"; jourUtilise = true; }
    else { taux[d] = TAUX_REFERENCE.taux[d]; origine[d] = "reference"; }
  }
  return { taux, origine, date: jourUtilise && tauxDuJour?.date ? tauxDuJour.date : TAUX_REFERENCE.date };
}

/** Montant en euros ; devise inconnue ou taux invalide → 0. EUR = identité. */
export function convertir(montant, devise, taux) {
  const m = Number(montant);
  if (!fini(m)) return 0;
  if (devise === "EUR") return m;
  const t = taux?.[devise];
  if (!DEVISES_A_TAUX.includes(devise) || !fini(t) || !(t > 0)) return 0;
  return m / t;
}

/** Totalise les comptes étrangers du profil en euros. Les lignes invalides sont ignorées. */
export function consoliderEtrangers(profil, taux) {
  const lignes = [], parDevise = {};
  let totalEUR = 0;
  for (const c of Array.isArray(profil?.comptesEtrangers) ? profil.comptesEtrangers : []) {
    const solde = Number(c?.solde);
    if (!fini(solde) || solde <= 0 || !(c?.type in TYPES_COMPTES_ETRANGERS) || !DEVISES_COMPTES.includes(c?.devise)) continue;
    const soldeEUR = convertir(solde, c.devise, taux);
    if (!(soldeEUR > 0)) continue;
    lignes.push({ id: c.id, type: c.type, devise: c.devise, solde, soldeEUR });
    parDevise[c.devise] = (parDevise[c.devise] ?? 0) + soldeEUR;
    totalEUR += soldeEUR;
  }
  return { totalEUR, parDevise, lignes };
}

/** Copie du profil où le total des comptes étrangers (en euros) figure dans placements.comptesEtrangers. Ne mute jamais l'entrée. */
export function avecComptesEtrangers(profil, taux) {
  const { totalEUR } = consoliderEtrangers(profil, taux);
  const placements = { ...(profil?.placements ?? {}) };
  delete placements.comptesEtrangers; // jamais stocké : toujours dérivé
  if (totalEUR > 0) placements.comptesEtrangers = totalEUR;
  return { ...profil, placements };
}

// Enveloppes dont la part actions est exposée aux devises des ETF du plan
const ENVELOPPES_BOURSE = ["pea", "cto", "assuranceVieUC"];

/**
 * Exposition au change du patrimoine financier.
 * Approximation : l'argent des enveloppes boursières (PEA, CTO, assurance-vie en unités de compte) est réparti entre les ETF du plan
 * selon leurs poids (`part`), puis chaque ETF selon ses devises d'exposition (saisies dans profil.devisesBourse, sinon par défaut).
 * Les comptes étrangers sont à 100 % dans leur devise ; tout le reste (livrets, fonds euros, PER, SCPI, or, crypto…) est compté en euros.
 * → { totalEUR, parDevise (en €), pourcentages (en %) }
 */
export function expositionChange(plan, profil, taux) {
  const parDevise = { EUR: 0 };
  const ajouter = (d, v) => { if (v > 0) parDevise[d] = (parDevise[d] ?? 0) + v; };
  const etrangers = consoliderEtrangers(profil, taux);
  for (const [d, v] of Object.entries(etrangers.parDevise)) ajouter(d, v);

  const ETF = (plan?.investissementBourse ?? []).filter((x) => x.part > 0);
  const poidsTotal = ETF.reduce((t, x) => t + x.part, 0);
  for (const [id, brut] of Object.entries(profil?.placements ?? {})) {
    const v = Number(brut);
    if (id === "comptesEtrangers" || !fini(v) || v <= 0) continue;
    if (!ENVELOPPES_BOURSE.includes(id) || !(poidsTotal > 0)) { ajouter("EUR", v); continue; }
    for (const x of ETF) {
      const saisi = profil?.devisesBourse?.[x.nom];
      const e = saisi && Object.values(saisi).some((p) => p > 0) ? saisi : devisesParDefaut(x);
      const part = (v * x.part) / poidsTotal;
      if (!e) { ajouter("EUR", part); continue; }
      const t = Object.values(e).reduce((a, b) => a + (Number(b) || 0), 0);
      if (!(t > 0)) { ajouter("EUR", part); continue; }
      for (const [d, p] of Object.entries(e)) ajouter(d, (part * (Number(p) || 0)) / t);
    }
  }
  const totalEUR = Object.values(parDevise).reduce((t, x) => t + x, 0);
  const pourcentages = {};
  for (const [d, v] of Object.entries(parDevise)) pourcentages[d] = totalEUR > 0 ? (100 * v) / totalEUR : 0;
  return { totalEUR, parDevise, pourcentages };
}
