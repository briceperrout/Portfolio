// Tests des niveaux de lecture (niveaux.js) et de leur cohérence avec index.html — `node test_niveaux.mjs`
import { readFileSync, existsSync } from "node:fs";
import { PLAN } from "./plan.js";
import { analyser, GROUPES_PLACEMENTS, totalGroupe, repartirGroupe, repartirCapitalPrudent } from "./moteur.js";
import { NIVEAUX, INFOS_NIVEAUX, MATRICE, LIBELLES_VUES, nomVue, libelleOnglet, suiteVue, rang, visible, reglagesAvancesActifs, niveauLePlusBas } from "./niveaux.js";

export const resultats = { ok: 0, echecs: [] };
const verifier = (condition, message) => { if (condition) resultats.ok++; else resultats.echecs.push(message); };
const egal = (a, b, message) => verifier(JSON.stringify(a) === JSON.stringify(b), `${message} — obtenu ${JSON.stringify(a)}, attendu ${JSON.stringify(b)}`);

// ---------------------------------------------------------------- règles de base
egal(NIVEAUX, ["debutant", "intermediaire", "avance"], "ordre des niveaux");
egal(NIVEAUX.map(rang), [0, 1, 2], "rang des niveaux");
egal(rang("inconnu"), 2, "niveau inconnu traité comme avancé");
verifier(visible(undefined, "debutant") && visible("", "debutant"), "sans data-min : visible partout");
verifier(!visible("intermediaire", "debutant") && visible("intermediaire", "intermediaire") && visible("intermediaire", "avance"), "visibilité intermédiaire");
verifier(!visible("avance", "debutant") && !visible("avance", "intermediaire") && visible("avance", "avance"), "visibilité avancée");
verifier(NIVEAUX.every((n) => INFOS_NIVEAUX[n]?.nom && INFOS_NIVEAUX[n]?.description), "libellés et descriptions présents");

// ---------------------------------------------------------------- cohérence MATRICE ↔ index.html
const html = readFileSync(new URL("./index.html", import.meta.url), "utf8");
const lignes = html.split("\n");
const dm = (l) => l?.match(/data-min="([a-z]+)"/)?.[1];
for (const [cle, min] of Object.entries(MATRICE.profil)) {
  // Un fieldset est repéré par sa légende (le data-min est sur le panneau, ligne précédente) ; le reste par son id.
  const iLegende = lignes.findIndex((l) => l.includes("<legend") && l.replace(/<[^>]*>/g, "").trim().startsWith(cle));
  const iId = lignes.findIndex((l) => l.includes(`id="${cle}"`) || l.includes(`for="${cle}"`));
  const ligne = iLegende >= 0 && iId < 0 ? lignes[iLegende - 1] : lignes[iId];
  egal(dm(ligne), min, `data-min de « ${cle} » dans index.html`);
}
// Rééquilibrage : chaque clé de MATRICE.reequilibrage a son id et son data-min dans le gabarit de app.js
const appJs = readFileSync(new URL("./app.js", import.meta.url), "utf8").split("\n");
for (const [cle, min] of Object.entries(MATRICE.reequilibrage)) {
  const ligne = appJs.find((l) => l.includes(`id="${cle}"`));
  egal(ligne?.match(/data-min="([a-z]+)"/)?.[1], min, `data-min de « ${cle} » dans app.js`);
}
// Trajectoire : chaque clé de MATRICE.trajectoire porte son data-min dans index.html ou dans le gabarit de app.js
for (const [cle, min] of Object.entries(MATRICE.trajectoire)) {
  const ligne = lignes.find((l) => l.includes(`id="${cle}"`)) ?? appJs.find((l) => l.includes(`id="${cle}"`));
  egal(ligne?.match(/data-min="([a-z]+)"/)?.[1], min, `data-min de « ${cle} » (trajectoire)`);
}
// Retraite : chaque clé de MATRICE.retraite porte son data-min dans le gabarit de rendreRetraite() (app.js)
for (const [cle, min] of Object.entries(MATRICE.retraite)) {
  const ligne = appJs.find((l) => l.includes(`id="${cle}"`));
  egal(ligne?.match(/data-min="([a-z]+)"/)?.[1], min, `data-min de « ${cle} » (retraite)`);
}
verifier(appJs.some((l) => l.includes('id="ret-simple"') && l.includes('data-seul="debutant"')) && appJs.some((l) => l.includes('id="ret-verdict-bloc"') && l.includes('data-seul="debutant"')), "retraite débutant : réglages et verdict (data-seul)");
verifier(/if \(niveauCourant\(\) === "debutant"\) \{ rendreRetraiteDebutant\(\)/.test(appJs.join("\n")), "retraite : le niveau Débutant a sa propre page");
verifier(appJs.some((l) => l.includes('id="tr-avenir"') && l.includes('data-seul="debutant"')), "panneau « Mon avenir en 3 chiffres » (data-seul)");
verifier(/siNiveau\("avance", \(\) => `<section class="panneau" id="bloc-crise"/.test(appJs.join("\n")) && /siNiveau\("intermediaire", \(\) => `<section class="panneau" id="tr-eventail"/.test(appJs.join("\n")), "crise et éventail produits via siNiveau");
verifier(/siNiveau\("avance", \(\) => blocRythme\(res\)\)/.test(appJs.join("\n")) && /siNiveau\("intermediaire", \(\) => blocPocheBourse\(res\)\)/.test(appJs.join("\n")), "panneaux coûteux produits via siNiveau");
verifier(appJs.some((l) => l.includes('id="res-bourse-debutant"') && l.includes('data-seul="debutant"')), "ligne bourse débutant (data-seul)");
egal(dm(lignes.find((l) => l.includes('id="lien-suivi"'))), MATRICE.onglets.suivi, "data-min de l'onglet Suivi");
egal(dm(lignes.find((l) => l.includes('id="lien-plan"'))), MATRICE.onglets.plan, "data-min de l'onglet Mon plan");
// Transmission : chaque clé de MATRICE.transmission porte son data-min dans index.html ou dans le gabarit de rendreTransmission() (app.js)
for (const [cle, min] of Object.entries(MATRICE.transmission)) {
  const ligne = lignes.find((l) => l.includes(`id="${cle}"`)) ?? appJs.find((l) => l.includes(`id="${cle}"`));
  egal(dm(ligne), min, `data-min de « ${cle} » (Transmission)`);
}
egal(dm(lignes.find((l) => l.includes('id="lien-transmission"'))), MATRICE.onglets.transmission, "data-min de l'onglet Transmission");
const valeursHtml = [...html.matchAll(/data-min="([^"]*)"/g)].map((m) => m[1]);
verifier(valeursHtml.length > 0 && valeursHtml.every((v) => v === "intermediaire" || v === "avance"), "valeurs data-min valides");
verifier(/html\[data-niveau="debutant"\] \[data-min="intermediaire"\]/.test(html) && /\[data-seul="debutant"\]/.test(html), "règles CSS de masquage présentes");
verifier(!/<script(?![^>]*\bsrc=)[^>]*>/.test(html), "aucun script inline (CSP stricte)");

// ---------------------------------------------------------------- réglages avancés actifs
const VIDE = {
  age: 30, pays: "FR", creditsMensuels: 0, futur: { actif: false }, placements: {}, projetRP: { actif: false, ptz: { actif: false } },
  abondement: { actif: false }, independant: { forme: "" }, foyer: { actif: false }, tmi: undefined,
};
const copie = (o) => JSON.parse(JSON.stringify(o));
egal(reglagesAvancesActifs(VIDE, "debutant", VIDE), [], "profil par défaut : aucun réglage avancé");
egal(reglagesAvancesActifs(null, "debutant", VIDE), [], "profil absent toléré");

const riche = copie(VIDE);
Object.assign(riche, {
  pays: "BE", tmi: "30", profilRisque: "prudent", enfants: 2, creditsMensuels: 300, salaireDans10Ans: 4000,
  futur: { actif: true }, projetLocatif: { actif: true }, projetRP: { actif: true, ptz: { actif: true } },
  frais: { av: 0.8 }, foyer: { actif: true }, abondement: { actif: true }, evenements: [{ type: "voiture" }],
  independant: { forme: "microBnc" }, retraite: { modePension: "manuel" }, placements: { livretA: 1000, scpi: 5000 },
});
const deb = reglagesAvancesActifs(riche, "debutant", VIDE), inter = reglagesAvancesActifs(riche, "intermediaire", VIDE);
verifier(deb.length === 16, `débutant : 16 réglages attendus, obtenu ${deb.length}`);
verifier(new Set(deb.map((r) => r.libelle)).size === deb.length, "pas de doublon de libellé");
verifier(inter.length === 7 && inter.every((r) => r.niveauRequis === "avance"), "intermédiaire : seuls les réglages avancés restent signalés");
egal(reglagesAvancesActifs(riche, "avance", VIDE), [], "avancé : rien n'est masqué donc rien n'est signalé");
egal(niveauLePlusBas(deb), "intermediaire", "« Les voir » ouvre le niveau le plus bas utile");
egal(niveauLePlusBas(inter), "avance", "« Les voir » : niveau avancé quand seuls des réglages avancés sont actifs");
egal(reglagesAvancesActifs({ ...copie(VIDE), pays: "FR", futur: { actif: false } }, "debutant", VIDE), [], "valeurs par défaut non signalées");
const pur = copie(riche); reglagesAvancesActifs(pur, "debutant", VIDE);
egal(pur, riche, "le profil n'est jamais modifié");
egal(reglagesAvancesActifs({ ...copie(VIDE), placements: { pea: 9000, livretA: 500 } }, "debutant", VIDE), [], "comptes essentiels ne déclenchent pas « Autres »");
const sansAutres = { ...copie(VIDE), placements: { pea: 9000, cto: 1000, assuranceVieUC: 500, lep: 300, livretJeune: 100, ldds: 5 } };
egal(reglagesAvancesActifs(sansAutres, "debutant", VIDE), [], "CTO, assurance-vie UC, LEP et Livret Jeune sont des comptes regroupés, pas des « Autres »");
for (const c of ["per", "scpi", "orPhysique", "plateformeCrypto", "coldWallet", "epargneSalariale", "pel"]) {
  verifier(reglagesAvancesActifs({ ...copie(VIDE), placements: { [c]: 1 } }, "debutant", VIDE).length === 1, `${c} non nul : compté dans les réglages avancés`);
}

// ---------------------------------------------------------------- libellés par niveau (une seule table)
egal(["profil", "reequilibrage", "trajectoire", "retraite", "ideale", "fiches"].map((v) => libelleOnglet(v, "debutant")), ["1. Ma situation", "2. Mon plan du mois", "3. Mon avenir", "4. Ma retraite", "Épargne idéale", "Fiches"], "libellés d'onglets en débutant");
for (const n of ["intermediaire", "avance"]) egal(["profil", "reequilibrage", "trajectoire", "retraite", "ideale", "suivi", "fiches", "plan"].map((v) => libelleOnglet(v, n)), ["1. Mon profil", "2. Rééquilibrage", "3. Trajectoire", "4. Retraite", "Épargne idéale", "Suivi", "Fiches", "Mon plan"], `libellés d'onglets en ${n} = libellés actuels`);
egal([suiteVue("reequilibrage", "intermediaire"), suiteVue("trajectoire", "intermediaire"), suiteVue("retraite", "intermediaire")], ["voir mon rééquilibrage", "trajectoire", "ta retraite"], "boutons « Étape N » : textes actuels conservés");
egal([suiteVue("reequilibrage", "debutant"), suiteVue("trajectoire", "debutant"), suiteVue("retraite", "debutant")], ["voir mon plan du mois", "mon avenir", "ma retraite"], "boutons « Étape N » en débutant");
verifier(Object.values(LIBELLES_VUES).every((e) => NIVEAUX.every((n) => e[n]?.nom && e[n]?.suite)), "chaque vue a un nom et une suite aux 3 niveaux");
egal([nomVue("inconnue", "debutant"), libelleOnglet("profil", "n'importe quoi")], ["", "1. Mon profil"], "vue inconnue vide ; niveau inconnu traité comme avancé");
// Ancres et identifiants inchangés ; chaque data-lib du HTML désigne une vue de la table
for (const [ancre, id] of [["#mon-profil", "lien-profil"], ["#reequilibrage", "lien-reequilibrage"], ["#trajectoire", "lien-trajectoire"], ["#retraite", "lien-retraite"], ["#epargne-ideale", "lien-ideale"], ["#fiches", "lien-fiches"]]) verifier(html.includes(`<a href="${ancre}" id="${id}"`), `ancre ${ancre} et id ${id} inchangés`);
const refs = [...html.matchAll(/data-lib(?:-suite)?="([a-z]+)"/g)].map((m) => m[1]);
verifier(refs.length >= 8 && refs.every((v) => LIBELLES_VUES[v]), "data-lib / data-lib-suite : toutes les vues existent dans la table");

// ---------------------------------------------------------------- matrice : valeurs et couples (niveau, élément)
const toutes = Object.entries(MATRICE).flatMap(([ecran, table]) => Object.entries(table).map(([cle, min]) => [ecran, cle, min]));
verifier(toutes.length > 20, `la matrice n'est pas vide (${toutes.length} entrées)`);
for (const [ecran, cle, min] of toutes) verifier(min === "intermediaire" || min === "avance", `MATRICE.${ecran}.${cle} : valeur valide (« ${min} »)`);
for (const min of [undefined, "", "intermediaire", "avance"]) for (const n of NIVEAUX) {
  const attendu = !min || rang(n) >= rang(min);
  verifier(visible(min, n) === attendu, `visible(${JSON.stringify(min)}, ${n}) = ${attendu}`);
}
for (const n of ["inconnu", undefined, null, ""]) {
  egal(rang(n), 2, `rang(${JSON.stringify(n)}) : valeur inconnue → avancé`);
  verifier(visible("avance", n) && visible("intermediaire", n), `visible(…, ${JSON.stringify(n)}) : niveau inconnu voit tout`);
}
verifier(visible("valeur-inconnue", "debutant") === false && visible("valeur-inconnue", "avance") === true, "data-min inconnu : traité comme avancé (masqué sous « avance »)");

// ---------------------------------------------------------------- copies locales des profils d'app.js (app.js touche au DOM : non importable en Node)
const clone = (x) => JSON.parse(JSON.stringify(x));
const SUCCESSION_DEFAUT = { union: "mariage", regime: "communaute_legale", optionConjoint: "auto", donationDernierVivant: false, enfantsNonCommuns: 0, testament: false, enfantMineurAuFoyer: false, biensPropres: 0, clauseAV: "conjoint_puis_enfants", quotiteAssuranceEmprunteur: 100, donationAnterieure: { annee: null, montantParEnfant: 0 }, projetDonation: { valeur: 0, croissance: 3, annees: 15 } };
const PTZ_DEFAUT = { actif: false, zone: "B1", tranche: 2, typeOperation: "collectifNeuf", personnes: null, travauxPctCout: 0 };
const PROFIL_EXEMPLE = {
  age: 32, salaireNetMensuel: 3200, epargneMensuelle: 1000, depensesMensuelles: 1800, tmi: "30",
  pays: "FR", statutPro: "stable", eligibleLEP: false, creditsMensuels: 0,
  comptesEtrangers: [], tauxChange: {},
  futur: { actif: false, age: 40, capital: null, salaire: null, epargne: null },
  proprietaire: false, loyerMensuel: 900,
  placements: { livretA: 22950, ldds: 12000, livretBancaire: 5050, assuranceVie: 25000, assuranceVieUC: 0, pea: 30000, cto: 0, orPhysique: 0, plateformeCrypto: 5000, coldWallet: 0, scpi: 0, per: 0 },
  pea: { ouvert: true, dateOuverture: "2023-03", versements: 26000, etablissement: "Banque traditionnelle" },
  assuranceVie: { ouverte: true, dateOuverture: "2019-06", type: "Banque traditionnelle" },
  projetRP: { actif: true, prix: 320000, type: "ancien", imperatif: false, horizonAnnees: 3, aideFamiliale: 0, ageChoisi: null, departement: "", commune: "", typeLogement: "appartement", surface: null, ptz: { ...PTZ_DEFAUT }, loyerEquivalent: null, chargesCoproMensuelles: null },
  salaireDans10Ans: null, rythmeReequilibrage: "", avPartEuros: 100,
  logement: { usage: "rp", origine: "achat", part: 100, valeur: null, creditRestant: 0, finCredit: null, departement: "", commune: "", typeLogement: "appartement", surface: null },
  abondement: { acces: "?", actif: false, plan: "pereco", taux: null, plafond: null, interessement: null, placer: true, surInteressement: false },
  independant: { forme: "", ca: 0, resultat: 0, remunerationNette: 0, capital: 0, distribution: 100, vl: false },
  foyer: { actif: false, statut: "marie" },
  conjoint: { prenom: "", age: 31, salaireNetMensuel: 2400, pea: { ouvert: false, versements: 0, etablissement: "" } },
  succession: clone(SUCCESSION_DEFAUT),
};
const PROFIL_VIDE = {
  age: 30, salaireNetMensuel: 0, epargneMensuelle: 0, depensesMensuelles: 0, proprietaire: false, loyerMensuel: 0,
  pays: "FR", statutPro: "", eligibleLEP: false, creditsMensuels: 0,
  comptesEtrangers: [], tauxChange: {},
  futur: { actif: false, age: null, capital: null, salaire: null, epargne: null },
  placements: {}, pea: { ouvert: false, versements: 0, etablissement: "" }, assuranceVie: { ouverte: false, type: "" },
  projetRP: { actif: false, prix: 0, type: "ancien", imperatif: false, horizonAnnees: 0, aideFamiliale: 0, ageChoisi: null, departement: "", commune: "", typeLogement: "appartement", surface: null, ptz: { ...PTZ_DEFAUT }, loyerEquivalent: null, chargesCoproMensuelles: null },
  salaireDans10Ans: null, rythmeReequilibrage: "", avPartEuros: 100,
  logement: { usage: "rp", origine: "achat", part: 100, valeur: null, creditRestant: 0, finCredit: null, departement: "", commune: "", typeLogement: "appartement", surface: null },
  abondement: { acces: "?", actif: false, plan: "pereco", taux: null, plafond: null, interessement: null, placer: true, surInteressement: false },
  independant: { forme: "", ca: 0, resultat: 0, remunerationNette: 0, capital: 0, distribution: 100, vl: false },
  foyer: { actif: false, statut: "marie" },
  conjoint: { prenom: "", age: 30, salaireNetMensuel: 0, pea: { ouvert: false, versements: 0, etablissement: "" } },
  succession: clone(SUCCESSION_DEFAUT),
};
// Garde-fou : les copies suivent app.js (si un champ y est ajouté, ce test le rappelle)
const appSrc = readFileSync(new URL("./app.js", import.meta.url), "utf8");
const litApp = (nom) => { const t = appSrc.match(new RegExp(`const ${nom} = (\\{\\n[\\s\\S]*?\\n\\});`))?.[1]; return t ? new Function("PTZ_DEFAUT", "clone", "SUCCESSION_DEFAUT", `return ${t};`)(PTZ_DEFAUT, clone, SUCCESSION_DEFAUT) : null; };
egal(SUCCESSION_DEFAUT, new Function(`return ${appSrc.match(/const SUCCESSION_DEFAUT = (\{.*\});/)?.[1]};`)(), "copie de SUCCESSION_DEFAUT identique à celle d'app.js");
egal(PROFIL_EXEMPLE, litApp("PROFIL_EXEMPLE"), "copie de PROFIL_EXEMPLE identique à celle d'app.js");
egal(PROFIL_VIDE, litApp("PROFIL_VIDE"), "copie de PROFIL_VIDE identique à celle d'app.js");

// ---------------------------------------------------------------- réglages avancés : profil vide et profil Exemple
for (const n of NIVEAUX) egal(reglagesAvancesActifs(copie(PROFIL_VIDE), n, PROFIL_VIDE), [], `profil vide : aucun réglage avancé en ${n}`);
const exDeb = reglagesAvancesActifs(copie(PROFIL_EXEMPLE), "debutant", PROFIL_VIDE);
const exInter = reglagesAvancesActifs(copie(PROFIL_EXEMPLE), "intermediaire", PROFIL_VIDE);
const exAv = reglagesAvancesActifs(copie(PROFIL_EXEMPLE), "avance", PROFIL_VIDE);
verifier(exDeb.length > 0, `profil Exemple : réglages avancés signalés en débutant (${exDeb.map((r) => r.libelle).join(" ; ")})`);
verifier(exInter.length < exDeb.length, `profil Exemple : liste plus courte en intermédiaire (${exInter.length} < ${exDeb.length})`);
egal(exAv, [], "profil Exemple : rien de signalé en avancé");

// ---------------------------------------------------------------- invariance des calculs : le niveau ne doit jamais atteindre le moteur
const profilsTest = { Exemple: copie(PROFIL_EXEMPLE) };
for (const [nom, capital, age] of [["prudent 4 000 €", 4000, 25], ["prudent 45 000 €", 45000, 40], ["prudent 180 000 €", 180000, 55]]) {
  profilsTest[nom] = { ...copie(PROFIL_EXEMPLE), age, placements: repartirCapitalPrudent(PLAN, capital, 1500), pea: { ouvert: true, dateOuverture: "2021-01", versements: 0, etablissement: "" }, projetRP: { ...copie(PROFIL_VIDE.projetRP) } };
}
for (const [nom, p] of Object.entries(profilsTest)) {
  const avant = JSON.stringify(analyser(copie(PLAN), copie(p)));
  verifier(avant.length > 1000, `analyser(${nom}) produit un résultat complet`);
  const profilCopie = copie(p);
  for (const n of [...NIVEAUX, "avance", "debutant"]) { // aller-retour de niveaux : tout ce que niveaux.js sait faire d'un profil
    reglagesAvancesActifs(profilCopie, n, PROFIL_VIDE);
    niveauLePlusBas(reglagesAvancesActifs(profilCopie, n, PROFIL_VIDE));
  }
  egal(profilCopie, p, `${nom} : le profil n'est pas modifié par les niveaux`);
  const apres = JSON.stringify(analyser(copie(PLAN), profilCopie));
  verifier(avant === apres, `${nom} : analyser() strictement identique avant/après un aller-retour de niveau`);
}
for (const f of ["moteur.js", "projection.js", "fiscal.js", "pension.js"]) {
  const src = readFileSync(new URL(`./${f}`, import.meta.url), "utf8");
  verifier(!/niveaux\.js/.test(src) && !/dataset\.niveau|niveauCourant/.test(src), `${f} n'importe pas niveaux.js et ne lit pas le niveau`);
}
verifier(!/from "\.\/(app|assistant)\.js"/.test(readFileSync(new URL("./niveaux.js", import.meta.url), "utf8")) && !/document|window|localStorage/.test(readFileSync(new URL("./niveaux.js", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "")), "niveaux.js : aucun DOM, aucun stockage");

// ---------------------------------------------------------------- placements regroupés : repartirGroupe → totalGroupe stable
for (const groupe of ["livrets", "assuranceVie", "bourse"]) for (const montant of [0, 1000, 30000, 200000]) {
  const plac = { ...PROFIL_EXEMPLE.placements, lep: 0 };
  const r = repartirGroupe(PLAN, groupe, montant, plac, PROFIL_EXEMPLE);
  verifier(Math.abs(totalGroupe(r, groupe) - montant) <= 1, `groupe ${groupe}, ${montant} € : total conservé (${totalGroupe(r, groupe)})`);
  verifier(GROUPES_PLACEMENTS[groupe].every((id) => r[id] >= 0), `groupe ${groupe}, ${montant} € : aucun montant négatif`);
  egal(repartirGroupe(PLAN, groupe, totalGroupe(r, groupe), r, PROFIL_EXEMPLE), r, `groupe ${groupe}, ${montant} € : répartition idempotente`);
  for (const autre of Object.keys(GROUPES_PLACEMENTS).filter((g) => g !== groupe)) egal(totalGroupe(r, autre), totalGroupe(plac, autre), `groupe ${groupe} : le groupe ${autre} n'est pas touché`);
  egal(plac.livretA, PROFIL_EXEMPLE.placements.livretA, "repartirGroupe ne mute pas les placements d'entrée");
}
{
  const plac = { per: 4000, scpi: 100 };
  egal(repartirGroupe(PLAN, "autres", 99999, plac), plac, "groupe « autres » : lecture seule, copie inchangée");
  egal(totalGroupe(repartirGroupe(PLAN, "livrets", -50, { livretA: 10 }), "livrets"), 0, "montant négatif : traité comme 0");
  egal(totalGroupe({}, "inconnu"), 0, "groupe inconnu : total 0");
}

// ---------------------------------------------------------------- service worker : le shell contient tous les modules importés
{
  const sw = readFileSync(new URL("./service-worker.js", import.meta.url), "utf8");
  const shell = [...(sw.match(/const SHELL = \[([\s\S]*?)\];/)?.[1].matchAll(/"([^"]+)"/g) ?? [])].map((m) => m[1]);
  verifier(shell.includes("niveaux.js") && shell.includes("index.html") && shell.includes("manifest.json") && shell.includes("favicon.svg"), "SHELL : niveaux.js, index.html, manifest.json et favicon.svg présents");
  for (const f of shell.filter((x) => x !== "./")) verifier(existsSync(new URL(`./${f}`, import.meta.url)), `SHELL : ${f} existe sur le disque`);
  for (const f of shell.filter((x) => x.endsWith(".js") && x !== "service-worker.js")) {
    const src = readFileSync(new URL(`./${f}`, import.meta.url), "utf8");
    for (const m of src.matchAll(/(?:from|import)\s*\(?\s*"\.\/([a-z0-9-]+\.js)"/g)) verifier(shell.includes(m[1]), `SHELL : ${m[1]} (importé par ${f}) est pré-caché`);
  }
  const cacheMatch = sw.match(/CACHE_VERSION = "plan-patrimoine-v(\d+)"/);
  verifier(cacheMatch && Number(cacheMatch[1]) >= 16, `CACHE_VERSION incrémentée (v${cacheMatch?.[1]})`);
}

console.log(`test_niveaux : ${resultats.ok} vérifications OK, ${resultats.echecs.length} échec(s)`);
for (const e of resultats.echecs) console.error("  ✗", e);
if (resultats.echecs.length) process.exitCode = 1;
