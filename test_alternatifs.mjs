// Tests des placements alternatifs : fiscalité des SCPI, délai de jouissance, nue-propriété temporaire — node test_alternatifs.mjs
import { PLAN } from "./plan.js";
import { PRELEVEMENTS, impotBareme } from "./fiscal.js";
import { tauxGains, foyerScpiDe } from "./moteur.js";
import { fiscaliteScpi, tauxFiscalScpi, coutJouissance, decoteNuePropriete, comparerNuePropriete, fraisEntreeScpiEffectifs, delaiJouissance } from "./alternatifs.js";

let ok = 0, ko = 0;
const verifier = (nom, obtenu, attendu, tol = 2) => {
  const bon = typeof attendu === "number" ? Math.abs(obtenu - attendu) <= tol : obtenu === attendu;
  if (bon) ok++; else { ko++; console.log(`ÉCHEC ${nom} : obtenu ${obtenu}, attendu ${attendu}`); }
};
const PS = PRELEVEMENTS.PS_PATRIMOINE;

// 1-2. Délai de jouissance et décote de la nue-propriété
verifier("1 coût de jouissance", coutJouissance(4.5, 5), 1.875, 1e-9);
verifier("2 décote 5 ans", decoteNuePropriete(4.5, 5), 19.75, 0.2);
verifier("2 décote 10 ans", decoteNuePropriete(4.5, 10), 35.6, 0.2);
verifier("2 décote 15 ans", decoteNuePropriete(4.5, 15), 48.3, 0.2);

// 3. Foyer d'une part en tranche à 30 % sur tout l'intervalle
const R = 40000;
verifier("3 tranche à 30 % en R", impotBareme(R, 1).tmi, 30, 0);
verifier("3 tranche à 30 % en R + 1000", impotBareme(R + 1000, 1).tmi, 30, 0);
const f1 = { revenuImposable: R, parts: 1, tmi: 30 };
const r3 = fiscaliteScpi(f1, 1000);
verifier("3 taux global exact", r3.tauxGlobal, 30 + PS, 0.1);
verifier("3 mode exact", r3.mode, "exact", 0);
verifier("3 tauxFiscalScpi", tauxFiscalScpi(f1), r3.tauxGlobal, 1e-9);

// 4. SCPI européenne : pas de prélèvements sociaux, taux effectif
const r4 = fiscaliteScpi(f1, 1000, { partEtrangere: 100, impotEtranger: 0 });
const imp = (x) => impotBareme(x, 1).impot;
const attenduSurcout = (imp(R + 1000) * R) / (R + 1000) - imp(R);
verifier("4 PS nuls", r4.psFrance, 0, 0);
verifier("4 IR France nul", r4.irFrance, 0, 1e-9);
verifier("4 surcoût égal à la formule", r4.surcoutTauxEffectif, attenduSurcout, 1e-6);
verifier("4 surcoût positif", r4.surcoutTauxEffectif > 0, true, 0);
verifier("4 surcoût < 300 €", r4.surcoutTauxEffectif < 300, true, 0);
verifier("4 foyer non imposable : surcoût nul", fiscaliteScpi({ revenuImposable: 5000, parts: 1, tmi: 0 }, 1000, { partEtrangere: 100 }).surcoutTauxEffectif, 0, 0);
verifier("4 impôt étranger", fiscaliteScpi(f1, 1000, { partEtrangere: 50, impotEtranger: 20 }).impotEtranger, 100, 1e-9);
verifier("4 revenu nul : taux 0", fiscaliteScpi(f1, 0).tauxGlobal, 0, 0);

// 5. Approche sans revenu imposable
const r5 = fiscaliteScpi({ tmi: 41 }, 1000, { partEtrangere: 25 });
verifier("5 mode approche", r5.mode, "approche", 0);
verifier("5 IR = Rfr × tmi", r5.irFrance, 750 * 0.41, 1e-9);
verifier("5 surcoût nul", r5.surcoutTauxEffectif, 0, 0);

// 6. Nue-propriété contre pleine propriété
const base = { montant: 20000, dureeAns: 10, tauxDistribution: 4.5, revalorisation: 0, fraisEntree: 0, delaiJouissanceMois: 0, tauxFiscal: 0 };
const c6 = comparerNuePropriete(base);
verifier("6 cohérence de la décote", Math.abs(c6.triNP - c6.triPP), 0, 0.05);
verifier("6 décote estimée", c6.decoteEstimee, true, 0);
verifier("6 trois avertissements", c6.avertissements.length, 3, 0);
const c6b = comparerNuePropriete({ ...base, tauxFiscal: 47.2 });
verifier("6 fiscalité lourde : NP gagne", c6b.triNP > c6b.triPP, true, 0);
const c6c = comparerNuePropriete({ ...base, decote: 30 });
verifier("6 décote saisie", c6c.decoteEstimee, false, 0);
verifier("6 décote saisie reprise", c6c.decote, 30, 0);
verifier("6 deux avertissements", c6c.avertissements.length, 2, 0);
verifier("6 délai de jouissance pénalise la PP", comparerNuePropriete({ ...base, delaiJouissanceMois: 6 }).triPP < c6.triPP, true, 0);
verifier("6 entrées invalides", comparerNuePropriete({ montant: 0, dureeAns: 5, tauxDistribution: 4 }), null, 0);

// 7. Fiscalité SCPI du plan : suit la tranche réelle du foyer
verifier("7 plan : pas de valeur figée", PLAN.fiscalite.gains.scpi, null, 0);
verifier("7 TMI 11", tauxGains(PLAN, { tmi: "11" }, "scpi"), 11 + PS, 0.01);
verifier("7 TMI 41", tauxGains(PLAN, { tmi: "41" }, "scpi"), 41 + PS, 0.01);
verifier("7 TMI inconnue", tauxGains(PLAN, { tmi: "" }, "scpi"), 30 + PS, 0.01);
verifier("7 réglage manuel prioritaire", tauxGains({ fiscalite: { gains: { scpi: 25 } } }, { tmi: "41" }, "scpi"), 25, 0);
verifier("7 autres enveloppes inchangées", tauxGains(PLAN, { tmi: "41" }, "cto"), PLAN.fiscalite.gains.cto, 0);
verifier("7 réforme des prélèvements sociaux", tauxGains({ fiscalite: { gains: { scpi: null }, ajustementScpi: 1 } }, { tmi: "30" }, "scpi"), 30 + PS + 1, 0.01);
verifier("7 part européenne du profil", tauxGains(PLAN, { tmi: "30", scpiDetail: { partEtrangere: 100, impotEtranger: 0 } }, "scpi") < 30 + PS, true, 0);
const foyerSalaire = foyerScpiDe({ salaireNetMensuel: 3200, tmi: "30" });
verifier("7 foyer : revenu imposable déduit des salaires", foyerSalaire.revenuImposable > 0 && foyerSalaire.parts === 1, true, 0);

// 8. Délai de jouissance dans les frais d'entrée
const H = PLAN.hypotheses;
verifier("8 délai du plan", PLAN.hypotheses.scpi.delaiJouissanceMois, 5, 0);
verifier("8 frais effectifs", fraisEntreeScpiEffectifs(H), H.fraisEntree.scpi + coutJouissance(H.rendements.scpi, 5), 1e-9);
verifier("8 frais effectifs (10 + 5/3)", fraisEntreeScpiEffectifs(H), 10 + coutJouissance(4, 5), 1e-9);
verifier("8 délai du profil prioritaire", delaiJouissance(H, 2), 2, 0);
verifier("8 délai du profil à 0", delaiJouissance(H, 0), 0, 0);
verifier("8 délai vide : plan", delaiJouissance(H, null), 5, 0);

console.log(`${ok} vérifications réussies, ${ko} échec(s)`);
process.exit(ko ? 1 : 0);
