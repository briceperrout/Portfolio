// Tests du simulateur successoral — node test_succession.mjs
import { droitsBareme, valeurUsufruit, rappelFiscal, droitsEnfant, droitsConcubin, droitsAV990I, reserveHereditaire, masseSuccessorale, optionsPossibles, simulerSuccession, comparerOptionsConjoint, simulerDonationNP, calendrierAbattements, entreeDepuisProfil, droitsSurRegistre, reserveAVTransmissible } from "./succession.js";
import { PLAN } from "./plan.js";
import { normaliserFoyer } from "./moteur.js";
import { ABATTEMENT_AV_DECES, AV_DECES } from "./fiscal.js";

let ok = 0, ko = 0;
const verifier = (nom, obtenu, attendu, tol = 0.01) => {
  const bon = typeof attendu === "number" ? Math.abs(obtenu - attendu) <= tol : JSON.stringify(obtenu) === JSON.stringify(attendu);
  if (bon) ok++; else { ko++; console.log(`ÉCHEC ${nom} : obtenu ${JSON.stringify(obtenu)}, attendu ${JSON.stringify(attendu)}`); }
};

// 1. Barème
verifier("barème 200000", droitsBareme(200000), 38194.35);
verifier("barème 0", droitsBareme(0), 0);
verifier("barème rappel", droitsBareme(100000, 50000), 20000);
// 2. Usufruit
verifier("us 20", valeurUsufruit(20).nuePropriete, 10); verifier("us 20 usufruit", valeurUsufruit(20).usufruit, 90);
verifier("us 21", valeurUsufruit(21).usufruit, 80);
verifier("us 62", valeurUsufruit(62).nuePropriete, 60);
verifier("us 72", valeurUsufruit(72).nuePropriete, 70);
verifier("us 90", valeurUsufruit(90).usufruit, 20);
verifier("us 91", valeurUsufruit(91).usufruit, 10);
// 3. 990 I
verifier("990I 400k", droitsAV990I(400000, "enfant"), 49500);
verifier("990I 1M", droitsAV990I(1000000, "enfant"), 186093.75);
verifier("990I conjoint", droitsAV990I(400000, "conjoint"), 0);
verifier("ABATTEMENT_AV_DECES unique", ABATTEMENT_AV_DECES, AV_DECES.ABATTEMENT_990I);
// 4. Concubin
verifier("concubin", droitsConcubin(100000), 59043.6);
// 5. Rappel fiscal
verifier("rappel 2016", rappelFiscal([{ annee: 2016, montant: 60000 }], 2026).abattement, 40000);
verifier("rappel 2011", rappelFiscal([{ annee: 2011, montant: 60000 }], 2026).abattement, 100000);
const r150 = rappelFiscal([{ annee: 2020, montant: 150000 }], 2026);
verifier("rappel 150k abattement", r150.abattement, 0); verifier("rappel 150k dejaTaxe", r150.dejaTaxe, 50000);
verifier("réserve", [0, 1, 2, 3, 5].map(reserveHereditaire), [0, 0.5, 2 / 3, 0.75, 0.75]);
// 6. Seul, 1 enfant
const s6 = simulerSuccession({ situation: "seul", enfants: 1, actifs: [{ valeur: 300000, nature: "propre" }] });
verifier("seul masse", s6.masse.masseNette, 298500);
verifier("seul droits", s6.heritiers[0].droitsTotal, 37894.35);
// 7. Mariage communauté légale
const cas7 = { annee: 2026, ageDefunt: 65, situation: "mariage", regime: "communaute_legale", ageConjoint: 65, enfants: 2, enfantsNonCommuns: 0, actifs: [{ valeur: 800000, nature: "commun" }], patrimoineConjoint: { propre: 0 } };
let r = simulerSuccession({ ...cas7, optionConjoint: "usufruit" });
const enf = (x) => x.heritiers.filter((h) => h.lien === "enfant");
verifier("usufruit base", enf(r)[0].baseTaxable, 19550);
verifier("usufruit droits", enf(r)[0].droitsTotal, 2104.35);
verifier("usufruit conjoint", r.heritiers[0].droitsTotal, 0);
r = simulerSuccession({ ...cas7, optionConjoint: "quart_pp" });
verifier("quart droits", enf(r)[0].droitsTotal, 8081.85);
verifier("quart conjoint", r.heritiers[0].droitsTotal, 0);
// 8. Enfants non communs
const cas8 = { ...cas7, enfantsNonCommuns: 1 };
verifier("usufruit absent", optionsPossibles(cas8).includes("usufruit"), false);
r = simulerSuccession({ ...cas8, optionConjoint: "usufruit" });
verifier("repli quart_pp", r.optionRetenue, "quart_pp");
verifier("repli message", r.hypotheses.some((h) => h.includes("repli")), true);
verifier("DDV rend l'usufruit possible", optionsPossibles({ ...cas8, donationDernierVivant: true }).includes("usufruit"), true);
// 9. Communauté universelle
r = simulerSuccession({ ...cas7, regime: "communaute_universelle" });
verifier("CU droits enfants", enf(r).reduce((s, h) => s + h.droitsTotal, 0), 0);
verifier("CU drapeau", r.masse.attributionIntegrale, true);
// 10. Résidence principale
const rp = { enfants: 0, actifs: [{ valeur: 300000, nature: "propre", rp: true }] };
verifier("RP seul", masseSuccessorale({ ...rp, situation: "seul" }).abattementRP, 0);
verifier("RP concubin", masseSuccessorale({ ...rp, situation: "concubin" }).abattementRP, 0);
verifier("RP mineur au foyer", masseSuccessorale({ ...rp, situation: "seul", enfantMineurAuFoyer: true }).abattementRP, 60000);
verifier("RP mariage", masseSuccessorale({ situation: "mariage", actifs: [{ valeur: 400000, nature: "commun", rp: true }] }).abattementRP, 40000);
// 11. PER
const per = { situation: "seul", enfants: 2, clauseAV: "enfants", per: { valeur: 100000 } };
let h = simulerSuccession({ ...per, ageDefunt: 65 }).heritiers[0];
verifier("PER 65 => 990 I", h.base757B, 0); verifier("PER 65 capital", h.avHorsSuccession, 50000);
h = simulerSuccession({ ...per, ageDefunt: 75 }).heritiers[0];
verifier("PER 75 => 757 B", h.base757B, 34750);
// 12. 757 B
r = simulerSuccession({ situation: "seul", ageDefunt: 75, enfants: 2, clauseAV: "enfants", assuranceVie: { apres70Primes: 100000 } });
verifier("757B base", r.heritiers[0].base757B, 34750); verifier("757B droits", r.heritiers[0].droitsTotal, 0);
verifier("757B exonéré conjoint", simulerSuccession({ situation: "mariage", ageDefunt: 75, enfants: 1, assuranceVie: { apres70Primes: 100000 } }).totalDroits, 0);
// 13-14. Donation en nue-propriété
const d = simulerDonationNP({ valeur: 300000, ageDonateur: 62, enfants: 1, annee: 2026 });
verifier("donation droits", d.droitsDonation, 14194.35);
verifier("sans donation", d.droitsSansDonation, 38194.35);
verifier("économie", d.economie, 24000);
verifier("calendrier âges", calendrierAbattements(62, 2026).map((l) => l.age), [62, 77]);
// 15. Comparaison des options
const cmp = comparerOptionsConjoint(cas7);
const noms = cmp.map((l) => l.option);
verifier("cmp contient", ["quart_pp", "usufruit", "communaute_universelle"].every((o) => noms.includes(o)), true);
verifier("cmp trié", cmp.every((l, i) => i === 0 || cmp[i - 1].total <= l.total), true);
const premiereReelle = cmp.find((l) => l.option !== "communaute_universelle");
verifier("auto = meilleure option", simulerSuccession({ ...cas7, optionConjoint: "auto" }).optionRetenue, premiereReelle.option);
verifier("cmp hors mariage", comparerOptionsConjoint({ situation: "seul", enfants: 1 }), []);
// 16. Pureté
const entree = JSON.parse(JSON.stringify({ ...cas7, optionConjoint: "auto", donations: [{ annee: 2018, montant: 50000 }], assuranceVie: { avant70: 100000 } }));
const avant = JSON.stringify(entree);
simulerSuccession(entree); comparerOptionsConjoint(entree); simulerDonationNP({ valeur: 1, ageDonateur: 60, enfants: 1, donations: entree.donations });
verifier("pureté", JSON.stringify(entree), avant);

// 17. Adaptateur profil -> entrée (profil minimal équivalent à PROFIL_EXEMPLE : app.js n'est pas importable hors navigateur)
const profilExemple = { age: 32, enfants: 0, proprietaire: false, placements: { livretA: 22950, ldds: 12000, livretBancaire: 5050, assuranceVie: 25000, assuranceVieUC: 0, pea: 30000, plateformeCrypto: 5000, per: 0 }, assuranceVie: { versementsApres70: 0 }, logement: { usage: "rp", part: 100, valeur: null, creditRestant: 0 }, foyer: { actif: false, statut: "marie" }, conjoint: { age: 31, pea: { ouvert: false, versements: 0 } }, succession: {} };
const copieExemple = JSON.stringify(profilExemple);
const eEx = entreeDepuisProfil(profilExemple, 2026);
verifier("adaptateur exemple : seul", eEx.situation, "seul");
verifier("adaptateur exemple : actifs propres", eEx.actifs.every((a) => a.nature === "propre"), true);
verifier("adaptateur exemple : assurance-vie", eEx.assuranceVie.avant70, 25000);
verifier("adaptateur exemple : masse >= 0", simulerSuccession(eEx).masse.masseNette >= 0, true);
verifier("adaptateur : profil vide", simulerSuccession(entreeDepuisProfil({}, 2026)).totalDroits, 0);
verifier("adaptateur : pas de mutation", JSON.stringify(profilExemple), copieExemple);
const profilMarie = { age: 55, enfants: 2, proprietaire: true, logement: { usage: "rp", part: 50, valeur: 400000, creditRestant: 100000 }, placements: { livretA: 30000, pea: 70000, assuranceVie: 90000, per: 10000 }, assuranceVie: { versementsApres70: 0 }, foyer: { actif: true, statut: "marie" }, conjoint: { age: 52, pea: { ouvert: true, versements: 20000 } }, succession: { union: "mariage", regime: "communaute_legale", biensPropres: 60000, quotiteAssuranceEmprunteur: 50, clauseAV: "enfants", donationAnterieure: { annee: 2018, montantParEnfant: 30000 } } };
const copieMarie = JSON.stringify(profilMarie);
const eM = entreeDepuisProfil(profilMarie, 2026);
verifier("adaptateur marié : mariage", eM.situation, "mariage");
verifier("adaptateur marié : RP part 50 %", eM.actifs.find((a) => a.rp).valeur, 200000);
verifier("adaptateur marié : RP commune", eM.actifs.find((a) => a.rp).nature, "commun");
const propre = eM.actifs.find((a) => a.nature === "propre");
verifier("adaptateur marié : biens propres transférés", propre.valeur, 60000);
verifier("adaptateur marié : total conservé (PEA du conjoint non ajouté)", eM.actifs.reduce((s, a) => s + a.valeur, 0), 200000 + 30000 + 70000);
verifier("adaptateur marié : pas de ligne « PEA du conjoint » (déjà dans les placements du foyer)", eM.actifs.some((a) => a.libelle === "PEA du conjoint"), false);
verifier("adaptateur marié : dette selon quotité assurée", eM.dettes[0].montant, 50000);
verifier("adaptateur marié : donation rappelée", eM.donations, [{ annee: 2018, montant: 30000 }]);
verifier("adaptateur marié : PER", eM.per.valeur, 10000);
verifier("adaptateur marié : simulation sans erreur", simulerSuccession(eM).heritiers.length, 3);
verifier("adaptateur marié : pas de mutation", JSON.stringify(profilMarie), copieMarie);
const eSep = entreeDepuisProfil({ ...profilMarie, succession: { ...profilMarie.succession, regime: "separation" } }, 2026);
verifier("adaptateur séparation : placements du foyer en commun, logement propre", eSep.actifs.filter((a) => a.libelle !== "Logement" && a.libelle !== "Biens propres déclarés").every((a) => a.nature === "commun") && eSep.actifs.find((a) => a.libelle === "Logement").nature === "propre", true);
verifier("adaptateur séparation : biens propres transférés aussi", eSep.actifs.find((a) => a.libelle === "Biens propres déclarés")?.valeur, 60000);
verifier("adaptateur séparation : patrimoine propre du conjoint nul", eSep.patrimoineConjoint.propre, 0);
verifier("adaptateur PACS", entreeDepuisProfil({ ...profilMarie, succession: { union: "pacs" } }, 2026).situation, "pacs");
verifier("adaptateur concubin", entreeDepuisProfil({ ...profilMarie, foyer: { actif: true, statut: "concubin" } }, 2026).situation, "concubin");

// 18. Droits sur le registre final d'une décumulation
const regFinal = { livrets: { valeur: 20000 }, av: { avant70: { valeur: 150000, primes: 100000 }, apres70: { valeur: 0, primes: 0 } }, pea: { valeur: 100000, versements: 100000 }, cto: { valeur: 50000, base: 50000 }, per: { valeur: 0, versementsDeduits: 0 }, autres: [{ id: "scpi", valeur: 30000, base: 30000, taux: 0 }] };
const profilReg = { age: 60, enfants: 2, proprietaire: false, placements: { livretA: 1 }, foyer: { actif: false }, succession: {} };
const copieReg = JSON.stringify({ profilReg, regFinal });
const dR = droitsSurRegistre(profilReg, regFinal, { annee: 2056, ageDefunt: 90 });
const equiv = simulerSuccession({ annee: 2056, ageDefunt: 90, situation: "seul", enfants: 2, clauseAV: "enfants",
  actifs: [{ valeur: 20000, nature: "propre" }, { valeur: 100000, nature: "propre" }, { valeur: 50000, nature: "propre" }, { valeur: 30000, nature: "propre" }],
  assuranceVie: { avant70: 150000 - 50000 * 0.172, apres70Primes: 0 } });
verifier("registre : droits = succession équivalente", dR.totalDroits, equiv.totalDroits);
verifier("registre : net transmis cohérent", dR.netTransmis, equiv.netTransmis);
verifier("registre : droits imputables aux placements", dR.droitsPlacements, dR.totalDroits);
verifier("registre : pas de mutation", JSON.stringify({ profilReg, regFinal }), copieReg);
verifier("registre : seul sans enfant, 0 droit", droitsSurRegistre({ age: 60, enfants: 0, foyer: { actif: false } }, regFinal, { annee: 2056, ageDefunt: 90 }).totalDroits, 0);
verifier("registre : échelle réduit les droits", droitsSurRegistre(profilReg, regFinal, { annee: 2056, ageDefunt: 90, echelle: 0.5 }).totalDroits <= dR.totalDroits, true);
verifier("registre : registre vide", droitsSurRegistre(profilReg, {}, { annee: 2056, ageDefunt: 90 }).totalDroits, 0);

// 19. Correctifs de revue
// E3 : donation de nue-propriété et reste de la succession (1 enfant, 62 ans, 300 000 €, N = 5, croissance 0, 400 000 € d'autres biens)
//  sans donation : base 700 000 − 100 000 = 600 000 → 1 380,75 + (552 324 − 15 932) × 20 % + (600 000 − 552 324) × 30 % = 122 961,95
//  donation : 180 000 de nue-propriété − 100 000 = 80 000 → 14 194,35 ; au décès, donation rappelée (5 ans < 15) : abattement 0, déjà taxé 80 000
//  droitsBareme(400 000, 80 000) = impôt(480 000) − impôt(80 000) = (1 380,75 + 92 813,60) − 14 194,35 = 80 000
//  économie = 122 961,95 − 14 194,35 − 80 000 = 28 767,60
const dR2 = simulerDonationNP({ valeur: 300000, ageDonateur: 62, enfants: 1, annee: 2026, anneesAvantDeces: 5, croissance: 0, autresBiensParEnfant: 400000 });
verifier("donation + reste : sans donation", dR2.droitsSansDonation, 122961.95);
verifier("donation + reste : droits à la donation", dR2.droitsDonation, 14194.35);
verifier("donation + reste : droits au décès avec donation", dR2.droitsDecesAvecDonation, 80000);
verifier("donation + reste : économie", dR2.economie, 28767.6);
const dR3 = simulerDonationNP({ valeur: 300000, ageDonateur: 62, enfants: 1, annee: 2026 });
verifier("donation seule inchangée", [dR3.droitsDonation, dR3.droitsSansDonation, dR3.economie, dR3.droitsDecesAvecDonation], [14194.35, 38194.35, 24000, 0]);
// E7 : donation datée dans le futur non rappelée
verifier("rappel : donation future ignorée", rappelFiscal([{ annee: 2027, montant: 60000 }], 2026).abattement, 100000);
// E4 : concubin en vue « moi » (normaliserFoyer le ramène à « seul » pour le budget, mais la situation réelle est conservée)
const profilMoi = { age: 50, enfants: 1, proprietaire: false, placements: { pea: 100000, assuranceVie: 40000 }, foyer: { actif: true, statut: "concubin", vue: "moi" }, conjoint: { age: 48, pea: { ouvert: true, versements: 15000 } }, succession: { testament: true, clauseAV: "conjoint_puis_enfants" } };
const moiNorm = normaliserFoyer(PLAN, profilMoi);
verifier("concubin vue moi : brut", entreeDepuisProfil(profilMoi, 2026).situation, "concubin");
verifier("concubin vue moi : normalisé", entreeDepuisProfil(moiNorm, 2026).situation, "concubin");
verifier("concubin vue moi : placements propres", entreeDepuisProfil(profilMoi, 2026).actifs.every((a) => a.nature === "propre"), true);
verifier("concubin vue foyer : placements communs", entreeDepuisProfil({ ...profilMoi, foyer: { actif: true, statut: "concubin", vue: "foyer" } }, 2026).actifs.every((a) => a.nature === "commun"), true);
verifier("concubin vue moi : droitsSurRegistre = même situation", droitsSurRegistre(moiNorm, regFinal, { annee: 2056, ageDefunt: 80 }).totalDroits, simulerSuccession({ ...entreeDepuisProfil({ ...profilMoi, age: 80, placements: { livretBancaire: 20000, pea: 100000, cto: 50000, scpi: 30000, assuranceVie: 150000 - 8600 }, conjoint: { age: 78 } }, 2056) }).totalDroits - simulerSuccession(entreeDepuisProfil({ ...profilMoi, age: 80, placements: {}, conjoint: { age: 78 } }, 2056)).totalDroits, 0.01);
// E6 : âge du conjoint absent, décalage de 30 ans compté une seule fois (usufruit à 85 ans = 30 %, et non à 115 ans)
const mariePArg = { age: 55, enfants: 2, proprietaire: false, foyer: { actif: true, statut: "marie" }, conjoint: { pea: { ouvert: false } }, placements: {}, succession: { optionConjoint: "usufruit", clauseAV: "enfants" } };
const regSimple = { livrets: { valeur: 600000 } };
const attendu6 = simulerSuccession({ annee: 2056, ageDefunt: 85, situation: "mariage", ageConjoint: 85, enfants: 2, optionConjoint: "usufruit", clauseAV: "enfants", actifs: [{ valeur: 600000, nature: "commun" }] }).totalDroits;
verifier("âge conjoint absent : ageInitial + décalage", droitsSurRegistre(mariePArg, regSimple, { annee: 2056, ageDefunt: 85 }).totalDroits, attendu6);
// E8 : réserve d'AV transmissible
const resA = (situationFoyer, clause, enfants = 2) => reserveAVTransmissible({ enfants, foyer: situationFoyer, succession: { clauseAV: clause } });
verifier("réserve AV : marié, clause conjoint", resA({ actif: true, statut: "marie" }, "conjoint_puis_enfants"), 0);
verifier("réserve AV : marié, clause enfants", resA({ actif: true, statut: "marie" }, "enfants"), 305000);
verifier("réserve AV : concubin, clause conjoint", resA({ actif: true, statut: "concubin" }, "conjoint_puis_enfants"), 152500);
verifier("réserve AV : seul, 2 enfants", resA({ actif: false }, "conjoint_puis_enfants"), 305000);
verifier("réserve AV : seul sans enfant", resA({ actif: false }, "enfants", 0), 152500);

console.log(`${ok} vérifications réussies, ${ko} échec(s)`);
process.exit(ko ? 1 : 0);
