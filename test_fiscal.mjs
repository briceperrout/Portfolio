// Tests de la fiscalité des indépendants et de la centralisation des taux — node test_fiscal.mjs
import { PFU, PRELEVEMENTS, microEntreprise, remunerationSociete, optimiserRemuneration, plafondPERIndependant, impotSurLesSocietes } from "./fiscal.js";
import { PLAN } from "./plan.js";
import { estimerPension } from "./pension.js";

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
verifier("plan scpi", PLAN.fiscalite.gains.scpi, 47.2, 0);
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

console.log(`${ok} vérifications réussies, ${ko} échec(s)`);
process.exit(ko ? 1 : 0);
