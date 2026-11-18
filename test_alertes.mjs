// Tests du centre d'alertes proactives (alertes.js) — `node test_alertes.mjs`
import { readFileSync } from "node:fs";
import { PLAN } from "./plan.js";
import { PLAFONDS } from "./fiscal.js";
import { detecterAlertes, livretsPleins, derive, av70, fenetreCTO, bilanMensuel, dernierJourCession, SEUIL_DERIVE, desequilibre as desequilibreCharges, SEUIL_DESEQUILIBRE } from "./alertes.js";
import { echeancesProfil, versCSV } from "./calendrier.js";
import { equilibreContributions, normaliserFoyer } from "./moteur.js";
import { prevuA, moisEntre } from "./projection.js";
import { MARCHE, PLUS_VALUES } from "./fiscal.js";

let ok = 0, ko = 0;
const verifier = (condition, nom) => { if (condition) ok++; else { ko++; console.log(`ÉCHEC ${nom}`); } };

// Profil de départ : PROFIL_EXEMPLE lu dans app.js (non importable en Node : il touche au DOM), comme test_niveaux.mjs
const appSrc = ["./app.js", "./ui/commun.js"].map((f) => readFileSync(new URL(f, import.meta.url), "utf8")).join("\n"); // les profils par défaut vivent dans ui/commun.js
const clone = (x) => JSON.parse(JSON.stringify(x));
const ligne = (nom) => appSrc.match(new RegExp(`^(?:export )?const ${nom} = (\\{.*\\});$`, "m"))?.[1];
const PTZ_DEFAUT = new Function(`return ${ligne("PTZ_DEFAUT")};`)();
const SUCCESSION_DEFAUT = new Function(`return ${ligne("SUCCESSION_DEFAUT")};`)();
const brut = appSrc.match(/const PROFIL_EXEMPLE = (\{\n[\s\S]*?\n\});/)?.[1];
const EXEMPLE = new Function("PTZ_DEFAUT", "clone", "SUCCESSION_DEFAUT", `return ${brut};`)(PTZ_DEFAUT, clone, SUCCESSION_DEFAUT);
verifier(EXEMPLE && EXEMPLE.placements, "profil exemple lu dans app.js");

const AUJOURDHUI = new Date("2026-11-17");
const profilAvec = (placements = {}, reste = {}) => ({ ...clone(EXEMPLE), ...reste, placements: { ...clone(EXEMPLE.placements), ...placements } });
const ids = (liste) => liste.map((a) => a.id);
const detecter = (p) => detecterAlertes(PLAN, p, { aujourdhui: AUJOURDHUI });

// Livrets
let a = detecter(profilAvec({ livretA: 23000 }, { age: 40 }));
verifier(ids(a).includes("livret-livretA"), "livretA 23 000 € : alerte livretA");
const la = a.find((x) => x.id === "livret-livretA");
verifier(la?.cle === "livretA:2026" && la.min === null && la.niveau === "info", "livretA : cle, min null, niveau info");
verifier(/refusé/.test(la?.texte ?? "") && /acquis/.test(la?.texte ?? "") && !/irrégulier|illégal/.test(la?.texte ?? ""), "livretA : texte (refusé, acquis, jamais « irrégulier »)");
verifier(!ids(detecter(profilAvec({ livretA: 10000 }, { age: 40 }))).includes("livret-livretA"), "livretA 10 000 € : aucune alerte livretA");
verifier(ids(detecter(profilAvec({ ldds: PLAFONDS.ldds }, { age: 40 }))).includes("livret-ldds"), "ldds au plafond exact : alerte");
verifier(!ids(detecter(profilAvec({ lep: 0 }, { age: 40 }))).includes("livret-lep"), "LEP absent : aucune alerte");
verifier(ids(detecter(profilAvec({ lep: PLAFONDS.lep }, { age: 40 }))).includes("livret-lep"), "LEP plein : alerte");

// Assurance-vie, 70 ans
a = detecter(profilAvec({}, { age: 68 }));
const v = a.find((x) => x.id === "av70");
verifier(!!v && v.texte.includes("2 an") && v.cle === "av70:68" && v.min === "intermediaire", "âge 68 : av70, « 2 an », cle et min");
verifier(!ids(detecter(profilAvec({}, { age: 65 }))).includes("av70"), "âge 65 : aucune alerte av70");
verifier(!ids(detecter(profilAvec({}, { age: 71 }))).includes("av70"), "âge 71 : aucune alerte av70");
const couple = profilAvec({}, { age: 40, foyer: { actif: true, statut: "marie" }, conjoint: { ...clone(EXEMPLE.conjoint), age: 67 } });
verifier(ids(detecter(couple)).includes("av70-conjoint") && !ids(detecter(couple)).includes("av70"), "conjoint de 67 ans : av70-conjoint seul");
verifier(!ids(detecter(profilAvec({}, { age: 40, conjoint: { ...clone(EXEMPLE.conjoint), age: 67 } }))).includes("av70-conjoint"), "foyer inactif : pas d'alerte pour le conjoint");

// Dérive d'allocation
const desequilibre = profilAvec({ livretA: 2000, ldds: 0, livretBancaire: 0, assuranceVie: 0, pea: 150000, cto: 0, plateformeCrypto: 0 }, { age: 40 });
const dv = derive(PLAN, desequilibre, AUJOURDHUI);
verifier(dv.length === 1 && dv[0].min === "intermediaire" && dv[0].cle === "derive:2026-11" && dv[0].vue === "reequilibrage", "profil très déséquilibré : derive présente");
verifier(ids(detecter(desequilibre)).includes("derive"), "detecterAlertes inclut derive");
// Équilibre : on place chaque enveloppe exactement à sa cible, puis la dérive disparaît
const { reeq } = (await import("./moteur.js")).analyser(PLAN, clone(desequilibre));
const cibles = Object.fromEntries(reeq.comptes.map((c) => [c.enveloppe, Math.round(c.cible)]));
const total = Object.values(cibles).reduce((s, x) => s + x, 0);
const equilibre = { ...clone(desequilibre), placements: { ...Object.fromEntries(Object.keys(EXEMPLE.placements).map((k) => [k, 0])), ...cibles } };
verifier(total > 0 && derive(PLAN, equilibre, AUJOURDHUI).length === 0, `profil à l'équilibre : derive absente (seuil ${SEUIL_DERIVE})`);

// Tri : aucune info avant une action ou une alerte
const mixte = detecter(profilAvec({ livretA: 23000, pea: 150000, assuranceVie: 0, livretBancaire: 0, ldds: 0 }, { age: 68 }));
const rang = { alerte: 0, action: 1, info: 2 };
verifier(mixte.length >= 3 && mixte.every((x, i) => i === 0 || rang[mixte[i - 1].niveau] <= rang[x.niveau]), `tri par gravité (${mixte.map((x) => x.niveau).join(" > ")})`);

// Immuabilité
const p = profilAvec({ livretA: 23000 }, { age: 68 });
const avant = JSON.stringify(p), planAvant = JSON.stringify(PLAN);
detecter(p); livretsPleins(PLAN, p, AUJOURDHUI); derive(PLAN, p, AUJOURDHUI); av70(p);
verifier(JSON.stringify(p) === avant && JSON.stringify(PLAN) === planAvant, "profil et plan non modifiés");

// Robustesse
let leve = false;
try { detecterAlertes(PLAN, {}); detecterAlertes(PLAN, null); detecterAlertes({}, {}); } catch { leve = true; }
verifier(!leve, "profil vide ou plan invalide : aucune exception");

// Dernier jour de cession (CTO)
verifier(dernierJourCession(2026) === "2026-12-29", "dernier jour de cession 2026");
verifier(dernierJourCession(2027) === "2027-12-29", "dernier jour de cession 2027");
verifier(dernierJourCession(2028) === "2028-12-27", "dernier jour de cession 2028 (31/12 dimanche)");
verifier(MARCHE.reglementJoursOuvres === 2 && PLUS_VALUES.reportMoinsValuesAns === 10 && Object.isFrozen(MARCHE), "constantes marché et plus-values (gelées)");
const avecCTO = profilAvec({ cto: 8000 }, { age: 40 }), sansCTO = profilAvec({ cto: 0 }, { age: 40 });
const f = fenetreCTO(avecCTO, new Date("2026-12-10"));
verifier(f.length === 1 && f[0].cle === "cto:2026" && f[0].niveau === "action" && f[0].min === "intermediaire" && f[0].titre.endsWith("29/12") && f[0].texte.includes("10 ans"), "fenetreCTO le 10/12 : alerte");
verifier(fenetreCTO(avecCTO, new Date("2026-11-17")).length === 0, "fenetreCTO le 17/11 : rien");
verifier(fenetreCTO(avecCTO, new Date("2026-12-29")).length === 1 && fenetreCTO(avecCTO, new Date("2026-12-30")).length === 0, "fenetreCTO : 29/12 inclus, 30/12 exclu");
verifier(fenetreCTO(sansCTO, new Date("2026-12-10")).length === 0, "fenetreCTO sans CTO : rien");

// Bilan mensuel
const ref = { date: "2026-01", points: Array.from({ length: 21 }, (_, i) => ({ c: 10000 + 1000 * i, p10: 9000 + 1000 * i, p50: 10000 + 1000 * i, p90: 11000 + 1000 * i })) };
const r10 = [{ date: "2026-10", placements: {}, total: 19000 }];
verifier(bilanMensuel([], ref, AUJOURDHUI).length === 0 && bilanMensuel(null, ref, AUJOURDHUI).length === 0, "bilanMensuel sans relevé : rien");
const b = bilanMensuel(r10, ref, AUJOURDHUI);
verifier(b.length === 1 && b[0].cle === "bilan:2026-11" && b[0].min === null && b[0].vue === "suivi" && b[0].titre === "Relevé de novembre à saisir", "bilanMensuel : relevé d'octobre, alerte novembre");
const attendu = prevuA(ref, moisEntre("2026-01", "2026-10"));
verifier(b[0].texte.includes("19") && attendu && Math.abs(attendu.c - 10750) < 1 && /écart de \+8/.test(b[0].texte), "bilanMensuel : écart réel / prévu calculé comme le Suivi");
verifier(bilanMensuel([{ date: "2026-11", placements: {}, total: 1 }], ref, AUJOURDHUI).length === 0, "bilanMensuel : relevé du mois déjà saisi");
verifier(bilanMensuel(r10, null, AUJOURDHUI).length === 1 && !/écart/.test(bilanMensuel(r10, null, AUJOURDHUI)[0].texte), "bilanMensuel sans référence : invitation seule");
verifier(ids(detecterAlertes(PLAN, profilAvec({}, { age: 40 }), { aujourdhui: AUJOURDHUI, releves: r10, reference: ref })).includes("bilan-mensuel"), "detecterAlertes transmet releves et reference");

// prevuA / moisEntre (déplacés d'app.js)
verifier(moisEntre("2026-01", "2026-10") === 9 && moisEntre("2025-11", "2026-02") === 3, "moisEntre");
verifier(prevuA(ref, 6).c === 10500 && prevuA(ref, -1) === null && prevuA(null, 3) === null && prevuA(ref, 12 * 25) === null, "prevuA : interpolation, bornes");

// Calendrier : échéance CTO exportée
const ech = echeancesProfil(PLAN, avecCTO, { aujourdhui: AUJOURDHUI }).find((e) => e.titre.startsWith("Dernier jour de cession"));
verifier(ech && ech.type === "fiscal" && ech.date.getFullYear() === 2026 && ech.date.getMonth() === 11 && ech.date.getDate() === 29, "calendrier : échéance CTO au 29/12/2026");
verifier(ech && versCSV([ech]).includes("12/29/2026"), "calendrier : CSV avec le jour exact");
const apres = echeancesProfil(PLAN, avecCTO, { aujourdhui: new Date(2026, 11, 30) }).find((e) => e.titre.startsWith("Dernier jour de cession"));
verifier(apres && apres.date.getFullYear() === 2027, "calendrier : année suivante une fois la date passée");
verifier(!echeancesProfil(PLAN, sansCTO, { aujourdhui: AUJOURDHUI }).some((e) => e.titre.startsWith("Dernier jour de cession")), "calendrier : rien sans CTO");

// Équilibre des contributions
{
  const plan0 = { ...clone(PLAN), hypotheses: { ...clone(PLAN.hypotheses), rendements: { ...clone(PLAN.hypotheses.rendements), prudent: 0 } } };
  const concubin = (payeA, payeB) => ({ ...clone(EXEMPLE), salaireNetMensuel: 3000, depensesMensuelles: payeA, foyer: { actif: true, statut: "concubin" }, conjoint: { prenom: "", salaireNetMensuel: 2000, depensesMensuelles: payeB } });
  {
    const brut = concubin(1000, 1500), marie = { ...concubin(1000, 1500), foyer: { actif: true, statut: "marie" }, conjoint: { salaireNetMensuel: 2000, partCharges: 75 } };
    for (const [nom, p] of [["concubin", brut], ["marié", marie]]) {
      const a = equilibreContributions(p, plan0), b = equilibreContributions(normaliserFoyer(PLAN, clone(p)), plan0);
      verifier(a && JSON.stringify(a) === JSON.stringify(b), `équilibre : profil brut = profil fusionné (${nom})`);
    }
    const moi = { ...clone(brut), foyer: { actif: true, statut: "concubin", vue: "moi" } };
    verifier(JSON.stringify(equilibreContributions(moi, plan0)) === JSON.stringify(equilibreContributions(normaliserFoyer(PLAN, clone(moi)), plan0)), "équilibre : concubin « vue moi » identique une fois normalisé");
  }
  let r = equilibreContributions(concubin(1000, 1500), plan0);
  verifier(r.disponible && r.ecart === 500, "équilibre concubin : écart 500");
  verifier(r.surcontributeur === "B", "équilibre concubin : B paie trop");
  verifier(r.manqueAGagner === 60000, "équilibre concubin : manque à gagner 60 000 (rendement 0)");
  verifier(r.separatif === true, "équilibre concubin : séparatif");
  verifier(ids(desequilibreCharges(concubin(1000, 1500), plan0)).includes("desequilibre"), "équilibre : alerte pour 500 €/mois");
  verifier(ids(detecterAlertes(plan0, concubin(1000, 1500), { aujourdhui: AUJOURDHUI })).includes("desequilibre"), "équilibre : alerte dans detecterAlertes");
  verifier(desequilibreCharges(concubin(1000, 1500), plan0)[0].vue === "mon-profil", "équilibre : renvoie vers l'onglet Profil (#mon-profil)");
  // Écart de 100 €/mois : payeA 1400 / payeB 1100 pour D = 2500, théorique B = 1000
  r = equilibreContributions(concubin(1400, 1100), plan0);
  verifier(r.ecart === 100, "équilibre : écart 100");
  verifier(desequilibreCharges(concubin(1400, 1100), plan0).length === 0, "équilibre : pas d'alerte à 100 €/mois");
  const marie = { ...clone(EXEMPLE), salaireNetMensuel: 3000, depensesMensuelles: 2500, foyer: { actif: true, statut: "marie" }, conjoint: { salaireNetMensuel: 2000 }, succession: { regime: "communaute_legale" } };
  verifier(equilibreContributions(marie, plan0).disponible === false, "équilibre marié sans partCharges : indisponible");
  const marieP = { ...marie, conjoint: { salaireNetMensuel: 2000, partCharges: 80 } };
  r = equilibreContributions(marieP, plan0);
  verifier(r.disponible && r.separatif === false, "équilibre communauté : non séparatif");
  verifier(!ids(detecterAlertes(plan0, marieP, { aujourdhui: AUJOURDHUI })).includes("desequilibre"), "équilibre communauté : aucune alerte");
  verifier(equilibreContributions({ ...marie, foyer: { actif: false } }, plan0) === null, "équilibre : null hors couple");
  verifier(SEUIL_DESEQUILIBRE.euros === 150, "seuil de déséquilibre exporté");
}

console.log(`test_alertes : ${ok} vérifications OK, ${ko} échec(s)`);
if (ko) process.exit(1);
