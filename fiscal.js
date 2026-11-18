// =====================================================================
//  IMPÔT SUR LE REVENU — barème 2026 (revenus 2025), loi de finances du
//  19 février 2026 : tranches relevées de 0,9 %. Sert à passer du salaire
//  « net après impôt » (ce qui arrive sur le compte, saisi dans le profil)
//  au « net avant impôt » et au brut, et à estimer la retraite après impôt.
//  Approximations : abattement de 10 % sans plancher ni plafond, net
//  imposable = net avant impôt, pas de réductions ni de crédits d'impôt.
// =====================================================================

import { FISCALITE_2026 } from "./fiscalite/2026.js";

// Source unique : fiscalite/2026.js. Les exports ci-dessous gardent leurs noms historiques.
export const FISCALITE = FISCALITE_2026;
export const MILLESIME = FISCALITE.millesime;
export const PLAFONDS = FISCALITE.plafonds;
export const CREDIT = FISCALITE.credit; // indemnités de remboursement anticipé (immobilier, consommation)

export const BAREME = FISCALITE.ir.bareme;
// Taux de prélèvement : source unique pour plan.js, evolution-fiscale.js et locatif.js
export const PRELEVEMENTS = FISCALITE.prelevements;
export const PFU = Math.round((PRELEVEMENTS.IR_PFU + PRELEVEMENTS.PS_CAPITAL) * 10) / 10; // 31,4 %

export const DECOTE = FISCALITE.ir.decote;

// Alerte de millésime : une loi de finances plus récente que les barèmes embarqués a pu les modifier. Pure, sans montant.
export function alerteMillesime(millesime = MILLESIME, date = new Date()) {
  const annee = date.getFullYear();
  if (annee <= millesime) return null;
  return {
    niveau: "info",
    annee,
    texte: "Les barèmes fiscaux de l'application sont ceux de la loi de finances " + millesime + ". La loi de finances " + annee + " a pu modifier les tranches, plafonds et abattements : les résultats sont à vérifier.",
  };
}

// Parts pour enfants à charge : 0,5 pour chacun des deux premiers, 1 à partir du troisième
export const partsEnfants = (n) => { const k = Math.max(0, Math.round(Number(n) || 0)); return Math.min(k, 2) * 0.5 + Math.max(0, k - 2); };
export const PLAFOND_DEMI_PART = FISCALITE.ir.plafondDemiPart; // avantage maximal par demi-part pour enfant

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

// =====================================================================
// Décumulation : primitives fiscales pures (retraits par enveloppe)
// =====================================================================
export const ABATTEMENT_AV = FISCALITE.assuranceVie.abattement;   // art. 125-0 A CGI, non indexé
export const SEUIL_PRIMES_AV = FISCALITE.assuranceVie.seuilPrimes; // primes nettes, non indexé
// ==== Droits de mutation à titre gratuit (successions et donations) — voir fiscalite/2026.js ====
export const DMTG = FISCALITE.dmtg;
export const AV_DECES = FISCALITE.avDeces;
export const PLUS_VALUES = FISCALITE.plusValues;  // report des moins-values sur valeurs mobilières (art. 150-0 D CGI)
export const MARCHE = FISCALITE.marche;          // règlement-livraison (jours ouvrés) et jours fériés de Bourse en décembre
// Art. 669 CGI : [âge de l'usufruitier strictement inférieur à, % de l'usufruit]
export const BAREME_USUFRUIT = FISCALITE.baremeUsufruit;
export const ABATTEMENT_AV_DECES = AV_DECES.ABATTEMENT_990I;                  // art. 990 I, par bénéficiaire
// Revenus 2025 (IR 2026) : plancher par pensionné, plafond par foyer ; la LF 2026 a conservé l'abattement de 10 %
export const ABATTEMENT_PENSIONS = FISCALITE.abattementPensions;

// PFU d'un jeu de prélèvements (scénarios de réforme) : part impôt + prélèvements sociaux sur le capital
const pfuDe = (pr) => pr.IR_PFU + pr.PS_CAPITAL;
const partGain = (valeur, prixDeRevient) => (valeur > 0 ? Math.max(0, 1 - prixDeRevient / valeur) : 0);

// Barème indexé sur l'inflation simulée : le barème est homogène de degré 1 (seuils, décote, plafond du quotient familial).
export function impotBaremeIndexe(revenu, parts = 1, partsBase = parts, indexation = 1) {
  const k = indexation > 0 ? indexation : 1;
  const r = impotBareme(revenu / k, parts, partsBase);
  const impot = r.impot * k;
  return { impot, tmi: r.tmi, tauxMoyen: revenu > 0 ? (100 * impot) / (revenu / 0.9) : 0 };
}

// Revenu imposable d'une pension après l'abattement de 10 % (plancher par pensionné, plafond par foyer)
export function revenuImposablePension(pensionAnnuelle, { pensionnes = 1, indexation = 1 } = {}) {
  const pension = Math.max(0, pensionAnnuelle);
  const A = ABATTEMENT_PENSIONS;
  const brut = (A.taux / 100) * pension;
  const plancher = A.plancher * pensionnes * indexation, plafond = A.plafond * indexation;
  const abattement = Math.min(Math.min(plafond, Math.max(plancher, brut)), pension);
  return Math.max(0, pension - abattement);
}

// Plus grand revenu supplémentaire que le foyer peut encore recevoir sans dépasser la tranche cible
export function margeTranche(revenuImposable, { parts, partsBase, indexation = 1, tmiCible }) {
  const tmiDe = (x) => impotBaremeIndexe(revenuImposable + x, parts, partsBase, indexation).tmi;
  if (tmiDe(0) > tmiCible) return 0;
  let bas = 0, haut = 2000000;
  if (tmiDe(haut) <= tmiCible) return haut;
  for (let i = 0; i < 40; i++) {
    const mil = (bas + haut) / 2;
    if (tmiDe(mil) <= tmiCible) bas = mil; else haut = mil;
  }
  return bas;
}

// Rachat sur assurance-vie : PS toujours dus ; après 8 ans, abattement puis 7,5 % (12,8 % au-delà de 150 k€ de primes)
export function impotRachatAV({ montant, valeur, primes, primesTotales = primes, ancien8, abattementRestant = 0 }, prelevements = PRELEVEMENTS) {
  const P = prelevements;
  const gain = montant * partGain(valeur, primes);
  const ps = (gain * P.PS_PATRIMOINE) / 100;
  let gainAbattu = 0, ir;
  if (ancien8) {
    gainAbattu = Math.min(gain, Math.max(0, abattementRestant));
    const imposable = gain - gainAbattu;
    const f = primesTotales > 0 ? Math.max(0, primesTotales - SEUIL_PRIMES_AV) / primesTotales : 0;
    ir = (imposable * ((1 - f) * P.IR_AV_8ANS + f * P.IR_PFU)) / 100;
  } else ir = (gain * P.IR_PFU) / 100;
  const impot = ir + ps;
  return { gain, gainAbattu, ir, ps, impot, net: montant - impot };
}

export function impotRetraitPEA({ montant, valeur, versements, ancien5 }, prelevements = PRELEVEMENTS) {
  const gain = montant * partGain(valeur, versements);
  // PEA_IR (scénario de réforme) : le PEA de plus de 5 ans paie aussi la part impôt
  const taux = ancien5 ? prelevements.PS_CAPITAL + (prelevements.PEA_IR ? prelevements.IR_PFU : 0) : pfuDe(prelevements);
  const impot = (gain * taux) / 100;
  return { gain, impot, net: montant - impot };
}

export function impotRetraitCTO({ montant, valeur, base }, prelevements = PRELEVEMENTS) {
  const gain = montant * partGain(valeur, base);
  const impot = (gain * pfuDe(prelevements)) / 100;
  return { gain, impot, net: montant - impot };
}

// Sortie en capital du PER : versements déduits au barème (sans abattement de 10 %), plus-values au PFU
export function impotRetraitPER({ montant, valeur, versementsDeduits, revenuImposableAutre = 0, parts, partsBase, indexation = 1 }, prelevements = PRELEVEMENTS) {
  const partVersements = valeur > 0 ? montant * Math.min(1, versementsDeduits / valeur) : 0;
  const gain = montant - partVersements;
  const R = revenuImposableAutre;
  const ir = impotBaremeIndexe(R + partVersements, parts, partsBase, indexation).impot - impotBaremeIndexe(R, parts, partsBase, indexation).impot;
  const pfu = (gain * pfuDe(prelevements)) / 100;
  const impot = ir + pfu;
  return { partVersements, gain, ir, pfu, impot, net: montant - impot };
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

// Revenus imposables ANNUELS (après l'abattement de 10 %, comme revenuImposableSalaires) de chaque conjoint, ou null hors couple.
// Imposition commune (marié, PACS) : le net avant impôt du total est remonté avec les parts du foyer, puis réparti au prorata des nets après impôt.
// Concubins : A porte les enfants (parts du foyer, base 1), B déclare seul.
// Accepte le profil brut comme le profil ramené au foyer par normaliserFoyer (salaires additionnés ; en concubinage « vue moi », le vrai foyer est dans foyerSuccession).
export function revenusImposablesConjoints(profil) {
  const foyer = profil?.foyerSuccession ?? profil?.foyer;
  if (!foyer?.actif) return null;
  const fini = (x) => (Number.isFinite(x) && x > 0 ? x : 0);
  const sB = fini(Number(profil.conjoint?.salaireNetMensuel));
  const sA = fini(Number(profil.salaireNetMensuel) - (profil.couple === true ? sB : 0));
  const ff = foyerFiscal({ ...profil, foyer });
  if (ff.commun) {
    const total = sA + sB;
    const avant = fini(decomposerSalaire(total, { parts: ff.parts, partsBase: ff.partsBase, autresMensuels: ff.autresMensuels }).netAvant);
    const partA = total > 0 ? sA / total : 0.5;
    return { a: avant * 12 * 0.9 * partA, b: avant * 12 * 0.9 * (total > 0 ? 1 - partA : 0.5) };
  }
  return {
    a: fini(decomposerSalaire(sA, { parts: ff.parts, partsBase: 1 }).netAvant) * 12 * 0.9,
    b: fini(decomposerSalaire(sB, { parts: 1, partsBase: 1 }).netAvant) * 12 * 0.9,
  };
}

// Impôt annuel du couple selon le statut : déclaration commune (mariage, PACS) ou deux déclarations (concubinage, sans case T).
// Concubins : les enfants se répartissent entre les deux déclarations pour minimiser le total. gainCommun > 0 : l'imposition commune fait économiser.
export function impotSelonStatut({ revenuA = 0, revenuB = 0, enfants = 0 } = {}) {
  const num = (x) => (Number.isFinite(Number(x)) && Number(x) > 0 ? Number(x) : 0);
  const rA = num(revenuA), rB = num(revenuB), n = Math.max(0, Math.round(Number(enfants) || 0));
  const parts = 2 + partsEnfants(n);
  const commun = { impot: impotBareme(rA + rB, parts, 2).impot, parts };
  let meilleur = null;
  for (let k = 0; k <= n; k++) {
    const impotA = impotBareme(rA, 1 + partsEnfants(k), 1).impot;
    const impotB = impotBareme(rB, 1 + partsEnfants(n - k), 1).impot;
    if (!meilleur || impotA + impotB < meilleur.impot) meilleur = { impot: impotA + impotB, impotA, impotB, enfantsA: k, enfantsB: n - k };
  }
  return { commun, separe: meilleur, gainCommun: meilleur.impot - commun.impot };
}

// Taux marginal EFFECTIF : ce que coûte réellement le dernier euro de revenu (impôt(R) − impôt(R − pas)) / pas, en %.
// Il diffère de la tranche légale (`tmi`) : la décote le majore (≈ 1,4525 × le taux de tranche dans sa zone, soit ≈ 16 % en tranche à 11 %),
// il peut être nul quand la tranche est à 11 % (impôt annulé par la décote), et le plafonnement du quotient familial le fait varier.
export function tauxMarginalEffectif(revenuImposable, parts = 1, partsBase = parts, pas = 100) {
  const R = Number(revenuImposable);
  if (!Number.isFinite(R) || R <= 0) return 0;
  const p = Number.isFinite(Number(pas)) && Number(pas) > 0 ? Number(pas) : 100;
  const bas = Math.max(0, R - p);
  return (100 * (impotBareme(R, parts, partsBase).impot - impotBareme(bas, parts, partsBase).impot)) / Math.min(p, R);
}

// Économie d'impôt exacte d'une déduction (versement PER, intéressement placé…) : impôt avant − impôt après.
// Contrairement à « montant × tranche », elle tient compte du changement de tranche, de la décote et du plafond des demi-parts.
// tauxEffectif = économie / déduction (en %) ; sans déduction, le taux marginal effectif du revenu.
export function economieDeduction(revenuImposable, deduction, parts = 1, partsBase = parts) {
  const R0 = Number(revenuImposable), D0 = Number(deduction);
  const R = Number.isFinite(R0) ? Math.max(0, R0) : 0;
  const d = Number.isFinite(D0) ? Math.min(Math.max(0, D0), R) : 0;
  if (!(R > 0)) return { economie: 0, tauxEffectif: 0 };
  const economie = impotBareme(R, parts, partsBase).impot - impotBareme(R - d, parts, partsBase).impot;
  return { economie, tauxEffectif: d > 0 ? (100 * economie) / d : tauxMarginalEffectif(R, parts, partsBase) };
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

// =====================================================================
//  INDÉPENDANTS — micro-entreprise, SASU, EURL à l'IS (barème 2026)
//  Fonctions pures : entrée → sortie déterministe, montants annuels.
//  Simplifications : taux effectifs, pas de déficit reportable, pas de
//  chômage ni de prévoyance, réforme 2026 de l'assiette TNS non reproduite
//  ligne à ligne.
// =====================================================================
export const INDEPENDANTS_2026 = FISCALITE.independants;

const I = INDEPENDANTS_2026;

// Impôt supplémentaire dû à un revenu d'indépendant : impôt(autres + revenu) − impôt(autres)
function impotAttribue(revenuIndependant, autres, parts, partsBase) {
  const a = Math.max(0, Number(autres) || 0), r = Math.max(0, Number(revenuIndependant) || 0);
  const avec = impotBareme(a + r, parts, partsBase), sans = impotBareme(a, parts, partsBase);
  return { impot: Math.max(0, avec.impot - sans.impot), impotFoyer: avec.impot, tmi: avec.tmi, tmiSans: sans.tmi };
}

export function microEntreprise({ ca, activite = "bnc", versementLiberatoire = false, autresRevenusImposables = 0, parts = 1, partsBase = parts }) {
  const P = I.micro[activite] ?? I.micro.bnc;
  const c = Math.max(0, Number(ca) || 0);
  const cotisations = (c * P.cotisations) / 100;
  const abattement = Math.min(c, Math.max(I.micro.abattementMin, (c * P.abattement) / 100));
  const revenuImposable = c - abattement;
  const alertes = [];
  let impot, impotFoyer, tmi;
  if (versementLiberatoire) {
    const t = impotAttribue(0, autresRevenusImposables, parts, partsBase);
    impot = (c * P.vl) / 100;
    impotFoyer = t.impotFoyer + impot;
    tmi = t.tmi;
    alertes.push("Éligibilité au versement libératoire selon le revenu fiscal de référence N-2 non vérifiée.");
  } else {
    const t = impotAttribue(revenuImposable, autresRevenusImposables, parts, partsBase);
    impot = t.impot; impotFoyer = t.impotFoyer; tmi = t.tmi;
  }
  if (c > P.seuil) alertes.push(`Dépassement du seuil micro (${P.seuil.toLocaleString("fr-FR")} €) : bascule vers le régime réel.`);
  return {
    forme: "micro", activite, ca: c, cotisations, abattement, revenuImposable, impot, impotFoyer, tmi,
    netAnnuel: c - cotisations - impot, assietteRetraite: revenuImposable, revenuProPER: revenuImposable, alertes,
  };
}

function impotsSociete(b) {
  return (I.is.tauxReduit * Math.min(b, I.is.plafondReduit) + I.is.tauxNormal * Math.max(0, b - I.is.plafondReduit)) / 100;
}
export const impotSurLesSocietes = impotsSociete;

export function remunerationSociete({ forme, resultatAvantRemuneration, remunerationNette, capitalEtCCA = 0, tauxDistribution = 100, autresRevenusImposables = 0, parts = 1, partsBase = parts }) {
  const eurl = forme === "eurl";
  const resultat = Number(resultatAvantRemuneration) || 0;
  const net = Math.max(0, Number(remunerationNette) || 0);
  const alertes = [];
  let brut = null, cotisations, imposableAvantAbattement;
  if (!eurl) {
    brut = net / (1 - I.sasu.tauxSalarial / 100);
    const cout = brut * (1 + I.sasu.tauxPatronal / 100);
    cotisations = cout - net;
    imposableAvantAbattement = net + (brut * I.sasu.assietteCsg / 100) * I.sasu.csgNonDeductible / 100;
  } else {
    cotisations = (net * I.tns.tauxSurNet) / 100;
    const cout = net + cotisations;
    imposableAvantAbattement = net + (I.tns.csgNonDeductible / 100) * cout * (1 - I.tns.abattementAssiette / 100);
  }
  const coutRemuneration = net + cotisations;
  const abattement = Math.min((imposableAvantAbattement * I.abattement10.taux) / 100, I.abattement10.plafond);
  const remunerationImposable = imposableAvantAbattement - abattement;
  if (coutRemuneration > resultat) alertes.push("La rémunération dépasse le résultat : aucun déficit reportable n'est simulé.");
  const beneficeAvantIS = Math.max(0, resultat - coutRemuneration);
  const is = impotsSociete(beneficeAvantIS);
  const dividendesBruts = ((beneficeAvantIS - is) * Math.max(0, Number(tauxDistribution))) / 100;
  let pfu = 0, tns = 0, irSurExcedent = 0;
  if (!eurl) {
    pfu = (dividendesBruts * PFU) / 100;
  } else {
    const seuil = (I.seuilDividendesEURL / 100) * Math.max(0, Number(capitalEtCCA) || 0);
    const partPFU = Math.min(dividendesBruts, seuil), exces = dividendesBruts - partPFU;
    pfu = (partPFU * PFU) / 100;
    tns = (exces * I.tns.tauxSurNet) / (100 + I.tns.tauxSurNet);
    irSurExcedent = (exces * PRELEVEMENTS.IR_PFU) / 100;
    if (exces > 0) alertes.push("Dividendes d'EURL au-delà de 10 % du capital soumis aux cotisations TNS.");
  }
  const dividendesNets = dividendesBruts - pfu - tns - irSurExcedent;
  const t = impotAttribue(remunerationImposable, autresRevenusImposables, parts, partsBase);
  if (!eurl && net === 0) alertes.push("Aucune cotisation retraite : aucun trimestre validé.");
  const netEnPoche = net - t.impot + dividendesNets;
  return {
    forme, remunerationNette: net, brut, cotisations, coutRemuneration, remunerationImposable, beneficeAvantIS, is,
    dividendesBruts, prelevementsDividendes: { pfu, tns, irSurExcedent }, dividendesNets,
    impot: t.impot, impotFoyer: t.impotFoyer, tmi: t.tmi, netEnPoche,
    tauxPrelevementGlobal: resultat > 0 ? (1 - netEnPoche / resultat) * 100 : 0,
    assietteRetraite: eurl ? net : brut, revenuProPER: remunerationImposable, alertes,
  };
}

// Courbe net en poche selon la rémunération nette, de 0 au maximum que le résultat permet de verser
export function optimiserRemuneration(saisie, pas = 1000) {
  const resultat = Math.max(0, Number(saisie.resultatAvantRemuneration) || 0);
  const netMax = saisie.forme === "eurl" ? resultat / (1 + I.tns.tauxSurNet / 100)
    : (resultat * (1 - I.sasu.tauxSalarial / 100)) / (1 + I.sasu.tauxPatronal / 100);
  const points = [];
  for (let n = 0; n < netMax; n += Math.max(1, pas)) points.push(n);
  points.push(netMax);
  const courbe = points.map((n) => {
    const r = remunerationSociete({ ...saisie, remunerationNette: n });
    return { remunerationNette: n, netEnPoche: r.netEnPoche, is: r.is, tmi: r.tmi };
  });
  const optimum = courbe.reduce((m, p) => (p.netEnPoche > m.netEnPoche ? p : m), courbe[0]);
  return { courbe, optimum };
}

// Plafond de déductibilité des versements PER d'un indépendant
export function plafondPERIndependant({ forme, revenuPro, pass, passN1 }) {
  const rev = Math.max(0, Number(revenuPro) || 0);
  if (forme === "eurl") {
    const plafond = Math.max(0.1 * pass, 0.1 * Math.min(rev, 8 * pass) + 0.15 * Math.min(Math.max(0, rev - pass), 7 * pass));
    return { plafond, regle: "154 bis", detail: "10 % du revenu (jusqu'à 8 PASS) + 15 % de la part entre 1 et 8 PASS, au moins 10 % du PASS" };
  }
  const plafond = Math.max(0.1 * passN1, 0.1 * Math.min(rev, 8 * passN1));
  return { plafond, regle: "163 quatervicies", detail: "10 % du revenu professionnel (jusqu'à 8 PASS de l'an dernier), au moins 10 % du PASS" };
}

// =====================================================================
//  EXIT TAX (art. 167 bis CGI) — imposition des plus-values latentes lors du
//  transfert du domicile fiscal hors de France. Fonction pure, estimation.
// =====================================================================
export const EXIT_TAX = FISCALITE.exitTax;

export function exitTax({ valeurTitres = 0, plusValuesLatentes = 0, moinsValuesLatentes = 0, participation50 = false, anneesResidence10 = 10, destination = "ue" } = {}, prelevements = PRELEVEMENTS) {
  const num = (x) => { const n = Number(x); return Number.isFinite(n) ? n : 0; };
  const titres = Math.max(0, num(valeurTitres)), pv = Math.max(0, num(plusValuesLatentes)), mv = Math.max(0, num(moinsValuesLatentes));
  const annees = num(anneesResidence10), participation = participation50 === true;
  const residence = annees >= EXIT_TAX.ANNEES_RESIDENCE;
  const seuil = titres > EXIT_TAX.SEUIL_TITRES;
  const assujetti = residence && (seuil || participation);
  const motifs = [];
  if (!residence) motifs.push(`Résidence fiscale en France inférieure à ${EXIT_TAX.ANNEES_RESIDENCE} ans sur les ${EXIT_TAX.FENETRE_ANNEES} dernières années : l'exit tax ne s'applique pas.`);
  if (seuil) motifs.push(`Valeur globale des titres supérieure à ${EXIT_TAX.SEUIL_TITRES.toLocaleString("fr-FR")} €.`);
  if (participation) motifs.push(`Participation d'au moins ${EXIT_TAX.PART_BENEFICES} % des bénéfices sociaux d'une société.`);
  if (residence && !seuil && !participation) motifs.push(`Valeur des titres inférieure ou égale à ${EXIT_TAX.SEUIL_TITRES.toLocaleString("fr-FR")} € et aucune participation d'au moins ${EXIT_TAX.PART_BENEFICES} % : l'exit tax ne s'applique pas.`);
  if (!assujetti) return { assujetti: false, motifs, base: 0, impotIR: 0, prelevementsSociaux: 0, total: 0, sursis: null, degrevementApresAns: null, notes: [] };
  const base = Math.max(0, pv - mv);
  const impotIR = Math.round(base * prelevements.IR_PFU / 100);
  const prelevementsSociaux = Math.round(base * prelevements.PS_CAPITAL / 100);
  return {
    assujetti, motifs, base, impotIR, prelevementsSociaux, total: impotIR + prelevementsSociaux,
    sursis: destination === "ue" ? "automatique" : "sur demande, avec garanties",
    degrevementApresAns: titres <= EXIT_TAX.SEUIL_DEGREVEMENT_LONG ? EXIT_TAX.DEGREVEMENT_COURT : EXIT_TAX.DEGREVEMENT_LONG,
    notes: [
      "L'option pour le barème progressif de l'impôt sur le revenu n'est pas simulée : le prélèvement forfaitaire est appliqué.",
      "PEA et assurance-vie ne sont pas intégrés à l'assiette de ce simulateur : à vérifier au cas par cas.",
      "Taux de prélèvements sociaux de résident appliqué ; le régime peut différer en cas d'affiliation à la sécurité sociale d'un autre État de l'UE.",
      "Le dégrèvement n'est acquis que si les titres sont toujours détenus à l'échéance indiquée.",
    ],
  };
}
