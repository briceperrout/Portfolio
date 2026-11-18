// Tests de la fiscalité des indépendants et de la centralisation des taux — node test_fiscal.mjs
import { alerteMillesime, FISCALITE, MILLESIME, PLAFONDS, BAREME, PFU, PRELEVEMENTS, DECOTE, PLAFOND_DEMI_PART, partsEnfants, impotBareme, impotBaremeIndexe, revenuImposablePension, margeTranche, impotRachatAV, impotRetraitPEA, impotRetraitPER, microEntreprise, remunerationSociete, optimiserRemuneration, plafondPERIndependant, impotSurLesSocietes, exitTax, economieDeduction, tauxMarginalEffectif, impotSelonStatut, revenusImposablesConjoints } from "./fiscal.js";
import { conseilPER, tauxGains, revenuImposableDe, normaliserFoyer } from "./moteur.js";
import { PLAN } from "./plan.js";
import { estimerPension } from "./pension.js";
import { comparerMillesimes } from "./outils/comparer-millesimes.mjs";
import { readFileSync } from "node:fs";

let ok = 0, ko = 0;
const verifier = (nom, obtenu, attendu, tol = 2) => {
  const bon = typeof attendu === "number" ? Math.abs(obtenu - attendu) <= tol : obtenu === attendu;
  if (bon) ok++; else { ko++; console.log(`ÉCHEC ${nom} : obtenu ${obtenu}, attendu ${attendu}`); }
};

// Micro BNC, CA 50 000 €
let m = microEntreprise({ ca: 50000, activite: "bnc" });
verifier("micro cotisations", m.cotisations, 12800);
verifier("micro abattement", m.abattement, 17000);
verifier("micro revenu imposable", m.revenuImposable, 33000);
verifier("micro IR", m.impot, 3004);
verifier("micro TMI", m.tmi, 30, 0);
verifier("micro net", m.netAnnuel, 34196);
m = microEntreprise({ ca: 50000, activite: "bnc", versementLiberatoire: true });
verifier("micro VL impôt", m.impot, 1100);
verifier("micro VL net", m.netAnnuel, 36100);
verifier("micro seuil", microEntreprise({ ca: 90000 }).alertes.length, 1, 0);

// SASU, résultat 100 000 €, rémunération nette 30 000 €
const saisie = { resultatAvantRemuneration: 100000, remunerationNette: 30000, tauxDistribution: 100 };
let s = remunerationSociete({ forme: "sasu", ...saisie });
verifier("sasu brut", s.brut, 38461.54);
verifier("sasu coût", s.coutRemuneration, 54615.38);
verifier("sasu bénéfice", s.beneficeAvantIS, 45384.62);
verifier("sasu IS", s.is, 7096.15);
verifier("sasu dividendes", s.dividendesBruts, 38288.46);
verifier("sasu PFU", s.prelevementsDividendes.pfu, 12022.58);
verifier("sasu IR", s.impot, 1721);
verifier("sasu TMI", s.tmi, 11, 0);
verifier("sasu net en poche", s.netEnPoche, 54545);

// EURL, mêmes données, capital + comptes courants 1 000 €
const e = remunerationSociete({ forme: "eurl", capitalEtCCA: 1000, ...saisie });
verifier("eurl cotisations", e.cotisations, 13500);
verifier("eurl coût", e.coutRemuneration, 43500);
verifier("eurl IS", e.is, 9875);
verifier("eurl dividendes", e.dividendesBruts, 46625);
verifier("eurl PFU", e.prelevementsDividendes.pfu, 31.4);
verifier("eurl TNS", e.prelevementsDividendes.tns, 14438.79);
verifier("eurl IR sur excédent", e.prelevementsDividendes.irSurExcedent, 5955.2);
verifier("eurl IR rémunération", e.impot, 1698);
verifier("eurl TMI", e.tmi, 11, 0);
verifier("eurl net en poche", e.netEnPoche, 54502);

// Impôt sur les sociétés
verifier("IS 42 500", impotSurLesSocietes(42500), 6375);
verifier("IS 100 000", impotSurLesSocietes(100000), 20750);

// Plafond PER des indépendants
const pass = 48060, passN1 = 47100;
verifier("PER EURL 60 000", plafondPERIndependant({ forme: "eurl", revenuPro: 60000, pass, passN1 }).plafond, 7791);
verifier("PER EURL 10 000", plafondPERIndependant({ forme: "eurl", revenuPro: 10000, pass, passN1 }).plafond, 4806);
verifier("PER EURL 1 000 000", plafondPERIndependant({ forme: "eurl", revenuPro: 1000000, pass, passN1 }).plafond, 88911);
verifier("PER SASU 27 986", plafondPERIndependant({ forme: "sasu", revenuPro: 27986, pass, passN1 }).plafond, 4710);
verifier("PER micro 500 000", plafondPERIndependant({ forme: "micro", revenuPro: 500000, pass, passN1 }).plafond, 37680);
verifier("PER règle EURL", plafondPERIndependant({ forme: "eurl", revenuPro: 1, pass, passN1 }).regle, "154 bis");
verifier("PER règle SASU", plafondPERIndependant({ forme: "sasu", revenuPro: 1, pass, passN1 }).regle, "163 quatervicies");

// Centralisation des taux
verifier("PFU", PFU, 31.4, 0);
verifier("PRELEVEMENTS gelé", Object.isFrozen(PRELEVEMENTS), true);
verifier("plan cto", PLAN.fiscalite.gains.cto, 31.4, 0);
verifier("plan pea", PLAN.fiscalite.gains.pea, 18.6, 0);
verifier("plan assurance-vie", PLAN.fiscalite.gains.assuranceVie, 24.7, 0);
verifier("plan scpi : suit la tranche du foyer (null), TMI 30 % → 47,2 %", tauxGains(PLAN, { tmi: "30" }, "scpi"), 47.2, 0.01);
verifier("plan abondement", PLAN.abondement.prelevements, 9.7, 0);

// Optimisation de la rémunération (SASU)
const o = optimiserRemuneration({ forme: "sasu", resultatAvantRemuneration: 100000, tauxDistribution: 100 });
verifier("optimisation courbe non vide", o.courbe.length > 0, true);
verifier("optimisation optimum maximal", o.courbe.every((p) => o.optimum.netEnPoche >= p.netEnPoche), true);

// Droits à la retraite des indépendants
const prof = (independant) => ({ age: 35, tmi: "30", statutPro: "independant", enfants: 0, foyer: { actif: false }, salaireNetMensuel: 0, independant });
const pension = (independant) => estimerPension(PLAN, prof(independant), { ageDebut: 22, ageArret: 64 });
let pe = pension({ forme: "eurl", resultat: 100000, remunerationNette: 30000, capital: 1000, distribution: 100 });
verifier("eurl régime", pe.regime, "ssi");
verifier("eurl complémentaire", pe.libelleComplementaire, "RCI");
verifier("eurl trimestres par an", pe.trimestresParAn, 4, 0);
verifier("eurl points RCI de l'année", pe.pointsParAn, 0.07 * 30000 / 21.532, 0.1);
verifier("eurl alerte dividendes", pe.alertes.some((a) => a.includes("dividendes")), true);
pe = pension({ forme: "eurl", resultat: 100000, remunerationNette: 2000, capital: 1000, distribution: 0 });
verifier("eurl 2 000 € : 3 trimestres (assiette minimale)", pe.trimestresParAn, 3, 0);
pe = pension({ forme: "microBicVente", ca: 20000 });
verifier("micro BIC vente 20 000 € : 3 trimestres", pe.trimestresParAn, 3, 0);
verifier("micro alerte moins de 4 trimestres", pe.alertes.some((a) => a.includes("moins de 4 trimestres")), true);
pe = pension({ forme: "sasu", resultat: 100000, remunerationNette: 0, distribution: 100 });
verifier("sasu 0 € : aucun trimestre futur", pe.futurs, 0, 0);
verifier("sasu 0 € : alerte dividendes", pe.alertes.some((a) => a.includes("dividendes")), true);
pe = pension({ forme: "sasu", resultat: 100000, remunerationNette: 30000, distribution: 100 });
verifier("sasu régime", pe.regime, "general");
verifier("sasu complémentaire", pe.libelleComplementaire, "Agirc-Arrco");
verifier("sasu pension > 0", pe.demande.net > 0, true);
pe = estimerPension(PLAN, { age: 32, salaireNetMensuel: 3200, statutPro: "stable", foyer: { actif: false } }, { ageDebut: 22, ageArret: 64 });
verifier("salarié régime général", pe.regime, "general");
verifier("salarié champs historiques", ["trimestres", "sam", "points", "auLegal", "aTauxPlein", "demande"].every((k) => k in pe), true);

// Âge de liquidation par défaut : le plus tardif de l'arrêt d'activité et de l'âge légal
{
  const an = new Date().getFullYear();
  const sal = (naiss) => ({ age: an - naiss, salaireNetMensuel: 3200, statutPro: "stable", foyer: { actif: false } });
  const pen = (naiss, opts) => estimerPension(PLAN, sal(naiss), { ageDebut: 22, ...opts });
  let q = pen(1964, { ageArret: 64 });
  verifier("liquidation 1964, arrêt 64 : âge de demande", q.demande.age, 64, 0);
  verifier("liquidation 1964, arrêt 64 : affichage arrondi", Math.ceil(q.demande.age), 64, 0);
  verifier("liquidation 1964 : âge légal inchangé", q.auLegal.age, 62.75, 0);
  q = pen(1964, { ageArret: 60 });
  verifier("liquidation 1964, arrêt 60 : âge légal", q.demande.age, 62.75, 0);
  q = pen(1964, { ageArret: 64, ageDemande: 66 });
  verifier("liquidation 1964, demande 66 saisie", q.demande.age, 66, 0);
  q = pen(1964, { ageArret: 64, trimestresDeja: 100 });
  verifier("liquidation 1964, carrière courte : trimestres insuffisants", q.trimestres < q.regles.trimestres, true);
  verifier("liquidation 1964, carrière courte : décote non aggravée", q.demande.decote <= q.auLegal.decote, true);
  verifier("liquidation 1964, carrière courte : pension non réduite", q.demande.net >= q.auLegal.net, true);
  q = pen(1970, { ageArret: 64 });
  verifier("liquidation 1970, arrêt 64 : inchangé", q.demande.age, 64, 0);
}

// Décumulation : primitives fiscales
let av = impotRachatAV({ montant: 10000, valeur: 100000, primes: 60000, ancien8: true, abattementRestant: 4600 });
verifier("av gain", av.gain, 4000); verifier("av ir sous abattement", av.ir, 0); verifier("av ps", av.ps, 688);
av = impotRachatAV({ montant: 20000, valeur: 100000, primes: 60000, ancien8: true, abattementRestant: 4600 });
verifier("av gain 2", av.gain, 8000); verifier("av ir 7,5 %", av.ir, 255); verifier("av ps 2", av.ps, 1376);
verifier("av net", av.net, 20000 - 255 - 1376);
av = impotRachatAV({ montant: 20000, valeur: 100000, primes: 60000, primesTotales: 200000, ancien8: true, abattementRestant: 4600 });
verifier("av primes > 150 k : taux mixte", av.ir, 3400 * (0.75 * 7.5 + 0.25 * 12.8) / 100);
av = impotRachatAV({ montant: 20000, valeur: 100000, primes: 60000, ancien8: false });
verifier("av < 8 ans : 12,8 %", av.ir, 8000 * 0.128);
verifier("av valeur nulle", impotRachatAV({ montant: 0, valeur: 0, primes: 0, ancien8: true }).gain, 0);
verifier("pea > 5 ans", impotRetraitPEA({ montant: 10000, valeur: 20000, versements: 10000, ancien5: true }).impot, 5000 * 0.186);
verifier("pea < 5 ans", impotRetraitPEA({ montant: 10000, valeur: 20000, versements: 10000, ancien5: false }).impot, 5000 * 0.314);
verifier("pension 20 000", revenuImposablePension(20000), 18000);
verifier("pension 60 000", revenuImposablePension(60000), 55561);
verifier("pension 3 000", revenuImposablePension(3000), 2546);
verifier("pension 300", revenuImposablePension(300), 0);
verifier("marge 11 %", margeTranche(20000, { parts: 1, partsBase: 1, tmiCible: 11 }), 29579 - 20000);
verifier("marge 11 % indexée", margeTranche(20000, { parts: 1, partsBase: 1, indexation: 1.1, tmiCible: 11 }), 29579 * 1.1 - 20000);
verifier("marge TMI dépassée", margeTranche(40000, { parts: 1, partsBase: 1, tmiCible: 11 }), 0);
{
  const o = { valeur: 60000, versementsDeduits: 50000, revenuImposableAutre: 18000, parts: 1, partsBase: 1 };
  const r = impotRetraitPER({ montant: 12000, ...o });
  const pv = 12000 * 50000 / 60000;
  verifier("per part versements", r.partVersements, pv);
  verifier("per ir", r.ir, impotBareme(18000 + pv, 1, 1).impot - impotBareme(18000, 1, 1).impot, 1e-6);
  verifier("per pfu", r.pfu, (12000 - pv) * 0.314);
  verifier("per net", r.net, 12000 - r.ir - r.pfu);
}
for (const x of [0, 9000, 25000, 70000]) verifier(`barème indexé 1 = barème ${x}`, impotBaremeIndexe(x, 1, 1, 1).impot, impotBareme(x, 1, 1).impot, 1e-9);
verifier("barème indexé 1,1", impotBaremeIndexe(33000, 2, 2, 1.1).impot, impotBareme(30000, 2, 2).impot * 1.1, 1e-6);

// Exit tax (art. 167 bis CGI)
{
  verifier("exit 800000 non assujetti", exitTax({ valeurTitres: 800000 }).assujetti, false);
  verifier("exit 800001 assujetti", exitTax({ valeurTitres: 800001 }).assujetti, true);
  verifier("exit 5 ans non assujetti", exitTax({ valeurTitres: 1000000, anneesResidence10: 5 }).assujetti, false);
  verifier("exit 6 ans assujetti", exitTax({ valeurTitres: 1000000, anneesResidence10: 6 }).assujetti, true);
  verifier("exit participation50", exitTax({ valeurTitres: 100000, participation50: true }).assujetti, true);
  const e = exitTax({ valeurTitres: 1000000, plusValuesLatentes: 300000 });
  verifier("exit IR", e.impotIR, 38400, 0);
  verifier("exit PS", e.prelevementsSociaux, 55800, 0);
  verifier("exit total", e.total, 94200, 0);
  verifier("exit notes", e.notes.length >= 3, true);
  verifier("exit moins-values", exitTax({ valeurTitres: 1000000, plusValuesLatentes: 300000, moinsValuesLatentes: 100000 }).base, 200000, 0);
  verifier("exit base négative", exitTax({ valeurTitres: 1000000, plusValuesLatentes: 10, moinsValuesLatentes: 100 }).total, 0, 0);
  verifier("exit non assujetti total", exitTax({ valeurTitres: 500000, plusValuesLatentes: 300000 }).total, 0, 0);
  verifier("exit dégrèvement 2 ans", exitTax({ valeurTitres: 2570000 }).degrevementApresAns, 2, 0);
  verifier("exit dégrèvement 5 ans", exitTax({ valeurTitres: 2570001 }).degrevementApresAns, 5, 0);
  verifier("exit sursis ue", exitTax({ valeurTitres: 900000 }).sursis, "automatique");
  verifier("exit sursis autre", exitTax({ valeurTitres: 900000, destination: "autre" }).sursis, "sur demande, avec garanties");
  verifier("exit non assujetti sursis", exitTax({ valeurTitres: 1 }).sursis, null);
  const vide = exitTax({}), junk = exitTax({ valeurTitres: "x", plusValuesLatentes: NaN, moinsValuesLatentes: undefined, anneesResidence10: "abc" });
  for (const r of [vide, junk]) verifier("exit sans NaN", [r.base, r.impotIR, r.prelevementsSociaux, r.total].every(Number.isFinite), true);
}

// ---- Décote, quotient familial et tranches (calculs à la main, revenu net imposable en entrée) ----
{
  // Seul, RNI 20 000 : brut (20 000 − 11 600) × 11 % = 924 ; décote 897 − 0,4525 × 924 = 478,89 → 445,11
  let r = impotBareme(20000);
  verifier("décote seul impôt", r.impot, 445.11, 1);
  verifier("décote seul TMI", r.tmi, 11, 0);
  verifier("DECOTE.seul exporté", DECOTE.seul, 897, 0);
  verifier("PLAFOND_DEMI_PART exporté", PLAFOND_DEMI_PART, 1807, 0);
  // Limite de la première tranche
  verifier("RNI 11 600 impôt", impotBareme(11600).impot, 0, 0);
  verifier("RNI 11 600 TMI", impotBareme(11600).tmi, 0, 0);
  // Écart documenté : à 11 601 le brut (0,11 €) est effacé par la décote ; le code renvoie alors tmi 0 (tmi = 0 quand impôt = 0)
  verifier("RNI 11 601 impôt effacé par la décote", impotBareme(11601).impot, 0, 0);
  verifier("RNI 11 601 TMI (0 car impôt nul)", impotBareme(11601).tmi, 0, 0);
  // Seul, RNI 40 000 : brut 17 979 × 11 % + 10 421 × 30 % = 1 977,69 + 3 126,30 = 5 103,99 ; décote nulle
  r = impotBareme(40000);
  verifier("sans décote seul impôt", r.impot, 5103.99, 1);
  verifier("sans décote seul TMI", r.tmi, 30, 0);
  // Couple 2 parts, RNI 30 000 : QF 15 000, brut/part 374, total 748 ; décote 1 483 − 0,4525 × 748 = 1 144,53 > 748 → 0
  r = impotBareme(30000, 2);
  verifier("décote couple impôt nul", r.impot, 0, 0);
  verifier("DECOTE.couple exporté", DECOTE.couple, 1483, 0);
  // Couple 2 parts, RNI 50 000 : QF 25 000, brut/part 1 474 (13 400 × 11 %), total 2 948 ; décote 1 483 − 0,4525 × 2 948 = 148,03 → 2 798,97
  verifier("décote couple partielle", impotBareme(50000, 2).impot, 2798.97, 1);
  // Plafonnement : couple 2 enfants (3 parts, base 2), RNI 100 000
  // 3 parts : 3 × 3 103,99 = 9 311,97 ; 2 parts : 2 × 8 103,99 = 16 207,98 ; avantage 6 896,01 > 2 × 1 807 = 3 614 → 16 207,98 − 3 614 = 12 593,98
  r = impotBareme(100000, 3, 2);
  verifier("QF plafonné impôt", r.impot, 12593.98, 1);
  verifier("QF plafonné TMI", r.tmi, 30, 0);
  // QF non plafonné : couple 1 enfant (2,5 parts, base 2), RNI 40 000
  // 2,5 parts : QF 16 000, (16 000 − 11 600) × 11 % = 484 × 2,5 = 1 210 ; 2 parts : QF 20 000, 924 × 2 = 1 848 ; avantage 638 < 1 807 → on garde 1 210
  // décote couple (base 2) : 1 483 − 0,4525 × 1 210 = 935,475 → impôt 274,525
  r = impotBareme(40000, 2.5, 2);
  verifier("QF non plafonné impôt", r.impot, 274.525, 1);
  verifier("QF non plafonné TMI", r.tmi, 11, 0);
  // Bornes de tranches (seul)
  verifier("TMI juste au-dessus de 29 579", impotBareme(29580).tmi, 30, 0);
  verifier("TMI à 29 579", impotBareme(29579).tmi, 11, 0);
  verifier("TMI juste au-dessus de 84 577", impotBareme(84578).tmi, 41, 0);
  verifier("TMI à 84 577", impotBareme(84577).tmi, 30, 0);
  verifier("TMI juste au-dessus de 181 917", impotBareme(181918).tmi, 45, 0);
  verifier("TMI à 181 917", impotBareme(181917).tmi, 41, 0);
  // Parts pour enfants
  verifier("partsEnfants 0", partsEnfants(0), 0, 0);
  verifier("partsEnfants 1", partsEnfants(1), 0.5, 0);
  verifier("partsEnfants 2", partsEnfants(2), 1, 0);
  verifier("partsEnfants 3", partsEnfants(3), 2, 0);
}

// ---- Source unique fiscalite/2026.js : cohérence interne et non-régression littérale ----
{
  const P = PLAFONDS;
  verifier("per.plafondMax = 8 × PASS N-1 × 10 %", P.per.plafondMax, 8 * P.passN1 * 0.1, 0.001);
  verifier("per.plafondMin = 10 % du PASS N-1", P.per.plafondMin, 0.1 * P.passN1, 0.001);
  verifier("abondement PERCO = 16 % du PASS", P.abondement.perco, 0.16 * P.pass, 0.001);
  verifier("abondement PEE = 8 % du PASS", P.abondement.pee, 0.08 * P.pass, 0.001);
  verifier("PFU = IR_PFU + PS_CAPITAL", PFU, PRELEVEMENTS.IR_PFU + PRELEVEMENTS.PS_CAPITAL, 0.0001);
  verifier("barème strictement croissant", BAREME.every(([h, t], i) => i === 0 || (h > BAREME[i - 1][0] && t > BAREME[i - 1][1])), true);
  verifier("FISCALITE figée", Object.isFrozen(FISCALITE), true);
  verifier("FISCALITE.plafonds figé en profondeur", Object.isFrozen(P.ptz.plafondOperationUnePersonne), true);
  verifier("MILLESIME", MILLESIME, 2026, 0);
  verifier("BAREME[1][0]", BAREME[1][0], 29579, 0);
  verifier("BAREME[4][1]", BAREME[4][1], 45, 0);
  verifier("DECOTE.taux", DECOTE.taux, 45.25, 0);
  verifier("PLAFONDS.livretA", P.livretA, 22950, 0);
  verifier("PLAFONDS.ldds", P.ldds, 12000, 0);
  verifier("PLAFONDS.lep", P.lep, 10000, 0);
  verifier("PLAFONDS.pea", P.pea, 150000, 0);
  verifier("PLAFONDS.pass", P.pass, 48060, 0);
  verifier("PLAFONDS.per.plafondMax", P.per.plafondMax, 37680, 0);
  verifier("PLAFONDS.ptz zone B1", P.ptz.plafondOperationUnePersonne.B1, 135000, 0);
  verifier("PLAN reprend les plafonds (livret A)", PLAN.enveloppes.livretA.plafond, P.livretA, 0);
  verifier("PLAN reprend les plafonds (PER)", PLAN.per.plafondMax, P.per.plafondMax, 0);
  verifier("PLAN reprend les plafonds (PASS)", PLAN.retraitePublique.pass, P.pass, 0);
  verifier("PLAN reprend l'abondement PEE", PLAN.abondement.plafondPEE, P.abondement.pee, 0);
}

// ---- Économie d'impôt exacte d'une déduction et taux marginal effectif ----
{
  verifier("tme : zone de décote (20 000)", tauxMarginalEffectif(20000), 15.98, 0.05);
  verifier("tme : impôt nul (11 601)", tauxMarginalEffectif(11601), 0, 0.001);
  verifier("tme : tranche à 30 % (40 000)", tauxMarginalEffectif(40000), 30, 0.001);
  verifier("tme : QF plafonné, 3 parts dont base 2 (100 000)", tauxMarginalEffectif(100000, 3, 2), 30, 0.001);
  verifier("tme : couple 2 parts, RNI 50 000", tauxMarginalEffectif(50000, 2), 15.98, 0.05);
  verifier("tme : revenu nul", tauxMarginalEffectif(0), 0, 0);
  verifier("tme : entrée NaN", tauxMarginalEffectif(NaN), 0, 0);
  const e1 = economieDeduction(32000, 5000);
  verifier("économie : 32 000 / 5 000", e1.economie, 1140.49, 1);
  verifier("économie : taux effectif 32 000 / 5 000", e1.tauxEffectif, 22.81, 0.05);
  verifier("économie : n'est pas montant × tmi", e1.economie < 5000 * 0.3, true);
  verifier("économie : 20 000 / 5 000", economieDeduction(20000, 5000).economie, 445.11, 1);
  verifier("économie : déduction nulle", economieDeduction(40000, 0).economie, 0, 0);
  verifier("économie : déduction nulle, taux = marginal", economieDeduction(40000, 0).tauxEffectif, 30, 0.001);
  const e2 = economieDeduction(10000, 50000);
  verifier("économie : déduction bornée au revenu, pas de NaN", Number.isFinite(e2.economie) && Number.isFinite(e2.tauxEffectif), true);
  verifier("économie : déduction bornée au revenu (impôt déjà nul)", e2.economie, impotBareme(10000).impot, 0.001);
  const e3 = economieDeduction(NaN, undefined);
  verifier("économie : entrées NaN/undefined", e3.economie === 0 && e3.tauxEffectif === 0, true);
  verifier("économie : déduction négative ignorée", economieDeduction(32000, -500).economie, 0, 0);
  verifier("non-régression : tmi de impotBareme(32 000)", impotBareme(32000).tmi, 30, 0);
  verifier("non-régression : tmi de impotBareme(20 000)", impotBareme(20000).tmi, 11, 0);

  // conseilPER : exact quand le revenu se déduit des salaires, sinon montant × tranche
  const profil = { statutPro: "salarie", salaireNetMensuel: 2700, epargneMensuelle: 10000, plafondPER: 5000, age: 35, enfants: 0, tmi: 30, tmiEstimee: true };
  const F = revenuImposableDe(profil);
  verifier("revenuImposableDe : connu (salarié)", !!F && F.revenu > 30000 && F.revenu < 34000 && F.parts === 1, true);
  const mouvements = [{ sens: "versement", enveloppe: "pea", montant: 2000 }];
  const c = conseilPER(PLAN, profil, mouvements);
  verifier("conseilPER exact : exact", c.exact, true);
  verifier("conseilPER exact : versement annuel", c.annuel, 5000, 0.01);
  verifier("conseilPER exact : économie = différence d'impôt", c.economie, economieDeduction(F.revenu, c.annuel, F.parts, F.partsBase).economie, 0.01);
  verifier("conseilPER exact : taux effectif", c.tauxEffectif, 100 * c.economie / c.annuel, 0.001);
  verifier("conseilPER exact : moins que montant × tmi", c.economie < (c.annuel * c.tmi) / 100, true);
  verifier("conseilPER exact : tmi légale conservée", c.tmi, 30, 0);
  const sans = conseilPER(PLAN, { ...profil, salaireNetMensuel: 0, tmiEstimee: false }, mouvements);
  verifier("conseilPER tmi saisie sans revenu : exact faux", sans.exact, false);
  verifier("conseilPER tmi saisie sans revenu : annuel × tmi / 100", sans.economie, (sans.annuel * 30) / 100, 0.001);
  verifier("conseilPER tmi saisie sans revenu : taux = tmi", sans.tauxEffectif, 30, 0);
  const incoherent = conseilPER(PLAN, { ...profil, tmi: 41, tmiEstimee: false }, mouvements);
  verifier("conseilPER tmi saisie ≠ tranche des salaires : approximation", incoherent.exact, false);
}

// ---- Alerte de millésime ----
{
  verifier("alerte millésime : fin 2026 (aucune)", alerteMillesime(2026, new Date("2026-12-31")), null);
  verifier("alerte millésime : année du millésime avec défaut", alerteMillesime(MILLESIME, new Date(MILLESIME, 5, 1)), null);
  const a = alerteMillesime(2026, new Date("2027-01-01T12:00:00"));
  verifier("alerte millésime : objet en 2027", typeof a, "object");
  verifier("alerte millésime : année", a?.annee, 2027, 0);
  verifier("alerte millésime : niveau", a?.niveau, "info");
  verifier("alerte millésime : cite 2026 et 2027", a.texte.includes("2026") && a.texte.includes("2027"), true);
  verifier("alerte millésime : aucun montant", /\d[\d\s]*€/.test(a.texte), false);
}

// Impôt selon le statut du couple (commun ou séparé)
{
  let r = impotSelonStatut({ revenuA: 50000, revenuB: 0, enfants: 0 });
  verifier("statut : commun A seul", r.commun.impot, impotBareme(50000, 2, 2).impot, 0.01);
  verifier("statut : séparé A seul", r.separe.impot, impotBareme(50000, 1, 1).impot, 0.01);
  verifier("statut : gain commun positif (un seul revenu)", r.gainCommun > 0, true);
  r = impotSelonStatut({ revenuA: 60000, revenuB: 60000, enfants: 0 });
  verifier("statut : deux revenus égaux, écart quasi nul", Math.abs(r.gainCommun) <= 2, true);
  r = impotSelonStatut({ revenuA: 80000, revenuB: 20000, enfants: 3 });
  let minimal = true;
  for (let k = 0; k <= 3; k++) {
    const t = impotBareme(80000, 1 + partsEnfants(k), 1).impot + impotBareme(20000, 1 + partsEnfants(3 - k), 1).impot;
    if (r.separe.impot > t + 0.01) minimal = false;
  }
  verifier("statut : répartition des enfants minimale", minimal, true);
  verifier("statut : enfants répartis = 3", r.separe.enfantsA + r.separe.enfantsB, 3, 0);
  const marie = { salaireNetMensuel: 3000, enfants: 1, foyer: { actif: true, statut: "marie" }, conjoint: { salaireNetMensuel: 2000 } };
  verifier("revenus conjoints : null si foyer inactif", revenusImposablesConjoints({ salaireNetMensuel: 3000, foyer: { actif: false } }), null);
  for (const [nom, p] of [["marié", marie], ["concubin", { ...marie, foyer: { actif: true, statut: "concubin" } }], ["sans salaire", { ...marie, salaireNetMensuel: undefined, conjoint: {} }]]) {
    const v = revenusImposablesConjoints(p);
    verifier(`revenus conjoints ${nom} : finis et positifs`, Number.isFinite(v.a) && Number.isFinite(v.b) && v.a >= 0 && v.b >= 0, true);
    if (nom === "sans salaire") continue;
    const w = revenusImposablesConjoints(normaliserFoyer(PLAN, JSON.parse(JSON.stringify(p))));
    verifier(`revenus conjoints ${nom} : profil fusionné = profil brut`, Math.abs(w.a - v.a) < 0.01 && Math.abs(w.b - v.b) < 0.01, true);
  }
  {
    const moi = { ...marie, foyer: { actif: true, statut: "concubin", vue: "moi" } }, v = revenusImposablesConjoints(moi), w = revenusImposablesConjoints(normaliserFoyer(PLAN, JSON.parse(JSON.stringify(moi))));
    verifier("revenus conjoints concubin « vue moi » : profil normalisé = brut", Math.abs(w.a - v.a) < 0.01 && Math.abs(w.b - v.b) < 0.01, true);
  }
}

// Outillage du millésime : cohérence des métadonnées, import unique, comparateur
{
  verifier("millésime : FISCALITE.millesime = MILLESIME", FISCALITE.millesime, MILLESIME);
  verifier("millésime : revenus = millésime - 1", FISCALITE.revenus, FISCALITE.millesime - 1);
  verifier("millésime : loiDeFinances mentionne l'année", String(FISCALITE.loiDeFinances).includes(String(FISCALITE.millesime)), true);
  const imports = [...readFileSync(new URL("./fiscal.js", import.meta.url), "utf8").matchAll(/from\s+"\.\/fiscalite\/(\d{4})\.js"/g)].map((r) => r[1]);
  verifier("millésime : fiscal.js importe un seul fichier fiscalite/<année>.js", imports.length, 1, 0);
  verifier("millésime : le fichier importé est celui du millésime", imports[0], String(MILLESIME));
  verifier("comparerMillesimes : identique -> aucun écart", comparerMillesimes(FISCALITE, FISCALITE).length, 0, 0);
  const clone = structuredClone(FISCALITE);
  clone.ir.bareme[2][1] += 1;
  clone.nouvelleCle = 42;
  delete clone.marche;
  const ec = comparerMillesimes(FISCALITE, clone);
  verifier("comparerMillesimes : 3 écarts", ec.length, 3, 0);
  const par = (c) => ec.find((e) => e.chemin === c);
  verifier("comparerMillesimes : taux modifié", par("ir.bareme[2][1]")?.type, "modifie");
  verifier("comparerMillesimes : clé ajoutée", par("nouvelleCle")?.type, "ajoute");
  verifier("comparerMillesimes : clé supprimée", par("marche")?.type, "supprime");
}

console.log(`${ok} vérifications réussies, ${ko} échec(s)`);
process.exit(ko ? 1 : 0);
