// =====================================================================
//  IMPÔT SUR LE REVENU — barème 2026 (revenus 2025), loi de finances du
//  19 février 2026 : tranches relevées de 0,9 %. Sert à passer du salaire
//  « net après impôt » (ce qui arrive sur le compte, saisi dans le profil)
//  au « net avant impôt » et au brut, et à estimer la retraite après impôt.
//  Approximations : abattement de 10 % sans plancher ni plafond, net
//  imposable = net avant impôt, pas de réductions ni de crédits d'impôt.
// =====================================================================

export const BAREME = [[11600, 0], [29579, 11], [84577, 30], [181917, 41], [Infinity, 45]];
const DECOTE = { seul: 897, couple: 1483, taux: 45.25 };

// Parts pour enfants à charge : 0,5 pour chacun des deux premiers, 1 à partir du troisième
export const partsEnfants = (n) => { const k = Math.max(0, Math.round(Number(n) || 0)); return Math.min(k, 2) * 0.5 + Math.max(0, k - 2); };
const PLAFOND_DEMI_PART = 1807; // avantage maximal par demi-part pour enfant (2026)

// Impôt annuel d'un foyer à partir de son revenu imposable (après l'abattement de 10 %).
// partsBase : parts sans les enfants (1 ou 2), pour plafonner l'avantage des enfants.
export function impotBareme(revenuImposable, parts = 1, partsBase = parts) {
  if (parts > partsBase) {
    const avec = impotBrut(revenuImposable, parts), sans = impotBrut(revenuImposable, partsBase);
    const plafond = PLAFOND_DEMI_PART * (parts - partsBase) * 2;
    return decoter(sans.impot - avec.impot > plafond ? { ...sans, impot: sans.impot - plafond } : avec, revenuImposable, partsBase);
  }
  return decoter(impotBrut(revenuImposable, parts), revenuImposable, parts);
}
function impotBrut(revenuImposable, parts) {
  const q = Math.max(0, revenuImposable) / parts;
  let bas = 0, impotPart = 0, tmi = 0;
  for (const [haut, taux] of BAREME) {
    if (q > bas) { impotPart += ((Math.min(q, haut) - bas) * taux) / 100; tmi = taux; }
    bas = haut;
  }
  return { impot: impotPart * parts, tmi };
}
function decoter(r, revenuImposable, partsBase) {
  let impot = r.impot;
  const seuil = partsBase >= 2 ? DECOTE.couple : DECOTE.seul;
  const decote = seuil - (impot * DECOTE.taux) / 100;
  if (decote > 0) impot = Math.max(0, impot - decote);
  return { impot, tmi: impot > 0 ? r.tmi : 0, tauxMoyen: revenuImposable > 0 ? (100 * impot) / (revenuImposable / 0.9) : 0 };
}

// Du net après impôt (mensuel) au net avant impôt et au brut.
// autresMensuels : net après impôt du conjoint quand le foyer est imposé ensemble
// (remonté avec le même rapport que le tien).
export function decomposerSalaire(netApres, { parts = 1, partsBase = parts, autresMensuels = 0, netSurBrut = 78 } = {}) {
  const n = Math.max(0, Number(netApres) || 0);
  let avant = n, r = { impot: 0, tmi: 0 };
  for (let i = 0; i < 40; i++) {
    const foyer = (avant + (n > 0 ? (autresMensuels * avant) / n : 0)) * 12;
    r = impotBareme(foyer * 0.9, parts, partsBase);
    const maPart = foyer > 0 ? (r.impot * avant * 12) / foyer : 0;
    const suivant = n + maPart / 12;
    if (Math.abs(suivant - avant) < 0.01) { avant = suivant; break; }
    avant = suivant;
  }
  const impotMensuel = avant - n;
  return { netApres: n, netAvant: avant, brut: avant / (netSurBrut / 100), impotMensuel, tauxPAS: avant > 0 ? (100 * impotMensuel) / avant : 0, tmi: r.tmi };
}

// Retraite (ou tout revenu) nette avant impôt → après impôt, abattement de 10 % compris
export function apresImpot(netAvantMensuel, parts = 1) {
  const r = impotBareme(Math.max(0, netAvantMensuel) * 12 * 0.9 * parts, parts);
  return Math.max(0, netAvantMensuel - r.impot / 12 / parts);
}

// Parts et revenus du foyer à partir du profil (marié ou pacsé = imposition commune)
export function foyerFiscal(profil, conjointNetApres = null) {
  const commun = !!profil.foyer?.actif && (profil.foyer?.statut ?? "marie") === "marie";
  const enfants = partsEnfants(profil.enfants);
  if (!commun) return { parts: 1 + enfants, partsBase: 1, autresMensuels: 0, commun, enfants };
  const c = conjointNetApres ?? (Number(profil.conjoint?.salaireNetMensuel) || 0);
  return { parts: 2 + enfants, partsBase: 2, autresMensuels: c, commun, enfants };
}

// Revenu imposable du foyer tiré des salaires (net avant impôt, moins l'abattement de 10 %).
// Profil brut ou ramené au foyer (couple : salaires déjà additionnés). Concubins : seulement le tien.
export function revenuImposableSalaires(profil) {
  const ff = foyerFiscal(profil);
  const total = Math.max(0, Number(profil.salaireNetMensuel) || 0);
  const conj = profil.foyer?.actif ? Math.max(0, Number(profil.conjoint?.salaireNetMensuel) || 0) : 0;
  const base = ff.commun ? (profil.couple ? total : total + conj) : profil.couple ? Math.max(0, total - conj) : total;
  return decomposerSalaire(base, { parts: ff.parts, partsBase: ff.partsBase }).netAvant * 12 * 0.9;
}

// Taux d'impôt réel sur un revenu en plus (loyers…) : impôt avec − impôt sans, divisé par ce revenu (en %).
// Tient compte d'un changement de tranche, de la décote et du plafond des demi-parts.
// Une tranche saisie à la main plus haute (autres revenus) l'emporte.
export function tauxSurRevenuEnPlus(profil, extra) {
  const ff = foyerFiscal(profil);
  const R = revenuImposableSalaires(profil);
  const sans = impotBareme(R, ff.parts, ff.partsBase), avec = impotBareme(R + Math.max(0, extra), ff.parts, ff.partsBase);
  const marginal = extra > 0 ? (100 * (avec.impot - sans.impot)) / extra : sans.tmi;
  const saisi = profil.tmi === "" || profil.tmi == null ? null : Number(profil.tmi);
  const parSaisie = saisi != null && !profil.tmiEstimee && saisi > marginal + 0.5;
  return { taux: parSaisie ? saisi : marginal, tmiSans: sans.tmi, tmiAvec: avec.tmi, franchit: avec.tmi > sans.tmi, parSaisie, estimee: !!profil.tmiEstimee };
}
