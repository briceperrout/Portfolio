// Tests des niveaux de lecture (niveaux.js) et de leur cohérence avec index.html — `node test_niveaux.mjs`
import { readFileSync } from "node:fs";
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

console.log(`test_niveaux : ${resultats.ok} vérifications OK, ${resultats.echecs.length} échec(s)`);
for (const e of resultats.echecs) console.error("  ✗", e);
if (resultats.echecs.length) process.exitCode = 1;
