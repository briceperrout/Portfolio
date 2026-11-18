// =====================================================================
//  IMMOBILIER LOCATIF — bien déjà loué et projet d'investissement à crédit.
//  Échéancier réel du crédit (les intérêts baissent chaque année, donc au
//  régime réel l'impôt monte), impôt selon le régime, cash-flow, TRI net et
//  comparaison avec le même argent placé sur un PEA.
//  Montants annuels ; loyers et charges relevés de l'inflation.
// =====================================================================

import { tauxSurRevenuEnPlus, PRELEVEMENTS } from "./fiscal.js";

const PS_FONCIER = PRELEVEMENTS.PS_PATRIMOINE; // prélèvements sociaux sur les revenus fonciers et le LMNP (inchangés en 2026)

// Mensualité d'un prêt amortissable (assurance comprise, sur le capital emprunté)
export function mensualitePret(capital, tauxAnnuel, ans, assuranceAnnuelle = 0) {
  if (!(capital > 0) || !(ans > 0)) return 0;
  const i = tauxAnnuel / 100 / 12, n = ans * 12;
  const hors = i === 0 ? capital / n : (capital * i) / (1 - Math.pow(1 + i, -n));
  return hors + (capital * assuranceAnnuelle) / 100 / 12;
}

// Échéancier annuel : capital restant au début de chaque année, intérêts payés, mensualités payées
export function echeancier(capital, tauxAnnuel, ans, mensualite = null) {
  const t = tauxAnnuel / 100, m = mensualite > 0 ? mensualite : mensualitePret(capital, tauxAnnuel, ans);
  const lignes = [];
  let K = Math.max(0, capital);
  for (let y = 0; y < 60; y++) {
    if (K <= 0.5 || y >= Math.max(1, Math.ceil(ans))) { lignes.push({ capital: 0, interets: 0, paye: 0 }); continue; }
    // Douze mensualités dans l'année
    let interets = 0, paye = 0;
    for (let k = 0; k < 12 && K > 0.5; k++) { const ik = (K * t) / 12, p = Math.min(m, K + ik); interets += ik; paye += p; K = K + ik - p; }
    lignes.push({ capital: K + paye - interets, interets, paye });
    if (y === Math.ceil(ans) - 1) K = 0;
  }
  return { mensualite: m, an: (y) => lignes[Math.max(0, Math.min(lignes.length - 1, y))], restant: (y) => (y + 1 < lignes.length ? lignes[y + 1].capital : 0) };
}

// Impôt annuel sur les loyers selon le régime (tranche + prélèvements sociaux)
export function impotLocatif({ regime = "micro", loyers, charges, interets, tmi, amortissement = 0, ps = PS_FONCIER }) {
  const taux = (Number(tmi) || 0) / 100 + ps / 100;
  const imposable = regime === "micro" ? loyers * 0.7
    : regime === "reel" ? Math.max(0, loyers - charges - interets)
    : regime === "lmnp-micro" ? loyers * 0.5
    : Math.max(0, loyers - charges - interets - amortissement); // LMNP au réel : l'amortissement efface en général l'impôt
  return { imposable, impot: imposable * taux };
}

// Taux d'impôt sur les loyers (calculé une fois par profil, sur la 1re année)
const cacheTaux = new WeakMap();
function tauxLoyers(profil, cle, imposable) {
  let m = cacheTaux.get(profil);
  if (!m) { m = {}; cacheTaux.set(profil, m); }
  return (m[cle] ??= tauxSurRevenuEnPlus(profil, imposable));
}

// Règles du plan (modifiables dans une simulation d'évolution fiscale) : prélèvements sociaux, amortissement en meublé
const regleLoc = (plan) => ({ ps: plan.fiscalite?.locatif?.ps ?? PS_FONCIER, amortir: plan.fiscalite?.locatif?.amortissementLMNP !== false });

// Bien déjà loué (logement du profil), pour l'année y (0 = cette année)
export function fluxLocatif(plan, profil, y = 0) {
  const L = profil.proprietaire ? profil.logement ?? {} : {};
  if ((L.usage ?? "rp") !== "loue") return null;
  const infl = Math.pow(1 + (plan.hypotheses?.inflation ?? 0) / 100, y);
  const part = (L.part > 0 ? Math.min(100, L.part) : 100) / 100;
  const loyers = Math.max(0, Number(L.loyerPercu) || 0) * 12 * part * infl;
  const charges = Math.max(0, Number(L.chargesAn) || 0) * part * infl;
  const credit = Math.max(0, Number(L.creditRestant) || 0);
  const ans = Math.max(1, (Number(L.finCredit) || new Date().getFullYear()) - new Date().getFullYear());
  const ech = echeancier(credit, plan.achatRP?.tauxCredit ?? 3.5, ans, Number(L.mensualite) > 0 ? Number(L.mensualite) : null);
  const { interets, paye } = credit > 0 ? ech.an(y) : { interets: 0, paye: 0 };
  const regime = L.regime || "micro", RL = regleLoc(plan);
  const amort = regime === "lmnp-reel" && RL.amortir ? ((Number(L.valeur) || 0) * part * 0.85) / 30 : 0;
  const T = tauxLoyers(profil, `existant-${RL.amortir}`, y === 0 ? impotLocatif({ regime, loyers, charges, interets, tmi: 0, amortissement: amort }).imposable : fluxLocatif(plan, profil, 0).imposable);
  const { imposable, impot } = impotLocatif({ regime, loyers, charges, interets, tmi: T.taux, amortissement: amort, ps: RL.ps });
  return { T, loyers, charges, interets, mensualiteAn: paye, imposable, impot, regime, net: loyers - charges - impot, cashflow: loyers - charges - impot - paye, finCredit: credit > 0 ? ans : null, microDepasse: regime === "micro" && loyers > 15000 };
}

// Projet d'investissement locatif à crédit (profil.projetLocatif)
export function projetLocatifDe(plan, profil) {
  const P = profil.projetLocatif;
  if (!P?.actif || !(Number(P.prix) > 0)) return null;
  const A = plan.achatRP ?? {}, H = plan.hypotheses ?? {};
  const agePers = profil.agePrincipal ?? profil.age ?? 30;
  const age = Math.max(Math.ceil(agePers), Math.round(Number(P.age) || agePers));
  const annees = age - Math.ceil(agePers);
  const prix = Number(P.prix), type = P.type === "neuf" ? "neuf" : "ancien";
  const frais = (prix * (A.fraisNotairePourcent?.[type] ?? 8)) / 100;
  const cout = prix + frais + Math.max(0, Number(P.travaux) || 0);
  const apport = Math.min(cout, Math.max(0, Number(P.apport) || 0));
  const pret = cout - apport;
  const duree = Math.max(1, Math.min(30, Number(P.duree) || 20));
  const taux = A.tauxCredit ?? 3.5;
  const ech = echeancier(pret, taux, duree);
  const assuranceAn = (pret * (A.tauxAssuranceEmprunteur ?? 0)) / 100;
  const regime = P.regime || "micro", RL = regleLoc(plan);
  const vacance = Math.min(50, Math.max(0, Number(P.vacance ?? 1)));
  const infl = (H.inflation ?? 0) / 100, valo = (H.valorisationImmobiliere ?? 0) / 100;
  // Flux de l'année k après l'achat (k = 0 : 1re année), en euros de l'époque
  const flux = (k) => {
    const f = Math.pow(1 + infl, annees + k);
    const loyers = Math.max(0, Number(P.loyer) || 0) * (12 - vacance) * f;
    const charges = Math.max(0, Number(P.charges) || 0) * f;
    const { interets, paye: payeCredit } = ech.an(k);
    const paye = payeCredit + (k < duree ? assuranceAn : 0);
    const amort = regime === "lmnp-reel" && RL.amortir && k < 30 ? (prix * 0.85) / 30 : 0;
    const T = tauxImpot();
    const { impot, imposable } = impotLocatif({ regime, loyers, charges, interets, tmi: T.taux, amortissement: amort, ps: RL.ps });
    return { loyers, charges, interets, paye, impot, imposable, cashflow: loyers - charges - impot - paye };
  };
  // Taux mesuré sur la 1re année pleine (ou la 1re année où un revenu devient imposable, en LMNP au réel)
  const imposableK = (k) => {
    const f = Math.pow(1 + infl, annees + k), { interets } = ech.an(k);
    return impotLocatif({ regime, loyers: Math.max(0, Number(P.loyer) || 0) * (12 - vacance) * f, charges: Math.max(0, Number(P.charges) || 0) * f, interets, tmi: 0, amortissement: regime === "lmnp-reel" && RL.amortir && k < 30 ? (prix * 0.85) / 30 : 0 }).imposable;
  };
  let kT = 0;
  while (kT < 30 && imposableK(kT) <= 0) kT++;
  const tauxImpot = () => tauxLoyers(profil, `projet-${prix}-${regime}-${P.loyer}-${P.charges}-${annees}-${duree}-${apport}-${RL.amortir}`, kT < 30 ? imposableK(kT) / Math.pow(1 + infl, annees + kT) : 0);
  const valeur = (k) => prix * Math.pow(1 + valo, annees + k); // k années après l'achat
  return { age, annees, prix, frais, cout, apport, pret, duree, taux, mensualite: ech.mensualite + assuranceAn / 12, regime, ech, flux, valeur, vacance, impot: tauxImpot(), anneeImposable: kT < 30 ? kT : null };
}

// Impôt sur la plus-value immobilière à la revente après n années (hors résidence principale)
export function impotPlusValue(prixAchat, prixVente, n, amortissementsReintegres = 0) {
  const pv = Math.max(0, prixVente - prixAchat * (1 + 0.075 + (n >= 5 ? 0.15 : 0)) + amortissementsReintegres);
  const abIR = n < 6 ? 0 : n >= 22 ? 1 : Math.min(1, 0.06 * (Math.min(n, 21) - 5) + (n >= 22 ? 0.04 : 0));
  const abPS = n < 6 ? 0 : n >= 30 ? 1 : Math.min(1, 0.0165 * (Math.min(n, 21) - 5) + (n >= 22 ? 0.016 : 0) + 0.09 * Math.max(0, n - 22));
  return pv * (1 - abIR) * (PRELEVEMENTS.IR_PV_IMMO / 100) + pv * (1 - abPS) * (PRELEVEMENTS.PS_PATRIMOINE / 100);
}

// Taux de rendement interne annuel (décimal : 0,05 = 5 %) de flux annuels : flux[0] à aujourd'hui (négatif : la mise), flux[k] à la fin de l'année k. Bissection.
export function triAnnuel(flux) {
  const van = (r) => flux.reduce((t, c, i) => t + c / Math.pow(1 + r, i), 0);
  let bas = -0.99, haut = 1;
  for (let i = 0; i < 80; i++) { const m = (bas + haut) / 2; if (van(m) > 0) bas = m; else haut = m; }
  return (bas + haut) / 2;
}
// TRI net (taux de rendement interne) sur n années, et le même argent placé sur un PEA
export function analyseLocatif(plan, projet, n = 20) {
  if (!projet) return null;
  const cf = [-projet.apport];
  let effortTotal = projet.apport;
  for (let k = 0; k < n; k++) { const f = projet.flux(k); cf.push(f.cashflow); if (f.cashflow < 0) effortTotal += -f.cashflow; }
  const vente = projet.valeur(n), dette = projet.ech.restant(n - 1);
  const amortReint = projet.regime === "lmnp-reel" && regleLoc(plan).amortir ? ((projet.prix * 0.85) / 30) * Math.min(n, 30) : 0;
  const impotPV = impotPlusValue(projet.prix, vente, n, amortReint);
  const final = vente - dette - impotPV;
  cf[cf.length - 1] += final;
  const triDe = triAnnuel;
  const tri = triDe(cf);
  // Même argent sur un PEA : l'apport, puis chaque année l'effort (cash-flow négatif) ; un cash-flow positif est retiré
  const rb = (plan.hypotheses?.rendements?.bourse ?? 8) / 100;
  let pea = projet.apport, verse = projet.apport;
  const cfP = [-projet.apport];
  for (let k = 0; k < n; k++) {
    const c = projet.flux(k).cashflow;
    pea = Math.max(0, pea * (1 + rb) - c);
    if (c < 0) verse += -c; else verse -= Math.min(verse, c);
    cfP.push(c);
  }
  const peaNet = pea - Math.max(0, pea - verse) * (PRELEVEMENTS.PS_CAPITAL / 100);
  cfP[cfP.length - 1] += peaNet;
  return { n, tri, triPEA: triDe(cfP), final, vente, dette, impotPV, effortTotal, cashflow1: projet.flux(0).cashflow, peaNet };
}
