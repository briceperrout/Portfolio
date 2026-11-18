// Tests des crédits, des indemnités de remboursement anticipé et de l'arbitrage rembourser / placer — node test_credits.mjs
import { PLAN } from "./plan.js";
import { mensualitePret } from "./locatif.js";
import { CREDIT } from "./fiscal.js";
import { detecterAlertes } from "./alertes.js";
import { moisRestants, normaliserCredit, echeancierMensuel, creditsDuProfil, iraCredit, rembourserAnticipe, triMensuel, arbitrerRemboursement, prioriserCredits, mensualitesConso, creditsMensuelsDe } from "./credits.js";

let ok = 0, ko = 0;
const verifier = (nom, obtenu, attendu, tol = 2) => {
  const bon = typeof attendu === "number" ? Math.abs(obtenu - attendu) <= tol : obtenu === attendu;
  if (bon) ok++; else { ko++; console.log(`ÉCHEC ${nom} : obtenu ${obtenu}, attendu ${attendu}`); }
};

const AUJ = new Date("2026-11-17");
const conso = (extra = {}) => ({ id: "c1", type: "conso", libelle: "Conso", capitalRestant: 15000, taux: 6, finCredit: "2029-11", ...extra });
const PROFIL = (extra = {}) => ({ age: 35, salaireNetMensuel: 3000, depensesMensuelles: 1800, tmi: "30", capital: 40000, placements: { livretA: 22950, ldds: 12000, pea: 5050 }, logement: {}, credits: [], ...extra });

// Bases
verifier("mois restants", moisRestants(conso(), AUJ), 36, 0);
verifier("mois restants passé", moisRestants(conso({ finCredit: "2020-01" }), AUJ), 0, 0);
verifier("mois restants inconnu", moisRestants({}, AUJ), 0, 0);
const norm = normaliserCredit(conso(), AUJ);
verifier("mensualité complétée", norm.mensualite, mensualitePret(15000, 6, 3), 0.01);
verifier("crédit sans taux incomplet", normaliserCredit(conso({ taux: "" }), AUJ).incomplet, true);
const ech = echeancierMensuel(15000, 6, norm.mensualite);
verifier("échéancier durée", ech.length, 36, 0);
verifier("échéancier extinction", ech.at(-1).crd, 0, 0.01);
verifier("échéancier insuffisant", echeancierMensuel(15000, 6, 50).insuffisant, true);

// 1. Remboursement total d'un crédit conso
let a = arbitrerRemboursement(PLAN, PROFIL(), conso(), 15000, { enveloppe: "livretA", aujourdhui: AUJ });
verifier("1 IRA conso 1 %", a.ira, 150, 0.01);
verifier("1 intérêts économisés", a.interetsEconomises, 1428, 5);
verifier("1 rendement garanti ≥ 5,3", a.rendementGaranti >= 5.3, true);
verifier("1 rendement garanti ≤ 5,6", a.rendementGaranti <= 5.6, true);
verifier("1 verdict", a.verdict, "rembourser");
verifier("1 gain certain", a.gainCertain, a.interetsEconomises - 150, 0.01);
verifier("1 mensualité réduite à zéro", a.apres.mois, 0, 0);

// 2. Seuil des 10 000 €
verifier("2 seuil sans indemnité", iraCredit(conso(), 8000, AUJ).ira, 0, 0);
verifier("2 seuil dépassé avec déjà remboursé", iraCredit(conso(), 8000, AUJ, { dejaRembourse12Mois: 5000 }).ira > 0, true);
verifier("2 seuil de la loi", CREDIT.consommation.seuilSansIndemnite, 10000, 0);

// 3. Moins de 12 mois restants : 0,5 %
verifier("3 IRA 0,5 %", iraCredit(conso({ finCredit: "2027-09" }), 15000, AUJ).ira, 75, 0.01);

// 4. Immobilier : 6 mois d'intérêts plafonnés à 3 %
const immo = (extra = {}) => ({ id: "i1", type: "immo", libelle: "Immo", capitalRestant: 150000, taux: 1.2, finCredit: "2046-11", ...extra });
verifier("4 immo 6 mois d'intérêts", iraCredit(immo(), 150000, AUJ).ira, 900, 0.01);
verifier("4 immo plafond 3 %", iraCredit(immo({ capitalRestant: 100000, taux: 7 }), 100000, AUJ).ira, 3000, 0.01);

// 5. Taux non fixe, options
verifier("5 revolving", iraCredit(conso({ type: "revolving" }), 15000, AUJ).ira, 0, 0);
verifier("5 taux variable", iraCredit(conso({ tauxVariable: true }), 15000, AUJ).ira, 0, 0);
verifier("5 option aucune", iraCredit(conso(), 15000, AUJ, { ira: "aucune" }).ira, 0, 0);
verifier("5 option nombre", iraCredit(conso(), 15000, AUJ, { ira: 321 }).ira, 321, 0);
verifier("5 ptz", iraCredit(conso({ type: "ptz" }), 15000, AUJ).ira, 0, 0);

// 6. Point mort : rendement de l'enveloppe = taux du crédit, sans impôt, sans indemnité
const plan6 = JSON.parse(JSON.stringify(PLAN));
plan6.hypotheses.rendements.securite = 6;
plan6.fiscalite.gains.livretA = 0;
a = arbitrerRemboursement(plan6, PROFIL(), conso(), 15000, { enveloppe: "livretA", ira: "aucune", aujourdhui: AUJ });
verifier("6 point mort (écart / sortie)", Math.abs(a.ecart) / a.sortie, 0, 0.01);

// 7. Modes de remboursement partiel
let r = rembourserAnticipe(conso(), 5000, "duree", AUJ);
verifier("7 durée : moins de mois", r.apres.mois < r.avant.mois, true);
verifier("7 durée : mensualité conservée", r.apres.mensualite, r.avant.mensualite, 0.001);
verifier("7 durée : intérêts économisés > 0", r.interetsEconomises > 0, true);
const capApres = 15000 - 5000;
verifier("7 durée : capital + intérêts restants", r.apres.interets + capApres, echeancierMensuel(capApres, 6, r.apres.mensualite).reduce((s, l) => s + l.interets + l.capital, 0), 0.01);
r = rembourserAnticipe(conso(), 5000, "mensualite", AUJ);
verifier("7 mensualité : mois identiques", r.apres.mois, r.avant.mois, 0);
verifier("7 mensualité : mensualité réduite", r.apres.mensualite < r.avant.mensualite, true);
verifier("7 mensualité : assurance économisée nulle", r.assuranceEconomisee, 0, 0);
r = rembourserAnticipe(conso({ assuranceMensuelle: 10 }), 5000, "duree", AUJ);
verifier("7 assurance économisée", r.assuranceEconomisee, 10 * (r.avant.mois - r.apres.mois), 0.001);
verifier("7 capital borné", rembourserAnticipe(conso(), 99999, "duree", AUJ).capitalRembourse, 15000, 0);
verifier("7 flux libérés sur l'horizon", rembourserAnticipe(conso(), 5000, "duree", AUJ).fluxLiberes.length, 36, 0);

// 8. Priorisation
const credits8 = [
  conso({ id: "a", type: "revolving", taux: 18, capitalRestant: 2000, finCredit: "2027-11" }),
  conso({ id: "b" }),
  { ...immo(), id: "c" },
  { id: "d", type: "ptz", libelle: "PTZ", capitalRestant: 50000, taux: 0, finCredit: "2040-01" },
  { id: "e", type: "conso", libelle: "Sans taux", capitalRestant: 1000, finCredit: "2028-01" },
];
let pr = prioriserCredits(PLAN, PROFIL({ credits: credits8 }), AUJ);
verifier("8 ordre", pr.credits.map((c) => c.id).join(","), "a,b,c");
verifier("8 exclus", pr.exclus.map((c) => c.id).sort().join(","), "d,e");
verifier("8 prioritaires", pr.credits.map((c) => c.prioritaire).join(","), "true,true,false");
verifier("8 rendement prudent", pr.rendementNetPrudent, 2, 0.001);
pr = prioriserCredits(PLAN, PROFIL({ tmi: "30", credits: [{ ...immo(), id: "l", taux: 3, usage: "locatif", regimeReel: true }] }), AUJ);
verifier("8 locatif réel net d'impôt", pr.credits[0].coutNet, 3 * (1 - 0.472), 0.02);
pr = prioriserCredits(PLAN, PROFIL({ credits: [{ ...immo(), id: "l", taux: 3, usage: "locatif", regimeReel: false }] }), AUJ);
verifier("8 locatif micro non déduit", pr.credits[0].coutNet, 3, 0.001);
pr = prioriserCredits(PLAN, PROFIL({ logement: { creditRestant: 120000, tauxCredit: 1.3, finCredit: 2046, mensualite: 600 } }), AUJ);
verifier("8 crédit du logement repris", pr.credits[0]?.id, "logement");

// 9. TRI : 5 % nominal = 5,116 % effectif
const m9 = mensualitePret(1000, 5, 1);
verifier("9 TRI annualisé", triMensuel(1000, Array(12).fill(m9)), 5.116, 0.01);
verifier("9 TRI sans flux", triMensuel(1000, []), null);

// 10. Alertes
const profilAlerte = PROFIL({ credits: [conso({ id: "auto", type: "auto", libelle: "Auto", taux: 6, capitalRestant: 4000, finCredit: "2028-11" })] });
let al = detecterAlertes(PLAN, profilAlerte, { aujourdhui: AUJ }).filter((x) => x.fiche === "remboursement-anticipe");
verifier("10 alerte crédit coûteux", al.length, 1, 0);
verifier("10 niveau action", al[0]?.niveau, "action");
const pauvre = PROFIL({ placements: { livretA: 8000, ldds: 0, pea: 30000 }, credits: profilAlerte.credits });
verifier("10 sans excédent : aucune alerte", detecterAlertes(PLAN, pauvre, { aujourdhui: AUJ }).filter((x) => x.fiche === "remboursement-anticipe").length, 0, 0);
const bon = PROFIL({ credits: [conso({ id: "x", type: "conso", taux: 1, capitalRestant: 4000, finCredit: "2028-11" })] });
verifier("10 crédit bon marché : aucune alerte", detecterAlertes(PLAN, bon, { aujourdhui: AUJ }).filter((x) => x.fiche === "remboursement-anticipe").length, 0, 0);

// 11. Migration et source unique de creditsMensuels
verifier("11 sans liste : valeur saisie conservée", creditsMensuelsDe({ creditsMensuels: 250, credits: [] }, AUJ), 250, 0);
verifier("11 profil ancien sans credits", creditsMensuelsDe({ creditsMensuels: 180 }, AUJ), 180, 0);
const m1 = mensualitePret(15000, 6, 3);
verifier("11 somme des mensualités", creditsMensuelsDe({ creditsMensuels: 999, credits: [conso(), conso({ id: "c2", assuranceMensuelle: 10 })] }, AUJ), 2 * m1 + 10, 0.02);
verifier("11 hors crédit du logement", mensualitesConso({ logement: { creditRestant: 100000, tauxCredit: 1, mensualite: 500 }, credits: [conso()] }, AUJ), m1, 0.01);
verifier("11 liste logement", creditsDuProfil({ logement: { creditRestant: 100000, tauxCredit: 1, finCredit: 2046, mensualite: 500 }, credits: [conso()] }, AUJ).length, 2, 0);
verifier("11 logement sans taux incomplet", creditsDuProfil({ logement: { creditRestant: 100000, mensualite: 500, finCredit: 2046 } }, AUJ)[0].incomplet, true);

console.log(`${ok} vérifications réussies, ${ko} échec(s)`);
process.exit(ko ? 1 : 0);
