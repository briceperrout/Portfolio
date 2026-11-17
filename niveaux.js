// Niveaux de lecture : Débutant, Intermédiaire, Avancé.
// Règle d'or : le niveau ne change QUE l'affichage et les questions posées, jamais les calculs ni le profil.
// Un champ masqué garde sa valeur : ce module est pur (aucun accès au DOM, aucune écriture dans le profil).
// Tout nouveau bloc d'interface doit déclarer son niveau minimal (attribut data-min dans index.html) et,
// s'il est listé ici, apparaître dans MATRICE.

import { GROUPES_PLACEMENTS } from "./moteur.js";

export const NIVEAUX = ["debutant", "intermediaire", "avance"];

export const INFOS_NIVEAUX = {
  debutant: { nom: "Débutant", description: "L'essentiel en quelques questions : ton plan du mois, ton avenir et ta retraite en un coup d'œil." },
  intermediaire: { nom: "Intermédiaire", description: "Le détail de tes comptes, de tes impôts, de ton employeur et de ton foyer." },
  avance: { nom: "Avancé", description: "Tous les outils : indépendants, locatif, PTZ, crises, fiscalité, scénarios." },
};

/** 0, 1 ou 2 ; une valeur inconnue est traitée comme « avance » (on n'en cache jamais trop par erreur). */
export const rang = (niveau) => { const i = NIVEAUX.indexOf(niveau); return i < 0 ? NIVEAUX.length - 1 : i; };

/** Un élément de niveau minimal `min` est-il visible au niveau `niveau` ? (min absent = visible partout) */
export const visible = (min, niveau) => !min || rang(niveau) >= rang(min);

/**
 * Libellés des vues par niveau : SEULE source des noms d'onglets, des bandeaux « Étape N sur 4 » et des boutons « Étape N : … ».
 * Les ancres (#mon-profil, #reequilibrage, #trajectoire, #retraite…) ne changent jamais : seul le texte affiché varie.
 *  - n : numéro d'étape (absent = onglet hors parcours) ;
 *  - nom : libellé de la vue ; suite : texte du bouton « Étape N : <suite> → » qui y mène.
 */
const unique = (nom, suite) => ({ debutant: { nom, suite }, intermediaire: { nom, suite }, avance: { nom, suite } });
export const LIBELLES_VUES = {
  profil: { n: 1, debutant: { nom: "Ma situation", suite: "ta situation" }, intermediaire: { nom: "Mon profil", suite: "ton profil" }, avance: { nom: "Mon profil", suite: "ton profil" } },
  reequilibrage: { n: 2, debutant: { nom: "Mon plan du mois", suite: "voir mon plan du mois" }, intermediaire: { nom: "Rééquilibrage", suite: "voir mon rééquilibrage" }, avance: { nom: "Rééquilibrage", suite: "voir mon rééquilibrage" } },
  trajectoire: { n: 3, debutant: { nom: "Mon avenir", suite: "mon avenir" }, intermediaire: { nom: "Trajectoire", suite: "trajectoire" }, avance: { nom: "Trajectoire", suite: "trajectoire" } },
  retraite: { n: 4, debutant: { nom: "Ma retraite", suite: "ma retraite" }, intermediaire: { nom: "Retraite", suite: "ta retraite" }, avance: { nom: "Retraite", suite: "ta retraite" } },
  ideale: unique("Épargne idéale", "épargne idéale"),
  suivi: unique("Suivi", "suivi"),
  fiches: unique("Fiches", "fiches"),
  plan: unique("Mon plan", "mon plan"),
};

const entree = (vue, niveau) => LIBELLES_VUES[vue]?.[NIVEAUX.includes(niveau) ? niveau : "avance"];
/** Nom de la vue au niveau donné (« Mon plan du mois »). Vue inconnue : chaîne vide. */
export const nomVue = (vue, niveau) => entree(vue, niveau)?.nom ?? "";
/** Libellé de l'onglet : numéroté pour les 4 étapes (« 2. Mon plan du mois »), sinon le nom seul. */
export const libelleOnglet = (vue, niveau) => { const n = LIBELLES_VUES[vue]?.n; return n ? `${n}. ${nomVue(vue, niveau)}` : nomVue(vue, niveau); };
/** Texte du bouton « Étape N : … → » (sans l'« Étape N : » ni la flèche). */
export const suiteVue = (vue, niveau) => entree(vue, niveau)?.suite ?? "";

/**
 * Table de référence « élément → niveau minimal », par écran. Tout ce qui n'y figure pas = tous niveaux.
 * Les clés sont l'identifiant du champ ou du bloc dans index.html (ou, pour un <fieldset>, le début de sa légende).
 * Les valeurs doivent rester alignées sur les attributs data-min d'index.html (vérifié par test_niveaux.mjs).
 */
const I = "intermediaire", A = "avance";
export const MATRICE = {
  profil: {
    // « Toi »
    "p-situation": I, "p-risque": I, "p-statut-pro": I,
    // « Ton activité d'indépendant » (bloc entier) et résidence fiscale
    "bloc-independant": A, "p-pays": A, "ligne-impot-pays": A,
    // « Ton budget »
    "p-credits": I, "bloc-budget-conjoint": I, "p-vue": A, "p-carriere": I, "p-salaire10": A,
    // « Ton logement » (le choix propriétaire/locataire et le loyer restent visibles partout)
    "lg-valeur": I, "lg-credit": I, "lg-mens": I,
    "lg-usage": A, "lg-origine": A, "lg-part": A, "lg-fin": A, "lg-loyer": A, "lg-charges": A, "lg-regime": A,
    // Blocs entiers
    "Tes impôts": I, "p-plafond-per": A,
    "Ton employeur": I,
    "Foyer": I, "c-pea-date": A, "c-pea-etab": A, "c-pea-vers": A,
    "Tester une situation future": A,
    "Placements actuels": I, // le débutant a sa version regroupée (bloc data-seul="debutant" « Ton argent placé aujourd'hui »)
    "Ouverture des contrats": I,
    "Argent versé et frais réels": A,
    // « Projet d'achat de la résidence principale » : activation, prix et horizon restent visibles partout
    "p-rp-type": I, "p-rp-aide": I, "p-rp-copro": A, "p-rp-loyer-eq": A, "p-rp-ptz": A, "bloc-ptz": A,
    "Projet d'investissement locatif": A,
    "Ton taux d'endettement": I,
    // « Ta retraite » : revenu cible et âge de départ restent visibles partout
    "r0-mode": I, "r0-pension": I, "r0-loyers": I, "r0-or": I,
    "Événements de vie": I,
  },
  onglets: { suivi: I, plan: A },
  // Complétés aux étapes 3 à 5
  // Rééquilibrage : les clés sont les id générés dans rendreResultats() (app.js), qui portent aussi data-min
  reequilibrage: { "res-futur": A, "res-profil-risque": I, "res-infos": I, "res-montants": I, "res-rythme": A, "poche-bourse": I },
  // Trajectoire : ids de index.html et du gabarit de rendreTrajectoire() (app.js). Absent = tous niveaux (dont « Trajectoire du patrimoine »).
  // « tr-avenir » (data-seul="debutant") est la version simplifiée ; « bloc-liberte » est affiché dans l'onglet Retraite ; « tr-tranches » inclut les bascules du plan.
  trajectoire: {
    "achat-trajectoire": I, "t-achat": I, "t-reel": I, "tr-tuiles": I, "tr-objectifs": I, "tr-tranches": I, "tr-eventail": I, "tr-rapporte": I, "bloc-liberte": I,
    "tr-composition": A, "bloc-crise": A, "tr-apres-impots": A, "bloc-ab": A, "bloc-fiscal": A,
  },
  // Retraite : ids du gabarit de rendreRetraite() (app.js). En Débutant la page est remplacée par « ret-simple » + « ret-verdict-bloc » (data-seul).
  retraite: {
    "ret-hypotheses": I, "ret-objectifs": I, "ret-age": I, "bloc-liberte": I, "bloc-pension": I, "ret-resultat": I, "ret-capital": I,
    "r-loyers": A, "ret-decaissement": A, "ret-impots": A, "ret-economie-retraits": I, "ret-ordre-retraits": A, "r-priorite": A,
  },
};

// Comptes « Autres » (PER, SCPI, or, crypto…) : lecture seule en débutant, détail à saisir en Intermédiaire (groupes définis dans moteur.js).
export const COMPTES_AUTRES = GROUPES_PLACEMENTS.autres;

const vide = (v) => v === undefined || v === null || v === "";
const egal = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const nombre = (v) => Number(v) || 0;

// Chaque règle : un réglage masqué à certains niveaux, et la façon de savoir qu'il s'écarte du défaut.
const REGLES = [
  { libelle: "Activité d'indépendant renseignée", niveauRequis: A, actif: (p, d) => !vide(p.independant?.forme) && p.independant.forme !== d.independant?.forme },
  { libelle: "Résidence fiscale hors de France", niveauRequis: A, actif: (p) => !vide(p.pays) && p.pays !== "FR" },
  { libelle: "Simulation d'une situation à un âge futur", niveauRequis: A, actif: (p, d) => !!p.futur?.actif && !d.futur?.actif },
  { libelle: "Projet d'investissement locatif", niveauRequis: A, actif: (p, d) => !!p.projetLocatif?.actif && !d.projetLocatif?.actif },
  { libelle: "Prêt à taux zéro (PTZ) activé", niveauRequis: A, actif: (p, d) => !!p.projetRP?.ptz?.actif && !d.projetRP?.ptz?.actif },
  { libelle: "Frais réels ou montants versés saisis", niveauRequis: A, actif: (p, d) => ["frais", "verses"].some((k) => Object.entries(p[k] ?? {}).some(([c, v]) => !vide(v) && !egal(v, d[k]?.[c]))) },
  { libelle: "Salaire espéré dans 10 ans saisi", niveauRequis: A, actif: (p, d) => !vide(p.salaireDans10Ans) && !egal(p.salaireDans10Ans, d.salaireDans10Ans) },
  { libelle: "Conjoint et foyer pris en compte", niveauRequis: I, actif: (p, d) => !!p.foyer?.actif && !d.foyer?.actif },
  { libelle: "Enfants à charge renseignés", niveauRequis: I, actif: (p) => nombre(p.enfants) > 0 },
  { libelle: "Mensualités de crédits en cours", niveauRequis: I, actif: (p, d) => nombre(p.creditsMensuels) > nombre(d.creditsMensuels) },
  { libelle: "Abondement de l'employeur actif", niveauRequis: I, actif: (p, d) => !!p.abondement?.actif && !d.abondement?.actif },
  { libelle: "Événements de vie prévus", niveauRequis: I, actif: (p) => Array.isArray(p.evenements) && p.evenements.length > 0 },
  { libelle: "Profil de risque choisi à la main", niveauRequis: I, actif: (p, d) => !vide(p.profilRisque) && p.profilRisque !== d.profilRisque },
  { libelle: "Tranche d'imposition saisie à la main", niveauRequis: I, actif: (p, d) => !vide(p.tmi) && !egal(String(p.tmi), String(d.tmi ?? "")) },
  { libelle: "Retraite publique saisie à la main", niveauRequis: I, actif: (p) => !vide(p.retraite?.modePension) && p.retraite.modePension !== "auto" },
  { libelle: "Placements détaillés dans des comptes « Autres »", niveauRequis: I, actif: (p) => Object.entries(p.placements ?? {}).some(([c, v]) => COMPTES_AUTRES.includes(c) && nombre(v) > 0) },
];

/**
 * Réglages masqués au niveau courant dont la valeur diffère des défauts (`defauts` = PROFIL_VIDE, passé en paramètre).
 * Retourne [{ libelle, niveauRequis }], sans doublon.
 */
export function reglagesAvancesActifs(profil, niveau, defauts = {}) {
  const p = profil ?? {}, d = defauts ?? {}, vus = new Set(), liste = [];
  for (const r of REGLES) {
    if (visible(r.niveauRequis, niveau) || vus.has(r.libelle)) continue;
    if (r.actif(p, d)) { vus.add(r.libelle); liste.push({ libelle: r.libelle, niveauRequis: r.niveauRequis }); }
  }
  return liste;
}

/** Le niveau le plus bas qui révèle au moins un des réglages de la liste (pour le bouton « Les voir »). */
export function niveauLePlusBas(liste) {
  return liste.reduce((m, r) => (rang(r.niveauRequis) < rang(m) ? r.niveauRequis : m), liste[0]?.niveauRequis ?? "avance");
}
