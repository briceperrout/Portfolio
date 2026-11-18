// Tests de l'immobilier (charges du propriétaire, PTZ, lissage, acheter ou louer) — node test_immobilier.mjs
import { PLAN } from "./plan.js";
import { PFU, PRELEVEMENTS } from "./fiscal.js";
import { normaliserFoyer, chargesProprietaire, pretTauxZero, lisserPTZ, financement } from "./moteur.js";
import { acheterOuLouer, comparaisonAchatLocation } from "./projection.js";
import { mensualitePret } from "./locatif.js";
import { FICHES } from "./fiches.js";
import { LEXIQUE } from "./lexique.js";
import { readFileSync, readdirSync } from "node:fs";
import { chargerPrix, chargerDepartement, departementCharge, departementDe, definirLecteur, reinitialiser, chercherCommunes, libelleCommune, estimer, estimerLoyer } from "./immobilier.js";

let ok = 0, ko = 0;
const verifier = (nom, obtenu, attendu, tol = 1) => {
  const bon = typeof attendu === "number" ? Math.abs(obtenu - attendu) <= tol : obtenu === attendu;
  if (bon) ok++; else { ko++; console.log(`ÉCHEC ${nom} : obtenu ${obtenu}, attendu ${attendu}`); }
};

// Charges du propriétaire
let c = chargesProprietaire(PLAN, { prix: 300000, typeLogement: "appartement", surface: 60, loyerMarcheMensuel: 1000 });
verifier("charges appart TF", c.taxeFonciere, 1000);
verifier("charges appart copro", c.copro, 900);
verifier("charges appart entretien", c.entretien, 2400);
verifier("charges appart total", c.totalAnnuel, 4300);
verifier("charges appart mensuel", c.totalMensuel, 358.33);
verifier("charges source marché", c.sourceLoyer, "marche");
c = chargesProprietaire(PLAN, { prix: 300000, typeLogement: "maison", surface: 100, loyerMarcheMensuel: 1200 });
verifier("charges maison TF", c.taxeFonciere, 1200);
verifier("charges maison copro", c.copro, 0);
verifier("charges maison entretien", c.entretien, 3000);
verifier("charges maison total", c.totalAnnuel, 4200);
c = chargesProprietaire(PLAN, { prix: 300000 });
verifier("loyer par défaut", c.loyerMarcheRetenu, 1000);
verifier("source défaut", c.sourceLoyer, "defaut");
verifier("surface par défaut", c.copro, 900);
c = chargesProprietaire(PLAN, { prix: 300000, typeLogement: "appartement", surface: 60, loyerMarcheMensuel: 1000, chargesCoproMensuelles: 100 });
verifier("copro saisie", c.copro, 1200);

// PTZ
let z = pretTauxZero(PLAN, { coutOperation: 300000, pretTotal: 250000, zone: "A", tranche: 1, typeOperation: "collectifNeuf", personnes: 2 });
verifier("ptz éligible", z.eligible, true);
verifier("ptz plafond", z.plafondOperation, 225000);
verifier("ptz quotité", z.quotite, 50);
verifier("ptz montant", z.montant, 112500);
verifier("ptz différé", z.differe, 10);
verifier("ptz remboursement", z.remboursement, 15);
verifier("ptz mensualité", z.mensualiteRemboursement, 625);
z = pretTauxZero(PLAN, { coutOperation: 300000, pretTotal: 200000, zone: "A", tranche: 1, typeOperation: "collectifNeuf", personnes: 2 });
verifier("ptz plafonné au prêt/2", z.montant, 100000);
z = pretTauxZero(PLAN, { coutOperation: 200000, pretTotal: 150000, zone: "A", tranche: 1, typeOperation: "ancienTravaux", personnes: 1, travauxPctCout: 30 });
verifier("ptz ancien zone A", z.eligible, false);
verifier("ptz ancien zone A raison", z.raisons.some((r) => /zone/i.test(r)), true);
z = pretTauxZero(PLAN, { coutOperation: 120000, pretTotal: 120000, zone: "C", tranche: 2, typeOperation: "ancienTravaux", personnes: 1, travauxPctCout: 30 });
verifier("ptz ancien C éligible", z.eligible, true);
verifier("ptz ancien C plafond", z.plafondOperation, 100000);
verifier("ptz ancien C montant", z.montant, 40000);
z = pretTauxZero(PLAN, { coutOperation: 120000, pretTotal: 120000, zone: "C", tranche: 2, typeOperation: "ancienTravaux", personnes: 1, travauxPctCout: 10 });
verifier("ptz travaux insuffisants", z.eligible, false);
z = pretTauxZero(PLAN, { coutOperation: 300000, pretTotal: 250000, zone: "A", tranche: 5, typeOperation: "collectifNeuf", personnes: 2 });
verifier("ptz tranche 5", z.eligible, false);
z = pretTauxZero(PLAN, { coutOperation: 300000, pretTotal: 250000, zone: "Abis", tranche: 1, typeOperation: "collectifNeuf" });
verifier("ptz Abis = A", z.plafondOperation, 150000);

// Lissage du PTZ
const i = 0.035 / 12, act = (k) => (1 - Math.pow(1 + i, -k)) / i;
let L = lisserPTZ({ pretBancaire: 137500, tauxAnnuel: 3.5, dureeMois: 300, ptz: 112500, differeMois: 120, remboursementMois: 180 });
verifier("lissage M", L.mensualiteLissee, 996.97);
verifier("lissage possible", L.lissageImpossible, false);
let pvBanque = 0, sommePtz = 0, ecartMax = 0;
for (let m = 1; m <= 300; m++) {
  pvBanque += L.bancaireParMois(m) * Math.pow(1 + i, -m);
  sommePtz += L.ptzParMois(m);
  ecartMax = Math.max(ecartMax, Math.abs(L.bancaireParMois(m) + L.ptzParMois(m) - L.mensualiteLissee));
}
verifier("lissage valeur actualisée banque", pvBanque, 137500, 0.5);
verifier("lissage somme PTZ", sommePtz, 112500, 0.5);
verifier("lissage total constant", ecartMax, 0, 0.001);
verifier("lissage mensualité annuelle", L.mensualitesAnnuelles[0], L.mensualiteLissee, 0.01);
verifier("lissage restant dû début", L.restantDu(-1), 250000, 0.5);
verifier("lissage restant dû fin", L.restantDu(24), 0, 0.5);
L = lisserPTZ({ pretBancaire: 250000, tauxAnnuel: 3.5, dureeMois: 300, ptz: 0, differeMois: 0, remboursementMois: 0 });
verifier("sans PTZ annuité", L.mensualiteLissee, 1251.6, 0.5);
verifier("sans PTZ = locatif.js", L.mensualiteLissee, mensualitePret(250000, 3.5, 25), 0.01);

// Financement sans PTZ : même sortie qu'avant, plus mensualites et ptz null
for (const [prix, type, age, salaire, autres] of [[320000, "ancien", 30, 4000, 0], [250000, "neuf", 40, 5000, 300], [500000, "ancien", 30, 6000, 0]]) {
  const f = financement(PLAN, prix, type, age, salaire, autres);
  verifier(`financement ptz null (${prix})`, f.ptz, null);
  verifier(`financement mensualites (${prix})`, f.mensualites.length, f.duree, 0);
}
// Financement avec PTZ
{
  const sans = financement(PLAN, 300000, "neuf", 30, 6000, 0);
  const avec = financement(PLAN, 300000, "neuf", 30, 6000, 0, { zone: "B1", tranche: 2, typeOperation: "collectifNeuf", personnes: 2 });
  verifier("financement ptz éligible", avec.ptz?.eligible, true);
  verifier("financement pretBancaire", avec.pretBancaire, sans.pret - avec.ptz.montant, 0.01);
  verifier("financement mensualité plus basse", avec.mensualite < sans.mensualite, true);
  verifier("financement restantDu fin", avec.restantDu(avec.mensualites.length - 1), 0, 0.5);
}

// Acheter ou louer, cas à la main
let r = acheterOuLouer(PLAN, { prix: 100000, apportInitial: 108000, mensualites: [], restantDu: () => 0, charges: { taxeFonciere: 0, copro: 0, entretien: 0 }, loyerMensuel: 500, rendement: 0, valorisation: 0, inflation: 0, horizon: 5, fraisReventePct: 0 });
verifier("AoL acheteur(1)", r.serie[1].patrimoineAcheteur, 106000);
verifier("AoL acheteur(5)", r.serie[5].patrimoineAcheteur, 130000);
verifier("AoL locataire(3)", r.serie[3].patrimoineLocataire, 108000);
verifier("AoL point mort", r.pointMort, 2, 0);
verifier("AoL recroise", r.recroise, false);
// Fiscalité du portefeuille : PFU avant 5 ans, 18,6 % ensuite (PEA)
r = acheterOuLouer(PLAN, { prix: 0, apportInitial: 10000, mensualites: [], restantDu: () => 0, charges: null, loyerMensuel: 0, rendement: 8, valorisation: 0, inflation: 0, horizon: 6, fraisReventePct: 0 });
const brut = (t) => 10000 * Math.pow(1.08, t);
verifier("AoL locataire(4) PFU", r.serie[4].patrimoineLocataire, brut(4) - (brut(4) - 10000) * PFU / 100);
verifier("AoL locataire(5) 18,6 %", r.serie[5].patrimoineLocataire, brut(5) - (brut(5) - 10000) * PRELEVEMENTS.PS_CAPITAL / 100);
// Garde-fous
r = acheterOuLouer(PLAN, { prix: 0, apportInitial: 0, mensualites: [], loyerMensuel: 0, horizon: 3 });
r = acheterOuLouer(PLAN, { prix: 100000, apportInitial: 10000, mensualites: null, restantDu: () => 0, loyerMensuel: 500, horizon: 3 });
verifier("AoL mensualites null", r.serie.every((x) => Number.isFinite(x.patrimoineAcheteur)), true);
verifier("AoL sans NaN", r.serie.every((x) => Number.isFinite(x.patrimoineAcheteur) && Number.isFinite(x.patrimoineLocataire)), true);

// Garde-fous : un crédit sans restantDu valide est une erreur, pas un 0 silencieux
const leve = (f) => { try { f(); return false; } catch { return true; } };
verifier("AoL crédit sans restantDu", leve(() => acheterOuLouer(PLAN, { prix: 100000, apportInitial: 10000, mensualites: [500], loyerMensuel: 500 })), true);
verifier("AoL restantDu NaN", leve(() => acheterOuLouer(PLAN, { prix: 100000, apportInitial: 10000, mensualites: [500], restantDu: () => NaN, loyerMensuel: 500 })), true);

// De bout en bout : même chemin que l'application (achatPourProjection puis comparaisonAchatLocation)
for (const ptz of [false, true]) {
  const profil = normaliserFoyer(PLAN, { age: 30, salaireNetMensuel: 4500, epargneMensuelle: 1500, loyerMensuel: 900, creditsMensuels: 0, placements: { livretA: 40000 }, pea: { ouvert: false, versements: 0 }, assuranceVie: {}, enfants: 0,
    projetRP: { actif: true, prix: 285000, type: "ancien", imperatif: true, horizonAnnees: 1, aideFamiliale: 0, typeLogement: "appartement", surface: 60, loyerEquivalent: 1000, ptz: { actif: ptz, zone: "C", tranche: 2, typeOperation: "ancienTravaux", personnes: 2, travauxPctCout: 30 } } });
  const C = comparaisonAchatLocation(PLAN, profil);
  const nom = `E2E${ptz ? " PTZ" : ""}`;
  verifier(`${nom} calculé`, !!C?.resultat, true);
  if (C?.resultat) {
    const d0 = C.restantDu(0), r1 = C.resultat.serie[1];
    verifier(`${nom} restantDu(0) ≤ prêt`, d0 <= C.ap.pret + 0.5, true);
    verifier(`${nom} restantDu(0) ≥ 0,9 × prêt`, d0 >= 0.9 * C.ap.pret, true);
    verifier(`${nom} acheteur(1) < locataire(1)`, r1.patrimoineAcheteur < r1.patrimoineLocataire, true);
    verifier(`${nom} point mort ≠ 1`, C.resultat.pointMort !== 1, true);
  }
}

// Frais annexes, frais de revente et point de départ t = 0
for (const ptz of [false, true]) {
  const profil = normaliserFoyer(PLAN, { age: 30, salaireNetMensuel: 4500, epargneMensuelle: 1500, loyerMensuel: 900, creditsMensuels: 0, placements: { livretA: 40000 }, pea: { ouvert: false, versements: 0 }, assuranceVie: {}, enfants: 0,
    projetRP: { actif: true, prix: 285000, type: "ancien", imperatif: true, horizonAnnees: 1, aideFamiliale: 0, typeLogement: "appartement", surface: 60, loyerEquivalent: 1000, ptz: { actif: ptz, zone: "C", tranche: 2, typeOperation: "ancienTravaux", personnes: 2, travauxPctCout: 30 } } });
  const C = comparaisonAchatLocation(PLAN, profil);
  const nom = `t=0${ptz ? " PTZ" : ""}`;
  const A = PLAN.achatRP, p0 = C.resultat.serie[0];
  verifier(`${nom} année 0`, p0.annee, 0, 0);
  verifier(`${nom} fraisAnnexes`, C.fraisAnnexes, C.ap.pret * A.fraisGarantiePctPret / 100 + A.fraisDossier, 0.01);
  verifier(`${nom} fraisNotaire`, C.fraisNotaire, C.ap.prix * A.fraisNotairePourcent.ancien / 100, 0.01);
  verifier(`${nom} acheteur = prix × 0,95 − prêt`, p0.patrimoineAcheteur, C.ap.prix * 0.95 - C.ap.pret, 1);
  verifier(`${nom} locataire = apport requis + frais annexes`, p0.patrimoineLocataire, C.ap.apportRequis + C.fraisAnnexes, 1);
}

// Invariant d'effort égal (rendement, inflation et valorisation nuls) : écart des versements = Σ(coût propriétaire − loyer)
{
  const M = Array.from({ length: 20 }, () => 1200), loyer = 900, charges = { taxeFonciere: 1200, copro: 600, entretien: 0 };
  const dette = (k) => 200000 * Math.max(0, 1 - (k + 1) / 20);
  const rr = acheterOuLouer(PLAN, { prix: 250000, apportInitial: 20000, mensualites: M, restantDu: (k) => (k < 0 ? 200000 : dette(k)), charges, loyerMensuel: loyer, rendement: 0, valorisation: 0, inflation: 0, horizon: 25 });
  let somme = 0;
  for (let k = 0; k < 25; k++) somme += 12 * ((M[k] ?? 0) + (charges.taxeFonciere + charges.copro) / 12 - loyer);
  const f = rr.serie[25];
  verifier("effort égal : Δversements = Σ(coût − loyer)", f.versementsLocataireCumules - f.versementsAcheteurCumules, somme, 1);
  verifier("effort égal : t=0 dette initiale", rr.serie[0].dette, 200000, 0.01);
}

// Le point mort ne recule jamais quand on ajoute des frais
{
  const profil = normaliserFoyer(PLAN, { age: 30, salaireNetMensuel: 4500, epargneMensuelle: 1500, loyerMensuel: 900, creditsMensuels: 0, placements: { livretA: 40000 }, pea: { ouvert: false, versements: 0 }, assuranceVie: {}, enfants: 0,
    projetRP: { actif: true, prix: 285000, type: "ancien", imperatif: true, horizonAnnees: 1, aideFamiliale: 0, typeLogement: "appartement", surface: 60, loyerEquivalent: 1000, ptz: { actif: false } } });
  const sans = structuredClone(PLAN); sans.achatRP.fraisReventePct = 0; sans.achatRP.fraisGarantiePctPret = 0; sans.achatRP.fraisDossier = 0;
  const pmSans = comparaisonAchatLocation(sans, profil).resultat.pointMort, pmAvec = comparaisonAchatLocation(PLAN, profil).resultat.pointMort;
  verifier("point mort avec frais ≥ sans frais", pmAvec === null || (pmSans !== null && pmAvec >= pmSans), true);
}

// Fiches et lexique
const ids = new Set(FICHES.map((f) => f.id));
for (const id of ["ptz", "acheter-louer", "independants"]) verifier(`fiche ${id} existe`, ids.has(id), true);
verifier("ids de fiches uniques", ids.size, FICHES.length, 0);
for (const f of FICHES.filter((x) => ["ptz", "acheter-louer", "independants"].includes(x.id))) verifier(`fiche ${f.id} complète`, !!(f.titre && f.accroche && f.role && f.essentiel?.length && f.sections?.length && f.sources?.length), true);
for (const e of LEXIQUE.filter((x) => x.fiche)) verifier(`lexique « ${e.mot} » → fiche ${e.fiche}`, ids.has(e.fiche), true);
for (const mot of ["PTZ", "Point mort", "TNS", "Madelin", "Micro-entreprise"]) verifier(`lexique « ${mot} » lié à une fiche`, !!LEXIQUE.find((e) => e.mot === mot)?.fiche, true);

// Données DVF découpées (dvf/ généré par outils/decouper-dvf.py), chargées à la demande
const lireDisque = (chemin) => Promise.resolve(JSON.parse(readFileSync(new URL(`./${chemin}`, import.meta.url), "utf-8")));
const source = JSON.parse(readFileSync(new URL("./prix-m2.json", import.meta.url), "utf-8"));
const relance = "relance python3 outils/decouper-dvf.py";
{
  const meta = await lireDisque("dvf/meta.json"), index = await lireDisque("dvf/index.json");
  const vues = new Map(); let identiques = true;
  for (const f of readdirSync(new URL("./dvf/", import.meta.url)).filter((n) => n.endsWith(".json") && !["meta.json", "index.json"].includes(n))) {
    const lignes = await lireDisque(`dvf/${f}`);
    for (const [code, l] of Object.entries(lignes)) {
      vues.set(code, (vues.get(code) ?? 0) + 1);
      if (JSON.stringify(l) !== JSON.stringify(source.communes[code]) || l[1] !== f.replace(".json", "")) identiques = false;
    }
  }
  const codes = Object.keys(source.communes);
  verifier(`dvf : chaque commune dans exactement un département (${relance})`, vues.size === codes.length && codes.every((k) => vues.get(k) === 1), true);
  verifier(`dvf : lignes identiques à la source (${relance})`, identiques, true);
  verifier(`dvf : index de même cardinalité (${relance})`, index.length, codes.length, 0);
  verifier(`dvf : index sans doublon (${relance})`, new Set(index.map((e) => e[1])).size, codes.length, 0);
  verifier(`dvf : départements identiques (${relance})`, JSON.stringify(meta.departements) === JSON.stringify(source.departements), true);
  verifier(`dvf : période et source (${relance})`, meta.periode === source.periode && meta.source === source.source, true);
  for (const d of ["57", "67", "68"]) verifier(`dvf : ${d} hors DVF`, meta.horsDvf.includes(d), true);

  reinitialiser(); definirLecteur(lireDisque);
  verifier("recherche avant chargement", chercherCommunes("paris").length, 0, 0);
  await chargerPrix();
  const paris = chercherCommunes("paris");
  verifier("chercherCommunes « paris » sans département chargé", paris.length > 0 && paris.some((r) => r.dep === "75"), true);
  const arr = paris.find((r) => r.dep === "75");
  verifier("libelleCommune sans département chargé", libelleCommune(arr.code).startsWith("Paris"), true);
  verifier("recherche par code postal sans département chargé", chercherCommunes("75008").some((r) => r.dep === "75"), true);
  verifier("departementDe via le code commune", departementDe({ codeInsee: arr.code }), "75");
  verifier("departementDe du département saisi", departementDe({ departement: "33" }), "33");

  const lieu75 = { departement: "75", codeInsee: arr.code, typeLogement: "appartement", surface: 50 };
  verifier("estimer null avant chargerDepartement", estimer(lieu75), null);
  verifier("departementCharge avant", departementCharge("75"), false);
  await chargerDepartement("75");
  verifier("departementCharge après", departementCharge("75"), true);
  const e75 = estimer(lieu75);
  verifier("estimer 75 après chargement", e75 && e75.m2 > 3000 && e75.prix > 0, true);
  verifier("chargerDepartement mémorisé", chargerDepartement("75") === chargerDepartement("75"), true);

  const c67 = Object.entries(source.communes).find(([, l]) => l[1] === "67" && l[5]);
  const lieu67 = { departement: "67", codeInsee: c67[0], typeLogement: "appartement", surface: 60 };
  verifier("estimer 67 : horsDvf", estimer(lieu67)?.horsDvf === true && estimer(lieu67).introuvable === true, true);
  await chargerDepartement("67");
  verifier("estimer 67 après chargement : horsDvf", estimer(lieu67)?.horsDvf, true);
  const l67 = estimerLoyer(lieu67);
  verifier("estimerLoyer 67 : loyer de la commune", l67 && l67.m2 > 0 && l67.echelle !== "departement", true);

  // Échec réseau : nouvel essai possible
  reinitialiser(); let pannes = 0;
  definirLecteur((c) => (c === "dvf/33.json" && pannes++ === 0 ? Promise.reject(new Error("HTTP 500")) : lireDisque(c)));
  await chargerPrix();
  let echec = false; await chargerDepartement("33").catch(() => { echec = true; });
  verifier("échec de chargement signalé", echec, true);
  await chargerDepartement("33");
  verifier("nouvel essai après échec", departementCharge("33"), true);
  reinitialiser();
}

console.log(`${ok} tests réussis, ${ko} échecs`);
process.exit(ko ? 1 : 0);
