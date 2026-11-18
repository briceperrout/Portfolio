// Règle d'architecture : ui/commun.js porte l'état partagé et les helpers DOM transverses ;
// il n'importe JAMAIS app.js ni vues/*. Chaque vue (vues/<nom>.js) exporte rendre<Nom>() et
// monter<Nom>() (écouteurs, appelée une fois par app.js au démarrage) sans effet de bord au niveau module.
export { echapper } from "../utilitaires.js";

// État global de l'application : rempli par app.js (Object.assign) une fois le profil par défaut connu.
export const etat = {};

export const $ = (s) => document.querySelector(s);
export const clone = (x) => JSON.parse(JSON.stringify(x));
export const lire = (o, chemin) => chemin.split(".").reduce((a, k) => (a == null ? undefined : a[k]), o);
export function ecrire(o, chemin, v) {
  const ks = chemin.split(".");
  const dernier = ks.pop();
  const cible = ks.reduce((a, k) => (a[k] ??= {}), o);
  cible[dernier] = v;
}
export function fusion(base, sur) {
  if (sur === undefined || sur === null) return clone(base);
  if (base === null || typeof base !== "object" || typeof sur !== "object" || Array.isArray(base) || Array.isArray(sur)) return clone(sur);
  const r = clone(base);
  for (const k of Object.keys(sur)) r[k] = k in base ? fusion(base[k], sur[k]) : clone(sur[k]);
  return r;
}
export const crochets = { ecriture: null }; // synchronisation multi-appareils (plus bas) : prévenue après chaque écriture locale
export const memo = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) {
    try {
      // Scénario partagé ou simulation What-If en cours : le brouillon enregistré du profil n'est jamais écrasé
      if (k === "profil-v2" && horsSauvegarde()) return;
      localStorage.setItem(k, JSON.stringify(v));
      // Le brouillon du formulaire est rattaché au profil sélectionné : il ne se mélange pas avec un autre profil
      if (k === "profil-v2") localStorage.setItem("profil-v2-de", JSON.stringify(cleProfilCourant()));
      crochets.ecriture?.(k);
    } catch {}
  },
};

// Profil sélectionné (« col:id »), lu dans ce navigateur : utilisable avant le chargement des profils des proches
export function cleProfilCourant() {
  try { if (etat.partage) return "partage:lien"; } catch { /* état pas encore créé */ }
  const c = memo.get("profil-courant") ?? { col: "exemple", id: "exemple" }; return `${c.col}:${c.id}`;
}
// Vrai tant que le profil affiché n'est pas celui qui est enregistré : scénario ouvert par un lien, ou simulation What-If
export function horsSauvegarde() { try { return !!(etat.partage || etat.simulation); } catch { return false; } }
export const keur = (v) => `${Math.round(v / 1000).toLocaleString("fr-FR")} k€`;
export const DEPART_DEFAUT = { pays: "", destination: "ue", valeurTitres: null, plusValuesLatentes: null, moinsValuesLatentes: null, participation50: false, anneesResidence10: null };

// Données par défaut des profils (exemple et vide), partagées par app.js et les vues
export const PTZ_DEFAUT = { actif: false, zone: "B1", tranche: 2, typeOperation: "collectifNeuf", personnes: null, travauxPctCout: 0 };
export const SUCCESSION_DEFAUT = { union: "mariage", regime: "communaute_legale", optionConjoint: "auto", donationDernierVivant: false, enfantsNonCommuns: 0, testament: false, enfantMineurAuFoyer: false, biensPropres: 0, patrimoineConjointPropre: 0, clauseAV: "conjoint_puis_enfants", quotiteAssuranceEmprunteur: 100, donationAnterieure: { annee: null, montantParEnfant: 0 }, projetDonation: { valeur: 0, croissance: 3, annees: 15 } };
export const PROFIL_EXEMPLE = {
  age: 32, salaireNetMensuel: 3200, epargneMensuelle: 1000, depensesMensuelles: 1800, tmi: "30",
  pays: "FR", statutPro: "stable", eligibleLEP: false, creditsMensuels: 0, credits: [],
  comptesEtrangers: [], tauxChange: {}, scpiDetail: { partEtrangere: 0, impotEtranger: 0, delaiJouissanceMois: null },
  futur: { actif: false, age: 40, capital: null, salaire: null, epargne: null },
  proprietaire: false, loyerMensuel: 900,
  placements: { livretA: 22950, ldds: 12000, livretBancaire: 5050, assuranceVie: 25000, assuranceVieUC: 0, pea: 30000, cto: 0, orPhysique: 0, plateformeCrypto: 5000, coldWallet: 0, scpi: 0, per: 0 },
  pea: { ouvert: true, dateOuverture: "2023-03", versements: 26000, etablissement: "Banque traditionnelle" },
  assuranceVie: { ouverte: true, dateOuverture: "2019-06", type: "Banque traditionnelle" },
  projetRP: { actif: true, prix: 320000, type: "ancien", imperatif: false, horizonAnnees: 3, aideFamiliale: 0, ageChoisi: null, departement: "", commune: "", typeLogement: "appartement", surface: null, ptz: { ...PTZ_DEFAUT }, loyerEquivalent: null, chargesCoproMensuelles: null },
  salaireDans10Ans: null, rythmeReequilibrage: "", avPartEuros: 100,
  logement: { usage: "rp", origine: "achat", part: 100, valeur: null, creditRestant: 0, tauxCredit: 1.3, assuranceCredit: 0, finCredit: null, departement: "", commune: "", typeLogement: "appartement", surface: null },
  abondement: { acces: "?", actif: false, plan: "pereco", taux: null, plafond: null, interessement: null, placer: true, surInteressement: false },
  independant: { forme: "", ca: 0, resultat: 0, remunerationNette: 0, capital: 0, distribution: 100, vl: false },
  foyer: { actif: false, statut: "marie" },
  conjoint: { prenom: "", age: 31, salaireNetMensuel: 2400, pea: { ouvert: false, versements: 0, etablissement: "" } },
  succession: clone(SUCCESSION_DEFAUT),
};

export const PROFIL_VIDE = {
  age: 30, salaireNetMensuel: 0, epargneMensuelle: 0, depensesMensuelles: 0, proprietaire: false, loyerMensuel: 0,
  pays: "FR", statutPro: "", eligibleLEP: false, creditsMensuels: 0, credits: [],
  comptesEtrangers: [], tauxChange: {}, scpiDetail: { partEtrangere: 0, impotEtranger: 0, delaiJouissanceMois: null },
  futur: { actif: false, age: null, capital: null, salaire: null, epargne: null },
  placements: {}, pea: { ouvert: false, versements: 0, etablissement: "" }, assuranceVie: { ouverte: false, type: "" },
  projetRP: { actif: false, prix: 0, type: "ancien", imperatif: false, horizonAnnees: 0, aideFamiliale: 0, ageChoisi: null, departement: "", commune: "", typeLogement: "appartement", surface: null, ptz: { ...PTZ_DEFAUT }, loyerEquivalent: null, chargesCoproMensuelles: null },
  salaireDans10Ans: null, rythmeReequilibrage: "", avPartEuros: 100,
  logement: { usage: "rp", origine: "achat", part: 100, valeur: null, creditRestant: 0, tauxCredit: null, assuranceCredit: 0, finCredit: null, departement: "", commune: "", typeLogement: "appartement", surface: null },
  abondement: { acces: "?", actif: false, plan: "pereco", taux: null, plafond: null, interessement: null, placer: true, surInteressement: false },
  independant: { forme: "", ca: 0, resultat: 0, remunerationNette: 0, capital: 0, distribution: 100, vl: false },
  foyer: { actif: false, statut: "marie" },
  conjoint: { prenom: "", age: 30, salaireNetMensuel: 0, pea: { ouvert: false, versements: 0, etablissement: "" } },
  succession: clone(SUCCESSION_DEFAUT),
};

// Profils des proches : état partagé par app.js et les vues (Suivi, calendrier)
export const proches = {
  liste: [], situations: [], auteur: false, moi: null, mode: "local", // local | partage | lecture
  courant: memo.get("profil-courant") ?? { col: "exemple", id: "exemple" },
  reference: null, statut: "", zone: null, minuteur: null, enCours: false,
};
export function cle(c) { return `${c.col}:${c.id}`; }
export function docCourant() { return (proches.courant.col === "profils" ? proches.liste : proches.courant.col === "situations" ? proches.situations : []).find((d) => d.id === proches.courant.id); }

// Géométrie commune des graphiques SVG (trajectoire, Suivi)
export const GEOM = { W: 680, H: 280, g: 62, d: 16, h: 18, b: 30 };

// Couleurs : ordre catégoriel validé (adjacent), bourse → SCPI
export const ORDRE = ["bourse", "bitcoin", "prudent", "or", "projet", "securite", "scpi"];
export const COULEUR = { bourse: "--s1", bitcoin: "--s2", prudent: "--s3", or: "--s4", projet: "--s5", securite: "--s6", scpi: "--s7" };

// Types d'événements de vie (menu et libellés des bascules du plan)
export const TYPES_EV = [["entree", "Rentrée d'argent"], ["depense", "Dépense"], ["pause", "Pause d'épargne"]];

// Cède la main au navigateur entre deux calculs longs
export const pause = () => new Promise((r) => setTimeout(r, 0));
