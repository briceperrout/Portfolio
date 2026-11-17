// =====================================================================
//  IMPÔT SUR LE REVENU — barème 2026 (revenus 2025), loi de finances du
//  19 février 2026 : tranches relevées de 0,9 %. Sert à passer du salaire
//  « net après impôt » (ce qui arrive sur le compte, saisi dans le profil)
//  au « net avant impôt » et au brut, et à estimer la retraite après impôt.
//  Approximations : abattement de 10 % sans plancher ni plafond, net
//  imposable = net avant impôt, pas de réductions ni de crédits d'impôt.
// =====================================================================

export const BAREME = [[11600, 0], [29579, 11], [84577, 30], [181917, 41], [Infinity, 45]];
// Taux de prélèvement : source unique pour plan.js, evolution-fiscale.js et locatif.js
export const PRELEVEMENTS = Object.freeze({
  IR_PFU: 12.8,           // part impôt sur le revenu du prélèvement forfaitaire unique
  PS_CAPITAL: 18.6,       // LFSS 2026 : dividendes, intérêts, plus-values, PEA
  PS_PATRIMOINE: 17.2,    // assurance-vie, revenus fonciers
  IR_AV_8ANS: 7.5,        // assurance-vie de plus de 8 ans (après abattement)
  CSG_CRDS_ACTIVITE: 9.7, // CSG et CRDS sur l'abondement et l'épargne salariale
  VERIFIE_LE: "2026-11-16",
});
export const PFU = Math.round((PRELEVEMENTS.IR_PFU + PRELEVEMENTS.PS_CAPITAL) * 10) / 10; // 31,4 %

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

// =====================================================================
//  INDÉPENDANTS — micro-entreprise, SASU, EURL à l'IS (barème 2026)
//  Fonctions pures : entrée → sortie déterministe, montants annuels.
//  Simplifications : taux effectifs, pas de déficit reportable, pas de
//  chômage ni de prévoyance, réforme 2026 de l'assiette TNS non reproduite
//  ligne à ligne.
// =====================================================================
export const INDEPENDANTS_2026 = Object.freeze({
  micro: Object.freeze({
    // cotisations : % du CA ; abattement : abattement forfaitaire de l'impôt ; vl : versement libératoire (% du CA)
    // BNC 25,6 % : taux 2026 SSI non réglementé ; CIPAV (23,2 %) hors périmètre ; contribution formation professionnelle non incluse
    bnc: Object.freeze({ cotisations: 25.6, abattement: 34, vl: 2.2, seuil: 83600 }),
    bicServices: Object.freeze({ cotisations: 21.2, abattement: 50, vl: 1.7, seuil: 83600 }),
    bicVente: Object.freeze({ cotisations: 12.3, abattement: 71, vl: 1.0, seuil: 203100 }),
    abattementMin: 305,
  }),
  // Impôt sur les sociétés : 15 % jusqu'à 42 500 € de bénéfice (PME éligibles, art. 219 I-b du CGI), 25 % au-delà
  is: Object.freeze({ tauxReduit: 15, plafondReduit: 42500, tauxNormal: 25 }),
  // Président de SASU assimilé salarié (régime général, sans assurance chômage)
  sasu: Object.freeze({ tauxSalarial: 22, tauxPatronal: 42, csgNonDeductible: 2.9, assietteCsg: 98.25 }),
  // Gérant majoritaire d'EURL (TNS) : taux effectif simplifié sur la rémunération nette
  tns: Object.freeze({ tauxSurNet: 45, csgNonDeductible: 2.9, abattementAssiette: 26 }),
  // Frais professionnels forfaitaires de 10 % (plafond à vérifier chaque année) : salaires SASU et gérant EURL (art. 62)
  abattement10: Object.freeze({ taux: 10, plafond: 14426 }),
  // Dividendes d'EURL soumis aux cotisations TNS au-delà de 10 % du capital + primes d'émission + comptes courants d'associés
  seuilDividendesEURL: 10,
});

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
