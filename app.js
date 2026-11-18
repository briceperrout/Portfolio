import { PLAN } from "./plan.js";
import { analyserTaux, DEVISES, NOM_DEVISE, devisesParDefaut, DEVISES_COMPTES, TYPES_COMPTES_ETRANGERS, TAUX_REFERENCE, tauxEffectifs, consoliderEtrangers, avecComptesEtrangers, expositionChange } from "./devises.js";
import { analyser, capitalDe, GROUPES_PLACEMENTS, grouperAllocation, totalGroupe, groupePersonnalise, repartirGroupe, contratsApresRepartition, repartirCapitalPrudent, eur, pct, pretTauxZero, profilRisque, dureeTexte, diagnosticAchat, facteurSalaire, carriereDe, hausseReelle, normaliserFoyer, consequencesDepart, NOTE_CONSEQUENCES_DEPART } from "./moteur.js";
import { projetLocatifDe, analyseLocatif, mensualitePret } from "./locatif.js";
import { comparerFrais, FRAIS_CHARGE, FRAIS_OPTIMISE, achatPourProjection, comparaisonAchatLocation, projeter, projeterCentral, libertePatrimoine, moisPrecaution, referenceSuivi, prevuA, moisEntre, situationFuture, contexteRetraite, evaluerRetraite, capitalNecessaire, CRISES, simulerCrise, fluxLocatif, backtesterHistorique, scenarioInflation, SCENARIO_INFLATION } from "./projection.js";
import { HISTORIQUE } from "./historique.js";
import { SCENARIOS_FISCAUX, NEUTRE, optionFiscale, comparerTaux } from "./evolution-fiscale.js";
import { echeancesProfil, echeancesGenerales, versCSV } from "./calendrier.js";
import { genererRecapHTML, encoderProfilPartage, decoderProfilPartage } from "./recap.js";
import { FICHES as CONTENU_FICHES, VERIFIE_LE, PARCOURS_DEBUTANT } from "./fiches.js";
import { LEXIQUE, lierTermes } from "./lexique.js";
import { DEPARTEMENTS, chargerPrix, prixCharges, estimer, estimerLoyer, libelleCommune, chercherCommunes, codeCommune } from "./immobilier.js";
import { estimerPension, ageEnTexte } from "./pension.js";
import { entreeDepuisProfil, simulerSuccession, comparerOptionsConjoint, simulerDonationNP, optionsPossibles, reserveAVTransmissible } from "./succession.js";
import { decomposerSalaire, foyerFiscal, impotBareme, tauxMarginalEffectif, BAREME, exitTax, PRELEVEMENTS, PFU, PLAFONDS, ABATTEMENT_AV, SEUIL_PRIMES_AV, alerteMillesime } from "./fiscal.js";
import { ENTREPRISES, OFFRES_ACTIONS, PRIMES } from "./entreprises.js";
import { plafondPEREstime, revenuImposableDe, economieInteressement, endettementBancaire, lepEstime, simulerIndependant, lireReleveColle, lireFichierReleve, releveDepuisImport, calculerPRU, COMPTES_PRU, TAILLE_MAX_FICHIER, etatReleve, comparerReleve } from "./moteur.js";
import { monterAssistant } from "./assistant.js";
import { masquerTexte, contientMontant } from "./discretion.js";
import { detecterAlertes } from "./alertes.js";
import { NIVEAUX, INFOS_NIVEAUX, visible, reglagesAvancesActifs, niveauLePlusBas, nomVue, libelleOnglet, suiteVue } from "./niveaux.js";
import { genererCode, extraireCode, formaterCode, creerLien, estCleSynchronisable, synchroniser, effacerDistant, oublierCles } from "./sync.js";

// ---------------------------------------------------------------- outils
const $ = (s) => document.querySelector(s);
const clone = (x) => JSON.parse(JSON.stringify(x));
const lire = (o, chemin) => chemin.split(".").reduce((a, k) => (a == null ? undefined : a[k]), o);
function ecrire(o, chemin, v) {
  const ks = chemin.split(".");
  const dernier = ks.pop();
  const cible = ks.reduce((a, k) => (a[k] ??= {}), o);
  cible[dernier] = v;
}
function fusion(base, sur) {
  if (sur === undefined || sur === null) return clone(base);
  if (base === null || typeof base !== "object" || typeof sur !== "object" || Array.isArray(base) || Array.isArray(sur)) return clone(sur);
  const r = clone(base);
  for (const k of Object.keys(sur)) r[k] = k in base ? fusion(base[k], sur[k]) : clone(sur[k]);
  return r;
}
let hookEcriture = null; // synchronisation multi-appareils (plus bas) : prévenue après chaque écriture locale
const memo = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) {
    try {
      // Scénario partagé ou simulation What-If en cours : le brouillon enregistré du profil n'est jamais écrasé
      if (k === "profil-v2" && horsSauvegarde()) return;
      localStorage.setItem(k, JSON.stringify(v));
      // Le brouillon du formulaire est rattaché au profil sélectionné : il ne se mélange pas avec un autre profil
      if (k === "profil-v2") localStorage.setItem("profil-v2-de", JSON.stringify(cleProfilCourant()));
      hookEcriture?.(k);
    } catch {}
  },
};

// Niveau de lecture (Débutant / Intermédiaire / Avancé) : lu au plus tôt pour éviter un flash d'affichage complet.
// Mémorisé par appareil (clé « niveau »), jamais synchronisé : estCleSynchronisable() ne l'accepte pas.
const NIVEAU_MEMORISE = memo.get("niveau");
const PREMIER_LANCEMENT = !NIVEAUX.includes(NIVEAU_MEMORISE);
const DONNEES_EXISTANTES = PREMIER_LANCEMENT && [memo.get("profil-v2"), memo.get("local-profils")].some((v) => v && typeof v === "object" && Object.keys(v).length > 0);
document.documentElement.dataset.niveau = PREMIER_LANCEMENT ? (DONNEES_EXISTANTES ? "avance" : "debutant") : NIVEAU_MEMORISE;
// Profil sélectionné (« col:id »), lu dans ce navigateur : utilisable avant le chargement des profils des proches
function cleProfilCourant() {
  try { if (etat.partage) return "partage:lien"; } catch { /* état pas encore créé */ }
  const c = memo.get("profil-courant") ?? { col: "exemple", id: "exemple" }; return `${c.col}:${c.id}`;
}
// Vrai tant que le profil affiché n'est pas celui qui est enregistré : scénario ouvert par un lien, ou simulation What-If
function horsSauvegarde() { try { return !!(etat.partage || etat.simulation); } catch { return false; } }
const echapper = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const keur = (v) => `${Math.round(v / 1000).toLocaleString("fr-FR")} k€`;

// Couleurs : ordre catégoriel validé (adjacent), bourse → SCPI
const ORDRE = ["bourse", "bitcoin", "prudent", "or", "projet", "securite", "scpi"];
const COULEUR = { bourse: "--s1", bitcoin: "--s2", prudent: "--s3", or: "--s4", projet: "--s5", securite: "--s6", scpi: "--s7" };
const FICHES = Object.fromEntries(CONTENU_FICHES.map((f) => [f.id, f.titre]));
const texteLie = (t, exclure) => lierTermes(echapper(t), { exclure });
const lienFiche = (id, texte) => (FICHES[id] ? `<a class="lien-fiche" href="#fiche-${id}">${texte ?? `Fiche ${FICHES[id]}`}</a>` : "");

// ---------------------------------------------------------------- état
const PTZ_DEFAUT = { actif: false, zone: "B1", tranche: 2, typeOperation: "collectifNeuf", personnes: null, travauxPctCout: 0 };
const SUCCESSION_DEFAUT = { union: "mariage", regime: "communaute_legale", optionConjoint: "auto", donationDernierVivant: false, enfantsNonCommuns: 0, testament: false, enfantMineurAuFoyer: false, biensPropres: 0, clauseAV: "conjoint_puis_enfants", quotiteAssuranceEmprunteur: 100, donationAnterieure: { annee: null, montantParEnfant: 0 }, projetDonation: { valeur: 0, croissance: 3, annees: 15 } };
const DEPART_DEFAUT = { pays: "", destination: "ue", valeurTitres: null, plusValuesLatentes: null, moinsValuesLatentes: null, participation50: false, anneesResidence10: null };
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
const INDEPENDANT_VIDE = { forme: "", ca: 0, resultat: 0, remunerationNette: 0, capital: 0, distribution: 100, vl: false };
const COURANT_INITIAL = memo.get("profil-courant") ?? { col: "exemple", id: "exemple" };

// Lien magique : « #mon-profil?p=<code> » (voir recap.js). Retourne { code, profil } ou null si absent ou invalide.
function lireProfilPartage(hash = location.hash) {
  const i = hash.indexOf("?");
  if (i < 0) return null;
  const code = new URLSearchParams(hash.slice(i + 1)).get("p");
  const brut = decoderProfilPartage(code);
  return brut ? { code, profil: completerProfil(fusion(PROFIL_VIDE, brut)) } : null;
}
const PARTAGE_INITIAL = lireProfilPartage();

const etat = {
  partage: PARTAGE_INITIAL?.code ?? null, // code du scénario ouvert par un lien (non enregistré), sinon null
  simulation: null,                       // { base } pendant une simulation What-If (non enregistrée)
  reference: clone(PLAN),     // dernier plan enregistré (ou défaut)
  brouillon: clone(PLAN),     // plan en cours d'édition, appliqué en direct
  source: "defaut",           // defaut | partage | local
  majLe: null,
  // Brouillon repris seulement s'il appartient au profil sélectionné (anciens brouillons sans étiquette : repris comme avant)
  profil: PARTAGE_INITIAL?.profil ?? completerProfil(fusion(COURANT_INITIAL.col === "exemple" ? PROFIL_EXEMPLE : PROFIL_VIDE,
    (() => { const de = memo.get("profil-v2-de"); return de == null || de === `${COURANT_INITIAL.col}:${COURANT_INITIAL.id}` ? memo.get("profil-v2") : null; })())),
  db: null,
  peutEnregistrer: false,
  // Seul l'auteur (droit de modifier la page) peut changer le plan. Hors de
  // claude.ai (aperçu local), pas de droits à vérifier.
  auteur: !window.claude,
  chargement: true,
  tauxDuJour: null,           // taux de change du jour (BCE) : rempli plus tard, jamais enregistré ; sinon taux de référence de devises.js
};
const modifie = () => JSON.stringify(etat.brouillon) !== JSON.stringify(etat.reference);

// Profil passé aux calculs : le profil enregistré + le total converti des comptes étrangers dans placements.comptesEtrangers
// (dérivé ici, jamais écrit dans etat.profil, donc jamais sauvegardé, exporté ni synchronisé).
function profilDeCalcul(profil = etat.profil) { return avecComptesEtrangers(profil, tauxEffectifs(profil, etat.tauxDuJour).taux); }
function profilPourMoteur() { return profilDeCalcul(normaliserProfil(etat.profil)); }
// Profil utilisé par « Rééquilibrage » : la situation d'aujourd'hui, ou celle d'un âge futur
function profilSimule() {
  const p = profilPourMoteur();
  if (!p.futur?.actif) return { profil: p, futur: null };
  const f = situationFuture(etat.brouillon, p, { age: p.futur.age ?? p.age + 10, capital: p.futur.capital, salaire: p.futur.salaire, epargne: p.futur.epargne });
  return { profil: f.profil, futur: f };
}
// Profils enregistrés avant la case « Assurance-vie déjà ouverte » : on la déduit
function completerProfil(p) {
  // Âges réalistes : entre 18 et 120 ans
  const borne = (x) => (x == null || x === "" ? x : Math.min(120, Math.max(18, Number(x) || 18)));
  p.age = borne(p.age);
  if (p.conjoint) p.conjoint.age = borne(p.conjoint.age);
  if (p.futur?.age != null) p.futur.age = borne(p.futur.age);
  p.logement = { usage: "rp", origine: "achat", part: 100, typeLogement: "appartement", ...(p.logement ?? {}) };
  p.projetRP = { typeLogement: "appartement", loyerEquivalent: null, chargesCoproMensuelles: null, ...(p.projetRP ?? {}), ptz: { ...PTZ_DEFAUT, ...(p.projetRP?.ptz ?? {}) } };
  const acces0 = p.abondement?.acces ?? (p.abondement?.actif ? (p.abondement.plan === "pee" ? "pee" : "per") : "?");
  p.abondement = { actif: false, plan: "pereco", taux: null, plafond: null, interessement: null, placer: true, surInteressement: false, ...(p.abondement ?? {}), acces: acces0 };
  p.succession = { ...SUCCESSION_DEFAUT, ...(p.succession ?? {}), donationAnterieure: { ...SUCCESSION_DEFAUT.donationAnterieure, ...(p.succession?.donationAnterieure ?? {}) }, projetDonation: { ...SUCCESSION_DEFAUT.projetDonation, ...(p.succession?.projetDonation ?? {}) } };
  p.simulationDepart = { ...DEPART_DEFAUT, ...(p.simulationDepart ?? {}) };
  if (!Array.isArray(p.comptesEtrangers)) p.comptesEtrangers = [];
  if (!p.tauxChange || typeof p.tauxChange !== "object" || Array.isArray(p.tauxChange)) p.tauxChange = {};
  if (p.placements) delete p.placements.comptesEtrangers; // solde dérivé au calcul, jamais enregistré
  p.assuranceVie ??= {};
  if (p.assuranceVie.ouverte == null) p.assuranceVie.ouverte = !!(p.assuranceVie.type || p.assuranceVie.dateOuverture || (p.placements?.assuranceVie ?? 0) + (p.placements?.assuranceVieUC ?? 0) > 0);
  return p;
}
// Phrase sur le taux d'impôt appliqué aux loyers (tranche retenue, changement de tranche, décote)
const A_MAX = () => etat.brouillon?.achatRP?.tauxEndettementMax ?? 35;
function texteTauxLoyers(T, debut = "") {
  if (!T) return "";
  const t = pct(T.taux);
  const pourquoi = T.parSaisie ? `ta tranche saisie (${T.tmiSans < T.taux ? `plus haute que celle de ton salaire seul, ${T.tmiSans} %` : `${pct(T.taux)}`})`
    : T.franchit ? `tes loyers font passer une partie de tes revenus de la tranche à ${T.tmiSans} % à celle à ${T.tmiAvec} %`
    : Math.abs(T.taux - T.tmiSans) > 1 && T.tmiSans > 0 ? `tranche à ${T.tmiSans} %, plus la décote qui diminue quand les revenus montent`
    : `tranche à ${T.tmiSans} %${T.estimee ? ", estimée depuis ton salaire" : ""}`;
  return `${debut}Impôt sur les loyers calculé à <b>${t}</b> (${pourquoi}), plus 17,2 % de prélèvements sociaux. Si tu as d'autres revenus que ton salaire, indique ta tranche dans « Ton budget ».`;
}

// Taux d'endettement selon la règle des banques (HCSF) : aujourd'hui, puis après chaque projet
let minuteurEndettement = null;
function planifierEndettement(p) { clearTimeout(minuteurEndettement); minuteurEndettement = setTimeout(() => rendreEndettement(p), 150); }
function rendreEndettement(p) {
  const el = $("#jauge-endettement");
  if (!el) return;
  let E = null;
  try { E = Number(p.salaireNetMensuel) > 0 ? endettementBancaire(etat.brouillon, normaliserFoyer(etat.brouillon, normaliserProfil(p))) : null; } catch (e) { console.error(e); }
  if (!E) { el.innerHTML = `<p class="note" style="margin:0">Indique ton salaire pour voir ton taux d'endettement.</p>`; return; }
  const echelle = Math.max(50, E.max + 10);
  const lignes = E.lignes.map((l) => {
    if (l.introuvable) return `<li><div class="endet-tete"><span>${l.libelle}</span><span class="small muted">aucun âge d'achat possible pour l'instant</span></div></li>`;
    const t = l.taux ?? 0, ok = t <= E.max + 0.05;
    const revenus = [`salaire net avant impôt ${eur(l.salaireAvant)}`, l.loyers70 > 0.5 ? `70 % des loyers ${eur(l.loyers70)}` : null].filter(Boolean).join(" + ");
    const credits = (l.cle === "rp"
      ? [l.charges - l.mensRP > 0.5 ? `crédits en cours ${eur(l.charges - l.mensRP)}` : null, `nouvelle résidence ${eur(l.mensRP)}`]
      : [l.conso > 0 ? `crédits à la consommation ${eur(l.conso)}` : null, l.mensLogement > 0 ? `logement actuel ${eur(l.mensLogement)}` : null, l.mensRP > 0 ? `résidence principale ${eur(l.mensRP)}` : null, l.mensLocatif > 0 ? `bien locatif ${eur(l.mensLocatif)}` : null]).filter(Boolean);
    const marge = (E.max / 100) * l.revenus - l.charges;
    return `<li><div class="endet-tete"><span>${l.libelle}</span><span class="num">${pct(t)}<span class="endet-etat ${ok ? "ok" : "ko"}">${ok ? "✓ sous" : "⚠ au-dessus de"} ${E.max} %</span></span></div>
      <div class="endet-barre" role="img" aria-label="${pct(t)} pour ${E.max} % maximum"><span class="${ok ? "ok" : "ko"}" style="width:${Math.min(100, (100 * t) / echelle).toFixed(1)}%"></span><i style="left:${((100 * E.max) / echelle).toFixed(1)}%"></i></div>
      <div class="small muted">Revenus comptés : ${eur(l.revenus)} par mois (${revenus}). Crédits : ${credits.length > 1 ? `${credits.join(" + ")} = ${eur(l.charges)}` : credits.length ? credits[0] : "aucun"}. ${!ok ? `Dépassement : ${eur(-marge)} de mensualité en trop.` : marge < 20 ? "Au maximum autorisé : l'apport couvre le reste." : `Marge : encore ${eur(marge)} de mensualité possible.`}</div></li>`;
  }).join("");
  const Lk = E.lignes.find((l) => l.cle === "locatif" && l.taux > E.max + 0.05), noteL = $("#note-projet-locatif");
  if (Lk && noteL && p.projetLocatif?.actif) noteL.insertAdjacentHTML("beforeend", `<br><b>⚠ Banque :</b> avec ce projet, ton taux d'endettement monterait à ${pct(Lk.taux)} (maximum ${E.max} %) : la banque refuserait ce prêt, donc <b>Trajectoire et Retraite ne le comptent pas</b>. Plus d'apport, un crédit plus long, un bien moins cher ou un achat plus tard le font baisser (voir « Ton taux d'endettement » plus bas).`);
  el.innerHTML = `<ul class="endettement">${lignes}</ul>
    <p class="note" style="margin:10px 0 0">Le trait marque le maximum de ${E.max} % (assurance comprise). Au-dessus, la banque refuse en général ; elle peut déroger pour une partie de ses dossiers, surtout pour une résidence principale. Montants de chaque époque, salaire selon ton évolution de carrière${p.foyer?.actif ? ` ; foyer à deux salaires${p.foyer?.statut === "concubin" ? " (chacun imposé séparément)" : ""}` : ""}. Le détail de l'achat est dans « Trajectoire ».</p>`;
}

function normaliserProfil(source) {
  const p = clone(source);
  if (p.assuranceVie?.ouverte === false) p.assuranceVie = { ouverte: false, type: "" };
  if (p.proprietaire && (p.logement?.usage ?? "rp") === "rp") p.loyerMensuel = 0;
  if (!p.pea?.ouvert) p.pea = { ouvert: false, versements: 0 };
  p.independant = { ...INDEPENDANT_VIDE, ...(p.independant ?? {}) };
  p.projetRP = { ...(p.projetRP ?? {}), ptz: { ...PTZ_DEFAUT, ...(p.projetRP?.ptz ?? {}) } };
  // Personnes du foyer pour le plafond du PTZ, si non saisies : toi, ton conjoint s'il y en a un, et les enfants
  if (!(Number(p.projetRP.ptz.personnes) > 0)) p.projetRP.ptz.personnes = 1 + (p.foyer?.actif ? 1 : 0) + Math.max(0, Math.round(Number(p.enfants) || 0));
  // Tranche d'imposition non saisie : estimée à partir des revenus (barème 2026)
  const indep = (p.tmi === "" || p.tmi == null) && p.statutPro === "independant" ? simulerIndependant(etat.brouillon, p, false) : null;
  if (indep) {
    p.tmi = indep.tmi;
    p.tmiEstimee = true;
  } else if ((p.tmi === "" || p.tmi == null) && Number(p.salaireNetMensuel) > 0) {
    p.tmi = decomposerSalaire(p.salaireNetMensuel, foyerFiscal(p)).tmi;
    p.tmiEstimee = true;
  }
  // Retraite publique : estimée automatiquement pour chaque âge d'arrêt possible (moins de trimestres = décote)
  const rr = (p.retraite ??= {});
  rr.priorite = rr.priorite === "consommer" ? "consommer" : "transmettre";
  p.assuranceVie ??= {};
  p.assuranceVie.versementsApres70 ??= 0;
  const mode = rr.modePension ?? "auto";
  if (mode === "zero") { rr.pension = 0; rr.pensionParAge = null; }
  else if (mode === "auto") {
    rr.pension = 0; rr.pensionParAge = null;
    if (Number(p.salaireNetMensuel) > 0 && Number(p.age) > 0) {
      try {
        const plan = etat.brouillon, legal = plan.hypotheses?.ageRetraite ?? 64, parAge = {};
        for (let a = Math.ceil(Number(p.age)); a <= legal; a++) {
          const est = estimerPension(plan, p, { ageDebut: rr.ageDebutCarriere, trimestresDeja: rr.trimestresDeja, ageArret: a, ageDemande: rr.ageDemande, trimestresEnfants: rr.trimestresEnfants });
          parAge[a] = { pension: Math.round(est.demande.apres / 10) * 10, agePension: Math.ceil(est.demande.age), trimestres: est.trimestres, requis: est.regles.trimestres, decote: est.demande.decote };
        }
        rr.pensionParAge = parAge;
        const x = parAge[Math.min(legal, Math.round(Number(rr.ageDepart) || legal))] ?? parAge[legal];
        if (x) { rr.pension = x.pension; rr.agePension = x.agePension; }
      } catch (e) { /* profil incomplet */ }
    }
  }
  return p;
}

// ---------------------------------------------------------------- statut
function rendreStatut() {
  const el = $("#statut");
  el.classList.toggle("sale", modifie());
  if (modifie()) el.textContent = "Modifications non enregistrées";
  else if (etat.source === "partage") el.textContent = `Plan enregistré le ${new Date(etat.majLe).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })}`;
  else if (etat.source === "local") el.textContent = "Plan enregistré dans ce navigateur";
  else el.textContent = etat.chargement ? "Chargement du plan…" : "Plan par défaut";
  $("#btn-enregistrer").disabled = !modifie() || !etat.peutEnregistrer;
  $("#btn-annuler").disabled = !modifie();
}

// ---------------------------------------------------------------- résultats
function blocAllocation(res, compact = false) {
  const plan = etat.brouillon;
  const C = res.capital || 1;
  const classes = ORDRE.filter((c) => plan.classes[c] && (res.alloc[c] > 0.5 || res.actuel[c] > 0.5));
  const risque = ["bourse", "bitcoin", "or", "scpi"].reduce((s, c) => s + (res.alloc[c] ?? 0), 0);
  const segs = classes.filter((c) => res.alloc[c] > 0.5).map((c) => {
    const part = (100 * res.alloc[c]) / C;
    return `<div class="seg" tabindex="0" style="flex-grow:${res.alloc[c]};background:var(${COULEUR[c]})"
      data-bulle="${echapper(`${plan.classes[c].libelle} · ${eur(res.alloc[c])} · ${pct(part)}`)}"
      aria-label="${echapper(`${plan.classes[c].libelle} : ${eur(res.alloc[c])}, ${pct(part)}`)}"></div>`;
  }).join("");
  const ecart = (v) => (Math.abs(v) < 0.5 ? '<span class="muted">0 €</span>' : `<span class="${v > 0 ? "ecart-plus" : "ecart-moins"}">${v > 0 ? "+" : "−"}${eur(Math.abs(v))}</span>`);
  const lignes = classes.map((c) => `<tr><td><span class="pastille" style="background:var(${COULEUR[c]})"></span>${plan.classes[c].libelle}</td>
    <td class="m">${eur(res.actuel[c])}</td><td class="m">${eur(res.alloc[c])}</td><td class="m">${pct((100 * res.alloc[c]) / C)}</td><td class="m">${ecart(res.alloc[c] - res.actuel[c])}</td></tr>`).join("");
  return `
    <div class="chiffres">
      <div><b class="num">${eur(res.capital)}</b><span>capital</span></div>
      <div><b class="num">${pct((100 * risque) / C)}</b><span>en actifs risqués (cible)</span></div>
      <div><b class="num">${eur(res.alloc.securite + res.alloc.projet)}</b><span>à l'abri (sécurité + apport)</span></div>
    </div>
    <div class="barre" role="img" aria-label="Répartition cible">${segs}</div>
    ${compact
      ? `<div class="legende">${classes.filter((c) => res.alloc[c] > 0.5).map((c) => `<span><span class="pastille" style="background:var(${COULEUR[c]})"></span>${plan.classes[c].libelle} <b class="num">${eur(res.alloc[c])}</b></span>`).join("")}</div>`
      : `<div class="table-wrap"><table><thead><tr><th>Classe</th><th class="m">Actuel</th><th class="m">Cible</th><th class="m">Part</th><th class="m">Écart</th></tr></thead><tbody>${lignes}</tbody></table></div>
         <ol class="etapes">${res.etapes.map((e) => `<li>${texteLie(e)}</li>`).join("")}</ol>`}`;
}

function graphiqueAchat(achat) {
  const fin = Math.min(achat.serie.length, achat.ideal ? achat.ideal.annees + 8 : 25);
  const pts = achat.serie.slice(0, Math.max(2, fin));
  if (pts.length < 2) return "";
  const W = 640, H = 240, g = 58, d = 16, h = 14, b = 28;
  const ymax = Math.max(...pts.map((p) => Math.max(p.apport, p.apportRequis))) * 1.08 || 1;
  const x = (i) => g + (i * (W - g - d)) / (pts.length - 1);
  const y = (v) => H - b - (v * (H - b - h)) / ymax;
  const ligne = (k) => pts.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p[k]).toFixed(1)}`).join("");
  const graduations = [0, 0.25, 0.5, 0.75, 1].map((t) => ymax * t / 1.08);
  const pasX = Math.ceil(pts.length / 8);
  let svg = `<svg class="graphe" viewBox="0 0 ${W} ${H}" role="img" aria-label="Apport disponible et apport nécessaire selon l'âge">`;
  for (const v of graduations) svg += `<line class="grille-l" x1="${g}" x2="${W - d}" y1="${y(v)}" y2="${y(v)}"/><text x="${g - 8}" y="${y(v) + 4}" text-anchor="end">${keur(v)}</text>`;
  pts.forEach((p, i) => { if (i % pasX === 0) svg += `<text x="${x(i)}" y="${H - 8}" text-anchor="middle">${p.age} ans</text>`; });
  svg += `<line class="axe" x1="${g}" x2="${W - d}" y1="${H - b}" y2="${H - b}"/>`;
  if (achat.ideal) {
    const i = achat.ideal.annees;
    if (i < pts.length) svg += `<line x1="${x(i)}" x2="${x(i)}" y1="${h}" y2="${H - b}" stroke="var(--accent)" stroke-width="1.5" stroke-dasharray="4 4"/><text x="${Math.min(x(i) + 6, W - 120)}" y="${h + 10}" style="fill:var(--fg);font-weight:600">Âge idéal : ${achat.ideal.age} ans</text>`;
  }
  svg += `<path d="${ligne("apportRequis")}" fill="none" stroke="var(--s2)" stroke-width="2" stroke-linejoin="round"/>`;
  svg += `<path d="${ligne("apport")}" fill="none" stroke="var(--s1)" stroke-width="2" stroke-linejoin="round"/>`;
  svg += `<line id="curseur-achat" class="curseur" x1="0" x2="0" y1="${h}" y2="${H - b}" stroke="var(--faint)" stroke-width="1" visibility="hidden"/>`;
  pts.forEach((p, i) => {
    const l = (W - g - d) / (pts.length - 1);
    svg += `<rect x="${x(i) - l / 2}" y="${h}" width="${l}" height="${H - b - h}" fill="transparent" data-x="${x(i)}" data-curseur="curseur-achat"
      data-bulle="${echapper(`${p.age} ans · apport disponible ${eur(p.apport)} · apport nécessaire ${eur(p.apportRequis)} · prêt max ${eur(p.pretMax)} sur ${p.duree} ans`)}"/>`;
  });
  svg += `</svg>`;
  return `${svg}<div class="legende-g"><span><span class="trait" style="background:var(--s1)"></span>Apport disponible</span><span><span class="trait" style="background:var(--s2)"></span>Apport nécessaire</span></div>`;
}

// Coûts du propriétaire, prêt à taux zéro et comparaison acheter / louer, pour l'achat retenu
function graphiqueAcheterLouer(r) {
  const pts = r.serie;
  if (pts.length < 2) return "";
  const W = 640, H = 240, g = 58, d = 16, h = 14, b = 28;
  const tous = pts.flatMap((p) => [p.patrimoineAcheteur, p.patrimoineLocataire]);
  const ymax = Math.max(1, ...tous) * 1.08, ymin = Math.min(0, ...tous);
  const x = (i) => g + (i * (W - g - d)) / (pts.length - 1);
  const y = (v) => H - b - ((v - ymin) * (H - b - h)) / (ymax - ymin);
  const ligne = (k) => pts.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p[k]).toFixed(1)}`).join("");
  const pasX = Math.ceil(pts.length / 8);
  let svg = `<svg class="graphe" viewBox="0 0 ${W} ${H}" role="img" aria-label="Patrimoine de l'acheteur et du locataire selon la durée">`;
  for (const t of [0, 0.25, 0.5, 0.75, 1]) { const v = ymin + ((ymax - ymin) * t) / 1.08; svg += `<line class="grille-l" x1="${g}" x2="${W - d}" y1="${y(v)}" y2="${y(v)}"/><text x="${g - 8}" y="${y(v) + 4}" text-anchor="end">${keur(v)}</text>`; }
  pts.forEach((p, i) => { if (i === pts.length - 1 || (i % pasX === 0 && pts.length - 1 - i >= pasX)) svg += `<text x="${x(i)}" y="${H - 8}" text-anchor="middle">${p.annee} ans</text>`; });
  svg += `<line class="axe" x1="${g}" x2="${W - d}" y1="${y(0)}" y2="${y(0)}"/>`;
  if (r.pointMort != null) {
    const i = r.pointMort;
    svg += `<line x1="${x(i)}" x2="${x(i)}" y1="${h}" y2="${H - b}" stroke="var(--accent)" stroke-width="1.5" stroke-dasharray="4 4"/><text x="${Math.min(x(i) + 6, W - 130)}" y="${h + 10}" style="fill:var(--fg);font-weight:600">Point mort : ${r.pointMort} ans</text>`;
  }
  svg += `<path d="${ligne("patrimoineLocataire")}" fill="none" stroke="var(--s2)" stroke-width="2" stroke-linejoin="round"/>`;
  svg += `<path d="${ligne("patrimoineAcheteur")}" fill="none" stroke="var(--s1)" stroke-width="2" stroke-linejoin="round"/>`;
  svg += `<line id="curseur-al" class="curseur" x1="0" x2="0" y1="${h}" y2="${H - b}" stroke="var(--faint)" stroke-width="1" visibility="hidden"/>`;
  pts.forEach((p, i) => {
    const l = (W - g - d) / (pts.length - 1);
    svg += `<rect x="${x(i) - l / 2}" y="${h}" width="${l}" height="${H - b - h}" fill="transparent" data-x="${x(i)}" data-curseur="curseur-al" data-bulle="${echapper(`${p.annee === 0 ? "Au départ" : `Après ${p.annee} an${p.annee > 1 ? "s" : ""}`} · acheteur ${eur(p.patrimoineAcheteur)} · locataire ${eur(p.patrimoineLocataire)}`)}"/>`;
  });
  svg += `</svg>`;
  return `${svg}<div class="legende-g"><span><span class="trait" style="background:var(--s1)"></span>Patrimoine de l'acheteur</span><span><span class="trait" style="background:var(--s2)"></span>Patrimoine du locataire</span></div>`;
}

function blocCoutsEtAcheterLouer(res) {
  const plan = etat.brouillon, A = plan.achatRP, p = res.profil;
  let ap = null;
  try { ap = achatPourProjection(plan, p); } catch (e) { console.error(e); }
  if (!ap) return "";
  const c = ap.charges;
  const ligne = (lib, v) => `<tr><td>${lib}</td><td class="m"><span class="num">${eur(v)}</span></td><td class="m"><span class="num">${eur(v / 12)}</span></td></tr>`;
  const couts = `<h3 style="margin:16px 0 4px">Ce que coûte d'être propriétaire</h3>
    <div class="table-wrap"><table><thead><tr><th>Charge</th><th class="m">Par an</th><th class="m">Par mois</th></tr></thead><tbody>
      ${ligne("Taxe foncière", c.taxeFonciere)}${ligne("Copropriété non récupérable", c.copro)}${ligne("Entretien", c.entretien)}
      <tr><td><b>Total</b></td><td class="m"><b class="num">${eur(c.totalAnnuel)}</b></td><td class="m"><b class="num">${eur(c.totalMensuel)}</b></td></tr>
    </tbody></table></div>
    <p class="note" style="margin:6px 0 0">Loyer de référence pour la taxe foncière : <span class="num">${eur(c.loyerMarcheRetenu)}</span> par mois (${c.sourceLoyer === "marche" ? "loyer de marché" : `par défaut : ${String(A.chargesProprietaire.rendementLocatifBrutDefaut).replace(".", ",")} % du prix par an`}). ${lienFiche("acheter-louer", "Fiche : acheter ou louer")}</p>`;

  // Prêt à taux zéro
  let ptzHTML = "";
  const saisie = p.projetRP?.ptz;
  if (saisie?.actif) {
    if (ap.ptz?.eligible) {
      const z = ap.ptz, sans = mensualitePret(ap.pret, A.tauxCredit, ap.duree, A.tauxAssuranceEmprunteur);
      ptzHTML = `<h3 style="margin:16px 0 4px">Financement avec le prêt à taux zéro</h3>
        <div class="table-wrap"><table><thead><tr><th>Prêt</th><th class="m">Montant</th><th class="m">Taux</th><th class="m">Durée</th></tr></thead><tbody>
          <tr><td>Prêt bancaire</td><td class="m"><span class="num">${eur(ap.pretBancaire)}</span></td><td class="m">${pct(A.tauxCredit)}</td><td class="m">${ap.duree} ans</td></tr>
          <tr><td>Prêt à taux zéro (${z.quotite} % du coût)</td><td class="m"><span class="num">${eur(z.montant)}</span></td><td class="m">0 %</td><td class="m">${z.differe > 0 ? `différé ${z.differe} ans, puis ` : ""}${z.remboursement} ans</td></tr>
        </tbody></table></div>
        <p class="note" style="margin:6px 0 0">Mensualité lissée, assurance comprise : <b class="num">${eur(ap.mensualite)}</b> par mois, contre <span class="num">${eur(sans)}</span> sans PTZ. Plafond d'opération retenu : <span class="num">${eur(z.plafondOperation)}</span>. ${lienFiche("ptz", "Fiche : le prêt à taux zéro")}</p>
        ${ap.lissageImpossible ? `<p class="verdict ko"><b>Lissage impossible</b> : la part du PTZ dépasse la mensualité du prêt principal. La banque garde une mensualité classique et le PTZ s'y ajoute : la mensualité totale n'est pas constante.</p>` : ""}`;
    } else {
      const cout = ap.apportRequis + ap.pret;
      const z = pretTauxZero(plan, { coutOperation: cout, pretTotal: ap.pret, ...saisie });
      ptzHTML = `<h3 style="margin:16px 0 4px">Prêt à taux zéro</h3>
        <p class="verdict ko"><b>PTZ non applicable avec ces réglages.</b></p>
        <ul class="points">${z.raisons.map((x) => `<li>${echapper(x)}</li>`).join("") || "<li>Aucun montant de PTZ possible sur ce prêt.</li>"}</ul>`;
    }
  }

  // Acheter ou louer, à capital de départ égal : le locataire place tout l'apport requis (frais de notaire compris), aide familiale comprise
  let comp = null;
  try { comp = comparaisonAchatLocation(plan, p); } catch (e) { console.error(e); }
  const loyer = comp?.loyer ?? 0;
  let al = "";
  if (!(loyer > 0) || !comp?.resultat) al = `<p class="note" style="margin:0">Indique le loyer d'un logement équivalent (ou ton loyer actuel) dans « Mon profil » pour comparer.</p>`;
  else {
    const r = comp.resultat;
    const H = r.hypotheses;
    const phrase = r.pointMort == null ? "Pas de point mort sur 30 ans : louer et placer la différence reste plus avantageux." : `L'achat devient plus rentable que la location au bout de <b>${r.pointMort} ans</b>.${r.recroise ? " Attention : plus tard, le locataire repasse devant." : ""}`;
    const ligneAn = (q) => `<tr><td>${q.annee === 0 ? "Départ" : `${q.annee} an${q.annee > 1 ? "s" : ""}`}</td><td class="m"><span class="num">${eur(q.valeurBien)}</span></td><td class="m"><span class="num">${eur(q.dette)}</span></td><td class="m"><span class="num">${eur(q.fraisReventeDeduits)}</span></td><td class="m"><span class="num">${eur(q.portefeuilleAcheteur)}</span></td><td class="m"><b class="num">${eur(q.patrimoineAcheteur)}</b></td><td class="m"><span class="num">${eur(q.portefeuilleLocataire)}</span></td><td class="m"><b class="num">${eur(q.patrimoineLocataire)}</b></td><td class="m"><span class="num">${q.ecart >= 0 ? "+" : "−"}${eur(Math.abs(q.ecart))}</span></td></tr>`;
    const detail = [0, 1, 2, 3, 5, 10, 20, 30].map((t) => r.serie.find((q) => q.annee === t)).filter(Boolean).map(ligneAn).join("");
    al = `${graphiqueAcheterLouer(r)}
      <p class="verdict ${r.pointMort == null ? "ko" : "ok"}">${phrase}</p>
      <p class="note" style="margin:6px 0 0">Hypothèses : placement à ${pct(H.rendement)} par an (PEA puis compte-titres), bien qui prend ${pct(H.valorisation)} par an, inflation ${pct(H.inflation)} (loyers et charges), loyer de départ <span class="num">${eur(loyer)}</span> par mois, apport de départ <span class="num">${eur(Math.max(0, ap.apportRequis))}</span> frais de notaire compris, plus <span class="num">${eur(comp.fraisAnnexes)}</span> de frais de garantie (${pct(A.fraisGarantiePctPret ?? 0)} du prêt) et de dossier. Capital de départ identique dans les deux cas (aide familiale comprise). ${H.fraisReventePct > 0 ? `Frais de revente de ${pct(H.fraisReventePct)} déduits de la valeur du bien.` : "Sans frais de revente."} ${lienFiche("acheter-louer", "Fiche : acheter ou louer")}</p>
      <details style="margin-top:8px"><summary>Détail année par année</summary>
        <p class="note" style="margin:6px 0">Perdus dès l'achat : frais de notaire <span class="num">${eur(comp.fraisNotaire)}</span> et frais annexes du prêt (garantie, dossier) <span class="num">${eur(comp.fraisAnnexes)}</span>.</p>
        <div class="table-wrap"><table><thead><tr><th>Année</th><th class="m">Valeur du bien</th><th class="m">Dette</th><th class="m">Frais de revente</th><th class="m">Portefeuille acheteur</th><th class="m">Patrimoine acheteur</th><th class="m">Portefeuille locataire</th><th class="m">Patrimoine locataire</th><th class="m">Écart</th></tr></thead><tbody>${detail}</tbody></table></div>
      </details>`;
  }
  return `${couts}${ptzHTML}<h3 style="margin:16px 0 4px">Acheter ou louer ?</h3>${al}`;
}

function blocAchat(res) {
  const a = res.achat; if (!a) return "";
  const plan = etat.brouillon, A = plan.achatRP;
  const loyer = res.profil.loyerMensuel ?? 0;
  const i = a.ideal, ch = a.choisi;
  const effort = (m) => `${m - loyer >= 0 ? "+" : "−"}${eur(Math.abs(m - loyer))}/mois`;
  const signe = (v, unite = "") => `${v >= 0 ? "+" : "−"}${eur(Math.abs(v))}${unite}`;

  // Tuiles : l'âge retenu (impératif, choisi ou idéal)
  const ref = a.imperatif && a.horizon ? diagnosticAchat(plan, a.horizon) : ch && !ch.horsLimite ? ch : i;
  const libRef = a.imperatif ? "Achat impératif" : ch ? "Âge choisi" : "Âge idéal";
  const tuiles = ref
    ? [[libRef, `${ref.age} ans`], ["Dans", ref.annees === 0 ? "dès maintenant" : `${ref.annees} an(s)`], ["Apport nécessaire", eur(ref.apportRequis)],
       [`Prêt sur ${ref.duree || "–"} ans`, eur(ref.pret ?? 0)], ["Mensualité", eur(ref.mensualite ?? 0)], ["Effort vs loyer", effort(ref.mensualite ?? 0)]]
    : [["Âge idéal", `hors de portée avant ${A.ageMaxFinPret - 1} ans`]];

  // Tester un autre âge
  let test = "";
  if (!a.imperatif) {
    test = `<div class="test-age">
      <label for="age-achat" class="small"><b>Tester un autre âge d'achat</b></label>
      <div class="saisie"><input id="age-achat" type="number" min="${res.profil.agePrincipal ?? res.profil.age}" max="${A.ageMaxFinPret}" step="1" value="${ch?.age ?? ""}" placeholder="${i?.age ?? ""}"><span>ans</span></div>
      ${ch ? `<button type="button" class="lien" id="age-ideal">Revenir à l'âge idéal${i ? ` (${i.age} ans)` : ""}</button>` : `<span class="small muted">Change l'âge pour voir ce que ça change ; la trajectoire suit cet âge.</span>`}
    </div>`;
    if (ch) {
      if (ch.horsLimite || ch.tropTard) test += `<p class="verdict ko"><b>Achat à ${ch.age} ans impossible</b> : le prêt doit être remboursé avant ${A.ageMaxFinPret} ans.</p>`;
      else {
        const diff = i ? ` Par rapport à l'âge idéal (${i.age} ans) : apport nécessaire ${signe(ch.apportRequis - i.apportRequis)}, prêt ${signe(ch.pret - i.pret)}, mensualité ${signe(ch.mensualite - i.mensualite, "/mois")}.` : "";
        test += ch.ok
          ? `<p class="verdict ok"><b>Achat à ${ch.age} ans : finançable.</b> Apport disponible ${eur(ch.apport)}${ch.aide > 0 ? ` (dont ${eur(ch.aide)} d'aide familiale)` : ""} pour ${eur(ch.apportRequis)} nécessaires.${diff}</p>`
          : ch.okAvecPlacements
          ? `<p class="verdict ok"><b>Achat à ${ch.age} ans : finançable en vendant ${eur(ch.aVendre)} de tes autres placements.</b> Livrets, épargne mise de côté${ch.aide > 0 ? ` et aide familiale (${eur(ch.aide)})` : ""} : ${eur(ch.apport)} ; il faut ${eur(ch.apportRequis)}.${diff}</p>`
          : `<p class="verdict ko"><b>Achat à ${ch.age} ans : budget dépassé.</b> Il manquerait <b>${eur(ch.manqueTotal)}</b> d'apport, même en vendant tes autres placements : ${eur(ch.apport)} de livrets, d'épargne${ch.aide > 0 ? ` et d'aide familiale (${eur(ch.aide)})` : ""} et ${eur(ch.aVendre)} de placements, pour ${eur(ch.apportRequis)} nécessaires.${ch.limiteParEndettement ? ` À cet âge, ton salaire permet une mensualité de ${eur(ch.mensualiteMax)} au plus (${A.tauxEndettementMax} % des revenus${a.credits > 0 ? `, moins tes crédits en cours` : ""}) : la banque prêterait ${eur(ch.pretMax)} au maximum, le reste doit venir de l'apport.` : ""}${diff}</p>`;
      }
    }
  } else test = `<p class="note" style="margin:12px 0 0">Achat impératif fixé dans « Mon profil ». Pour comparer plusieurs âges, décoche « Achat impératif à une date fixée ».</p>`;

  // Comparaison année par année autour de l'âge idéal
  const centre = (i ?? ch ?? a.serie[Math.min(5, a.serie.length - 1)])?.age ?? res.profil.age;
  const lignes = a.serie.filter((p) => p.age >= centre - 5 && p.age <= centre + 3).map((p) => {
    const d = diagnosticAchat(plan, p);
    const verdict = d.tropTard ? '<span class="ecart-moins">Trop tard</span>' : d.ok ? '<span class="ecart-plus">✓ Finançable</span>' : d.okAvecPlacements ? `<span class="ecart-plus">✓ En vendant ${eur(d.aVendre)} de placements</span>` : `<span class="ecart-moins">Manque ${eur(d.manqueTotal)}</span>`;
    const cls = [ch && p.age === ch.age ? "ligne-choisie" : "", i && p.age === i.age ? "ligne-ideale" : ""].join(" ").trim();
    return `<tr${cls ? ` class="${cls}"` : ""}><td>${p.age} ans${i && p.age === i.age ? " · idéal" : ""}</td><td class="m">${eur(p.apport)}</td><td class="m">${eur(p.autresPlacements ?? 0)}</td><td class="m">${eur(p.apportRequis)}</td><td class="m">${eur(p.pretMax)}</td><td class="m">${eur(p.mensualite ?? 0)}</td><td class="m">${verdict}</td></tr>`;
  }).join("");

  let horizon = "";
  if (a.imperatif && a.horizon) {
    const hz = a.horizon;
    horizon = `<p class="verdict ${hz.manque > 0.5 ? "ko" : "ok"}">${hz.manque > 0.5
      ? `<b>Budget dépassé.</b> Achat impératif dans ${hz.annees} an(s), à ${hz.age} ans : apport nécessaire ${eur(hz.apportRequis)}. L'épargne d'ici là apportera ${eur(hz.apportFutur)} et les placements mobilisables ${eur(hz.mobilisable)} : il manquera <b>${eur(hz.manque)}</b>. Prix finançable à cette date : <b>${eur(hz.prixMax)}</b>.`
      : `<b>Finançable.</b> Achat impératif dans ${hz.annees} an(s), à ${hz.age} ans : apport nécessaire ${eur(hz.apportRequis)}, dont ${eur(hz.apportFutur)} viendront de l'épargne. La répartition met ${eur(hz.aProtegerMaintenant)} à l'abri dès maintenant${hz.prisSurPlacements > 0.5 ? `, dont ${eur(hz.prisSurPlacements)} pris sur les placements` : ""}.`}</p>`;
  }
  return `<section class="panneau"><h2>Résidence principale · ${eur(a.prix)} (${a.type})</h2>
    <p class="note" style="margin:4px 0 0">Apport disponible aujourd'hui : ${eur(a.surplus)} (livrets et PEL ${eur(a.livrets)} moins ${eur(a.securite)} de sécurité)${a.aide > 0 ? `, plus ${eur(a.aide)} d'aide familiale` : ""}${a.serie[0]?.vente > 0 ? `, plus la revente de ton logement actuel (${eur(a.serie[0].vente)} net du crédit aujourd'hui, revalorisé chaque année)` : ""}, puis ${eur(a.epargneApport)} d'épargne par mois mise de côté. Prêt sur ${A.dureeMaxAnnees} ans au plus, remboursé avant ${A.ageMaxFinPret} ans, mensualité ≤ ${A.tauxEndettementMax} % des revenus selon la règle des banques (HCSF) : salaire net avant impôt plus 70 % des loyers que tu perçois, moins tous tes crédits en cours${a.credits > 0 ? ` (dont ${eur(a.credits)} de crédits à la consommation)` : ""}, y compris celui d'un bien locatif.</p>
    <div class="tuiles">${tuiles.map(([k, v]) => `<div class="tuile"><span>${k}</span><b class="num">${v}</b></div>`).join("")}</div>
    ${horizon}${test}
    ${graphiqueAchat(a)}
    ${blocCoutsEtAcheterLouer(res)}
    <h3 style="margin:16px 0 4px">Et si j'achetais plus tôt ou plus tard ?</h3>
    <p class="note" style="margin:0 0 6px">Livrets, épargne, aide : livrets au-delà de la sécurité, épargne mise de côté chaque mois${a.aide > 0 ? ` et ${eur(a.aide)} d'aide familiale (comptée à chaque âge)` : " et aide familiale (aucune indiquée)"}. Autres placements : bourse, assurance-vie… vendables pour compléter (valeur d'aujourd'hui). Prêt possible : le maximum que la banque prêterait avec ton salaire à cet âge. Le même calcul sert pour l'âge choisi et l'achat impératif.</p>
    <div class="table-wrap"><table><thead><tr><th>Achat à</th><th class="m">Livrets, épargne, aide</th><th class="m">Autres placements</th><th class="m">Apport nécessaire</th><th class="m">Prêt possible</th><th class="m">Mensualité</th><th class="m">Verdict</th></tr></thead><tbody>${lignes}</tbody></table></div>
  </section>`;
}

// Poche bourse : combien acheter de chaque ETF avec le virement du mois, sur quel compte, et l'exposition par devise
let montantDCA = null;
const NOM_COMPTE = { pea: "PEA", cto: "compte-titres", per: "PER", assuranceVieUC: "assurance-vie (unités de compte)" };
const PARTS_ENTIERES = ["pea", "cto"];
function blocPocheBourse(res) {
  const plan = etat.brouillon, L = (plan.investissementBourse ?? []).filter((x) => x.part > 0);
  if (!L.length) return "";
  const P = etat.profil;
  const COMPTES = ["pea", "cto", "assuranceVieUC", "per"];
  const parCompte = {};
  for (const m of res.mouvements) if (m.sens === "versement" && COMPTES.includes(m.enveloppe)) parCompte[m.enveloppe] = (parCompte[m.enveloppe] ?? 0) + m.montant;
  const duMois = Object.values(parCompte).reduce((t, x) => t + x, 0);
  const M = montantDCA ?? Math.round(duMois);
  // Répartition du montant entre les comptes : celle du plan, sinon le PEA s'il est ouvert, sinon le compte-titres
  let comptes = Object.entries(parCompte).filter(([, v]) => v > 0.5).sort((a, b) => b[1] - a[1]);
  if (!comptes.length) comptes = [[P.pea?.ouvert || resideEnFranceUI() ? "pea" : "cto", 1]];
  const totC = comptes.reduce((t, [, v]) => t + v, 0);
  const totParts = L.reduce((t, x) => t + x.part, 0);
  const w = L.map((x) => x.part / totParts);
  const actuel = L.map((x) => Math.max(0, Number(P.lignesBourse?.[x.nom]) || 0));
  const A = actuel.reduce((t, x) => t + x, 0);
  const besoin = L.map((_, i) => Math.max(0, (A + M) * w[i] - actuel[i]));
  const sb = besoin.reduce((t, x) => t + x, 0);
  const achat = L.map((_, i) => (sb <= M ? besoin[i] + (M - sb) * w[i] : (M * besoin[i]) / sb));
  const prix = L.map((x) => Math.max(0, Number(P.prixETF?.[x.nom]) || 0));
  const besoinPrix = comptes.some(([c]) => PARTS_ENTIERES.includes(c));
  // Par compte : montant en euros (assurance-vie, PER d'assurance) ou nombre de parts entières (PEA, compte-titres)
  const parC = comptes.map(([c, v]) => {
    const budget = (M * v) / totC, cible = achat.map((a) => (a * v) / totC);
    if (!PARTS_ENTIERES.includes(c) || prix.some((p) => !(p > 0))) return { c, budget, montants: cible, parts: null, reste: 0 };
    const n = cible.map((a, i) => Math.floor(a / prix[i]));
    let reste = budget - n.reduce((t, k, i) => t + k * prix[i], 0);
    // Le reste sert à acheter une part de plus de l'ETF le plus en retard, tant que c'est possible
    for (let k = 0; k < 50; k++) {
      let best = -1, ecart = -Infinity;
      cible.forEach((a, i) => { if (prix[i] <= reste + 0.01 && a - n[i] * prix[i] > ecart) { ecart = a - n[i] * prix[i]; best = i; } });
      if (best < 0) break;
      n[best]++; reste -= prix[best];
    }
    return { c, budget, montants: n.map((k, i) => k * prix[i]), parts: n, reste: Math.max(0, reste) };
  });
  const achatReel = L.map((_, i) => parC.reduce((t, x) => t + x.montants[i], 0));
  const apres = L.map((_, i) => actuel[i] + achatReel[i]);
  const totApres = apres.reduce((t, x) => t + x, 0);
  // Exposition par devise : ce que tu as précisé, sinon la valeur par défaut de l'indice
  const expo = L.map((x) => { const p = P.devisesBourse?.[x.nom]; return p && Object.values(p).some((v) => v > 0) ? p : devisesParDefaut(x); });
  const dev = new Map();
  L.forEach((x, i) => { const v = totApres > 0 ? apres[i] : w[i]; const e = expo[i] ?? { "?": 100 }; const t = Object.values(e).reduce((a, b) => a + (Number(b) || 0), 0) || 100; for (const [d, p] of Object.entries(e)) if (p > 0) dev.set(d, (dev.get(d) ?? 0) + (v * p) / t); });
  const totDev = [...dev.values()].reduce((t, x) => t + x, 0) || 1;
  const couleurs = ["--s1", "--s3", "--s7", "--s4", "--s5", "--s2"];
  const devises = [...dev.entries()].sort((a, b) => b[1] - a[1]);
  const nomD = (d) => (d === "?" ? "Non précisé" : NOM_DEVISE[d] ?? d);
  const ouAcheter = parC.map((x) => `<b>${eur(x.budget)}</b> sur ton <b>${NOM_COMPTE[x.c]}</b>`).join(", ").replace(/, ([^,]*)$/, " et $1");
  const enteteCompte = (x) => `À acheter sur ton ${NOM_COMPTE[x.c]}`;
  const celluleAchat = (x, i) => x.parts ? `<b>${x.parts[i]} part${x.parts[i] > 1 ? "s" : ""}</b><div class="small muted">${eur(x.montants[i])}</div>` : `<b>${eur(x.montants[i])}</b>${PARTS_ENTIERES.includes(x.c) ? '<div class="small muted">indique le prix d\'une part</div>' : ""}`;
  const restes = parC.filter((x) => x.parts && x.reste > 0.5);
  const noteCompte = parC.map((x) => PARTS_ENTIERES.includes(x.c) ? `Sur le ${NOM_COMPTE[x.c]}, on n'achète que des parts entières : ${x.parts ? "le nombre de parts est calculé avec le prix que tu as indiqué" : "indique le prix d'une part de chaque ETF (affiché chez ton courtier) pour obtenir le nombre de parts"}.` : x.c === "per" ? "Sur un PER d'assurance, on investit un montant en euros (fractions de parts possibles) ; sur un PER compte-titres, ce sont des parts entières comme au PEA." : "Sur l'assurance-vie, on investit un montant en euros (fractions de parts possibles).").join(" ");
  return `<section class="panneau" id="poche-bourse" data-min="intermediaire"><h2>Ta poche bourse : quoi acheter ce mois-ci</h2>
    <p style="margin:4px 0 6px">Ce mois-ci, le plan prévoit ${ouAcheter} pour la partie bourse.</p>
    <p class="note" style="margin:0 0 8px">Indique combien tu as déjà sur chaque ETF (en euros, tous comptes confondus) : le site calcule combien en acheter avec le virement du mois pour te rapprocher des poids du plan, sans rien vendre.</p>
    <div class="ligne-actions" style="margin-bottom:8px"><label for="dca-montant" class="small">Montant à investir ce mois-ci</label><div class="saisie" style="max-width:160px"><input id="dca-montant" type="number" min="0" step="10" value="${M}"><span>€</span></div>${montantDCA != null ? `<button type="button" class="lien" id="dca-auto">Reprendre le montant du plan (${eur(duMois)})</button>` : `<span class="small muted">versements bourse du mois prévus par le plan</span>`}</div>
    <div class="table-wrap"><table><thead><tr><th>ETF</th><th class="m">Poids cible</th><th class="m">Tu as déjà (en €)</th>${besoinPrix ? '<th class="m">Prix d\'une part</th>' : ""}${parC.map((x) => `<th class="m">${enteteCompte(x)}</th>`).join("")}<th class="m">Après</th></tr></thead><tbody>
    ${L.map((x, i) => `<tr><td>${texteLie(x.nom)}<div class="small muted">${echapper(x.exemples ?? "")}</div></td><td class="m">${pct(w[i] * 100)}</td>
      <td class="m"><div class="saisie" style="max-width:130px;margin-left:auto"><input type="number" min="0" step="50" data-ligne-bourse="${echapper(x.nom)}" value="${actuel[i] || ""}" placeholder="0" aria-label="Montant déjà investi sur ${echapper(x.nom)}"><span>€</span></div></td>
      ${besoinPrix ? `<td class="m"><div class="saisie" style="max-width:120px;margin-left:auto"><input type="number" min="0" step="0.01" data-prix-etf="${echapper(x.nom)}" value="${prix[i] || ""}" placeholder="?" aria-label="Prix d'une part de ${echapper(x.nom)}"><span>€</span></div></td>` : ""}
      ${parC.map((c) => `<td class="m">${celluleAchat(c, i)}</td>`).join("")}<td class="m">${eur(apres[i])}${totApres > 0 ? `<div class="small muted">${pct((100 * apres[i]) / totApres)}</div>` : ""}</td></tr>`).join("")}
    </tbody></table></div>
    <p class="note" style="margin:6px 0 0">« Tu as déjà » : la valeur de ce que tu possèdes sur cet ETF aujourd'hui (pas le prix d'une part). ${noteCompte}${restes.length ? ` Il restera ${restes.map((x) => `${eur(x.reste)} sur le ${NOM_COMPTE[x.c]}`).join(" et ")} : laisse-les sur le compte, ils serviront le mois prochain.` : ""}</p>
    <h3 style="margin:14px 0 6px;font-size:1rem">Exposition par devise${totApres > 0 ? " (après les achats)" : " (poids cibles)"}</h3>
    <div class="barre-devises" style="display:flex;height:12px;border-radius:6px;overflow:hidden;gap:2px">${devises.map(([d, v], i) => `<span title="${echapper(nomD(d))} : ${pct((100 * v) / totDev)}" style="flex:${v};background:var(${couleurs[i % couleurs.length]})"></span>`).join("")}</div>
    <ul class="legende-g" style="list-style:none;padding:0;margin:8px 0 0;display:flex;flex-wrap:wrap;gap:12px">${devises.map(([d, v], i) => `<li class="small"><span class="pastille" style="background:var(${couleurs[i % couleurs.length]})"></span>${echapper(nomD(d))} : <b>${pct((100 * v) / totDev)}</b></li>`).join("")}</ul>
    <details class="devises-etf" style="margin-top:10px"${expo.some((e) => !e) ? " open" : ""}><summary class="small"><b>Préciser l'exposition de chaque ETF</b> (en %, d'après sa fiche chez l'émetteur : « répartition géographique » ou « par devise »)</summary>
      <div class="table-wrap" style="margin-top:6px"><table><thead><tr><th>ETF</th>${DEVISES.map((d) => `<th class="m">${d === "Autres" ? "Autres" : d}</th>`).join("")}<th class="m">Total</th></tr></thead><tbody>
      ${L.map((x, i) => { const e = expo[i] ?? {}; const tot = DEVISES.reduce((t, d) => t + (Number(e[d]) || 0), 0);
        return `<tr><td>${echapper(x.nom)}</td>${DEVISES.map((d) => `<td class="m"><input type="number" min="0" max="100" step="1" style="width:64px" data-devise-etf="${echapper(x.nom)}" data-devise="${d}" value="${Number(e[d]) || ""}" placeholder="0" aria-label="${echapper(x.nom)} : part en ${d}"></td>`).join("")}<td class="m${Math.round(tot) !== 100 && tot > 0 ? " ecart-moins" : ""}">${tot ? `${Math.round(tot)} %` : "—"}</td></tr>`; }).join("")}
      </tbody></table></div>
      <p class="note" style="margin:6px 0 0">Valeurs proposées : celles de l'indice suivi (S&P 500 : 100 % dollar ; STOXX Europe 600 : environ la moitié en euros ; MSCI World : environ 70 % dollar). <button type="button" class="lien" id="devises-defaut">Revenir aux valeurs proposées</button></p>
    </details>
    <p class="note" style="margin:8px 0 0">Les ETF du PEA sont cotés en euros, mais les entreprises qu'ils contiennent gagnent de l'argent en dollars, en livres… Si le dollar baisse de 10 % face à l'euro, la partie américaine perd environ 10 % en euros (et gagne si le dollar monte). C'est normal pour un portefeuille mondial : sur le long terme, ces écarts se compensent en partie.</p>
  </section>`;
}
const resideEnFranceUI = () => (etat.profil.pays ?? "FR") === "FR";
const ACTIONS_DEBUTANT = 3; // actions affichées d'emblée en débutant
let autresActionsOuvertes = false; // le <details> des autres actions reste ouvert d'un rendu à l'autre
$("#resultats").addEventListener("toggle", (e) => { if (e.target.id === "res-autres-actions") autresActionsOuvertes = e.target.open; }, true);

// Version débutant de « Répartition cible » : 3 familles (regroupement d'affichage, res.alloc n'est pas modifié)
function blocFamilles(res) {
  const COULEUR_FAMILLE = { abri: "--s6", prudent: "--s3", dynamique: "--s1" };
  const DETAIL = { abri: "disponible tout de suite, sans risque de perte (livrets, apport de ton projet)", prudent: "évolue peu (assurance-vie, obligations, or)", dynamique: "fait grandir ton capital sur le long terme, avec des hauts et des bas (bourse, bitcoin, immobilier SCPI)" };
  const F = grouperAllocation(res.alloc).filter((f) => f.montant > 0.5);
  const parId = Object.fromEntries(F.map((f) => [f.id, f]));
  const segs = F.map((f) => `<div class="seg" tabindex="0" style="flex-grow:${f.montant};background:var(${COULEUR_FAMILLE[f.id]})" data-bulle="${echapper(`${f.libelle} · ${eur(f.montant)} · ${pct(f.part)}`)}" aria-label="${echapper(`${f.libelle} : ${eur(f.montant)}, ${pct(f.part)}`)}"></div>`).join("");
  return `
    <div class="chiffres">
      <div><b class="num">${eur(res.capital)}</b><span>capital</span></div>
      <div><b class="num">${eur(parId.abri?.montant ?? 0)}</b><span>à l'abri</span></div>
      <div><b class="num">${pct(parId.dynamique?.part ?? 0)}</b><span>en placements dynamiques</span></div>
    </div>
    ${F.length ? `<div class="barre" role="img" aria-label="Répartition cible en trois familles">${segs}</div>` : ""}
    <ul class="familles">${F.map((f) => `<li><span class="pastille" style="background:var(${COULEUR_FAMILLE[f.id]})"></span><span><b>${f.libelle}</b> · <b class="num">${eur(f.montant)}</b> (${pct(f.part)})<span class="small muted"> : ${DETAIL[f.id]}</span></span></li>`).join("")}</ul>`;
}

function rendreResultats() {
  majBadgeAvances();
  let res, sim;
  try { sim = profilSimule(); res = analyser(etat.brouillon, sim.profil); }
  catch (e) {
    console.error(e);
    const msg = `<div class="erreur">Le plan ne peut pas être appliqué : ${echapper(e.message)}. Vérifie les réglages (au moins un palier est nécessaire).</div>`;
    $("#resultats").innerHTML = msg; $("#apercu").innerHTML = msg; return;
  }
  const plan = etat.brouillon;
  const niveau = niveauCourant(), deb = niveau === "debutant";
  etat.resultat = res;
  majAlertes(sim.futur ? undefined : res, !!sim.futur); // point central de recalcul : au démarrage et après chaque changement du profil ou du plan
  if (!$("#vue-ideale").hidden) rendreEpargneIdeale();
  const etranger = sim.futur ? 0 : consoliderEtrangers(etat.profil, tauxEffectifs(etat.profil, etat.tauxDuJour).taux).totalEUR;
  $("#total-capital").textContent = eur(res.capital);
  { const n = $("#total-capital-etranger"); if (n) { n.hidden = !(etranger > 0); n.textContent = etranger > 0 ? `dont ${eur(etranger)} à l'étranger` : ""; } }
  $("#total-capital-debutant").textContent = eur(res.capital);
  $("#total-capital-bas").textContent = eur(res.capital);
  const env = (id) => (id ? plan.enveloppes[id]?.libelle ?? id : "⚠ aucun compte");
  const signe = (v) => (Math.abs(v) < 0.5 ? '<span class="muted">0 €</span>' : `<span class="${v > 0 ? "ecart-plus" : "ecart-moins"}">${v > 0 ? "+" : "−"}${eur(Math.abs(v))}</span>`);

  const comptes = res.reeq.comptes.map((l) => `<tr><td>${lienFiche(plan.enveloppes[l.enveloppe]?.fiche, env(l.enveloppe)) || env(l.enveloppe)}<div class="statut-compte">${texteLie(l.texte, plan.enveloppes[l.enveloppe]?.fiche)}</div></td>
    <td class="m">${eur(l.actuel)}</td><td class="m">${eur(l.cible)}</td><td class="m">${signe(l.ecart)}</td></tr>`).join("");
  const eq = res.reeq.moisEquilibre;
  const toutOk = res.reeq.comptes.every((l) => l.statut === "ok");
  const eqTexte = toutOk ? "Les placements sont à l'équilibre." : eq == null ? "Équilibre non atteint en 10 ans avec ces réglages." : eq <= 1 ? "Équilibre atteint dès ce mois-ci." : `Équilibre atteint en environ ${eq} mois.`;
  const libMvt = (m) => m.sens === "arbitrage" ? `${m.transfert ? "Transférer de" : "Arbitrer de"} ${env(m.enveloppe)} vers ${env(m.vers)}` : `${m.sens === "retrait" ? (m.annuel ? "Vendre une fois cette année sur" : "Retirer de") : "Verser sur"} ${env(m.enveloppe)}`;
  const mvts = res.mouvements.map((m) => `<tr><td>${texteLie(libMvt(m))}${m.note ? `<div class="note">${texteLie(m.note)}</div>` : ""}</td>
    <td class="m"><span class="${m.sens === "retrait" ? "ecart-moins" : m.sens === "versement" ? "ecart-plus" : "muted"}">${m.sens === "retrait" ? "−" : m.sens === "versement" ? "+" : "⇄ "}${eur(m.montant)}</span></td></tr>`).join("");
  const item = (c) => `<li><span>${texteLie(c.texte)}</span>${(c.fiche && FICHES[c.fiche]) || VIDEOS[c.video] ? `<span class="fiche small">${c.fiche && FICHES[c.fiche] ? lienFiche(c.fiche) : ""}${VIDEOS[c.video] ? `${c.fiche ? " · " : ""}<a class="lien-video" href="${VIDEOS[c.video].url}" target="_blank" rel="noopener">▶ Vidéo : ${echapper(VIDEOS[c.video].titre)}</a>` : ""}</span>` : ""}</li>`;
  const parNiveau = (n) => res.consignes.filter((c) => c.niveau === n);
  const aFaire = parNiveau("action"), alertes = parNiveau("alerte"), infos = parNiveau("info");
  const titre = (t, n) => `<h2 class="compte-titre">${t} <span class="compteur">${n}</span></h2>`;
  // Débutant : les 3 premières actions (déjà triées par importance), les autres dans un <details>
  const liste = (L, debut = 0) => `<ol class="a-faire"${debut ? ` style="counter-reset: af ${debut}"` : ""}>${L.map(item).join("")}</ol>`;
  const reste = aFaire.length - ACTIONS_DEBUTANT;
  const aFaireHTML = !aFaire.length ? '<p class="muted small" style="margin:10px 0 0">Rien à faire de particulier : continue les versements du mois.</p>'
    : deb && reste > 0
      ? `${liste(aFaire.slice(0, ACTIONS_DEBUTANT))}<details class="autres-actions" id="res-autres-actions"${autresActionsOuvertes ? " open" : ""}><summary>${reste > 1 ? `Voir les ${reste} autres actions` : "Voir l'autre action"}</summary>${liste(aFaire.slice(ACTIONS_DEBUTANT), ACTIONS_DEBUTANT)}</details>`
      : liste(aFaire);

  const nomProfil = proches.courant.col === "exemple" ? "Exemple" : docCourant()?.nom ?? "";
  const F = sim.futur;
  const bandeauFutur = F && visible("avance", niveau) ? `<div class="bandeau" id="res-futur" data-min="avance"><b>Situation simulée à ${res.profil.agePrincipal ?? res.profil.age} ans${F.annees ? `, dans ${F.annees} an(s)` : ""}</b> : capital ${eur(F.capital)} (${F.estime.capital ? "estimé en suivant le plan, rendements moyens" : "saisi"}), salaire ${eur(res.profil.salaireNetMensuel)} par mois${F.estime.salaire ? " (estimé)" : ""}, épargne ${eur(res.profil.epargneMensuelle)} par mois${F.estime.epargne ? " (estimée)" : ""}.${F.achatAvant ? " L'achat de la résidence, prévu avant cet âge, n'est pas pris en compte." : ""} Les résultats ci-dessous concernent cette situation future, pas celle d'aujourd'hui.</div>` : "";
  etat.futur = F;
  const p = res.profil;
  const rythme = siNiveau("avance", () => blocRythme(res));
  // Débutant : une ligne à la place du détail « quoi acheter ce mois-ci » (visible seulement si le plan investit en bourse)
  const ligneBourseDebutant = (res.alloc.bourse ?? 0) > 0.5 ? `<section class="panneau" id="res-bourse-debutant" data-seul="debutant"><p class="note" style="margin:0">Pour la partie bourse, le plan conseille des ETF à bas frais : voir la ${lienFiche("pea", "fiche PEA")}.</p></section>` : "";
  const colDroite = (alertes.length ? `<section class="panneau attention">${titre("Attention", alertes.length)}<ul class="infos">${alertes.map(item).join("")}</ul></section>` : "")
    + siNiveau("intermediaire", () => `<section class="panneau" id="res-infos" data-min="intermediaire">${titre("Bon à savoir", infos.length)}
          ${infos.length ? `<ul class="infos">${infos.map(item).join("")}</ul>` : '<p class="muted small" style="margin:10px 0 0">Rien de plus à signaler.</p>'}</section>`);
  $("#resultats").innerHTML = `
    <div class="etape" style="margin:0"><p><b>Étape 2 sur 4.</b> Ce que le plan demande pour ce profil : d'abord les actions, dans l'ordre, puis les versements du mois${deb ? "" : " et le montant visé sur chaque compte"}.</p></div>
    ${bandeauFutur}
    <div class="panneau entete-res">
      <div class="qui-res"><b>${echapper(nomProfil || "Profil")}</b><span class="small muted">${p.agePrincipal ?? p.age} ans · ${eur(res.capital)} placés · ${eur(p.epargneMensuelle)} d'épargne par mois<span id="res-profil-risque" data-min="intermediaire"> · profil ${echapper(profilRisque(plan, p).libelle ?? "")}</span></span></div>
      <div class="ligne-actions"><a class="bouton" href="#mon-profil">Modifier mon profil</a><button type="button" id="btn-recap">Télécharger le récapitulatif</button></div>
      ${recapMessage ? `<p class="small muted" style="margin:0;flex-basis:100%">${echapper(recapMessage)}</p>` : ""}
    </div>
    <div class="grille-res${colDroite ? "" : " une-colonne"}">
      <div class="pile">
        <section class="panneau">${titre("À faire", aFaire.length)}
          <p class="note" style="margin:4px 0 0">Les actions à mener, de la plus importante à la moins urgente. Les mots soulignés en pointillé mènent à leur fiche.</p>
          ${aFaireHTML}</section>
        <section class="panneau"><h2>Ce mois-ci · ${eur(p.epargneMensuelle)} d'épargne à répartir</h2>
          <p class="note" style="margin:4px 0 0">Les virements à faire ce mois-ci pour rapprocher chaque compte de sa cible.</p>
          <div class="table-wrap" style="margin-top:8px"><table><tbody>${mvts || '<tr><td class="muted">Aucun mouvement ce mois-ci.</td></tr>'}</tbody></table></div></section>
        ${siNiveau("intermediaire", () => `<section class="panneau" id="res-montants" data-min="intermediaire"><h2>Montant visé sur chaque compte</h2><p class="note" style="margin:4px 0 8px">${eqTexte} L'argent déjà placé reste sur son compte quand le plan l'autorise ; l'épargne du mois comble les manques et les excédents sont déplacés petit à petit.</p>
          ${rythme ? `<div id="res-rythme" data-min="avance">${rythme}</div>` : ""}
          <div class="table-wrap"><table><thead><tr><th>Compte</th><th class="m">Actuel</th><th class="m">Cible</th><th class="m">Écart</th></tr></thead><tbody>${comptes}</tbody></table></div></section>`)}
        <section class="panneau" id="res-repartition"><h2>Répartition cible</h2><p class="note" style="margin:4px 0 0">${deb ? "Comment le plan répartit ton capital en trois familles : l'argent à l'abri pour les imprévus et tes projets, une part prudente qui bouge peu, et une part dynamique pour le long terme." : "Comment le plan répartit ton capital entre les grandes familles de placements."}</p>${deb ? blocFamilles(res) : blocAllocation(res)}</section>
        ${siNiveau("avance", () => blocExpositionChange())}
        ${deb ? ligneBourseDebutant : siNiveau("intermediaire", () => blocPocheBourse(res))}
        <div class="etape" style="margin:0"><a class="bouton" href="#mon-profil">← ${nomVue("profil", niveauCourant())}</a><a class="bouton principal" href="#trajectoire">Étape 3 : ${suiteVue("trajectoire", niveauCourant())} →</a></div>
      </div>
      ${colDroite ? `<div class="pile">${colDroite}</div>` : ""}
    </div>`;
  if (!$("#vue-fiches").hidden) rendreFiches();
  if (!$("#vue-suivi").hidden) rendreSuivi();
  $("#apercu").innerHTML = `<h2>Aperçu en direct</h2><p class="note" style="margin:2px 0 10px">Profil choisi dans « Mon profil » : ${res.profil.age} ans, ${eur(res.capital)} placés.</p>${blocAllocation(res, true)}`;
}

// Vidéos (tutoriels YouTube) liées à certaines actions
const VIDEOS = {
  ouverture: { titre: "ouvrir son compte et son PEA Trade Republic", url: "https://www.youtube.com/watch?v=LI4CdWFgSjM" },
  transfert: { titre: "transférer son PEA chez Trade Republic", url: "https://www.youtube.com/watch?v=6vPVakNBpy0" },
};

// Rythme du rééquilibrage : automatique (selon les montants) ou choisi
function blocRythme(res) {
  const R = res.reeq;
  if (!(R.aDeplacer > 0.5)) return "";
  const choix = String(etat.profil.rythmeReequilibrage ?? "");
  const options = [["", `Automatique (${dureeTexte(R.dureeAuto)})`], ["12", "Sur 1 an"], ["24", "Sur 2 ans"], ["36", "Sur 3 ans"], ["60", "Sur 5 ans"]];
  const parMois = R.aDeplacer / R.duree;
  return `<div class="test-age" style="margin:0 0 10px">
    <label for="rythme" class="small"><b>Rythme du rééquilibrage</b></label>
    <select id="rythme" style="width:auto">${options.map(([v, l]) => `<option value="${v}" ${v === choix ? "selected" : ""}>${l}</option>`).join("")}</select>
    <span class="small muted">${eur(R.aDeplacer)} à déplacer entre comptes sur ${dureeTexte(R.duree)}${R.automatique ? ` (en automatique, pas plus que ton épargne du mois en moyenne, entre 1 et 5 ans)` : ""}. Les livrets et les arbitrages d'assurance-vie (gratuits) se font chaque mois ; les comptes où une vente coûte des frais (PEA, compte-titres, crypto, SCPI) sont vendus en une fois par an, et pas du tout pour un petit excédent. L'or physique n'est jamais revendu. Plus c'est long, plus c'est doux, mais plus tes placements restent longtemps loin de la cible.</span>
  </div>`;
}
$("#resultats").addEventListener("change", (e) => {
  if (e.target.id !== "rythme") return;
  etat.profil.rythmeReequilibrage = e.target.value;
  memo.set("profil-v2", etat.profil);
  rendreResultats();
  planifierSauvegardeProfil();
});

// Téléchargement unique : API « downloads » de l'hôte si elle existe, sinon Blob + <a download> (localhost, Cloudflare Pages)
async function telechargerFichier(fichier, blob) {
  if (etat.downloads) { await etat.downloads.save({ filename: fichier, data: blob }); return; }
  const a = document.createElement("a");
  const url = URL.createObjectURL(blob);
  a.href = url; a.download = fichier;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
// Récapitulatif téléchargeable
let recapMessage = "";
const slug = (s) => (s || "profil").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
$("#resultats").addEventListener("click", async (e) => {
  if (e.target.id !== "btn-recap") return;
  const bouton = e.target; bouton.disabled = true; bouton.textContent = "Préparation…";
  try {
    const plan = etat.brouillon, res = etat.resultat;
    let nom = proches.courant.col === "exemple" ? "Exemple" : docCourant()?.nom ?? "Profil";
    if (etat.futur) nom += ` · simulation à ${res.profil.agePrincipal ?? res.profil.age} ans`;
    const proj = projeter(plan, profilPourMoteur(), { inclureAchat: true });
    const { suivi } = suiviCourant();
    const echeances = [...echeancesProfil(plan, profilPourMoteur(), { releves: suivi?.releves ?? [] }), ...echeancesGenerales(plan)].sort((a, b) => a.date - b.date);
    const planDate = etat.source === "partage" && etat.majLe ? new Date(etat.majLe).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" }) : null;
    const html = genererRecapHTML({ plan, nom, profil: res.profil, res, proj, echeances, fiches: CONTENU_FICHES, planDate, niveauNom: INFOS_NIVEAUX[niveauCourant()].nom, tauxDuJour: etat.tauxDuJour });
    const d = new Date();
    await telechargerFichier(`plan-action-${slug(nom)}-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}.html`, new Blob([html], { type: "text/html" }));
    recapMessage = "Fichier enregistré : ouvre-le dans un navigateur, puis « Imprimer ou enregistrer en PDF ».";
  } catch (err) {
    recapMessage = err?.code === "declined" ? "Téléchargement annulé." : `Téléchargement impossible ici (${err?.code ?? err?.message ?? "erreur"}).`;
  }
  rendreResultats();
});

// Bulle au survol (segments de la barre, colonnes du graphique)
document.addEventListener("pointerover", (e) => {
  const s = e.target.closest?.("[data-bulle]"); const b = $("#bulle");
  document.querySelectorAll(".curseur").forEach((c) => c.setAttribute("visibility", "hidden"));
  if (!s) { b.hidden = true; return; }
  b.textContent = s.dataset.bulle; b.hidden = false;
  const curseur = s.dataset.curseur && document.getElementById(s.dataset.curseur);
  if (s.dataset.x && curseur) { curseur.setAttribute("x1", s.dataset.x); curseur.setAttribute("x2", s.dataset.x); curseur.setAttribute("visibility", "visible"); }
});
document.addEventListener("pointermove", (e) => {
  const b = $("#bulle"); if (b.hidden) return;
  const x = Math.min(e.clientX + 12, window.innerWidth - b.offsetWidth - 8);
  b.style.left = `${Math.max(8, x)}px`; b.style.top = `${e.clientY + 14}px`;
});
document.addEventListener("focusin", (e) => {
  const s = e.target.closest?.(".seg"); const b = $("#bulle");
  if (!s) { b.hidden = true; return; }
  const r = s.getBoundingClientRect();
  b.textContent = s.dataset.bulle; b.hidden = false;
  b.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - b.offsetWidth - 8))}px`; b.style.top = `${r.bottom + 8}px`;
});

// ---------------------------------------------------------------- trajectoire
const GEOM = { W: 680, H: 280, g: 62, d: 16, h: 18, b: 30 };

function cadre(ages, ymax) {
  const { W, H, g, d, h, b } = GEOM;
  const x = (i) => g + (i * (W - g - d)) / Math.max(1, ages.length - 1);
  const y = (v) => H - b - (Math.max(0, v) * (H - b - h)) / ymax;
  let s = "";
  for (let k = 0; k <= 4; k++) {
    const v = (ymax * k) / 4;
    s += `<line class="grille-l" x1="${g}" x2="${W - d}" y1="${y(v)}" y2="${y(v)}"/><text x="${g - 8}" y="${y(v) + 4}" text-anchor="end">${keur(v)}</text>`;
  }
  ages.forEach((a, i) => { if (a % 5 === 0 || (i === 0 && 5 - (a % 5) >= 4)) s += `<text x="${x(i)}" y="${H - 9}" text-anchor="middle">${a} ans</text>`; }); // pas de chevauchement avec le prochain multiple de 5
  s += `<line class="axe" x1="${g}" x2="${W - d}" y1="${H - b}" y2="${H - b}"/>`;
  return { x, y, s };
}
function colonnesSurvol(ages, x, bulle, idCurseur) {
  const { W, H, g, d, h, b } = GEOM;
  const l = (W - g - d) / Math.max(1, ages.length - 1);
  return `<line id="${idCurseur}" class="curseur" x1="0" x2="0" y1="${h}" y2="${H - b}" stroke="var(--faint)" stroke-width="1" visibility="hidden"/>` +
    ages.map((a, i) => `<rect x="${x(i) - l / 2}" y="${h}" width="${l}" height="${H - b - h}" fill="transparent" data-x="${x(i)}" data-curseur="${idCurseur}" data-bulle="${echapper(bulle(i))}"/>`).join("");
}
// Maximum de l'axe : 4 graduations « rondes »
const echelle = (v) => {
  const brut = Math.max(1, v * 1.04) / 4, mag = Math.pow(10, Math.floor(Math.log10(brut)));
  const pas = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].map((k) => k * mag).find((x) => x >= brut);
  return pas * 4;
};

function graphiqueComposition(central, defl, achat) {
  const plan = etat.brouillon;
  const ages = central.map((p) => p.age);
  const classes = ORDRE.filter((c) => central.some((p) => (p.classes[c] ?? 0) > 1));
  const piles = central.map((p, i) => { let cum = 0; return classes.map((c) => (cum += (p.classes[c] ?? 0) * defl(i))); });
  const ymax = echelle(Math.max(...piles.map((s) => s[s.length - 1] ?? 0)));
  const { x, y, s } = cadre(ages, ymax);
  let svg = `<svg class="graphe" viewBox="0 0 ${GEOM.W} ${GEOM.H}" role="img" aria-label="Composition des placements selon l'âge (scénario central)">${s}`;
  classes.forEach((c, k) => {
    const haut = piles.map((pl, i) => `${x(i).toFixed(1)},${y(pl[k]).toFixed(1)}`);
    const bas = piles.map((pl, i) => `${x(i).toFixed(1)},${y(k ? pl[k - 1] : 0).toFixed(1)}`).reverse();
    svg += `<polygon points="${haut.concat(bas).join(" ")}" fill="var(${COULEUR[c]})" stroke="var(--surface)" stroke-width="1"/>`;
  });
  if (achat) {
    const i = central.findIndex((p) => p.evenement === "achat");
    if (i >= 0) svg += `<line x1="${x(i)}" x2="${x(i)}" y1="${GEOM.h}" y2="${GEOM.H - GEOM.b}" stroke="var(--fg)" stroke-width="1.5" stroke-dasharray="4 4"/><text x="${Math.min(x(i) + 6, GEOM.W - 150)}" y="${GEOM.h + 10}" style="fill:var(--fg);font-weight:600">Achat de la résidence</text>`;
  }
  svg += colonnesSurvol(ages, x, (i) => {
    const p = central[i];
    return `${p.age} ans · ${eur(p.financier * defl(i))}\n` + classes.filter((c) => (p.classes[c] ?? 0) > 1).reverse().map((c) => `${plan.classes[c].libelle} : ${eur(p.classes[c] * defl(i))}`).join("\n");
  }, "curseur-compo");
  svg += `</svg>`;
  return svg + `<div class="legende-g">${classes.slice().reverse().map((c) => `<span><span class="pastille" style="background:var(${COULEUR[c]})"></span>${plan.classes[c].libelle}</span>`).join("")}</div>`;
}

function graphiqueEventail(central, eventail, defl) {
  const ages = eventail.map((p) => p.age);
  const ymax = echelle(Math.max(...eventail.map((p, i) => Math.max(p.p90, central[i].financier) * defl(i))));
  const { x, y, s } = cadre(ages, ymax);
  const ligne = (f) => eventail.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(f(p, i) * defl(i)).toFixed(1)}`).join("");
  const bande = eventail.map((p, i) => `${x(i).toFixed(1)},${y(p.p90 * defl(i)).toFixed(1)}`)
    .concat(eventail.map((p, i) => `${x(i).toFixed(1)},${y(p.p10 * defl(i)).toFixed(1)}`).reverse()).join(" ");
  let svg = `<svg class="graphe" viewBox="0 0 ${GEOM.W} ${GEOM.H}" role="img" aria-label="Éventail des scénarios : placements selon l'âge">${s}`;
  svg += `<polygon points="${bande}" fill="var(--s1)" fill-opacity="0.16" stroke="none"/>`;
  svg += `<path d="${ligne((p) => p.p10)}" fill="none" stroke="var(--s1)" stroke-width="1" stroke-opacity="0.6"/>`;
  svg += `<path d="${ligne((p) => p.p90)}" fill="none" stroke="var(--s1)" stroke-width="1" stroke-opacity="0.6"/>`;
  svg += `<path d="${ligne((p, i) => central[i].financier)}" fill="none" stroke="var(--muted)" stroke-width="1.5" stroke-dasharray="5 4"/>`;
  svg += `<path d="${ligne((p) => p.p50)}" fill="none" stroke="var(--s1)" stroke-width="2"/>`;
  svg += colonnesSurvol(ages, x, (i) => {
    const p = eventail[i], k = defl(i);
    return `${p.age} ans\nOptimiste (1 chance sur 10 de faire mieux) : ${eur(p.p90 * k)}\nMédiane : ${eur(p.p50 * k)}\nPessimiste (1 chance sur 10 de faire moins bien) : ${eur(p.p10 * k)}\nScénario central : ${eur(central[i].financier * k)}`;
  }, "curseur-eventail");
  svg += `</svg>`;
  return svg + `<div class="legende-g"><span><span class="trait" style="background:var(--s1)"></span>Médiane</span><span><span class="pastille" style="background:var(--s1);opacity:.35"></span>8 scénarios sur 10 dans cette zone</span><span><span class="trait" style="background:var(--muted)"></span>Scénario central (rendements moyens, pointillés)</span></div>`;
}

let minuteurTrajectoire = null;
function planifierTrajectoire() {
  clearTimeout(minuteurTrajectoire);
  if (!$("#vue-trajectoire").hidden) minuteurTrajectoire = setTimeout(rendreTrajectoire, 200);
  else if (!$("#vue-retraite").hidden) minuteurTrajectoire = setTimeout(rendreRetraite, 250);
}
// Projection mise en cache : la même sert à « Trajectoire » et à « Retraite ».
// Deux entrées : la projection complète (avec l'éventail Monte-Carlo) et le scénario central seul (niveau Débutant).
// Le central est identique dans les deux ; une projection complète déjà en cache sert aussi au besoin central.
let cacheProjection = { cle: null, r: null };
let cacheCentral = { cle: null, r: null };
let cacheLegere = { cle: null, r: null }; // tirages au hasard mais sans éventail (verdict Débutant de l'onglet Retraite)
function projectionCourante(inclureAchat = true, { central = false, legere = false } = {}) {
  const r = { ...(etat.profil.retraite ?? {}) };
  const cle = JSON.stringify([etat.brouillon, { ...etat.profil, retraite: r }, inclureAchat]);
  if (cacheProjection.cle === cle) return cacheProjection.r;
  if (central) {
    if (cacheCentral.cle !== cle) cacheCentral = { cle, r: projeterCentral(etat.brouillon, profilPourMoteur(), { inclureAchat }) };
    return cacheCentral.r;
  }
  if (legere) {
    if (cacheLegere.cle !== cle) cacheLegere = { cle, r: projeter(etat.brouillon, profilPourMoteur(), { inclureAchat, legere: true }) };
    return cacheLegere.r;
  }
  cacheProjection = { cle, r: projeter(etat.brouillon, profilPourMoteur(), { inclureAchat }) };
  return cacheProjection.r;
}
// En Débutant : l'achat de la résidence est inclus s'il est actif, et les montants sont toujours en euros d'aujourd'hui
const achatInclus = () => niveauCourant() === "debutant" || $("#t-achat").checked;
const montantsReels = () => niveauCourant() === "debutant" || $("#t-reel").checked;

// Courbe centrale du patrimoine net (placements + immobilier − crédits), scénario central : tous niveaux.
// Les valeurs de l'infobulle sont celles de « Mon avenir en 3 chiffres » (C[i].net × defl(i)).
function graphiqueTrajectoire(central, defl, r, iR) {
  const ages = central.map((p) => p.age);
  const ymax = echelle(Math.max(...central.map((p, i) => Math.max(p.net, p.financier) * defl(i))));
  const { x, y, s } = cadre(ages, ymax);
  const ligne = (k, coul, larg, tiret) => `<path d="${central.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p[k] * defl(i)).toFixed(1)}`).join("")}" fill="none" stroke="${coul}" stroke-width="${larg}"${tiret ? ' stroke-dasharray="5 4"' : ""} stroke-linejoin="round"/>`;
  const repere = (i, texte, decalage) => i > 0 && i < central.length
    ? `<line x1="${x(i)}" x2="${x(i)}" y1="${GEOM.h}" y2="${GEOM.H - GEOM.b}" stroke="var(--fg)" stroke-width="1.5" stroke-dasharray="4 4"/><text x="${Math.min(x(i) + 6, GEOM.W - 110)}" y="${GEOM.h + 10 + decalage}" style="fill:var(--fg);font-weight:600">${texte}</text>` : "";
  let svg = `<svg class="graphe" viewBox="0 0 ${GEOM.W} ${GEOM.H}" role="img" aria-label="Patrimoine net selon l'âge (scénario central)">${s}`;
  svg += ligne("financier", "var(--muted)", 1.5, true) + ligne("net", "var(--s1)", 2.5);
  svg += repere(central.findIndex((p) => p.evenement === "achat"), "Achat de la résidence", 14) + repere(iR, "Retraite", 0);
  svg += colonnesSurvol(ages, x, (i) => {
    const p = central[i], f = defl(i);
    return `${p.age} ans\nPatrimoine net : ${eur(p.net * f)}\nDont placements : ${eur(p.financier * f)}` + (p.bien - p.dette > 0.5 || p.bien > 0.5 ? `\nImmobilier net du crédit : ${eur((p.bien - p.dette) * f)}` : "");
  }, "curseur-traj");
  svg += `</svg>`;
  return svg + `<div class="legende-g"><span><span class="trait" style="background:var(--s1)"></span>Patrimoine net (placements + immobilier − crédits)</span><span><span class="trait" style="background:var(--muted)"></span>Placements seuls (pointillés)</span></div>`;
}

// Résumé de l'achat de la résidence, à partir du même diagnostic que le panneau « Résidence principale » (blocAchat)
function resumeAchat(res) {
  const a = res?.achat; if (!a) return null;
  const plan = etat.brouillon;
  if (a.imperatif && a.horizon) return a.horizon.manque > 0.5 ? { ok: false, age: a.horizon.age, manque: a.horizon.manque } : { ok: true, age: a.horizon.age, manque: 0 };
  const ch = a.choisi, i = a.ideal;
  if (ch && (ch.horsLimite || ch.tropTard)) return { ok: false, age: ch.age, impossible: true, manque: 0 };
  if (ch) return ch.ok || ch.okAvecPlacements ? { ok: true, age: ch.age, manque: 0, aVendre: ch.ok ? 0 : ch.aVendre } : { ok: false, age: ch.age, manque: ch.manqueTotal };
  if (i) return { ok: true, age: i.age, manque: 0 }; // l'âge idéal est, par construction, finançable
  // Aucun âge finançable : on montre l'apport qui manque à l'âge où l'écart est le plus faible (colonne « Verdict » du tableau)
  const pires = a.serie.map((p) => diagnosticAchat(plan, p)).filter((d) => !d.tropTard);
  const meilleur = pires.reduce((m, d) => (!m || d.manqueTotal < m.manqueTotal ? d : m), null);
  return meilleur ? { ok: false, age: meilleur.age, manque: meilleur.manqueTotal } : { ok: false, age: null, impossible: true, manque: 0 };
}

// « Mon avenir en 3 chiffres » (niveau Débutant) : tout vient du scénario central, sans tirages au hasard
function avenirEnTroisChiffres(r, defl, iR) {
  const C = r.central, H = etat.brouillon.hypotheses, R = r.retraite;
  const ageR = R?.age ?? C[iR].age;
  const net = C[iR].net * defl(iR);
  const L = libertePatrimoine(r, H, etat.resultat?.alloc ?? {});
  let libre = "pas de calcul possible", libreSous = "", phraseLibre = "";
  if (L && !(L.objectif > 0)) { libre = "déjà couverte"; libreSous = "ta retraite publique suffit"; phraseLibre = "Ta retraite publique couvre déjà tes besoins."; }
  else if (L) {
    libre = L.fire ? (L.fire.age <= C[0].age ? "déjà atteinte" : `à ${L.fire.age} ans`) : `pas avant ${ageR} ans`;
    libreSous = `capital de ${keur(L.objectif)} (25 × tes besoins annuels)`;
    phraseLibre = L.fire ? `Ton capital pourrait financer tes besoins ${L.fire.age <= C[0].age ? "dès aujourd'hui" : `dès ${L.fire.age} ans`}.` : `Ton capital ne suffirait pas à vivre de tes placements avant ${ageR} ans : il faut continuer d'épargner.`;
  }
  let tuile3, phrase3;
  if (etat.profil.projetRP?.actif) {
    const A = resumeAchat(etat.resultat);
    if (!A) { tuile3 = ["Achat de ta résidence", "prix à renseigner", "dans Mon profil"]; phrase3 = "Renseigne le prix visé dans Mon profil pour savoir à quel âge acheter ta résidence principale."; }
    else if (A.impossible) { tuile3 = ["Achat de ta résidence", A.age ? `impossible à ${A.age} ans` : "hors de portée", "revois l'âge ou le prix dans Mon profil"]; phrase3 = "Ton projet de résidence principale n'est pas finançable en l'état."; }
    else if (A.ok) { tuile3 = ["Achat de ta résidence", `finançable à ${A.age} ans`, A.aVendre > 0.5 ? `en vendant ${eur(A.aVendre)} de placements` : "apport couvert"]; phrase3 = `Ta résidence principale serait finançable à ${A.age} ans.`; }
    else { tuile3 = ["Achat de ta résidence", `apport manquant : ${eur(A.manque)}`, `pour acheter à ${A.age} ans`]; phrase3 = `Il te manque encore ${eur(A.manque)} d'apport pour acheter ta résidence principale à ${A.age} ans.`; }
  } else {
    const p0 = profilPourMoteur(), mois = moisPrecaution(p0.placements, p0.depensesMensuelles);
    tuile3 = ["Épargne de précaution", mois == null ? "dépenses à renseigner" : `${(Math.round(mois * 10) / 10).toLocaleString("fr-FR")} mois de dépenses`, "en livrets, avant d'investir"];
    phrase3 = mois == null ? "" : mois < 3 ? "Ton épargne de précaution couvre moins de 3 mois de dépenses : c'est la première priorité." : mois < 6 ? "Ton épargne de précaution couvre déjà plusieurs mois de dépenses : c'est solide." : "Ton épargne de précaution couvre 6 mois de dépenses ou plus : tu es à l'abri des imprévus.";
  }
  const tuiles = [[`Ton patrimoine à la retraite`, eur(net), `net, à ${ageR} ans, en euros d'aujourd'hui`], ["Liberté financière", libre, libreSous], tuile3];
  const phrase = `En suivant ton plan, tu aurais environ ${eur(net)} à ${ageR} ans, en euros d'aujourd'hui. ${phraseLibre} ${phrase3}`.replace(/\s+/g, " ").trim();
  return `<section class="panneau" id="tr-avenir" data-seul="debutant"><h2>Mon avenir en 3 chiffres</h2>
    <div class="tuiles trois">${tuiles.map(([k, v, sous]) => `<div class="tuile"><span>${k}</span><b class="num">${v}</b>${sous ? `<span class="small muted">${sous}</span>` : ""}</div>`).join("")}</div>
    <p class="note" style="margin:0">${echapper(phrase)}</p>
  </section>`;
}

function rendreTrajectoire() {
  const t0 = performance.now();
  const plan = etat.brouillon, H = plan.hypotheses;
  const deb = niveauCourant() === "debutant";
  // Panneaux produits seulement au niveau où ils sont visibles : en Débutant, ni éventail, ni crise, ni fiscalité
  $("#achat-trajectoire").innerHTML = siNiveau("intermediaire", () => (etat.resultat ? blocAchat(etat.resultat) : "")
    || `<section class="panneau"><h2>Résidence principale</h2><p class="small muted" style="margin:6px 0 0">Pas de projet d'achat pour ce profil. Pour savoir à quel âge acheter et quel apport viser, coche « Projet d'achat » dans <a class="lien-fiche" href="#mon-profil">Mon profil</a>.</p></section>`);
  let r;
  try { r = projectionCourante(achatInclus(), { central: deb }); }
  catch (e) { console.error(e); $("#trajectoire").innerHTML = `<div class="erreur">La projection ne peut pas être calculée : ${echapper(e.message)}.</div>`; return; }
  const reel = montantsReels();
  const defl = (i) => (reel ? Math.pow(1 + (H.inflation ?? 0) / 100, -i) : 1);
  const C = r.central, E = r.eventail;
  const iR = Math.max(0, Math.min(C.length - 1, (H.ageRetraite ?? 64) - C[0].age));
  const iF = C.length - 1;
  const iRet = Math.max(0, Math.min(C.length - 1, (r.retraite?.age ?? H.ageRetraite ?? 64) - C[0].age));
  const unite = reel ? "en euros d'aujourd'hui" : "en euros de l'époque";

  const tuiles = siNiveau("intermediaire", () => `<div class="tuiles quatre" id="tr-tuiles" data-min="intermediaire">${[
    [`À ${C[iR].age} ans (médiane)`, eur(E[iR].p50 * defl(iR))],
    [`Fourchette à ${C[iR].age} ans`, `${keur(E[iR].p10 * defl(iR))} – ${keur(E[iR].p90 * defl(iR))}`],
    [`Patrimoine net à ${C[iF].age} ans`, eur(C[iF].net * defl(iF))],
    [`Après impôts à ${C[iF].age} ans`, eur(C[iF].apresImpots * defl(iF))],
  ].map(([k, v]) => `<div class="tuile"><span>${k}</span><b class="num">${v}</b></div>`).join("")}</div>`);
  const infoAchat = siNiveau("intermediaire", () => {
    let t = "";
    if (r.achat) {
      const a = r.achat, i = C.findIndex((p) => p.evenement === "achat");
      t = i >= 0
        ? `Achat de la résidence à ${a.age} ans (${a.imperatif ? "date impérative" : "âge idéal"}) : ${eur(a.prix)}, apport ${eur(a.apportRequis)} prélevé sur les placements, prêt de ${eur(a.pret)} sur ${a.duree} ans (${eur(a.mensualite)}/mois). Le loyer s'arrête, la mensualité est déduite de l'épargne.`
        : `L'achat prévu à ${a.age} ans n'a pas pu être financé dans le scénario central.`;
      if (r.achatsRates > 0) t += ` Dans ${Math.round((100 * r.achatsRates) / r.simulations)} % des scénarios, l'apport manque à cette date.`;
    } else if (etat.profil.projetRP?.actif && achatInclus()) t = "Aucun âge d'achat finançable avant la limite du plan : l'achat n'est pas inclus.";
    return t ? `<p class="small" style="margin:0" data-min="intermediaire">${echapper(t)}</p>` : "";
  });
  const infoPER = siNiveau("intermediaire", () => r.per?.actif ? `<p class="small" data-min="intermediaire" style="margin:6px 0 0">PER : ${eur(r.per.annuel)} versés par an jusqu'à ${Math.min(H.ageRetraite ?? 64, 70)} ans, ${plan.per?.reinvestirEconomie ? `et ${eur(r.per.economie)} d'économie d'impôt réépargnés chaque année` : "économie d'impôt non réépargnée"}. Dans « après impôts », les versements déduits sont imposés à ${plan.per?.tmiRetraite ?? 0} % à la sortie (hypothèse).</p>` : "");

  // Repères : tous les 5 ans, plus la retraite, l'achat et la fin de la projection
  const idx = [...new Set(C.map((p, i) => i).filter((i) => i % 5 === 0 || i === iR || i === iF || C[i].evenement === "achat"))].sort((x, y) => x - y);
  const gain = (x, mis) => (mis > 0.5 ? (x - mis) / mis : null);
  const celluleGain = (x, mis, f, i) => {
    const g = i === 0 ? null : gain(x, mis);
    return `<td class="m">${eur(x * f)}${g == null ? "" : `<div class="small ${g >= 0 ? "ecart-plus" : "ecart-moins"}">${g >= 0 ? "+" : "−"}${pct(Math.abs(100 * g))}</div>`}</td>`;
  };
  const panneauRapporte = () => {
    const lignesGains = idx.map((i) => {
      const f = defl(i), mis = C[i].verse;
      return `<tr><td>${C[i].age} ans${C[i].evenement === "achat" ? " · achat" : ""}</td><td class="m">${mis > 0.5 ? eur(mis * f) : '<span class="small muted">déjà tout récupéré</span>'}</td>
      ${celluleGain(E[i].p10, mis, f, i)}${celluleGain(E[i].p50, mis, f, i)}${celluleGain(E[i].p90, mis, f, i)}${celluleGain(C[i].financier, mis, f, i)}
      <td class="m"><b>${i === 0 ? "—" : E[i].probaGain >= 1 ? "100 %" : E[i].probaGain >= 0.995 ? "plus de 99 %" : `${Math.round(100 * E[i].probaGain)} %`}</b></td></tr>`;
    }).join("");
    return `<section class="panneau" id="tr-rapporte" data-min="intermediaire"><h2>Ce que rapporte ton épargne</h2>
      ${(() => { const RR = r.retraite; return RR ? `<p class="verdict ok" style="margin:4px 0 8px"><b>Hypothèses retraite utilisées :</b> arrêt de travail à ${RR.age} ans, puis ${eur(RR.revenu)} par mois (après impôt, en euros d'aujourd'hui) pris sur tes placements${RR.pension > 0 ? `, moins ${eur(RR.pension)} de retraite publique à partir de ${RR.agePension} ans` : ", sans retraite publique comptée"}. <a class="lien-fiche" href="#mon-profil">Modifier dans « Mon profil », bloc « Ta retraite »</a></p>` : ""; })()}
      <p class="note" style="margin:4px 0 8px">« Argent mis » : ton capital de départ, plus toute l'épargne versée jusqu'à cet âge${r.achat ? ", moins l'apport sorti pour l'achat" : ""}. Sous chaque montant, le gain ou la perte par rapport à cet argent mis. Pessimiste : 1 scénario sur 10 fait moins bien ; optimiste : 1 sur 10 fait mieux ; médiane : la moitié fait mieux, la moitié moins bien ; central : rendements moyens chaque année. Placements seulement, avant impôts.</p>
      <div class="table-wrap"><table><thead><tr><th>Âge</th><th class="m">Argent mis</th><th class="m">Pessimiste</th><th class="m">Médiane</th><th class="m">Optimiste</th><th class="m">Central</th><th class="m">Chances d'avoir gagné</th></tr></thead><tbody>${lignesGains}</tbody></table></div>
      <p class="note" style="margin:8px 0 0">« Chances d'avoir gagné » : part des ${r.simulations} scénarios où les placements valent plus que l'argent mis à cet âge. Ces chances ne montent pas toujours avec l'âge : l'épargne des dernières années n'a pas encore eu le temps de rapporter, et un krach juste avant la date regardée suffit à faire repasser quelques scénarios sous l'argent mis. Après ${H.ageRetraite ?? 64} ans, l'argent mis diminue des revenus que tu te verses.</p>
    </section>`;
  };
  // Après impôts : impôt du scénario central, et même taux d'impôt sur les gains pour les autres scénarios
  const panneauApresImpots = () => {
    const lignesImpots = idx.map((i) => {
      const p = C[i], f = defl(i);
      const gainsCentral = Math.max(1, p.financier - p.baseTotal);
      const taux = Math.min(0.6, Math.max(0, p.impotPlacements / gainsCentral));
      const immo = p.bien - p.dette;
      // Chaque scénario a son propre impôt (sa composition, ses gains) ; à défaut, le taux du scénario central
      const parScenario = E[i].a10 != null;
      const cellule = (pX, aX, tX) => parScenario
        ? `<td class="m">${eur((aX + immo) * f)}<div class="small muted">impôts ${eur(tX * f)}</div></td>`
        : `<td class="m">${eur((pX - taux * Math.max(0, pX - p.baseTotal) - p.impotPER + immo) * f)}<div class="small muted">impôts ${eur((taux * Math.max(0, pX - p.baseTotal) + p.impotPER) * f)}</div></td>`;
      return `<tr><td>${p.age} ans</td><td class="m">${eur(immo * f)}</td>
      ${cellule(E[i].p10, E[i].a10, E[i].t10)}${cellule(E[i].p50, E[i].a50, E[i].t50)}${cellule(E[i].p90, E[i].a90, E[i].t90)}
      <td class="m"><b>${eur(p.apresImpots * f)}</b><div class="small muted">impôts ${eur((p.impotPlacements + p.impotPER) * f)}</div></td></tr>`;
    }).join("");
    return `<section class="panneau" id="tr-apres-impots" data-min="avance"><h2>Après impôts, si tout était vendu</h2>
      <p class="note" style="margin:4px 0 8px">Patrimoine net : placements moins les impôts dus si tout était vendu à cet âge, plus ${etat.profil.proprietaire || r.achat ? "l'immobilier net du crédit restant (colonne « Immobilier net »)" : "l'immobilier s'il y en a"}. Chaque scénario a sa ligne ; sous chaque montant, le total des impôts qui seraient payés.</p>
      <div class="table-wrap"><table><thead><tr><th>Âge</th><th class="m">Immobilier net</th><th class="m">Pessimiste</th><th class="m">Médiane</th><th class="m">Optimiste</th><th class="m">Central</th></tr></thead><tbody>${lignesImpots}</tbody></table></div>
      <p class="note" style="margin:8px 0 0">Impôts calculés pour le scénario central selon la fiscalité ${plan.fiscalite?.verifieeLe ? `vérifiée le ${new Date(plan.fiscalite.verifieeLe + "T12:00").toLocaleDateString("fr-FR")}` : "du plan"} (gains de chaque compte, or au régime le plus favorable, résidence principale exonérée${r.per?.actif ? ", PER imposé à la sortie" : ""}) . Pessimiste, médiane et optimiste : chacun des scénarios tirés au hasard est taxé avec sa propre répartition et ses propres gains (moins de gains et plus de livrets quand les marchés ont stagné, donc moins d'impôt), puis on prend le 1er dixième, la médiane et le 9e dixième du résultat après impôts. Immobilier net : valeur du logement moins le crédit restant ; il est valorisé de ${pct(H.valorisationImmobiliere ?? 0)} par an (hypothèse modifiable dans « Mon plan »), donc en euros d'aujourd'hui il ne monte que si ce taux dépasse l'inflation (${pct(H.inflation ?? 0)}). Ne sont pas comptés : les impôts payés lors des rééquilibrages, les abattements annuels de l'assurance-vie et la plus-value d'un logement autre que la résidence principale.</p>
    </section>`;
  };

  $("#trajectoire").innerHTML = `
    ${deb ? avenirEnTroisChiffres(r, defl, iRet) : ""}
    <section class="panneau" id="tr-trajectoire"><h2>Trajectoire du patrimoine</h2>
      <p class="note" style="margin:4px 0 0">${etat.profil.foyer?.actif ? "Foyer : les âges affichés sont l'âge de référence du couple. " : ""}Chaque année, le plan est réappliqué : paliers, âge, protection de l'apport. L'épargne suit le salaire (${normaliserProfil(etat.profil).salaireDans10Ans > 0 ? "selon ton salaire espéré dans 10 ans, puis ta carrière" : `carrière « ${echapper((carriereDe(plan, etat.profil).libelle ?? "").split(" :")[0])} »`}) et s'arrête à ${r.retraite?.age ?? H.ageRetraite} ans. Montants ${unite}.</p>
      ${tuiles}${infoAchat}${infoPER}
      <div style="margin-top:10px">${graphiqueTrajectoire(C, defl, r, iRet)}</div>
      <p class="small" style="margin:6px 0 0" id="tr-ligne-retraite">À ${C[iRet].age} ans (retraite) : patrimoine net <b class="num">${eur(C[iRet].net * defl(iRet))}</b>, dont ${eur(C[iRet].financier * defl(iRet))} de placements. Survole le graphique pour lire chaque âge.</p>
    </section>
    ${siNiveau("intermediaire", () => `<div id="tr-objectifs" data-min="intermediaire">${blocObjectifs(r)}</div>`)}
    ${siNiveau("intermediaire", () => blocTranches(r, defl, unite))}
    ${siNiveau("avance", () => `<section class="panneau" id="tr-composition" data-min="avance"><h2>Composition des placements · scénario central</h2>
      <p class="note" style="margin:4px 0 8px">Rendements moyens du plan chaque année. Survole le graphique pour le détail.</p>${graphiqueComposition(C, defl, r.achat)}</section>`)}
    ${siNiveau("intermediaire", () => `<section class="panneau" id="tr-eventail" data-min="intermediaire"><h2>Éventail des possibles · ${r.simulations} scénarios</h2>
      <p class="note" style="margin:4px 0 8px">Les rendements sont tirés au hasard chaque année selon la volatilité de chaque classe (bitcoin très variable). La médiane est sous le scénario central : les années de baisse pèsent plus que les années de hausse.</p>${graphiqueEventail(C, E, defl)}</section>`)}
    ${siNiveau("avance", () => `<section class="panneau" id="bloc-crise" data-min="avance"><h2>Et si une crise arrivait ?</h2>
      <p class="note" style="margin:4px 0 10px">On rejoue une crise passée sur ton portefeuille, puis les rendements moyens du plan. Pour voir ce que tu risques, et pourquoi il ne faut pas paniquer.</p>
      <div class="ligne-actions">
        <label for="crise-choix" class="small">Crise</label><select id="crise-choix" style="width:auto">${Object.entries(CRISES).map(([k, c]) => `<option value="${k}" ${k === uiCrise.id ? "selected" : ""}>${echapper(c.libelle)}</option>`).join("")}</select>
        <label for="crise-moment" class="small">Quand</label><select id="crise-moment" style="width:auto">${[["bientot", "L'année prochaine"], ["avant", "5 ans avant ta retraite"], ["retraite", "L'année où tu arrêtes de travailler"]].map(([k, l]) => `<option value="${k}" ${k === uiCrise.moment ? "selected" : ""}>${l}</option>`).join("")}</select>
      </div>
      <div id="crise-resultat" style="margin-top:10px"></div>
    </section>`)}
    ${siNiveau("avance", () => `<section class="panneau" id="bloc-historique" data-min="avance"><h2>Rejouer l'histoire réelle (${HISTORIQUE.debut}–${HISTORIQUE.fin})</h2>
      <p class="note" style="margin:4px 0 10px">On applique à ton plan, une fenêtre après l'autre, les rendements et l'inflation réellement observés depuis ${HISTORIQUE.debut}. Ce n'est pas une prévision : le passé ne se répète pas à l'identique.</p>
      <div class="ligne-actions">
        <label for="hist-longueur" class="small">Durée</label><select id="hist-longueur" style="width:auto">${[20, 30].map((n) => `<option value="${n}" ${n === uiHistorique.longueur ? "selected" : ""}>${n} ans</option>`).join("")}</select>
        <label for="hist-depart" class="small">Départ</label><select id="hist-depart" style="width:auto"><option value="maintenant" ${uiHistorique.depart === "maintenant" ? "selected" : ""}>Maintenant</option><option value="retraite" ${uiHistorique.depart === "retraite" ? "selected" : ""}>À la retraite</option></select>
      </div>
      <div id="hist-resultat" style="margin-top:10px"></div>
    </section>`)}
    ${siNiveau("intermediaire", () => `<section class="panneau" id="bloc-inflation" data-min="intermediaire"><h2>Et si l'inflation restait à 4–6 % pendant 10 ans ?</h2>
      <div class="ligne-actions">
        <label for="infl-taux" class="small">Inflation</label><select id="infl-taux" style="width:auto">${[4, 5, 6].map((n) => `<option value="${n}" ${n === uiInflation.taux ? "selected" : ""}>${n} % par an</option>`).join("")}</select>
      </div>
      <div id="infl-resultat" style="margin-top:10px"></div>
    </section>`)}
    ${siNiveau("intermediaire", panneauRapporte)}
    ${siNiveau("avance", panneauApresImpots)}
    ${siNiveau("avance", () => `<section class="panneau" id="bloc-ab" data-min="avance">${blocScenarios(r, reel)}</section>`)}
    ${siNiveau("avance", () => `<section class="panneau" id="bloc-fiscal" data-min="avance"></section>`)}`;
  rendreCrise();
  rendreHistorique();
  rendreInflation();
  rendreFiscal();
  try { performance.measure(`rendreTrajectoire:${niveauCourant()}`, { start: t0 }); } catch {} // mesure lisible via performance.getEntriesByType("measure")
}

// ---------------------------------------------------------------- évolution de la fiscalité
// « Et si la fiscalité changeait ? » : tout est recalculé avec d'autres règles à partir d'une année choisie
let simFiscale = { scenario: "ps", annee: 1, perso: { ...NEUTRE, dPS: 1.4 }, ...(memo.get("sim-fiscale") ?? {}) };
let cacheFiscal = { cle: null, r: null, sens: null }, minuteurFiscal = null;
const reglesFiscales = () => (simFiscale.scenario === "perso" ? simFiscale.perso : SCENARIOS_FISCAUX.find((s) => s.id === simFiscale.scenario)?.h ?? {});
function rendreFiscal() {
  const el = $("#bloc-fiscal"); if (!el) return;
  const plan = etat.brouillon, base = projectionCourante(true), R = base.retraite;
  const iR = R?.iR ?? null, ageAuj = base.central[0]?.age ?? 0;
  const S = SCENARIOS_FISCAUX.find((s) => s.id === simFiscale.scenario);
  const P = simFiscale.perso;
  const annees = [[1, `En ${new Date().getFullYear() + 1} (prochaine loi de finances)`], [5, "Dans 5 ans"], [10, "Dans 10 ans"], ...(iR > 0 ? [[iR, `À ta retraite (${ageAuj + iR} ans)`]] : [])];
  const ch = (id, lib, v, aide = "") => `<label class="coche"><input type="checkbox" data-fs="${id}" ${v ? "checked" : ""}> ${lib}</label>${aide ? `<p class="note" style="margin:-4px 0 0">${aide}</p>` : ""}`;
  const nb = (id, lib, v, unite, pas, min, max) => `<div class="champ"><label for="fs-${id}">${lib}</label><div class="saisie"><input id="fs-${id}" type="number" step="${pas}" min="${min}" max="${max}" data-fs="${id}" value="${v}"><span>${unite}</span></div></div>`;
  el.innerHTML = `<h2>Et si la fiscalité changeait ?</h2>
    <p class="note" style="margin:4px 0 8px">Les règles changent presque chaque année avec la loi de finances : flat tax en 2018, prélèvements sociaux relevés en 2026, amortissement du meublé rogné en 2025… Choisis un changement possible et sa date : le site recalcule ta trajectoire et ta retraite avec ces nouvelles règles, pour voir à quel point ton plan en dépend. Ce sont des hypothèses, pas des prévisions.</p>
    <div class="champs" style="max-width:640px">
      <div class="champ"><label for="fs-scenario">Changement à tester</label><select id="fs-scenario">${SCENARIOS_FISCAUX.map((s) => `<option value="${s.id}" ${s.id === simFiscale.scenario ? "selected" : ""}>${echapper(s.nom)}</option>`).join("")}<option value="perso" ${simFiscale.scenario === "perso" ? "selected" : ""}>Mon propre scénario</option></select></div>
      <div class="champ"><label for="fs-annee">À partir de</label><select id="fs-annee">${annees.map(([v, l]) => `<option value="${v}" ${v === simFiscale.annee ? "selected" : ""}>${l}</option>`).join("")}</select></div>
    </div>
    ${S ? `<p class="small" style="margin:6px 0 0">${echapper(S.texte)}</p>` : ""}
    <details id="fs-perso" style="margin-top:8px" ${simFiscale.scenario === "perso" ? "open" : ""}><summary class="small"><b>Construire mon propre scénario</b></summary>
      <div class="champs" style="max-width:640px;margin-top:8px">
        ${nb("dPS", "Prélèvements sociaux : variation (18,6 % aujourd'hui)", P.dPS, "points", 0.1, -5, 10)}
        ${nb("dIR", "Part impôt de la flat tax : variation (12,8 % aujourd'hui)", P.dIR, "points", 0.1, -5, 20)}
        ${ch("peaIR", "Le PEA de plus de 5 ans paie aussi l'impôt sur le revenu", P.peaIR)}
        ${ch("avFin", "L'assurance-vie de plus de 8 ans perd son taux réduit", P.avFin)}
        ${ch("livrets", "Les intérêts du Livret A, du LDDS et du LEP deviennent imposés", P.livrets)}
        ${ch("lmnpFin", "Fin de l'amortissement en location meublée (LMNP)", P.lmnp === false)}
        ${nb("perDed", "PER : part de l'économie d'impôt qui reste", P.perDed, "%", 10, 0, 100)}
        <div class="champ"><label for="fs-perSortie">PER : tranche appliquée à la sortie</label><select id="fs-perSortie" data-fs="perSortie">${[["", `Celle du plan (${plan.per?.tmiRetraite ?? 11} %)`], ["0", "0 %"], ["11", "11 %"], ["30", "30 %"], ["41", "41 %"]].map(([v, l]) => `<option value="${v}" ${String(P.perSortie ?? "") === v ? "selected" : ""}>${l}</option>`).join("")}</select></div>
      </div>
    </details>
    <div id="fs-resultat" style="margin-top:12px"><p class="muted small">Calcul en cours…</p></div>`;
  clearTimeout(minuteurFiscal);
  minuteurFiscal = setTimeout(calculerFiscal, 60);
}
function calculerFiscal() {
  const out = $("#fs-resultat"); if (!out) return;
  const plan = etat.brouillon, H = plan.hypotheses, infl = (H.inflation ?? 0) / 100;
  const profil = profilPourMoteur();
  const h = reglesFiscales(), annee = simFiscale.annee;
  const cle = JSON.stringify([cacheProjection.cle, h, annee]);
  let base, r;
  try {
    base = projectionCourante(true);
    if (cacheFiscal.cle !== cle) {
      r = projeter(plan, profil, { inclureAchat: true, fiscF: optionFiscale(plan, h, annee) });
      // Sensibilité : chaque changement seul, scénario central (rapide)
      const ref = projeterCentral(plan, profil, { inclureAchat: true });
      const ecart = (pts, i) => pts.central[i] ? pts.central[i].financier - pts.central[i].impotPlacements - pts.central[i].impotPER : 0;
      const sens = SCENARIOS_FISCAUX.filter((s) => !["noir", "baisse"].includes(s.id)).map((s) => {
        const c = projeterCentral(plan, profil, { inclureAchat: true, fiscF: optionFiscale(plan, s.h, annee) });
        return { s, retraite: ecart(c, ref.iR) - ecart(ref, ref.iR), fin: ecart(c, ref.dernier) - ecart(ref, ref.dernier), iR: ref.iR, dernier: ref.dernier };
      }).sort((a, b) => a.retraite - b.retraite);
      cacheFiscal = { cle, r, sens };
    }
    r = cacheFiscal.r;
  } catch (e) { console.error(e); out.innerHTML = `<p class="erreur">Calcul impossible : ${echapper(e.message)}</p>`; return; }
  const R0 = base.retraite, R1 = r.retraite;
  if (!R0 || !R1) { out.innerHTML = '<p class="muted small">La retraite est hors de la période projetée : pas de comparaison possible.</p>'; return; }
  const iR = R0.iR, iF = R0.dernier;
  const reel = (v, i) => v / Math.pow(1 + infl, i);
  const net = (pts, i) => pts.central[i].financier - pts.central[i].impotPlacements - pts.central[i].impotPER;
  const ecartTxt = (a, b, unite = "") => { const d = b - a; return Math.abs(d) < 0.5 ? '<span class="muted">inchangé</span>' : `<span class="${d < 0 ? "ecart-moins" : "ecart-plus"}">${d < 0 ? "−" : "+"}${eur(Math.abs(d))}${unite}${a > 0 ? ` (${d < 0 ? "−" : "+"}${pct(Math.abs((100 * d) / a))})` : ""}</span>`; };
  const tuiles = [
    [`Placements après impôts à ${base.central[iR].age} ans (départ)`, reel(net(base, iR), iR), reel(net(r, iR), iR), ""],
    ["Revenu possible sans entamer le capital", R0.revenuPreserve ?? 0, R1.revenuPreserve ?? 0, "/mois"],
    [`Placements après impôts à ${base.central[iF].age} ans`, reel(net(base, iF), iF), reel(net(r, iF), iF), ""],
  ];
  const pctD = (x) => `${Math.round(x * 100)} %`;
  const taux = comparerTaux(plan, h).filter((l) => Math.abs(l.apres - l.avant) > 0.05 || l.avant > 0);
  const sens = cacheFiscal.sens ?? [];
  const pire = sens[0];
  out.innerHTML = `<div class="tuiles">${tuiles.map(([k, a, b, u]) => `<div class="tuile"><span>${k}</span><b class="num">${eur(b)}${u}</b><span class="small">${ecartTxt(a, b, u)} par rapport aux règles actuelles (${eur(a)}${u})</span></div>`).join("")}
      <div class="tuile"><span>Chances que l'argent dure jusqu'à ${base.central[iF].age} ans</span><b class="num">${pctD(R1.probaDure)}</b><span class="small">${Math.round(R1.probaDure * 100) === Math.round(R0.probaDure * 100) ? '<span class="muted">inchangé</span>' : `<span class="${R1.probaDure < R0.probaDure ? "ecart-moins" : "ecart-plus"}">${pctD(R0.probaDure)} avec les règles actuelles</span>`}</span></div></div>
    <p class="note" style="margin:6px 0 0">En euros d'aujourd'hui, scénario central (rendements moyens) ; les chances viennent des ${r.simulations} scénarios tirés au hasard. Les nouvelles règles s'appliquent à partir de ${new Date().getFullYear() + simFiscale.annee} : aux ventes, aux retraits de la retraite, aux loyers, aux intérêts des livrets et aux versements sur le PER.</p>
    <h3 style="margin:14px 0 4px">Ce qui change, produit par produit</h3>
    <div class="table-wrap"><table><thead><tr><th>Produit</th><th class="m">Taux sur les gains aujourd'hui</th><th class="m">Dans ce scénario</th></tr></thead><tbody>
      ${taux.map((l) => `<tr><td>${l.nom}</td><td class="m">${pct(l.avant)}</td><td class="m">${Math.abs(l.apres - l.avant) > 0.05 ? `<b class="${l.apres > l.avant ? "ecart-moins" : "ecart-plus"}">${pct(l.apres)}</b>` : pct(l.apres)}</td></tr>`).join("")}
      ${(h.perDed ?? 100) !== 100 ? `<tr><td>PER : économie d'impôt sur les versements</td><td class="m">100 %</td><td class="m"><b class="ecart-moins">${h.perDed} %</b></td></tr>` : ""}
      ${h.lmnp === false ? `<tr><td>Meublé (LMNP au réel) : amortissement</td><td class="m">Oui</td><td class="m"><b class="ecart-moins">Supprimé</b></td></tr>` : ""}
    </tbody></table></div>
    <h3 style="margin:14px 0 4px">Pour toi, quels changements pèseraient le plus ?</h3>
    <p class="note" style="margin:0 0 6px">Chaque changement testé seul, à partir de ${new Date().getFullYear() + simFiscale.annee}, sur tes placements après impôts (scénario central, euros d'aujourd'hui).</p>
    <div class="table-wrap"><table><thead><tr><th>Changement</th><th class="m">À ton départ</th><th class="m">À ${base.central[iF].age} ans</th></tr></thead><tbody>
      ${sens.map((x) => `<tr><td>${echapper(x.s.nom)}</td><td class="m">${ecartTxt(0, reel(x.retraite, x.iR)).replace(/ \(.*\)/, "")}</td><td class="m">${ecartTxt(0, reel(x.fin, x.dernier)).replace(/ \(.*\)/, "")}</td></tr>`).join("")}
    </tbody></table></div>
    <ul class="points" style="margin-top:10px">
      ${pire && pire.retraite < -1000 ? `<li>Ton plan est le plus sensible à : <b>${echapper(pire.s.nom.toLowerCase())}</b>. C'est le risque fiscal à surveiller à chaque loi de finances (en décembre).</li>` : `<li>Aucun changement testé seul ne pèse beaucoup sur ton plan : ta fiscalité est bien répartie.</li>`}
      <li>Répartir son épargne entre plusieurs enveloppes (PEA, assurance-vie, PER, livrets) limite ce risque : une réforme touche rarement tout à la fois.</li>
      <li>Les réformes épargnent souvent l'argent déjà placé : en 2017, la flat tax de l'assurance-vie n'a visé que les versements faits après le 27 septembre 2017. Ouvrir tôt un PEA et une assurance-vie, même avec peu, garde l'antériorité.</li>
      <li>Ici, par prudence, les nouvelles règles s'appliquent à tout, y compris à l'argent déjà placé : c'est le pire cas.</li>
    </ul>`;
}
$("#trajectoire").addEventListener("change", (e) => {
  const t = e.target;
  if (t.id === "fs-scenario") simFiscale.scenario = t.value;
  else if (t.id === "fs-annee") simFiscale.annee = Number(t.value);
  else if (t.dataset?.fs) {
    const k = t.dataset.fs, P = simFiscale.perso;
    if (k === "lmnpFin") P.lmnp = !t.checked;
    else if (t.type === "checkbox") P[k] = t.checked;
    else if (k === "perSortie") P.perSortie = t.value === "" ? null : Number(t.value);
    else P[k] = t.value === "" ? NEUTRE[k] : Number(t.value);
    simFiscale.scenario = "perso";
  } else return;
  memo.set("sim-fiscale", simFiscale);
  rendreFiscal();
});
// ---------------------------------------------------------------- comparer des scénarios
// Jusqu'à 3 scénarios figés (mémorisés dans ce navigateur et dans l'export), comparés au profil actuel.
const MAX_SCENARIOS = 3, COULEURS_SC = ["--s2", "--s5", "--s7"];
// Rangés par profil : chaque profil (l'exemple, le tien, ceux des proches) a ses propres scénarios
const cleScenarios = () => `scenarios:${cleProfilCourant()}`;
function scenariosGardes() {
  let L = memo.get(cleScenarios());
  if (!Array.isArray(L)) {
    // Anciennes versions : une seule liste pour tout le navigateur, attribuée au premier profil qui l'ouvre
    const ancien = memo.get("scenarios"), A = memo.get("scenario-A");
    L = Array.isArray(ancien) ? ancien : A ? [A] : [];
    memo.set(cleScenarios(), L);
    try { localStorage.removeItem("scenarios"); localStorage.removeItem("scenario-A"); } catch {}
  }
  return L.slice(0, MAX_SCENARIOS);
}
const garderScenarios = (L) => memo.set(cleScenarios(), L.slice(0, MAX_SCENARIOS));
function blocScenarios(r, reel) {
  const H = etat.brouillon.hypotheses, infl = (H.inflation ?? 0) / 100;
  const S = scenariosGardes();
  const lettre = (k) => String.fromCharCode(65 + k);
  const intro = `<h2>Comparer des scénarios</h2>
    <p class="note" style="margin:4px 0 8px">Par exemple « locataire, 100 % ETF », « achat de ma résidence », « investissement locatif » ou « départ à 55 ans ». Fige le scénario actuel sous un nom, change ton profil, fige le suivant (3 au plus) : chaque courbe se superpose au profil actuel (patrimoine net, scénario central). Survole le graphique pour lire les écarts année par année.</p>
    <div class="ligne-actions"><input id="ab-nom" type="text" class="texte" maxlength="40" placeholder="Nom du scénario (ex. Locataire, 100 % ETF)" style="max-width:280px"><button type="button" class="principal" id="ab-figer" ${S.length >= MAX_SCENARIOS ? "disabled" : ""}>Figer le scénario actuel${S.length ? ` (${lettre(S.length)})` : " (A)"}</button>${S.length >= MAX_SCENARIOS ? `<span class="small muted">3 scénarios au plus : supprimes-en un pour en figer un autre.</span>` : ""}</div>
    ${S.length ? `<ul class="points" style="margin:8px 0 0">${S.map((x, k) => `<li><span class="trait" style="display:inline-block;width:18px;height:3px;vertical-align:middle;background:var(${COULEURS_SC[k]})"></span> <b>${lettre(k)} : ${echapper(x.nom || "sans nom")}</b> <span class="small muted">figé le ${new Date(x.date).toLocaleDateString("fr-FR")}</span> <button type="button" class="lien" data-suppr-sc="${k}">Supprimer</button></li>`).join("")}</ul>` : ""}`;
  if (!S.length) return intro;
  const B = r.central.map((p, i) => ({ age: p.age, v: p.net, i }));
  const val = (x) => (reel ? x.v / Math.pow(1 + infl, x.i) : x.v);
  const ages = B.map((b) => b.age);
  const serie = (sc) => ages.map((a) => { const p = sc.points.find((q) => q.age === a); return p ? { age: a, v: p.net, i: p.i } : null; });
  const series = S.map(serie);
  const tous = [...B.map(val), ...series.flatMap((se) => se.filter(Boolean).map(val))];
  const { W, H: Hh, g, d, h, b } = GEOM;
  const ymax = echelle(Math.max(1, ...tous)), ymin = Math.min(0, ...tous);
  const x = (i) => g + (i * (W - g - d)) / Math.max(1, ages.length - 1);
  const y = (v) => Hh - b - ((v - ymin) * (Hh - b - h)) / (ymax - ymin || 1);
  const chemin = (se) => se.map((p, i) => (p ? `${x(i).toFixed(1)},${y(val(p)).toFixed(1)}` : null)).filter(Boolean).join(" ");
  let svg = `<svg class="graphe" viewBox="0 0 ${W} ${Hh}" role="img" aria-label="Patrimoine net des scénarios figés et du profil actuel selon l'âge">`;
  for (let k = 0; k <= 4; k++) { const v = ymin + ((ymax - ymin) * k) / 4; svg += `<line class="grille-l" x1="${g}" x2="${W - d}" y1="${y(v)}" y2="${y(v)}"/><text x="${g - 8}" y="${y(v) + 4}" text-anchor="end">${keur(v)}</text>`; }
  ages.forEach((a, i) => { if (i % 5 === 0 || i === ages.length - 1) svg += `<text x="${x(i)}" y="${Hh - 9}" text-anchor="middle">${a} ans</text>`; });
  svg += `<line class="axe" x1="${g}" x2="${W - d}" y1="${Hh - b}" y2="${Hh - b}"/>`;
  series.forEach((se, k) => { svg += `<polyline points="${chemin(se)}" fill="none" stroke="var(${COULEURS_SC[k]})" stroke-width="2" stroke-dasharray="6 4"/>`; });
  svg += `<polyline points="${chemin(B)}" fill="none" stroke="var(--s1)" stroke-width="2.5"/>`;
  svg += colonnesSurvol(ages, x, (i) => {
    const vb = val(B[i]);
    return `${ages[i]} ans\nActuel : ${eur(vb)}` + series.map((se, k) => (se[i] ? `\n${lettre(k)} (${S[k].nom || "sans nom"}) : ${eur(val(se[i]))} · actuel ${vb - val(se[i]) >= 0 ? "+" : "−"}${eur(Math.abs(vb - val(se[i])))}` : "")).join("");
  }, "curseur-ab");
  svg += `</svg>`;
  const idx = ages.map((a, i) => i).filter((i) => i % 5 === 0 || i === ages.length - 1);
  const lignes = idx.map((i) => `<tr><td>${ages[i]} ans</td><td class="m"><b>${eur(val(B[i]))}</b></td>${series.map((se) => { if (!se[i]) return '<td class="m muted">—</td>'; const dd = val(B[i]) - val(se[i]); return `<td class="m">${eur(val(se[i]))}<div class="small"><span class="${dd >= 0 ? "ecart-plus" : "ecart-moins"}">actuel ${dd >= 0 ? "+" : "−"}${eur(Math.abs(dd))}</span></div></td>`; }).join("")}</tr>`).join("");
  return intro + `<div style="margin-top:10px">${svg}</div>
    <div class="legende-g"><span><span class="trait" style="background:var(--s1)"></span>Profil actuel</span>${S.map((sc, k) => `<span><span class="trait" style="background:var(${COULEURS_SC[k]})"></span>${lettre(k)} : ${echapper(sc.nom || "sans nom")}</span>`).join("")}</div>
    <div class="table-wrap" style="margin-top:8px"><table><thead><tr><th>Âge</th><th class="m">Actuel</th>${S.map((sc, k) => `<th class="m">${lettre(k)} : ${echapper(sc.nom || "sans nom")}</th>`).join("")}</tr></thead><tbody>${lignes}</tbody></table></div>
    <p class="note" style="margin:8px 0 0">Patrimoine net (placements + immobilier − crédits), scénario central, ${reel ? "en euros d'aujourd'hui" : "en euros de l'époque"}. Les scénarios sont gardés dans ce navigateur et dans l'export de tes données.</p>`;
}
$("#trajectoire").addEventListener("click", (e) => {
  const t = e.target;
  if (t.id !== "ab-figer" && !t.dataset?.supprSc) return;
  let r; try { r = projectionCourante(achatInclus()); } catch { return; }
  const S = scenariosGardes();
  if (t.id === "ab-figer" && S.length < MAX_SCENARIOS) S.push({ nom: $("#ab-nom")?.value?.trim() || "", date: new Date().toISOString(), points: r.central.map((p, i) => ({ age: p.age, net: p.net, i })) });
  else if (t.dataset.supprSc) S.splice(Number(t.dataset.supprSc), 1);
  garderScenarios(S);
  $("#bloc-ab").innerHTML = blocScenarios(r, montantsReels());
});
$("#t-reel").addEventListener("change", rendreTrajectoire);

// Crise rejouée : trois trajectoires (sans crise, en gardant le cap, en paniquant)
const uiCrise = { id: memo.get("crise-id") ?? "2008", moment: memo.get("crise-moment") ?? "bientot" };
function rendreCrise() {
  const out = $("#crise-resultat"); if (!out) return;
  const plan = etat.brouillon, H = plan.hypotheses;
  const p = profilPourMoteur(), age0 = Math.round(normaliserProfil(p).age ?? 30);
  const PRage = projectionCourante(achatInclus()).retraite?.age ?? H.ageRetraite ?? 64;
  const ageDebut = uiCrise.moment === "bientot" ? age0 + 1 : uiCrise.moment === "avant" ? Math.max(age0 + 1, PRage - 5) : Math.max(age0 + 1, PRage);
  let r;
  try { r = simulerCrise(plan, p, { crise: uiCrise.id, ageDebut, inclureAchat: achatInclus() }); }
  catch (e) { console.error(e); out.innerHTML = `<p class="erreur">Simulation impossible : ${echapper(e.message)}</p>`; return; }
  const reel = montantsReels(), infl = (H.inflation ?? 0) / 100;
  const defl = (i) => (reel ? Math.pow(1 + infl, -i) : 1);
  const S = r.sans, G = r.garde, P = r.panique, d = r.debut, n = r.crise.annees.length;
  const ages = S.map((pt) => pt.age);
  // Pire moment, retour au niveau d'avant, écarts à la retraite
  // Pire moment : le plus grand écart avec la même vie sans crise (achat et retraits compris des deux côtés)
  let iMin = d; for (let i = d; i <= Math.min(S.length - 1, d + n + 2); i++) if (G[i].financier / (S[i].financier || 1) < G[iMin].financier / (S[iMin].financier || 1)) iMin = i;
  const perte = S[iMin].financier - G[iMin].financier, avant = G[d].financier;
  const iRetour = G.findIndex((pt, i) => i > d && i > iMin && pt.financier >= avant);
  const iRet = Math.min(S.length - 1, d + 10);  // comparaison 10 ans après le début de la crise
  const cmp = (a, b) => `${a >= b ? "+" : "−"}${eur(Math.abs(a - b))} (${a >= b ? "+" : "−"}${pct(Math.abs(100 * (a - b) / (b || 1)))})`;
  const ymax = echelle(Math.max(...S.map((pt, i) => Math.max(pt.financier, G[i].financier, P[i].financier) * defl(i))));
  const { x, y, s } = cadre(ages, ymax);
  const ligne = (T, coul, larg, tiret) => `<path d="${T.map((pt, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(pt.financier * defl(i)).toFixed(1)}`).join("")}" fill="none" stroke="${coul}" stroke-width="${larg}"${tiret ? ' stroke-dasharray="5 4"' : ""} stroke-linejoin="round"/>`;
  let svg = `<svg class="graphe" viewBox="0 0 ${GEOM.W} ${GEOM.H}" role="img" aria-label="Placements avec et sans crise">${s}`;
  svg += `<rect x="${x(d)}" y="${GEOM.h}" width="${Math.max(2, x(Math.min(S.length - 1, d + n)) - x(d))}" height="${GEOM.H - GEOM.b - GEOM.h}" fill="var(--warn)" fill-opacity="0.08"/>`;
  svg += ligne(S, "var(--muted)", 1.5, true) + ligne(P, "var(--s2)", 2) + ligne(G, "var(--s1)", 2.5);
  svg += colonnesSurvol(ages, x, (i) => `${ages[i]} ans\nSans crise : ${eur(S[i].financier * defl(i))}\nCrise, en gardant le cap : ${eur(G[i].financier * defl(i))}\nCrise, en paniquant : ${eur(P[i].financier * defl(i))}`, "curseur-crise");
  svg += `</svg><div class="legende-g"><span><span class="trait" style="background:var(--s1)"></span>Crise, en gardant le cap</span><span><span class="trait" style="background:var(--s2)"></span>Crise, en paniquant (tout vendu au plus bas, retour 2 ans plus tard)</span><span><span class="trait" style="background:var(--muted)"></span>Sans crise (pointillés)</span><span><span class="pastille" style="background:var(--warn);opacity:.3"></span>Années de crise</span></div>`;
  const tuiles = [
    [`Pire moment (${ages[iMin]} ans), par rapport à sans crise`, `−${eur(perte * defl(iMin))} (−${pct(100 * perte / (S[iMin].financier || 1))})`],
    ["Retour au niveau d'avant la crise", iRetour > 0 ? `${iRetour - d} an(s) après le début` : "pas avant la fin de la projection"],
    [`10 ans après (${ages[iRet]} ans), en gardant le cap`, cmp(G[iRet].financier * defl(iRet), S[iRet].financier * defl(iRet))],
    [`10 ans après (${ages[iRet]} ans), en paniquant`, cmp(P[iRet].financier * defl(iRet), S[iRet].financier * defl(iRet))],
  ];
  out.innerHTML = `<p class="small" style="margin:0 0 8px"><b>${echapper(r.crise.libelle)}</b>, rejouée à partir de ${ages[d]} ans : ${echapper(r.crise.resume)}</p>
    ${svg}
    <div class="tuiles quatre">${tuiles.map(([k, v]) => `<div class="tuile"><span>${k}</span><b class="num">${v}</b></div>`).join("")}</div>
    <ul class="points" style="margin-top:4px">
      <li>${texteLie(`Dix ans après le début de la crise, garder le cap coûte ${eur(Math.max(0, (S[iRet].financier - G[iRet].financier) * defl(iRet)))} par rapport à une vie sans crise ; paniquer au plus bas coûte ${eur(Math.max(0, (G[iRet].financier - P[iRet].financier) * defl(iRet)))} de plus. Vendre après la baisse, c'est rendre la perte définitive et rater la remontée.`)}</li>
      <li>${texteLie("Pendant la crise, l'épargne de chaque mois continue d'acheter, mais moins cher : c'est ce qui fait remonter le portefeuille plus vite que la bourse elle-même. C'est tout l'intérêt d'investir progressivement, chaque mois.")}</li>
      <li>${texteLie("L'épargne de sécurité, l'assurance-vie, les obligations et l'or amortissent le choc : c'est pour ça que le plan ne met jamais tout en bourse, et devient plus prudent avec l'âge.")}</li>
      <li>${texteLie("Une crise juste avant ou au début de la retraite fait plus mal : on vend pour vivre pendant que les prix sont bas. D'où la réserve sans risque de 2 à 3 ans de retraits (onglet Retraite).")}</li>
    </ul>
    <p class="note" style="margin:8px 0 0">Rendements de crise approximatifs (ordres de grandeur en euros : bourse 70 % S&amp;P 500, 30 % STOXX Europe 600 ; le bitcoin n'existant pas avant 2009, on lui applique une chute comparable à 2018 et 2022). Après la crise, les rendements moyens du plan s'appliquent. Montants ${reel ? "en euros d'aujourd'hui" : "en euros de l'époque"}.</p>`;
}
$("#trajectoire").addEventListener("change", (e) => {
  if (e.target.id === "crise-choix") { uiCrise.id = e.target.value; memo.set("crise-id", uiCrise.id); rendreCrise(); }
  if (e.target.id === "crise-moment") { uiCrise.moment = e.target.value; memo.set("crise-moment", uiCrise.moment); rendreCrise(); }
});
// Histoire réelle rejouée (fenêtres glissantes sur HISTORIQUE) et inflation persistante
const uiHistorique = { longueur: Number(memo.get("hist-longueur")) === 20 ? 20 : 30, depart: memo.get("hist-depart") === "maintenant" ? "maintenant" : "retraite" };
const uiInflation = { taux: [4, 5, 6].includes(Number(memo.get("infl-taux"))) ? Number(memo.get("infl-taux")) : 5 };
let cacheHistorique = { cle: null, r: null };
let cacheInflation = { cle: null, r: null };
function rendreHistorique() {
  const out = $("#hist-resultat"); if (!out) return;
  if (!HISTORIQUE.annees?.length) { out.innerHTML = `<p class="note">Données historiques indisponibles.</p>`; return; }
  const plan = etat.brouillon, p = profilPourMoteur();
  const retraiteDeja = (Math.round(normaliserProfil(p).age ?? 0)) >= (projectionCourante(achatInclus()).retraite?.age ?? plan.hypotheses.ageRetraite ?? 64);
  const depart = retraiteDeja ? "maintenant" : uiHistorique.depart;
  const sel = $("#hist-depart"); if (sel) { sel.disabled = retraiteDeja; sel.value = depart; }
  const cle = JSON.stringify([plan, etat.profil, achatInclus(), uiHistorique.longueur, depart]);
  let r;
  try {
    if (cacheHistorique.cle === cle) r = cacheHistorique.r;
    else { r = backtesterHistorique(plan, p, { series: HISTORIQUE.annees, longueur: uiHistorique.longueur, depart, inclureAchat: achatInclus(), estimations: HISTORIQUE.estimations }); cacheHistorique = { cle, r }; }
  } catch (e) { console.error(e); out.innerHTML = `<p class="erreur">Simulation impossible : ${echapper(e.message)}</p>`; return; }
  if (!r.fenetres.length) { out.innerHTML = `<p class="note">Données historiques indisponibles pour cette durée.</p>`; return; }
  const S = r.synthese, ages = r.fenetres[0].trajectoireReelle.map((pt) => pt.age);
  const ymax = echelle(Math.max(1, ...r.fenetres.map((f) => Math.max(...f.trajectoireReelle.map((pt) => pt.valeur)))));
  const { x, y, s } = cadre(ages, ymax);
  const trace = (f, coul, larg, op) => `<path d="${f.trajectoireReelle.map((pt, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(pt.valeur).toFixed(1)}`).join("")}" fill="none" stroke="${coul}" stroke-width="${larg}" stroke-opacity="${op}" stroke-linejoin="round"/>`;
  const cible = (R) => r.fenetres.find((f) => R && f.debut === R.debut && f.fin === R.fin);
  const fPire = cible(S.pire), fMed = cible(S.mediane);
  let svg = `<svg class="graphe" viewBox="0 0 ${GEOM.W} ${GEOM.H}" role="img" aria-label="Trajectoires du capital selon toutes les périodes historiques">${s}`;
  svg += r.fenetres.map((f) => trace(f, "var(--s1)", 1, 0.22)).join("");
  if (fMed) svg += trace(fMed, "var(--s1)", 2.5, 1);
  if (fPire) svg += trace(fPire, "var(--s2)", 2.5, 1);
  svg += colonnesSurvol(ages, x, (i) => `${ages[i]} ans\nPire période (${S.pire.debut}–${S.pire.fin}) : ${eur(fPire?.trajectoireReelle[i]?.valeur ?? 0)}\nPériode médiane (${S.mediane.debut}–${S.mediane.fin}) : ${eur(fMed?.trajectoireReelle[i]?.valeur ?? 0)}`, "curseur-hist");
  svg += `</svg><div class="legende-g"><span><span class="trait" style="background:var(--s1);opacity:.4"></span>Chaque période historique</span><span><span class="trait" style="background:var(--s1)"></span>Période médiane</span><span><span class="trait" style="background:var(--s2)"></span>Pire période</span></div>`;
  const estimeesDe = (f) => {
    const L = r.estimationsLibelles ?? {};
    const t = ["scpi", "prudent", "bitcoin"].filter((c) => f?.anneesEstimees?.[c] > 0 && L[c]).map((c) => `${f.anneesEstimees[c]} ${f.anneesEstimees[c] > 1 ? "ans" : "an"} ${L[c]}`);
    return t.join(", ");
  };
  const ligneS = (lib, R) => {
    if (!R) return "";
    const e = estimeesDe(cible(R));
    return `<li>${lib} : ${R.debut}–${R.fin}, capital réel en fin de fenêtre <b class="num">${eur(R.capitalReelFinFenetre)}</b>${e ? ` <span class="small">(${echapper(e)})</span>` : ""}</li>`;
  };
  const nbMesurees = r.fenetres.filter((f) => !(f.anneesEstimees?.scpi > 0) && !(f.anneesEstimees?.prudent > 0)).length;
  const detientBtc = r.fenetres.some((f) => f.anneesEstimees?.bitcoin > 0);
  const trois = [...r.fenetres].sort((a, b) => a.capitalReelFinFenetre - b.capitalReelFinFenetre).slice(0, 3);
  const substit = r.fenetres.some((f) => f.anneesEstimees?.bitcoin > 0);
  const sources = Object.entries(HISTORIQUE.sources ?? {}).filter(([, v]) => v);
  const fiabilite = Object.entries(HISTORIQUE.fiabilite ?? {}).filter(([, v]) => v);
  out.innerHTML = `<p style="margin:0 0 6px"><b>Dans ${Math.round(100 * (S.tauxSucces ?? 0))} % des périodes historiques, ton capital aurait tenu</b> (${S.nb} périodes de ${r.longueur} ans, départ à ${r.ageDepart} ans).</p>
    ${svg}
    <ul class="points" style="margin-top:6px">${ligneS("Pire", S.pire)}${ligneS("Médiane", S.mediane)}${ligneS("Meilleure", S.meilleure)}
      <li>Scénario central du plan, au même horizon (patrimoine financier en euros d'aujourd'hui) : <b class="num">${eur(r.centralReelFinFenetre)}</b></li></ul>
    <p class="note" style="margin:6px 0 0">${nbMesurees} période${nbMesurees > 1 ? "s" : ""} sur ${S.nb} ${nbMesurees > 1 ? "reposent" : "repose"} uniquement sur des données mesurées${detientBtc ? " (hors bitcoin, remplacé par les actions avant 2018)" : ""}.</p>
    <div class="table-wrap"><table><caption class="small" style="text-align:left">Les 3 pires périodes</caption><thead><tr><th>Période</th><th>Inflation moyenne</th><th>Capital réel en fin de période</th><th>Capital épuisé à</th><th>Données estimées</th></tr></thead><tbody>
      ${trois.map((f) => `<tr><td>${f.debut}–${f.fin}</td><td>${pct(f.inflationMoyenne)}</td><td class="num">${eur(f.capitalReelFinFenetre)}</td><td>${f.ageEpuisement != null ? `${f.ageEpuisement} ans` : "—"}</td><td>${echapper(estimeesDe(f)) || "—"}</td></tr>`).join("")}</tbody></table></div>
    ${substit ? `<p class="note" style="margin:8px 0 0">Avant 2018, le bitcoin n'était pas accessible de façon réaliste et liquide à un épargnant français : sa part est remplacée par des actions pour les années concernées.</p>` : ""}
    ${sources.length ? `<details style="margin-top:8px"><summary class="small">Sources</summary><ul class="points">${sources.map(([k, v]) => `<li><b>${echapper(k)}</b> : ${echapper(v)}</li>`).join("")}${fiabilite.map(([k, v]) => `<li><b>${echapper(k)}</b> : Données estimées : ${echapper(v)}</li>`).join("")}</ul></details>` : ""}`;
}
function rendreInflation() {
  const out = $("#infl-resultat"); if (!out) return;
  const plan = etat.brouillon, p = profilPourMoteur();
  const cle = JSON.stringify([plan, etat.profil, achatInclus(), uiInflation.taux]);
  let r;
  try {
    if (cacheInflation.cle === cle) r = cacheInflation.r;
    else { r = scenarioInflation(plan, p, { taux: uiInflation.taux, inclureAchat: achatInclus() }); cacheInflation = { cle, r }; }
  } catch (e) { console.error(e); out.innerHTML = `<p class="erreur">Simulation impossible : ${echapper(e.message)}</p>`; return; }
  const classes = [["securite", "Livrets"], ["prudent", "Fonds euros"], ["bourse", "Actions"], ["or", "Or"], ["scpi", "SCPI"], ["bitcoin", "Bitcoin"]];
  const L = 680, ligneH = 26, gauche = 110, droite = 56, H = classes.length * ligneH + 22;
  const finale = (k) => { const s = r.indicesReels[k]; return Array.isArray(s) && s.length ? s[s.length - 1] : 0; };
  const vmax = Math.max(120, ...classes.map(([k]) => finale(k))) * 1.05;
  const xv = (v) => gauche + (v / vmax) * (L - gauche - droite);
  let svg = `<svg class="graphe" viewBox="0 0 ${L} ${H}" role="img" aria-label="Pouvoir d'achat final par classe d'actifs, base 100">`;
  classes.forEach(([k, lib], i) => {
    const v = finale(k), yy = 8 + i * ligneH;
    svg += `<text x="${gauche - 8}" y="${yy + 14}" text-anchor="end">${lib}</text><rect x="${gauche}" y="${yy + 2}" width="${Math.max(1, xv(v) - gauche).toFixed(1)}" height="${ligneH - 8}" fill="${v >= 100 ? "var(--s1)" : "var(--s2)"}" fill-opacity="0.85"/><text x="${xv(v) + 6}" y="${yy + 14}">${Math.round(v)}</text>`;
  });
  svg += `<line x1="${xv(100)}" x2="${xv(100)}" y1="4" y2="${H - 14}" stroke="var(--fg)" stroke-width="1.5" stroke-dasharray="4 4"/><text x="${xv(100)}" y="${H - 2}" text-anchor="middle">100 = pouvoir d'achat d'aujourd'hui</text></svg>`;
  const E = r.patrimoine, R = r.retraite;
  const ageTxt = (a) => (a == null ? "pas d'épuisement" : `${a} ans`);
  const effet = R.ageEpuisementCentral !== R.ageEpuisementScenario
    ? `<li>Effet sur la retraite : capital épuisé à ${ageTxt(R.ageEpuisementScenario)} au lieu de ${ageTxt(R.ageEpuisementCentral)} dans le scénario central.</li>` : "";
  const S = SCENARIO_INFLATION;
  out.innerHTML = `${svg}
    <ul class="points" style="margin-top:6px">
      <li>Dans ${r.duree} ans, ton patrimoine financier réel (hors résidence) serait de <b class="num">${eur(E.scenarioReel)}</b> contre <b class="num">${eur(E.centralReel)}</b> dans le scénario central, soit <b class="num">${E.ecart >= 0 ? "+" : "−"}${eur(Math.abs(E.ecart))}</b> (${E.ecart >= 0 ? "+" : "−"}${pct(Math.abs(E.ecartPct))}).</li>${effet}${achatInclus() ? `<li>Ce résultat inclut ton projet d'achat : avec un crédit à taux fixe, les mensualités ne bougent pas alors que le loyer évité suit l'inflation, ce qui amortit le choc.</li>` : ""}</ul>
    <details style="margin-top:8px"><summary class="small">Hypothèses du scénario</summary><ul class="points">
      <li>Ce sont des hypothèses de travail, pas des données mesurées.</li>
      <li>Inflation constante à ${r.taux} % pendant ${r.duree} ans, à partir d'aujourd'hui.</li>
      <li>Livrets : taux de l'inflation moins ${S.ecartLivrets} point (au minimum ${S.plancherLivrets} %).</li>
      <li>Fonds euros : le rendement monte de ${S.prudentHausseParAn} point par an, sans dépasser l'inflation moins ${S.prudentEcartPlafond} point.</li>
      <li>Actions : rendement réel moyen du plan, moins ${Math.abs(S.bourseChocReel)} points les ${S.bourseAnneesChoc} premières années (hausse des taux).</li>
      <li>Or : plus ${S.orPrimeReelle} points de rendement réel (valeur refuge). SCPI : moins ${Math.abs(S.scpiPrimeReelle)} point (loyers indexés avec retard). Bitcoin : rendement réel inchangé.</li></ul></details>`;
}
$("#trajectoire").addEventListener("change", (e) => {
  if (e.target.id === "hist-longueur") { uiHistorique.longueur = Number(e.target.value) === 20 ? 20 : 30; memo.set("hist-longueur", uiHistorique.longueur); rendreHistorique(); }
  if (e.target.id === "hist-depart") { uiHistorique.depart = e.target.value === "maintenant" ? "maintenant" : "retraite"; memo.set("hist-depart", uiHistorique.depart); rendreHistorique(); }
  if (e.target.id === "infl-taux") { uiInflation.taux = Number(e.target.value); memo.set("infl-taux", uiInflation.taux); rendreInflation(); }
});
function choisirAgeAchat(v) {
  etat.profil.projetRP ??= {};
  etat.profil.projetRP.ageChoisi = v > 0 ? v : null;
  memo.set("profil-v2", etat.profil);
  rendreResultats(); rendreTrajectoire(); planifierSauvegardeProfil();
}
$("#achat-trajectoire").addEventListener("change", (e) => { if (e.target.id === "age-achat") choisirAgeAchat(Math.round(Number(e.target.value))); });
// Poche bourse : valeurs des ETF et montant du mois (recalcul quand on quitte le champ)
$("#resultats").addEventListener("change", (e) => {
  const t = e.target;
  if (t.dataset.ligneBourse) { etat.profil.lignesBourse ??= {}; etat.profil.lignesBourse[t.dataset.ligneBourse] = t.value === "" ? 0 : Math.max(0, Number(t.value)); memo.set("profil-v2", etat.profil); planifierSauvegardeProfil(); rendreResultats(); }
  else if (t.id === "dca-montant") { montantDCA = t.value === "" ? null : Math.max(0, Number(t.value)); rendreResultats(); }
  else if (t.dataset.prixEtf) { etat.profil.prixETF ??= {}; etat.profil.prixETF[t.dataset.prixEtf] = t.value === "" ? 0 : Math.max(0, Number(t.value)); memo.set("profil-v2", etat.profil); planifierSauvegardeProfil(); rendreResultats(); }
  else if (t.dataset.deviseEtf) {
    const nom = t.dataset.deviseEtf, L = (etat.brouillon.investissementBourse ?? []).find((x) => x.nom === nom);
    etat.profil.devisesBourse ??= {};
    const cur = etat.profil.devisesBourse[nom] ?? { ...(L ? devisesParDefaut(L) ?? {} : {}) };
    cur[t.dataset.devise] = t.value === "" ? 0 : Math.min(100, Math.max(0, Number(t.value)));
    etat.profil.devisesBourse[nom] = cur;
    memo.set("profil-v2", etat.profil); planifierSauvegardeProfil(); rendreResultats();
    const d = document.querySelector("#poche-bourse details.devises-etf"); if (d) d.open = true;
  }
});
$("#resultats").addEventListener("click", (e) => {
  if (e.target.id === "dca-auto") { montantDCA = null; rendreResultats(); }
  if (e.target.id === "devises-defaut") { delete etat.profil.devisesBourse; memo.set("profil-v2", etat.profil); planifierSauvegardeProfil(); rendreResultats(); const d = document.querySelector("#poche-bourse details.devises-etf"); if (d) d.open = true; }
});
$("#achat-trajectoire").addEventListener("click", (e) => { if (e.target.id === "age-ideal") choisirAgeAchat(null); });
$("#t-achat").addEventListener("change", rendreTrajectoire);

// Tous les 5 ans : âge, salaire, épargne, placements et répartition ; les bascules du plan
function basculesDuPlan(r) {
  const plan = etat.brouillon, H = plan.hypotheses, C = r.central;
  const p0 = normaliserProfil(etat.profil);
  const R = profilRisque(plan, p0);
  const ev = [];
  const part = (pt, c) => (pt.financier > 0 ? (pt.classes?.[c] ?? 0) / pt.financier : 0);
  const ENTREES = {
    bitcoin: "Le bitcoin entre dans la répartition",
    or: "L'or physique entre dans la répartition",
    scpi: "L'immobilier (SCPI) entre dans la répartition",
  };
  for (const [c, texte] of Object.entries(ENTREES)) {
    if (!plan.classes[c]) continue;
    // Première apparition seulement (une classe déjà détenue aujourd'hui n'« entre » pas)
    const y = C.findIndex((pt, k) => part(pt, c) >= 0.005 && C.slice(0, k).every((q) => part(q, c) < 0.005));
    if (y > 0) ev.push({ y, court: texte.replace(" dans la répartition", ""), texte: `${texte} : le capital atteint environ ${keur(C[y].financier)}. Sa part monte ensuite progressivement, selon les paliers de capital du plan.` });
  }
  const debut = plan.age.ageDebut + (R.decalageAge ?? 0);
  const y0 = debut - C[0].age;
  if (y0 > 0 && y0 < C.length) ev.push({ y: y0, court: "Début de la prudence", texte: `Début du passage progressif vers la prudence (profil ${R.libelle ?? ""}) : chaque année, ${pct(plan.age.pointsParAn)} du capital passe des placements risqués vers l'assurance-vie et les obligations, jusqu'à ${pct(plan.age.maxPoints)} au total.` });
  else if (y0 <= 0) ev.push({ y: 0, court: "Prudence en cours", texte: `Le passage progressif vers la prudence a déjà commencé (depuis ${debut} ans) : ${pct(plan.age.pointsParAn)} du capital par an vers l'assurance-vie et les obligations.` });
  const iA = C.findIndex((pt) => pt.evenement === "achat");
  if (iA >= 0 && r.achat) {
    ev.push({ y: iA, court: "Achat de la résidence", texte: `Achat de la résidence principale (${eur(r.achat.prix)}) : ${eur(r.achat.apportRequis)} d'apport pris sur les placements, crédit de ${eur(r.achat.mensualite)} par mois pendant ${r.achat.duree} ans.` });
    const fin = iA + r.achat.duree;
    if (fin < C.length) ev.push({ y: fin, court: "Fin du crédit", texte: "Fin du crédit immobilier : la mensualité redevient de l'épargne." });
  }
  const yR = (r.retraite?.age ?? H.ageRetraite ?? 64) - C[0].age;
  if (yR > 0 && yR < C.length) ev.push({ y: yR, court: "Retraite", texte: `Retraite : l'épargne s'arrête et tu te verses ${eur(r.retraite?.revenu ?? 0)} par mois (en euros d'aujourd'hui) pris sur tes placements. Détail dans l'onglet « 4. Retraite ».` });
  // Investissement locatif
  const iL = C.findIndex((p) => p.locatif);
  if (iL >= 0) ev.push({ y: iL, court: "Locatif", texte: {
    achat: "Achat du bien locatif : l'apport sort des placements, le crédit commence, les loyers arrivent.",
    impossible: "Investissement locatif impossible : pas assez de placements pour l'apport à cet âge. Il n'est pas compté.",
    refuse: `Investissement locatif refusé par la banque : avec ce crédit, l'endettement dépasserait ${A_MAX()} % (voir « Ton taux d'endettement » dans « Mon profil »). Il n'est pas compté.`,
  }[C[iL].locatif] });
  // Événements de vie saisis dans « Mon profil »
  for (const e of etat.profil.evenements ?? []) {
    const yE = Math.round(Number(e.age) || 0) - C[0].age;
    if (!(yE >= 0 && yE < C.length)) continue;
    const n = Math.max(1, Number(e.annees) || 1), lib = e.libelle || TYPES_EV.find(([v]) => v === e.type)?.[1] || "Événement";
    ev.push({ y: yE, court: lib, texte: e.type === "pause" ? `${lib} : pas d'épargne pendant ${n} an(s).` : `${lib} : ${e.type === "entree" ? "+" : "−"}${eur(Number(e.montant) || 0)}${n > 1 ? ` par an pendant ${n} ans` : ""} (euros d'aujourd'hui).` });
  }
  return ev.sort((a, b) => a.y - b.y);
}

function blocTranches(r, defl, unite) {
  const plan = etat.brouillon, C = r.central;
  const ev = basculesDuPlan(r);
  const pas = [0, 5, 10, 15, 20, 25, 30].filter((k) => k < C.length);
  const lignes = pas.map((k, j) => {
    const pt = C[k], f = defl(k);
    const total = pt.financier || 1;
    const classes = ORDRE.filter((c) => (pt.classes?.[c] ?? 0) > 0.5);
    const barre = `<div class="mini-barre" data-bulle="${echapper(`À ${pt.age} ans · ${eur(pt.financier * f)}\n` + classes.map((c) => `${plan.classes[c].libelle} : ${eur(pt.classes[c] * f)} (${pct((100 * pt.classes[c]) / total)})`).join("\n"))}">${classes.map((c) => `<span style="flex-grow:${pt.classes[c]};background:var(${COULEUR[c]})"></span>`).join("")}</div>`;
    const avant = j === 0 ? -1 : pas[j - 1];
    const changes = ev.filter((e) => (j === 0 ? e.y === 0 : e.y > avant && e.y <= k));
    return `<tr><td>${k === 0 ? "Aujourd'hui" : `Dans ${k} ans`}</td><td class="m">${pt.age} ans</td><td class="m">${pt.salaire > 0 ? eur(pt.salaire * f) : "retraite"}</td><td class="m">${eur(Math.max(0, pt.epargne ?? 0) * f)}</td><td class="m"><b>${eur(pt.financier * f)}</b></td><td>${barre}</td>
      <td class="bascules">${changes.map((e) => `<div>${C[e.y].age} ans : ${echapper(e.court)}</div>`).join("") || "—"}</td></tr>`;
  }).join("");
  const legende = ORDRE.filter((c) => pas.some((k) => (C[k].classes?.[c] ?? 0) > 0.5)).map((c) => `<span><span class="pastille" style="background:var(${COULEUR[c]})"></span>${plan.classes[c].libelle}</span>`).join("");
  const p0 = normaliserProfil(etat.profil);
  const hausse = p0.salaireDans10Ans > 0 ? `selon ton salaire espéré dans 10 ans (${eur(p0.salaireDans10Ans)}), puis ta carrière` : `selon ta carrière : ${echapper((carriereDe(plan, p0).libelle ?? "").toLowerCase())}, en plus de l'inflation (${pct(plan.hypotheses.inflation ?? 0)})`;
  return `<section class="panneau" id="tr-tranches" data-min="intermediaire"><h2>Tous les 5 ans</h2>
    <p class="note" style="margin:4px 0 8px">Scénario central, en suivant le plan. Salaire ${hausse} ; l'épargne suit le salaire. Montants ${unite}. Survole une barre pour le détail.</p>
    <div class="table-wrap"><table><thead><tr><th></th><th class="m">Âge</th><th class="m">Salaire net</th><th class="m">Épargne / mois</th><th class="m">Placements</th><th>Répartition</th><th>Ce qui change</th></tr></thead><tbody>${lignes}</tbody></table></div>
    <div class="legende-g">${legende}</div>
    ${ev.length ? `<h3 style="margin:16px 0 0">Les bascules du plan</h3><ul class="bascules">${ev.map((e) => `<li><b class="quand">${C[e.y].age} ans</b><span>${texteLie(e.texte)}</span></li>`).join("")}</ul>` : ""}
  </section>`;
}

// ---------------------------------------------------------------- retraite
// Liberté financière : capital qui suffit (règle des 4 %), et âge « Coast FIRE » à partir duquel
// on pourrait ne plus rien épargner et atteindre quand même l'objectif à l'âge de la retraite
function blocLiberte(r) {
  const L = libertePatrimoine(r, etat.brouillon.hypotheses, etat.resultat?.alloc ?? {});
  if (!L) return "";
  const R = r.retraite, C = r.central;
  const { besoinAn, objectif, rr, coast, fire, ageR, v0 } = L;
  if (!(objectif > 0)) return `<section class="panneau" id="bloc-liberte" data-min="intermediaire"><h2>Liberté financière</h2><p class="small muted" style="margin:0">Ta retraite publique couvre l'objectif : pas besoin de capital pour le revenu visé.</p></section>`;
  return `<section class="panneau" id="bloc-liberte" data-min="intermediaire"><h2>Liberté financière</h2>
    <p class="note" style="margin:4px 0 8px">Règle des 4 % : un capital de 25 fois tes besoins annuels permet en général de retirer 4 % par an pendant 30 ans sans être à court. Tes besoins : ${eur(besoinAn / 12)} par mois${R.pension > 0 ? " (après la retraite publique comptée)" : ""}, soit un objectif de <b>${eur(objectif)}</b> en euros d'aujourd'hui.</p>
    <div class="tuiles">
      <div class="tuile"><span>Ton capital placé aujourd'hui</span><b class="num">${eur(v0)}</b><span class="small muted">${pct((100 * v0) / objectif)} de l'objectif</span></div>
      <div class="tuile"><span>Coast FIRE (ne plus épargner)</span><b class="num">${coast ? (coast.age <= C[0].age ? "déjà atteint" : `à ${coast.age} ans`) : "pas avant la retraite"}</b><span class="small muted">rendement réel moyen ${pct(rr * 100)} par an</span></div>
      <div class="tuile"><span>Liberté financière (tout de suite)</span><b class="num">${fire ? `à ${fire.age} ans` : `pas avant ${ageR} ans`}</b><span class="small muted">capital ≥ ${keur(objectif)}</span></div>
    </div>
    <p class="note" style="margin:8px 0 0">${coast ? `À partir de ${coast.age <= C[0].age ? "maintenant" : `${coast.age} ans`}, même sans épargner un euro de plus, ton capital (${eur(coast.v)}) grandirait jusqu'à environ ${eur(objectif)} à ${ageR} ans grâce aux seuls intérêts composés. Tu pourrais alors épargner moins, ou travailler moins, sans renoncer à ta retraite.` : `En suivant le plan, ton capital n'atteint pas ce seuil avant ${ageR} ans : il faut continuer d'épargner jusqu'à la retraite.`} Scénario central, en euros d'aujourd'hui, avant impôts sur les gains. La règle des 4 % vient d'études américaines ; en France, beaucoup visent plutôt 3,5 % (28 fois les besoins) par prudence.</p>
  </section>`;
}
// ---- Retraite : ordre de retrait fiscalement optimal (décumulation, calculé par projection.js / pension.js)
const POCHES_LIBELLES = { livrets: "Livrets", av_apres70: "Assurance-vie (versements après 70 ans)", av_avant70: "Assurance-vie (versements avant 70 ans)", pea: "PEA", cto: "Compte-titres", per: "PER", orPhysique: "Or physique", scpi: "SCPI", plateformeCrypto: "Bitcoin (plateforme)", coldWallet: "Bitcoin (cold wallet)" };
const libellePoche = (id, plan) => POCHES_LIBELLES[id] ?? plan.enveloppes?.[id]?.libelle ?? plan.classes?.[id]?.libelle ?? id;
function ordreRetraitsHtml(priorite, D) {
  let ordreLiquides;
  if (D?.ordreEtape3 === "ctoDabord") ordreLiquides = "Le compte-titres et les autres placements d'abord, puis le PEA : ton épargne sera consommée, autant laisser fructifier le PEA, moins taxé.";
  else if (D?.ordreEtape3 === "peaDabord" && D.ageEpuisementOptimise == null) ordreLiquides = "Le PEA d'abord, puis le compte-titres : ton épargne ne sera pas épuisée, et les plus-values du compte-titres sont effacées au décès.";
  else ordreLiquides = "Le PEA d'abord (moins taxé), puis le compte-titres et les autres placements.";
  if (D?.gainOrdreReel >= 1) ordreLiquides += ` (environ ${eur(Math.round(D.gainOrdreReel / 10) * 10)} de plus transmis, après impôts au décès${D.gainOrdreApresDroits ? " et droits de succession" : ""}, en euros d'aujourd'hui, que l'ordre inverse)`;
  const etapes = [
    "Le PER est vidé progressivement sur les années qui restent, sans dépasser ta tranche d'imposition.",
    "L'assurance-vie de plus de 8 ans est rachetée chaque année dans la limite de l'abattement (peu ou pas d'impôt sur le revenu).",
    "Les livrets, au-delà d'une réserve de précaution.",
    ordreLiquides,
    "L'assurance-vie des versements après 70 ans, au-delà de l'abattement.",
  ];
  const perHors = "Le PER au-delà de la tranche d'imposition.", avAvant = "L'assurance-vie des versements avant 70 ans, gardée pour la transmission.";
  const fin = priorite === "consommer" ? [avAvant, perHors] : [perHors, avAvant];
  return [...etapes, ...fin, "En dernier : la réserve de livrets, puis l'or physique."].map((t) => `<li>${echapper(t)}</li>`).join("");
}
function exemplesRetraitsHtml(D, plan) {
  if (!D?.exemples?.length) return "";
  const lignes = D.exemples.map((e) => e.retraits.map((r, k) => `<tr>${k === 0 ? `<td rowspan="${e.retraits.length + 1}">${e.age} ans</td>` : ""}<td>${echapper(libellePoche(r.id, plan))}</td><td class="m">${eur(r.montant)}</td><td class="m">${eur(r.impot)}</td></tr>`).join("") + `<tr><td><b>Total</b></td><td class="m"><b>${eur(e.brut)}</b></td><td class="m"><b>${eur(e.impots)}</b></td></tr>`).join("");
  return `<p class="note" style="margin:12px 0 6px">Exemples d'années : ce qui est retiré, compte par compte, et l'impôt payé (en euros de l'époque).</p>
    <div class="table-wrap"><table><thead><tr><th>Âge</th><th>Compte</th><th class="m">Retiré</th><th class="m">Impôt</th></tr></thead><tbody>${lignes}</tbody></table></div>`;
}
function economieRetraitsHtml(D) {
  if (!D || !(D.gainPatrimoineNetReel >= 1) || !(D.anneesComparees > 0)) return "";
  const ageOpt = D.ageEpuisementOptimise, agePro = D.ageEpuisementProrata;
  const epuise = ageOpt !== agePro && agePro != null ? ` Ton épargne tient aussi jusqu'à ${ageOpt == null ? "la fin de la projection" : `${ageOpt} ans`} au lieu de ${agePro} ans.` : "";
  const dix = (x) => eur(Math.round(x / 10) * 10);
  const impots = D.economieReel >= 1
    ? ` dont <b class="num">${dix(D.economieReel)}</b> d'impôts en moins sur ${D.anneesComparees} ans.`
    : " Les impôts payés sont un peu décalés dans le temps (moins au début, davantage plus tard), mais ton capital a plus longtemps travaillé.";
  return `<section class="panneau" id="ret-economie-retraits" data-min="intermediaire"><h2>Retirer dans le bon ordre</h2>
      <p style="margin:6px 0 0">Retirer dans le bon ordre te laisse environ <b class="num">${dix(D.gainPatrimoineNetReel)}</b> de plus à ${D.ageFinal} ans (en euros d'aujourd'hui) qu'un retrait au prorata, pour le même revenu.${impots}${epuise}</p>
      <p class="note" style="margin:6px 0 0">Scénario central, en euros d'aujourd'hui, après les impôts dus au décès sur les plus-values (hors droits de succession).</p>
    </section>`;
}
// Impôts au décès, droits de succession et net transmis, pour la stratégie choisie et pour le retrait au prorata (euros d'aujourd'hui)
function blocDroitsSuccession(D, priorite) {
  if (!D || D.droitsSuccessionOptimise == null || D.droitsSuccessionProrata == null) return "";
  const ligne = (nom, brut, net, droits, apres) => `<tr><td>${nom}</td><td class="m">${eur(brut - net)}</td><td class="m">${eur(droits)}</td><td class="m"><b>${eur(apres)}</b></td></tr>`;
  const nomStrategie = priorite === "consommer" ? "Ordre optimal, priorité « Consommer »" : "Ordre optimal, priorité « Transmettre »";
  return `<h3 style="margin:14px 0 6px">Ce qui serait transmis en fin de projection</h3>
    <div class="table-wrap"><table><thead><tr><th>Stratégie de retraits</th><th class="m">Impôts au décès</th><th class="m">Droits de succession</th><th class="m">Net transmis après droits</th></tr></thead><tbody>
      ${ligne(nomStrategie, D.patrimoineFinalOptimiseReel, D.patrimoineFinalNetReel, D.droitsSuccessionOptimise, D.patrimoineFinalNetApresDroitsReel)}
      ${ligne("Retrait au prorata", D.patrimoineFinalProrataReel, D.patrimoineFinalNetProrataReel, D.droitsSuccessionProrata, D.patrimoineFinalNetApresDroitsProrataReel)}
    </tbody></table></div>
    <p class="note" style="margin:6px 0 0">Droits estimés pour ta situation familiale, sur la part transmise par les placements ; la résidence principale n'y est pas imputée. <a class="lien-fiche" href="#transmission">Voir le détail dans l'onglet Transmission</a>.</p>`;
}
function rendreRetraite() {
  if (niveauCourant() === "debutant") { rendreRetraiteDebutant(); return; }
  const plan = etat.brouillon, H = plan.hypotheses;
  let r;
  try { r = projectionCourante(true); }
  catch (e) { console.error(e); $("#retraite").innerHTML = `<div class="erreur">Calcul impossible : ${echapper(e.message)}.</div>`; return; }
  const R = r.retraite, C = r.central, E = r.eventail;
  const p0 = normaliserProfil(etat.profil);
  const ageAuj = Math.ceil(p0.age ?? 0), ageLegal = H.ageRetraite ?? 64;
  const ageDepart = R?.age ?? ageLegal;
  // Repère : 70 à 80 % du dernier salaire (en euros d'aujourd'hui)
  const iDernier = Math.max(0, (R?.iR ?? 0) - 1);
  const dernierSalaire = C[iDernier]?.salaire ? C[iDernier].salaire / Math.pow(1 + (H.inflation ?? 0) / 100, iDernier) : 0;
  const repere = dernierSalaire > 0 ? `Repère : on vise souvent 70 à 80 % de son dernier salaire. Le tien serait d'environ ${eur(dernierSalaire)} par mois (en euros d'aujourd'hui) à ${C[iDernier].age} ans, soit ${eur(Math.round(dernierSalaire * 0.7 / 50) * 50)} à ${eur(Math.round(dernierSalaire * 0.8 / 50) * 50)} par mois.` : "";
  const optionsAge = Array.from({ length: Math.max(0, ageLegal - ageAuj + 1) }, (_, k) => ageAuj + k).map((a) => `<option value="${a}" ${a === ageDepart ? "selected" : ""}>${a} ans${a === ageLegal ? " (au plus tard)" : ""}</option>`).join("");
  const aLoyers = !!((etat.profil.proprietaire && etat.profil.logement?.usage === "loue") || etat.profil.projetLocatif?.actif);
  const saisie = `<section class="panneau" id="ret-hypotheses" data-min="intermediaire"><h2>Tes hypothèses</h2>
    <div class="champs" style="max-width:600px;margin-top:10px">
      <div class="champ"><label for="r-revenu"><b>Une retraite convenable pour toi</b>, par mois, après impôt, en euros d'aujourd'hui</label><div class="saisie"><input id="r-revenu" type="number" min="0" step="100" value="${p0.retraite?.revenu ?? ""}" placeholder="${plan.retraite?.revenuMensuelDefaut ?? 2000}"><span>€/mois</span></div></div>
      ${repere ? `<p class="note" style="margin:-4px 0 0">${repere}</p>` : ""}
      ${optionsAge ? `<div class="champ"><label for="r-age">Âge où tu arrêtes de travailler</label><select id="r-age">${optionsAge}</select></div>` : ""}
      <div class="champ"><label for="r-mode">Retraite publique</label><select id="r-mode">${[["auto", "Estimée automatiquement (suit l'âge d'arrêt)"], ["manuel", "Montant que j'indique"], ["zero", "Ne pas la compter (prudence)"]].map(([v, l]) => `<option value="${v}" ${(etat.profil.retraite?.modePension ?? "auto") === v ? "selected" : ""}>${l}</option>`).join("")}</select></div>
      <div class="champ"><label for="r-pension">Retraite publique comptée (nette après impôt, en euros d'aujourd'hui)</label><div class="saisie"><input id="r-pension" type="number" min="0" step="10" value="${p0.retraite?.pension ?? ""}" placeholder="0" ${(etat.profil.retraite?.modePension ?? "auto") === "manuel" ? "" : "disabled"}><span>€/mois</span></div></div>
      <p class="note" style="margin:-4px 0 0">${(etat.profil.retraite?.modePension ?? "auto") === "auto" ? `Calculée pour un arrêt à ${ageDepart} ans${(Number(p0.retraite?.pension) || 0) > 0 ? `, versée à partir de ${R?.agePension ?? ageLegal} ans` : ""} : elle change toute seule quand tu changes l'âge d'arrêt (moins de trimestres = retraite plus basse). Détail plus bas, dans « Estimer ta retraite publique ».` : (Number(p0.retraite?.pension) || 0) > 0 ? `Versée à partir de ${R?.agePension ?? ageLegal} ans.` : "Aucune retraite publique comptée : tout vient de tes placements."}</p>
      ${aLoyers ? `<label class="coche" data-min="avance"><input type="checkbox" id="r-loyers" ${etat.profil.retraite?.compterLoyers !== false ? "checked" : ""}> Compter les loyers nets de mes biens loués dans mes revenus à la retraite</label>
      <p class="note" data-min="avance" style="margin:-4px 0 0">${etat.profil.retraite?.compterLoyers !== false ? "Oui, ils sont comptés : chaque année, les loyers nets (après charges, impôt et crédit) rejoignent tes placements, ce qui réduit ce que tu dois y puiser. Décoche pour voir ta retraite sans eux (bien vendu, travaux, vacance…)." : "Non comptés : à partir de ta retraite, les loyers nets ne servent plus à financer ton revenu (le crédit encore en cours, lui, reste payé)."}</p>` : ""}
    </div>
    <p class="note" style="margin:8px 0 0">${(Number(p0.retraite?.pension) || 0) > 0 ? `Tes placements complètent la retraite publique à partir de ${R?.agePension ?? ageLegal} ans, et paient tout avant.` : "Par prudence, le plan compte 0 € de retraite publique : tout vient de tes placements. Pour l'estimer, voir « Estimer ta retraite publique » plus bas."} Tu arrêtes de travailler et d'épargner à ${ageDepart} ans (${ageLegal} ans au plus tard), puis tu te verses ce revenu jusqu'à ${R?.ageFin ?? ageLegal + (plan.retraite?.dureeAnnees ?? 30)} ans, relevé chaque année de l'inflation (${pct(H.inflation ?? 0)} par an)${R ? ` : ${eur(R.revenu)} d'aujourd'hui vaudront environ ${eur(R.revenu * Math.pow(1 + (H.inflation ?? 0) / 100, R.iR))} par mois en ${new Date().getFullYear() + R.iR}` : ""}.</p>
  </section>`;
  if (!R) {
    $("#retraite").innerHTML = saisie + `<section class="panneau"><p class="muted" style="margin:0">${(p0.age ?? 0) >= (H.ageRetraite ?? 64) ? "Ce profil a déjà l'âge de la retraite : la simulation part de la situation actuelle." : "Retraite hors de la période projetée."}</p></section>`;
    return;
  }
  const infl = (H.inflation ?? 0) / 100;
  const reel = (v, i) => v / Math.pow(1 + infl, i);
  const iR = R.iR, iF = R.dernier;
  const capR = reel(C[iR].financier, iR), capF = reel(C[iF].financier, iF);
  const medF = reel(E[iF].p50, iF), p10F = reel(E[iF].p10, iF);
  const probaTxt = `${Math.round(100 * R.probaDure)} %`;
  const tuiles = [
    [`Capital à ${C[iR].age} ans (central)`, eur(capR)],
    [`Capital à ${C[iR].age} ans (médiane)`, eur(reel(E[iR].p50, iR))],
    ["Revenu possible sans entamer le capital", R.revenuPreserve != null ? `${eur(R.revenuPreserve)}/mois` : "—"],
    [`Revenu possible en consommant tout d'ici ${C[iF].age} ans`, R.revenuConsomme != null ? `${eur(R.revenuConsomme)}/mois` : "—"],
    [`Chances que l'argent dure jusqu'à ${C[iF].age} ans`, probaTxt],
    [`À transmettre à ${C[iF].age} ans (médiane)`, eur(Math.max(0, medF))],
  ];
  const ok = R.probaDure >= SEUIL_TENABLE, moyen = R.probaDure >= SEUIL_FRAGILE;
  const verdict = `<p class="verdict ${ok ? "ok" : "ko"}"><b>${ok ? "Objectif tenable." : moyen ? "Objectif fragile." : "Objectif risqué."}</b> Avec ${eur(R.revenu)} par mois (en euros d'aujourd'hui)${R.pension > 0 ? `, dont ${eur(R.pension)} de retraite publique` : ""}, l'argent dure jusqu'à ${C[iF].age} ans dans ${probaTxt} des scénarios.${R.epuiseA ? ` Dans le scénario central, les placements sont épuisés à ${R.epuiseA} ans.` : ` Dans le scénario central, il reste ${eur(Math.max(0, capF))} (en euros d'aujourd'hui) à ${C[iF].age} ans.`}${R.revenuPreserve != null ? ` Pour transmettre au moins le capital de départ (${eur(capR)}), le revenu possible est d'environ ${eur(R.revenuPreserve)} par mois.` : ""}${ok ? "" : " Leviers : épargner plus, partir plus tard, viser un revenu plus bas, ou garder une part de bourse plus importante à la retraite."}</p>`;

  // Évolution pendant la retraite (en euros d'aujourd'hui)
  const defl = (i) => Math.pow(1 + infl, -(i + iR));
  const graphe = graphiqueEventail(C.slice(iR), E.slice(iR), defl);
  const idx = [...new Set(C.map((p, i) => i).filter((i) => i >= iR && ((i - iR) % 5 === 0 || i === iF)))];
  const lignes = idx.map((i) => {
    const p = C[i];
    return `<tr><td>${p.age} ans</td><td class="m">${p.retraitNet > 0 ? `${eur(reel(p.retraitNet, i))}<div class="small muted">${eur(p.retraitNet)} de l'époque</div>` : "—"}</td>
      <td class="m">${eur(reel(E[i].p10, i))}</td><td class="m">${eur(reel(E[i].p50, i))}</td><td class="m">${eur(reel(E[i].p90, i))}</td><td class="m"><b>${eur(reel(p.financier, i))}</b></td></tr>`;
  }).join("");

  // La première année : d'où vient l'argent, et la réserve sans risque
  const pR = C[iR], tot = pR.financier || 1;
  const brut1 = pR.brutRetraits ?? 12 * R.besoin * Math.pow(1 + infl, iR);
  const tauxPremiereAnnee = brut1 > 0 ? (100 * (pR.impotRetraits ?? 0)) / brut1 : 0;
  const D = r.decumulation, priorite = etat.profil.retraite?.priorite === "consommer" ? "consommer" : "transmettre";
  const classes = ORDRE.filter((c) => (pR.classes?.[c] ?? 0) > 0.5);
  // L'or physique est gardé (sauf si la case « vendre aussi mon or » est cochée) : le retrait se répartit sur le reste
  const vendreOr = !!etat.profil.retraite?.vendreOr || !(plan.reequilibrage?.jamaisVendre ?? []).includes("orPhysique");
  const totVendable = classes.filter((c) => vendreOr || c !== "or").reduce((t, c) => t + pR.classes[c], 0) || 1;
  const lignesVentes = classes.map((c) => { const garde = !vendreOr && c === "or"; return `<tr><td><span class="pastille" style="background:var(${COULEUR[c]})"></span>${plan.classes[c].libelle}${garde ? '<div class="small muted">gardé : ni vendu, ni rééquilibré</div>' : ""}</td><td class="m">${eur(reel(pR.classes[c], iR))}</td><td class="m">${pct((100 * pR.classes[c]) / tot)}</td><td class="m">${garde ? "0 €" : eur(reel((brut1 * pR.classes[c]) / totVendable, iR))}</td></tr>`; }).join("");
  const aDeLOr = (pR.classes?.or ?? 0) > 0.5;
  const sansRisque = ["securite", "projet", "prudent"].reduce((t, c) => t + (pR.classes?.[c] ?? 0), 0);
  const anneesReserve = brut1 > 0 ? sansRisque / brut1 : null;
  const tauxRetrait = pR.financier > 0 ? (100 * brut1) / pR.financier : 0;

  const centralAge = agePossibleCentral();
  const cleP = clePessimiste();
  const P = pessimiste.cle === cleP ? pessimiste : null;
  const fmtAge = (a, enCours) => (enCours ? '<span class="muted small">calcul en cours…</span>' : a == null ? `pas avant ${ageLegal} ans` : `${a} ans`);
  const blocAge = `<section class="panneau" id="ret-age" data-min="intermediaire"><h2>À quel âge peux-tu t'arrêter ?</h2>
    <p class="note" style="margin:4px 0 0">Le plus tôt possible pour te verser ${eur(R.revenu)} par mois jusqu'à ${R.ageFin} ans <b>en transmettant à ${R.ageFin} ans tout le capital que tu avais en arrêtant</b> (en euros d'aujourd'hui). À ${ageLegal} ans, on s'arrête quoi qu'il arrive.</p>
    <div class="tuiles" style="grid-template-columns:repeat(2,minmax(0,1fr))">
      <div class="tuile"><span>Scénario central (rendements moyens)</span><b class="num">${fmtAge(centralAge)}</b></div>
      <div class="tuile"><span>Scénario pessimiste (ça marche dans 9 cas sur 10)</span><b class="num" id="age-pessimiste">${fmtAge(P?.age, !P)}</b></div>
    </div>
    <div class="ligne-actions" id="actions-age">${boutonsAge(centralAge, P?.age, ageDepart, ageLegal)}</div>
    <p class="note" style="margin:8px 0 0">Pessimiste : on rejoue 200 scénarios de marchés tirés au hasard (krachs compris) ; l'âge retenu est celui où le capital est transmis intact dans au moins 9 scénarios sur 10. C'est la version prudente à retenir.</p>
  </section>`;
  $("#retraite").innerHTML = saisie + blocObjectifs(r, 'id="ret-objectifs" data-min="intermediaire"') + blocAge + blocLiberte(r) + blocPension(p0) + `
    <section class="panneau" id="ret-resultat" data-min="intermediaire"><h2>Ce que ça donne</h2>
      <div class="tuiles">${tuiles.map(([k, v]) => `<div class="tuile"><span>${k}</span><b class="num">${v}</b></div>`).join("")}</div>
      <div class="tuiles" style="grid-template-columns:repeat(2,minmax(0,1fr));margin-top:0">
        <div class="tuile"><span>Pessimiste (9 cas sur 10) : revenu possible sans entamer le capital</span><b class="num" id="pess-preserve">${P ? `${eur(P.revenuPreserve)}/mois` : '<span class="muted small">calcul en cours…</span>'}</b></div>
        <div class="tuile"><span>Pessimiste (9 cas sur 10) : revenu possible en consommant tout d'ici ${C[iF].age} ans</span><b class="num" id="pess-consomme">${P ? `${eur(P.revenuConsomme)}/mois` : '<span class="muted small">calcul en cours…</span>'}</b></div>
      </div>
      ${verdict}
      <p class="note" style="margin:10px 0 0">Tous les montants sont en euros d'aujourd'hui (inflation déduite). Les revenus possibles sont calculés dans le scénario central (rendements moyens), impôts sur les ventes compris : environ ${pct(tauxPremiereAnnee)} de chaque retrait la première année, puis plus ensuite, car la part de gains dans ce qu'il reste augmente (le capital restant continue de rapporter). Chaque scénario tiré au hasard est taxé avec ses propres gains. L'abattement annuel de l'assurance-vie de plus de 8 ans (${eur(ABATTEMENT_AV.seul)} de gains, ${eur(ABATTEMENT_AV.couple)} pour un couple marié ou pacsé) est utilisé chaque année.</p>
    </section>
${economieRetraitsHtml(D)}
    <section class="panneau" id="ret-capital" data-min="intermediaire"><h2>Ton capital pendant la retraite</h2>
      <p class="note" style="margin:4px 0 8px">Chaque année, le revenu est pris sur les placements, et le reste continue d'être placé selon le plan (de plus en plus prudent avec l'âge). En euros d'aujourd'hui.</p>
      ${graphe}
      <div class="table-wrap" style="margin-top:12px"><table><thead><tr><th>Âge</th><th class="m">Revenu versé / mois</th><th class="m">Pessimiste</th><th class="m">Médiane</th><th class="m">Optimiste</th><th class="m">Central</th></tr></thead><tbody>${lignes}</tbody></table></div>
    </section>
    <section class="panneau" id="ret-decaissement" data-min="avance"><h2>Comment se verser ce revenu</h2>
      <ol class="points" style="margin-top:10px">
        <li>${texteLie(`Une fois par an (en janvier, par exemple), retirer 12 mois de revenu : environ ${eur(reel(brut1, iR))} la première année (en euros d'aujourd'hui), impôts compris, soit ${pct(tauxRetrait)} du capital. On le met sur le compte courant ou un livret, et on se fait un virement automatique chaque mois.`)}</li>
        <li>${texteLie(`Garder une réserve sans risque (livrets, fonds euros, obligations) d'au moins 2 à 3 ans de retraits. Avec le plan, elle représente ${anneesReserve != null ? `environ ${String(Math.round(anneesReserve * 10) / 10).replace(".", ",")} années de retraits` : "—"} au départ.`)}</li>
        <li>${texteLie("Les bonnes années, vendre surtout ce qui dépasse sa cible (c'est le rééquilibrage du plan). Les années de forte baisse de la bourse, puiser dans la réserve sans risque plutôt que vendre des actions au plus bas, puis la reconstituer quand la bourse remonte.")}</li>
        <li>${texteLie("Garder le reste investi selon le plan : à 64 ans, il reste plus de 25 ans à tenir, et une part de bourse est ce qui permet au capital de durer et d'être transmis.")}</li>
      </ol>
      <h3 style="margin:16px 0 4px">Dans quel ordre retirer</h3>
      <div class="champ" style="max-width:420px" data-min="avance"><label for="r-priorite">Priorité</label><select id="r-priorite" data-min="avance"><option value="transmettre" ${priorite === "transmettre" ? "selected" : ""}>Transmettre (garder l'assurance-vie pour mes héritiers)</option><option value="consommer" ${priorite === "consommer" ? "selected" : ""}>Consommer (profiter de mon épargne)</option></select></div>
      <ol class="points" style="margin-top:10px">${ordreRetraitsHtml(priorite, D)}</ol>
      <div id="ret-ordre-retraits" data-min="avance">${exemplesRetraitsHtml(D, plan)}</div>
      <h3 style="margin:16px 0 4px">D'où vient l'argent la première année</h3>
      <p class="note" style="margin:0 0 6px">La simulation retire l'argent dans un ordre qui limite l'impôt, puis ajuste tes familles de placements pour rester proche du plan${aDeLOr && !vendreOr ? " (sauf l'or physique, gardé)" : ""}. Répartition des placements à l'âge du départ, en euros d'aujourd'hui :</p>
      ${aDeLOr ? `<p class="${vendreOr ? "verdict ko" : "note"}" style="margin:0 0 6px">${vendreOr ? "<b>Tu as choisi de vendre aussi ton or physique.</b> C'est possible, mais déconseillé : " : "<b>Ton or physique n'est pas vendu.</b> "}${vendreOr ? "l'or" : "L'or"} physique n'est pas fait pour financer la retraite : il protège contre les crises graves et se transmet (pièces et lingots, avec une fiscalité de transmission comme le reste du patrimoine). Mieux vaut le garder et puiser dans la bourse, l'assurance-vie et l'épargne. Il ne serait vendu qu'en dernier recours, si tout le reste était épuisé. <a class="lien-fiche" href="#mon-profil">Changer ce choix (« Ta retraite » dans Mon profil)</a></p>` : ""}
      <div class="table-wrap"><table><thead><tr><th>Placement</th><th class="m">Montant à ${pR.age} ans</th><th class="m">Part</th><th class="m">À vendre dans l'année</th></tr></thead><tbody>${lignesVentes}</tbody></table></div>
    </section>
    <section class="panneau" id="ret-impots" data-min="avance"><h2>Impôts et transmission</h2>
      <ul class="points" style="margin-top:10px">
        <li>${texteLie(`Assurance-vie de plus de 8 ans : l'abattement annuel (${eur(ABATTEMENT_AV.seul)} de gains, ${eur(ABATTEMENT_AV.couple)} pour un couple marié ou pacsé) est utilisé chaque année par des rachats partiels ; au-delà, les gains paient ${pct(PRELEVEMENTS.IR_AV_8ANS)} d'impôt (${pct(PRELEVEMENTS.IR_PFU)} sur la part des contrats dépassant ${eur(SEUIL_PRIMES_AV)} de versements) et ${pct(PRELEVEMENTS.PS_PATRIMOINE)} de prélèvements sociaux.`)}</li>
        <li>${texteLie("PEA de plus de 5 ans : retraits sans impôt sur le revenu, seulement 18,6 % de prélèvements sociaux sur la part de gains. Il est consommé avant le compte-titres, imposé à 31,4 % sur la part de gains de chaque vente.")}</li>
        <li>${texteLie("PER : la sortie en capital est lissée sur les années restantes, en restant dans ta tranche d'imposition (les versements déduits sont imposés au barème, les gains à 31,4 %), pour éviter une grosse facture d'un seul coup.")}</li>
        <li>${texteLie("Pour transmettre, l'assurance-vie est l'outil le plus avantageux : les sommes versées avant 70 ans sont transmises jusqu'à 152 500 € par bénéficiaire sans droits de succession ; après 70 ans, 30 500 € de versements au total (les gains sont exonérés). Le PEA, lui, est fermé au décès et entre dans la succession.")}</li>
        <li>${reserveAVTransmissible(etat.profil) > 0 ? texteLie(`L'assurance-vie des versements faits avant 70 ans est gardée pour la fin : elle se transmet jusqu'à 152 500 € par bénéficiaire sans droits de succession, soit ${eur(reserveAVTransmissible(etat.profil))} mis de côté pour ta situation (choix « Consommer » pour l'utiliser plus tôt). À faire valider par un conseiller ou un notaire selon ta situation.`) : `L'assurance-vie n'est pas mise de côté pour la transmission : ton conjoint ou partenaire est bénéficiaire de la clause et déjà exonéré de droits. Pour profiter de l'abattement de 152 500 € par bénéficiaire, désigne tes enfants dans la clause (réglage dans l'onglet <a class="lien-fiche" href="#transmission">Transmission</a>), puis l'assurance-vie sera gardée pour la fin.`}</li>
        <li>Droits de succession, abattements, donations : <a class="lien-fiche" href="#fiche-heritage">tout sur l'héritage</a>. Pour aller plus loin : <a class="lien-fiche" href="#fiche-optimisation-fiscale">optimisation fiscale</a>.</li>
      </ul>
      ${blocDroitsSuccession(D, priorite)}
      <p class="note" style="margin:10px 0 0">Limites : simulation fondée sur les rendements du plan ; elle ne compte ni la dépendance (maison de retraite), ni une éventuelle retraite publique si tu la laisses à 0 €. Les droits de succession sont une estimation (barèmes 2026, euros d'aujourd'hui) : le détail et les hypothèses sont dans l'onglet Transmission.</p>
    </section>`;
  majPension();
  lancerPessimiste();
}
// ---- Retraite, niveau Débutant : une seule question, « Est-ce que ma retraite tient ? ».
// Mêmes tirages et mêmes seuils que « Ce que ça donne » (projeter en version allégée) : aucun écart entre les deux niveaux.
const SEUIL_TENABLE = 0.9, SEUIL_FRAGILE = 0.7;
const verdictRetraite = (proba) => (proba >= SEUIL_TENABLE ? "tenable" : proba >= SEUIL_FRAGILE ? "fragile" : "pas-tenable");
let cacheNecessaire = { cle: null, r: null };
let suggestionRetraite = { cle: null, res: null };
let jetonSuggestion = 0;
function htmlSuggestionRetraite(s) {
  if (!s) return `<p class="small muted" style="margin:0">Je cherche la solution la plus simple… calcul en cours.</p>`;
  const { age, revenu } = s;
  if (age == null && revenu == null) return `<p class="note" style="margin:0">Aucun départ plus tardif ni revenu plus bas ne suffit avec ce plan. Pour aller plus loin, épargne davantage dans « Mon profil » : le détail est dans le niveau Intermédiaire.</p>`;
  const phrase = age != null && revenu != null ? `En t'arrêtant à ${age} ans, ou avec un revenu de ${eur(revenu)} par mois, ça tient.`
    : age != null ? `En t'arrêtant à ${age} ans, ça tient.` : `Avec un revenu de ${eur(revenu)} par mois, ça tient.`;
  return `<p style="margin:0 0 8px"><b>${phrase}</b></p>
    <div class="ligne-actions">${age != null ? `<button type="button" class="principal" data-age-depart="${age}">Arrêter à ${age} ans</button>` : ""}${revenu != null ? `<button type="button" ${age == null ? 'class="principal" ' : ""}data-revenu-retraite="${revenu}">Viser ${eur(revenu)} par mois</button>` : ""}</div>`;
}
// Cherche le départ le plus proche, et le revenu le plus proche, pour lesquels le verdict devient « Tenable ».
// Recherche rapide (moins de tirages), puis confirmation avec les tirages du verdict : la suggestion appliquée donne bien « Tenable ».
async function chercherSuggestionRetraite(R, ageLegal, jeton, cle) {
  const RAPIDE = 200;
  const proba = async (modif, tirages) => {
    await pause();
    if (jeton !== jetonSuggestion) throw new Error("annulé");
    const p = normaliserProfil({ ...etat.profil, retraite: { ...(etat.profil.retraite ?? {}), ...modif } });
    return projeter(etat.brouillon, p, { inclureAchat: true, legere: true, tirages })?.retraite?.probaDure ?? 0;
  };
  try {
    const okAge = async (a, t) => (await proba({ ageDepart: a >= ageLegal ? null : a }, t)) >= SEUIL_TENABLE;
    let age = null;
    const de = R.age + 1;
    if (de <= ageLegal && await okAge(ageLegal, RAPIDE)) {
      let bas = de, haut = ageLegal;
      while (bas < haut) { const m = Math.floor((bas + haut) / 2); if (await okAge(m, RAPIDE)) haut = m; else bas = m + 1; }
      age = haut;
      while (age <= ageLegal && !(await okAge(age))) age++;
      if (age > ageLegal) age = null;
    }
    const PAS = 50;
    const okRevenu = async (k, t) => (await proba({ revenu: k * PAS }, t)) >= SEUIL_TENABLE;
    let revenu = null;
    const kMax = Math.ceil(R.revenu / PAS) - 1;
    if (kMax >= 1) {
      let bas = 0, haut = kMax;
      while (bas < haut) { const m = Math.ceil((bas + haut) / 2); if (await okRevenu(m, RAPIDE)) bas = m; else haut = m - 1; }
      let k = bas;
      while (k > 0 && !(await okRevenu(k))) k--;
      revenu = k > 0 ? k * PAS : null;
    }
    if (jeton !== jetonSuggestion) return;
    suggestionRetraite = { cle, res: { age, revenu } };
    const el = $("#ret-suggestion");
    if (el) el.innerHTML = htmlSuggestionRetraite(suggestionRetraite.res);
  } catch (e) {
    if (e.message !== "annulé") { console.error(e); const el = $("#ret-suggestion"); if (el) el.innerHTML = ""; }
  }
}
function rendreRetraiteDebutant() {
  const plan = etat.brouillon, H = plan.hypotheses;
  let r;
  try { r = projectionCourante(true, { legere: true }); }
  catch (e) { console.error(e); $("#retraite").innerHTML = `<div class="erreur">Calcul impossible : ${echapper(e.message)}.</div>`; return; }
  const R = r.retraite, C = r.central;
  const p0 = normaliserProfil(etat.profil);
  const ageAuj = Math.ceil(p0.age ?? 0), ageLegal = H.ageRetraite ?? 64, ageDepart = R?.age ?? ageLegal;
  const optionsAge = Array.from({ length: Math.max(0, ageLegal - ageAuj + 1) }, (_, k) => ageAuj + k).map((a) => `<option value="${a}" ${a === ageDepart ? "selected" : ""}>${a} ans${a === ageLegal ? " (au plus tard)" : ""}</option>`).join("");
  const reglages = `<section class="panneau" id="ret-simple" data-seul="debutant"><h2>Ta retraite en 2 questions</h2>
    <div class="champs" style="max-width:600px;margin-top:10px">
      ${optionsAge ? `<div class="champ"><label for="r-age">Âge où tu veux arrêter de travailler</label><select id="r-age">${optionsAge}</select></div>` : ""}
      <div class="champ"><label for="r-revenu">Revenu voulu par mois, après impôt, en euros d'aujourd'hui</label><div class="saisie"><input id="r-revenu" type="number" min="0" step="100" value="${p0.retraite?.revenu ?? ""}" placeholder="${plan.retraite?.revenuMensuelDefaut ?? 2000}"><span>€/mois</span></div></div>
    </div>
  </section>`;
  if (!R) {
    $("#retraite").innerHTML = reglages + `<section class="panneau" data-seul="debutant"><p class="muted" style="margin:0">${(p0.age ?? 0) >= ageLegal ? "Ce profil a déjà l'âge de la retraite : la simulation part de la situation actuelle." : "Retraite hors de la période projetée."}</p></section>`;
    return;
  }
  const infl = (H.inflation ?? 0) / 100, reel = (v, i) => v / Math.pow(1 + infl, i);
  const mode = etat.profil.retraite?.modePension ?? "auto";
  const lignePension = mode === "zero" ? "Retraite publique : non comptée (réglage prudent, modifiable en niveau Intermédiaire)."
    : R.pension > 0 ? `Retraite publique ${mode === "auto" ? "estimée" : "comptée (montant saisi en niveau Intermédiaire)"} : ${eur(R.pension)}/mois à partir de ${R.agePension} ans.`
    : "Retraite publique : pas encore estimée (indique ton salaire dans « Mon profil »). Pour l'instant, tes placements paient tout.";
  const proba = R.probaDure, k = verdictRetraite(proba);
  const titre = { tenable: "Tenable", fragile: "Fragile", "pas-tenable": "Pas tenable" }[k];
  const probaTxt = `${Math.round(100 * proba)} %`;
  const capR = reel(C[R.iR].financier, R.iR);
  const cle = JSON.stringify([etat.brouillon, etat.profil]);
  if (cacheNecessaire.cle !== cle) cacheNecessaire = { cle, r: capitalNecessaire(etat.brouillon, profilPourMoteur(), { inclureAchat: true }) };
  const nec = cacheNecessaire.r ? reel(cacheNecessaire.r.capital, R.iR) : null;
  const ecart = nec == null ? "" : capR >= nec
    ? (k === "tenable" ? "" : ` Avec des rendements moyens, ton capital suffirait ; mais quelques mauvaises années de bourse au mauvais moment suffisent à le vider : c'est ce qui rend le résultat ${k === "fragile" ? "fragile" : "risqué"}.`)
    : ` Il manque environ ${eur(nec - capR)} pour tenir avec des rendements moyens.`;
  const verdict = `<p class="verdict ${k === "tenable" ? "ok" : "ko"}" id="ret-verdict"><b>${titre}.</b> Avec ${eur(R.revenu)} par mois (en euros d'aujourd'hui), ton argent dure jusqu'à ${R.ageFin} ans dans ${probaTxt} des cas simulés (bonnes et mauvaises années de bourse).${k === "tenable" ? "" : " Plus ce chiffre est bas, plus tu risques de manquer d'argent."}${ecart}</p>`;
  let suggestion = "";
  if (k !== "tenable") {
    const memoire = suggestionRetraite.cle === cle ? suggestionRetraite.res : null;
    suggestion = `<div id="ret-suggestion" style="margin-top:10px">${htmlSuggestionRetraite(memoire)}</div>`;
    if (!memoire) { const jeton = ++jetonSuggestion; chercherSuggestionRetraite(R, ageLegal, jeton, cle); }
  } else jetonSuggestion++;
  const tuiles = [
    [`Capital nécessaire à ${R.age} ans`, nec != null ? eur(nec) : "—", `pour que l'argent dure jusqu'à ${R.ageFin} ans (rendements moyens)`],
    [`Capital prévu à ${R.age} ans`, eur(capR), "ce que ton plan aura mis de côté (rendements moyens)"],
  ];
  $("#retraite").innerHTML = reglages + `<section class="panneau" id="ret-verdict-bloc" data-seul="debutant"><h2>Est-ce que ma retraite tient ?</h2>
      ${verdict}
      ${suggestion}
      <div class="tuiles" style="grid-template-columns:repeat(2,minmax(0,1fr));margin-top:12px">${tuiles.map(([t, v, sous]) => `<div class="tuile"><span>${t}</span><b class="num">${v}</b><span class="small muted">${sous}</span></div>`).join("")}</div>
      <p class="note" style="margin:10px 0 0">${lignePension} <a class="lien-fiche" href="#fiche-retraite-publique">Comment elle est estimée</a></p>
      <p class="note" style="margin:6px 0 0">Tous les montants sont en euros d'aujourd'hui (inflation déduite). Tu arrêtes de travailler et d'épargner à ${R.age} ans ; tu te verses ensuite ce revenu jusqu'à ${R.ageFin} ans, pris sur tes placements.</p>
    </section>`;
}
// Chances de réussite de chaque objectif (parmi les scénarios tirés au hasard)
function blocObjectifs(r, attrs = "") {
  const R = r.retraite, n = r.simulations, E = r.eventail;
  const items = [];
  if (r.achat) items.push([`Acheter ta résidence principale (${eur(r.achat.prix)}) à ${r.achat.age} ans`, 1 - r.achatsRates / n]);
  if (R) {
    items.push([`À ${R.age} ans, avoir plus que tout l'argent que tu as mis`, E[R.iR].probaGain]);
    items.push([`Arrêter de travailler à ${R.age} ans et te verser ${eur(R.revenu)} par mois jusqu'à ${R.ageFin} ans sans être à court`, R.probaDure]);
    items.push([`Transmettre à ${R.ageFin} ans au moins le capital que tu avais à ${R.age} ans`, R.probaTransmet]);
  }
  if (!items.length) return "";
  const niveau = (p) => (p >= 0.9 ? ["Très probable", "var(--s3)"] : p >= 0.7 ? ["Probable", "var(--s4)"] : p >= 0.5 ? ["Incertain", "var(--s2)"] : ["Peu probable", "var(--s2)"]);
  return `<section class="panneau"${attrs ? ` ${attrs}` : ""}><h2>Tes objectifs : chances de réussite</h2>
    <p class="note" style="margin:4px 0 10px">En suivant le plan, sur ${n} scénarios de marchés tirés au hasard (bonnes et mauvaises années, krachs compris).</p>
    <ul class="objectifs">${items.map(([t, p]) => { const [l, c] = niveau(p); const v = Math.round(100 * p); return `<li><span>${echapper(t)}</span><span class="jauge" role="img" aria-label="${v} %"><span style="width:${v}%;background:${c}"></span></span><b class="num">${p >= 0.995 && p < 1 ? "> 99" : v} %</b><span class="small muted">${l}</span></li>`; }).join("")}</ul>
  </section>`;
}

// Estimation de la retraite publique (base + complémentaire)
function blocPension(p0) {
  const plan = etat.brouillon, RP = plan.retraitePublique ?? {};
  const rr = p0.retraite ?? {};
  const ages = Array.from({ length: 70 - 62 + 1 }, (_, k) => 62 + k);
  return `<section class="panneau" id="bloc-pension" data-min="intermediaire"><h2>Estimer ta retraite publique</h2>
    <p class="note" style="margin:4px 0 10px">Estimation simplifiée pour un salarié du privé, à partir de ton salaire et de ta carrière (voir la fiche <a class="lien-fiche" href="#fiche-retraite-publique">Retraite publique</a>). Ton relevé officiel est sur info-retraite.fr.</p>
    <div class="estimateur" style="max-width:640px">
      <div class="champ"><label for="pp-debut">Âge de ton premier emploi</label><div class="saisie"><input id="pp-debut" type="number" min="14" max="40" step="1" value="${rr.ageDebutCarriere ?? ""}" placeholder="${RP.ageDebutCarriere ?? 22}"><span>ans</span></div></div>
      <div class="champ"><label for="pp-trim">Trimestres déjà validés (sur ton relevé, facultatif)</label><div class="saisie"><input id="pp-trim" type="number" min="0" max="200" step="1" value="${rr.trimestresDeja ?? ""}" placeholder="estimés"><span>trim.</span></div></div>
      <div class="champ"><label for="pp-enf">Trimestres pour enfants (jusqu'à 8 par enfant, en général pour la mère)</label><div class="saisie"><input id="pp-enf" type="number" min="0" max="80" step="1" value="${rr.trimestresEnfants ?? ""}" placeholder="0"><span>trim.</span></div></div>
      <div class="champ"><label for="pp-demande">Âge où tu la demandes</label><select id="pp-demande">${ages.map((a) => `<option value="${a}" ${Number(rr.ageDemande) === a ? "selected" : ""}>${a} ans</option>`).join("")}</select></div>
    </div>
    <div id="pension-resultat" style="margin-top:12px"></div>
  </section>`;
}
function majPension() {
  const out = $("#pension-resultat"); if (!out) return;
  const plan = etat.brouillon, RP = plan.retraitePublique ?? {};
  const p0 = normaliserProfil(etat.profil), rr = p0.retraite ?? {};
  const PR = projectionCourante(true).retraite;
  const ageArret = PR?.age ?? plan.hypotheses.ageRetraite ?? 64;
  let est;
  try { est = estimerPension(plan, p0, { ageDebut: rr.ageDebutCarriere, trimestresDeja: rr.trimestresDeja, ageArret, ageDemande: rr.ageDemande, trimestresEnfants: rr.trimestresEnfants }); }
  catch (e) { console.error(e); out.innerHTML = `<p class="erreur">Estimation impossible : ${echapper(e.message)}</p>`; return; }
  const sel = $("#pp-demande");
  if (sel && !rr.ageDemande) sel.value = String(Math.ceil(Math.max(est.regles.ageLegal, ageArret)));
  if ($("#pp-trim") && !(rr.trimestresDeja >= 0 && rr.trimestresDeja !== null && rr.trimestresDeja !== "")) $("#pp-trim").placeholder = `≈ ${est.passes}`;
  const lignes = [[`À l'âge légal (${ageEnTexte(est.regles.ageLegal)})`, est.auLegal], [`À ${RP.ageTauxPlein ?? 67} ans (taux plein automatique)`, est.aTauxPlein]];
  const demande = est.demande;
  if (![est.auLegal.age, est.aTauxPlein.age].includes(demande.age)) lignes.push([`À ${ageEnTexte(demande.age)} (ton choix)`, demande]);
  const tab = lignes.map(([l, x]) => `<tr><td>${l}</td><td class="m">${pct(x.taux)}${x.decote ? `<div class="small muted">décote de ${x.decote} trim.</div>` : ""}${x.surcote > 0 ? `<div class="small muted">surcote +${pct(x.surcote)}</div>` : ""}${x.majEnfants ? `<div class="small muted">+${x.majEnfants} % (3 enfants)</div>` : ""}</td><td class="m">${eur(x.base)}</td><td class="m">${eur(x.complementaire)}</td><td class="m">${eur(x.net)}</td><td class="m"><b>${eur(x.apres)}</b></td></tr>`).join("");
  const manque = Math.max(0, est.regles.trimestres - est.trimestres);
  const agePension = Math.ceil(demande.age);
  const actuel = Number(rr.pension) || 0;
  out.innerHTML = `
    <p class="small" style="margin:0 0 8px">Né(e) vers ${est.naissance} : âge légal <b>${ageEnTexte(est.regles.ageLegal)}</b>, <b>${est.regles.trimestres} trimestres</b> pour le taux plein. Avec un premier emploi à ${est.debut} ans et un arrêt à ${ageArret} ans : <b>${est.trimestres} trimestres</b>${manque ? `, soit ${manque} de moins que le taux plein` : ", assez pour le taux plein"}. ${est.regime === "ssi" ? "Revenu annuel moyen cotisé (25 meilleures années, plafonné au PASS)" : "Salaire annuel moyen retenu (25 meilleures années, brut, plafonné)"} : ${eur(est.sam)} ; ${est.points.toLocaleString("fr-FR")} points de complémentaire (${est.libelleComplementaire ?? "Agirc-Arrco"}).</p>
    ${est.alertes?.length ? `<ul class="note attention" style="margin:0 0 8px">${est.alertes.map((a) => `<li>${echapper(a)}</li>`).join("")}</ul>` : ""}
    ${ageArret < est.regles.ageLegal ? `<p class="verdict ko" style="margin:0 0 8px"><b>Tu arrêtes à ${ageArret} ans : la retraite publique n'est versée qu'à partir de ${ageEnTexte(est.regles.ageLegal)} au plus tôt.</b> Entre les deux, tes placements doivent tout payer, et tu ne valides plus de trimestres.</p>` : ""}
    <div class="table-wrap"><table><thead><tr><th>Si tu la demandes</th><th class="m">Taux</th><th class="m">Base (net)</th><th class="m">${est.libelleComplementaire ?? "Agirc-Arrco"} (net)</th><th class="m">Total net / mois</th><th class="m">Après impôt</th></tr></thead><tbody>${tab}</tbody></table></div>
    <p class="note" style="margin:8px 0 0">En euros d'aujourd'hui. Approximations : ${est.regime === "ssi" ? `trimestres validés selon le revenu (150 h au SMIC = ${eur(Math.round(((RP.independants?.smicHoraire ?? 12.02) * (RP.independants?.heuresParTrimestre ?? 150))))} par trimestre)` : "4 trimestres par année travaillée"}, salaires passés déduits de ton profil de carrière, trimestres pour enfants seulement si tu les indiques, pas de trimestres pour chômage ou maladie, complémentaire réduite comme la base en cas de décote. Surcote de 1,25 % par trimestre travaillé après l'âge légal au-delà de la durée requise ; +10 % sur la base et la complémentaire avec au moins 3 enfants (champ « Enfants à charge » de « Mon profil » ; compte aussi les enfants élevés, même plus à charge) ; plus de malus Agirc-Arrco depuis décembre 2023. « Après impôt » : barème 2026 pour une personne seule, abattement de 10 % compris (<a class="lien-fiche" href="#fiche-net-impot">net avant ou après impôt ?</a>). Les règles peuvent encore changer d'ici ta retraite.</p>
    <div class="ligne-actions" style="margin-top:10px">
      ${(rr.modePension ?? "auto") === "auto"
        ? `<span class="small"><b>✓ Comptée automatiquement</b> : ${eur(Math.round(demande.apres / 10) * 10)} par mois à partir de ${agePension} ans, recalculée si tu changes l'âge d'arrêt.</span><button type="button" class="lien" data-pension="0" data-age-pension="">Ne pas la compter (prudence)</button>`
        : `<button type="button" class="principal" data-pension="auto" data-age-pension="">Revenir au calcul automatique (${eur(Math.round(demande.apres / 10) * 10)} par mois)</button>${actuel > 0 ? `<button type="button" class="lien" data-pension="0" data-age-pension="">Revenir à 0 € (prudence)</button><span class="small muted">Actuellement compté : ${eur(actuel)} à partir de ${PR?.agePension ?? agePension} ans.</span>` : ""}`}
    </div>`;
}
$("#vue-retraite").addEventListener("input", (e) => {
  const map = { "pp-debut": "ageDebutCarriere", "pp-trim": "trimestresDeja", "pp-enf": "trimestresEnfants" };
  const k = map[e.target.id]; if (!k) return;
  etat.profil.retraite ??= {};
  etat.profil.retraite[k] = e.target.value === "" ? null : Number(e.target.value);
  memo.set("profil-v2", etat.profil); planifierSauvegardeProfil();
  majPension();
});
// Retraite publique automatique : les trimestres et l'âge de départ saisis changent le montant compté
$("#vue-retraite").addEventListener("change", (e) => {
  if (!["pp-debut", "pp-trim", "pp-enf"].includes(e.target.id) || (etat.profil.retraite?.modePension ?? "auto") !== "auto") return;
  syncRetraite0(); rendreRetraite(); planifierTrajectoire();
});
$("#vue-retraite").addEventListener("change", (e) => {
  if (e.target.id !== "pp-demande") return;
  etat.profil.retraite ??= {};
  etat.profil.retraite.ageDemande = Number(e.target.value);
  memo.set("profil-v2", etat.profil); planifierSauvegardeProfil();
  majPension();
  if ((etat.profil.retraite?.modePension ?? "auto") === "auto") { syncRetraite0(); rendreRetraite(); planifierTrajectoire(); }
});
$("#vue-retraite").addEventListener("click", (e) => {
  const b = e.target.closest?.("[data-pension]"); if (!b) return;
  etat.profil.retraite ??= {};
  etat.profil.retraite.modePension = b.dataset.pension === "auto" ? "auto" : Number(b.dataset.pension) > 0 ? "manuel" : "zero";
  etat.profil.retraite.pension = Number(b.dataset.pension) || null;
  etat.profil.retraite.agePension = Number(b.dataset.agePension) || null;
  syncRetraite0();
  memo.set("profil-v2", etat.profil); planifierSauvegardeProfil();
  rendreRetraite();
});

// Âge de départ possible et revenus « pessimistes » (9 scénarios sur 10)
const clePessimiste = () => { const r = { ...(etat.profil.retraite ?? {}) }; delete r.ageDebutCarriere; delete r.trimestresDeja; delete r.ageDemande; return JSON.stringify([etat.brouillon, { ...etat.profil, retraite: r }]); };
let pessimiste = { cle: null };
let jetonPessimiste = 0;
function agePossibleCentral() {
  const ctx = contexteRetraite(etat.brouillon, profilPourMoteur());
  const { PR, profil } = ctx;
  const ok = (a) => !!evaluerRetraite(ctx, { age: a })?.preserve;
  return chercherAge(ok, Math.ceil(profil.age), PR.ageLegal);
}
function chercherAge(ok, de, a) {
  if (a < de || !ok(a)) return null;
  let bas = de, haut = a;
  while (bas < haut) { const m = Math.floor((bas + haut) / 2); if (ok(m)) haut = m; else bas = m + 1; }
  return haut;
}
function boutonsAge(central, pess, actuel, legal) {
  const b = [];
  if (pess != null && pess !== actuel) b.push(`<button type="button" class="principal" data-age-depart="${pess}">Simuler un départ à ${pess} ans (pessimiste)</button>`);
  if (central != null && central !== actuel && central !== pess) b.push(`<button type="button" data-age-depart="${central}">Simuler un départ à ${central} ans (central)</button>`);
  if (actuel !== legal) b.push(`<button type="button" class="lien" data-age-depart="${legal}">Revenir à ${legal} ans</button>`);
  return b.join("");
}
const pause = () => new Promise((r) => setTimeout(r, 0));
async function lancerPessimiste() {
  const cle = clePessimiste();
  if (pessimiste.cle === cle) return;
  const jeton = ++jetonPessimiste;
  const ctx = contexteRetraite(etat.brouillon, profilPourMoteur());
  const { PR, profil } = ctx;
  const N = 200;
  const ok = async (a, revenu, critere) => { await pause(); if (jeton !== jetonPessimiste) throw new Error("annulé"); return !!evaluerRetraite(ctx, { age: a, revenu, scenarios: N })?.[critere]; };
  try {
    // Âge le plus tôt où le capital est transmis intact dans 9 cas sur 10
    let age = null;
    const de = Math.ceil(profil.age), a = PR.ageLegal;
    if (a >= de && await ok(a, PR.revenu, "preserve")) {
      let bas = de, haut = a;
      while (bas < haut) { const m = Math.floor((bas + haut) / 2); if (await ok(m, PR.revenu, "preserve")) haut = m; else bas = m + 1; }
      age = haut;
    }
    if (jeton !== jetonPessimiste) return;
    $("#age-pessimiste") && ($("#age-pessimiste").innerHTML = age == null ? `pas avant ${PR.ageLegal} ans` : `${age} ans`);
    // Revenus possibles à l'âge de départ choisi, dans 9 cas sur 10
    const chercher = async (critere) => { let bas = 0, haut = 20000; for (let k = 0; k < 13; k++) { const m = (bas + haut) / 2; if (await ok(PR.age, m, critere)) bas = m; else haut = m; } return bas; };
    const revenuPreserve = await chercher("preserve");
    if ($("#pess-preserve")) $("#pess-preserve").textContent = `${eur(revenuPreserve)}/mois`;
    const revenuConsomme = await chercher("dure");
    if ($("#pess-consomme")) $("#pess-consomme").textContent = `${eur(revenuConsomme)}/mois`;
    pessimiste = { cle, age, revenuPreserve, revenuConsomme };
    if ($("#actions-age")) $("#actions-age").innerHTML = boutonsAge(agePossibleCentral(), age, PR.age, PR.ageLegal);
  } catch (e) { if (e.message !== "annulé") console.error(e); }
}
// PER et PEA pour un même effort de 100 € par mois pendant n ans à 6 % par an, sortie en capital
// tauxEffectif : taux réel d'économie d'impôt du versement (économie exacte ÷ versement) ; à défaut, la tranche
function comparerPERPEA(tmi, tret, n = 20, tauxEffectif = tmi) {
  const r = 0.06 / 12, F = (Math.pow(1 + r, 12 * n) - 1) / r;
  const taux = Number.isFinite(Number(tauxEffectif)) ? Math.min(Math.max(Number(tauxEffectif), 0), 90) : tmi;
  const m = 100 / (1 - taux / 100), cap = m * F, verse = m * 12 * n;
  const per = cap - (verse * tret) / 100 - (cap - verse) * (PFU / 100);
  const capE = 100 * F, pea = capE - (capE - 1200 * n) * (PRELEVEMENTS.PS_CAPITAL / 100);
  return { per, pea, gain: 100 * (per / pea - 1) };
}
// ---------------------------------------------------------------- export / import des données (.json)
let importEnAttente = null;
async function exporterDonnees() {
  // Scénario partagé : on n'exporte que lui, jamais les relevés ni les scénarios du profil enregistré
  const { suivi } = etat.partage ? { suivi: null } : suiviCourant();
  const nom = etat.partage ? "scenario-partage" : docCourant()?.nom ?? (proches.courant.col === "exemple" ? "exemple" : "profil");
  const data = { app: "plan-patrimoine", format: 2, exporteLe: new Date().toISOString(), nom, profil: clone(etat.profil), suivi: suivi ? clone(suivi) : null, scenarios: etat.partage ? [] : scenariosGardes() };
  const d = new Date(), fichier = `plan-patrimoine-${slug(nom)}-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}.json`;
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  try {
    await telechargerFichier(fichier, blob);
    $("#msg-donnees").textContent = `Fichier « ${fichier} » prêt (${(data.suivi?.releves ?? []).length} relevé(s)).`;
  } catch (e) { $("#msg-donnees").textContent = e?.code === "dismissed" || e?.code === "declined" ? "Export annulé." : `Export impossible (${e?.code ?? e?.message ?? "erreur"}).`; }
}
$("#btn-export-json").addEventListener("click", exporterDonnees);
$("#btn-import-json").addEventListener("click", () => $("#fichier-import").click());
$("#fichier-import").addEventListener("change", async (e) => {
  const f = e.target.files?.[0]; e.target.value = "";
  if (!f) return;
  if (etat.partage || etat.simulation) retourMonProfil(); // l'import vise toujours le profil enregistré, pas un scénario temporaire
  try {
    const data = JSON.parse(await f.text());
    if (data?.app !== "plan-patrimoine" || !data.profil || typeof data.profil !== "object") throw new Error("ce fichier ne vient pas de Plan Patrimoine");
    importEnAttente = data;
    $("#msg-donnees").innerHTML = `Fichier de « ${echapper(String(data.nom ?? "profil"))} », exporté le ${new Date(data.exporteLe).toLocaleDateString("fr-FR")} : ${(data.suivi?.releves ?? []).length} relevé(s). Il remplacera le profil affiché${proches.courant.col === "exemple" ? " (l'Exemple, sans rien enregistrer)" : ""} et ses relevés. <button type="button" class="principal" id="btn-import-ok">Remplacer par ce fichier</button> <button type="button" class="lien" id="btn-import-annuler">Annuler</button>`;
  } catch (err) { importEnAttente = null; $("#msg-donnees").textContent = `Import impossible : ${err.message}.`; }
});
$("#msg-donnees").addEventListener("click", async (e) => {
  if (e.target.id === "btn-import-annuler") { importEnAttente = null; $("#msg-donnees").textContent = "Import annulé."; return; }
  if (e.target.id !== "btn-import-ok" || !importEnAttente) return;
  const data = importEnAttente; importEnAttente = null;
  etat.profil = completerProfil(fusion(PROFIL_VIDE, data.profil));
  memo.set("profil-v2", etat.profil);
  if (Array.isArray(data.scenarios)) garderScenarios(data.scenarios);
  else if (data.scenarioA) garderScenarios([data.scenarioA]);
  if (data.suivi) {
    const { test, doc: d } = suiviCourant();
    try { if (test) suivisTest.set(cle(proches.courant), clone(data.suivi)); else await ecrireSuivi(d, clone(data.suivi)); }
    catch (err) { console.error(err); }
  }
  rendreChampsPlacements(); remplirProfil(); apresSaisieProfil();
  $("#msg-donnees").textContent = "Données importées : profil, relevés et scénarios remplacés.";
});

// ---------------------------------------------------------------- synchronisation multi-appareils (chiffrée de bout en bout, voir sync.js)
// Le navigateur chiffre profils, relevés de suivi et scénarios avant l'envoi (AES-GCM) : le serveur ne stocke qu'un blob illisible.
// Réglage de cet appareil (jamais synchronisé) : « sync-config » = { code, pin, rev, modifieLe, derniere }.
const SYNC = { cfg: memo.get("sync-config"), minuteur: null, enCours: false, message: "", lienEntrant: null };
const syncActive = () => !!SYNC.cfg?.code;
const enregistrerCfgSync = (c) => { SYNC.cfg = c; memo.set("sync-config", c); };
const messageSync = (t) => { SYNC.message = t; const z = $("#msg-synchro"); if (z) z.textContent = t; };
const heureFR = (iso) => new Date(iso).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
const ERREURS_SYNC = {
  reseau: "Serveur injoignable : la synchronisation reprendra automatiquement.",
  code_ou_pin_incorrect: "Code ou PIN incorrect pour ces données (ou données altérées).",
  sync_indisponible: "La synchronisation n'est pas activée sur ce serveur (namespace KV absent).",
  taille_excessive: "Tes données dépassent la taille maximale de synchronisation (256 Ko chiffrés).",
  trop_de_requetes: "Trop de requêtes : réessaie dans une minute.",
  conflit: "Un autre appareil écrit en même temps : réessaie dans un instant.",
  origine_refusee: "Origine refusée par le serveur.",
  introuvable: "Aucune donnée n'existe encore pour ce code : vérifie le lien, ou enregistre d'abord ton plan sur l'appareil d'origine.",
};

function planifierSync(delai = 4000) {
  if (!syncActive() || etat.db) return;
  clearTimeout(SYNC.minuteur);
  SYNC.minuteur = setTimeout(() => lancerSync(false), delai);
}
// Toute écriture locale de données synchronisables date la modification (départage les scénarios) et programme un envoi
hookEcriture = (k) => {
  if (!syncActive() || !estCleSynchronisable(k)) return;
  SYNC.cfg = { ...SYNC.cfg, modifieLe: new Date().toISOString() };
  try { localStorage.setItem("sync-config", JSON.stringify(SYNC.cfg)); } catch { /* quota : sans effet bloquant */ }
  planifierSync();
};

async function lancerSync(manuel, options = {}) {
  if (!syncActive() || SYNC.enCours || etat.db) return false;
  SYNC.derniereErreur = null;
  if (navigator.onLine === false) { if (manuel) messageSync("Hors ligne : la synchronisation reprendra avec la connexion."); return false; }
  SYNC.enCours = true;
  messageSync("Synchronisation…");
  let ok = false;
  try {
    const { code, pin, modifieLe } = SYNC.cfg;
    const r = await synchroniser({ code, pin, modifieLe }, localStorage, options);
    enregistrerCfgSync({ ...SYNC.cfg, rev: r.rev, modifieLe: r.majLe || SYNC.cfg.modifieLe, derniere: new Date().toISOString() });
    if (r.changeLocal && proches.mode === "local") chargerLocal(); // fiches mises à jour depuis un autre appareil
    messageSync(r.rev === 0
      ? "Synchronisation active. Aucune donnée enregistrée pour l'instant : enregistre ton plan (« Enregistrer le plan ») pour qu'il soit envoyé."
      : `✓ Synchronisé à ${heureFR(SYNC.cfg.derniere)}${r.changeLocal ? " — données mises à jour depuis un autre appareil" : ""}.`);
    ok = true;
  } catch (e) {
    messageSync(ERREURS_SYNC[e.code] ?? `Synchronisation impossible (${e.code ?? e.message}).`);
    SYNC.derniereErreur = e.code ?? "inconnue";
  } finally { SYNC.enCours = false; rendreSynchro(); }
  return ok;
}

function rendreSynchro() {
  const zone = $("#synchro-corps");
  if (!zone) return;
  if (etat.db) { zone.innerHTML = `<p class="note">Indisponible : cet environnement a déjà son propre stockage partagé.</p>`; return; }
  const c = SYNC.cfg;
  if (!syncActive()) {
    zone.innerHTML = `
      <div class="ligne-actions"><input class="texte" id="sync-pin" type="password" autocomplete="new-password" maxlength="64" placeholder="PIN (facultatif, à retaper sur chaque appareil)" aria-label="PIN facultatif"><button type="button" class="principal" id="btn-sync-activer">🔄 Activer sur cet appareil</button></div>
      <p class="note" style="margin:12px 0 6px">Déjà activé sur un autre appareil ? Colle son lien (ou son code). Les profils déjà enregistrés ici seront fusionnés avec ceux du groupe.</p>
      <div class="ligne-actions"><input class="texte" id="sync-lien" type="text" autocomplete="off" spellcheck="false" placeholder="Lien ou code de synchronisation" aria-label="Lien ou code de synchronisation" value="${echapper(SYNC.lienEntrant ? formaterCode(SYNC.lienEntrant) : "")}"><input class="texte" id="sync-pin2" type="password" autocomplete="off" maxlength="64" placeholder="PIN (si défini)" aria-label="PIN" style="max-width:150px"><button type="button" id="btn-sync-rejoindre">Rejoindre</button></div>`;
    return;
  }
  const lien = creerLien(c.code, location.href);
  zone.innerHTML = `
    <p class="small" style="margin:0 0 6px">✓ Synchronisation <b>active</b> sur cet appareil${c.derniere ? ` · dernière à ${heureFR(c.derniere)}` : ""}${c.pin ? " · PIN requis sur les autres appareils" : ""}.</p>
    <div class="ligne-actions"><input class="texte" id="sync-lien-copie" type="text" readonly value="${echapper(lien)}" aria-label="Lien de synchronisation"><button type="button" id="btn-sync-copier">📋 Copier le lien</button></div>
    <p class="note" style="margin:6px 0 10px">Ouvre ce lien sur ton autre appareil. Il donne accès à tes données : ne l'envoie qu'à toi-même (message à soi, gestionnaire de mots de passe). Code à saisir à la main : <b class="num">${echapper(formaterCode(c.code))}</b></p>
    <div class="ligne-actions"><button type="button" id="btn-sync-maintenant">Synchroniser maintenant</button><button type="button" id="btn-sync-stop">Arrêter sur cet appareil</button><button type="button" class="lien" id="btn-sync-effacer">Effacer du serveur…</button></div>`;
}

async function copierTexte(texte, champ) {
  try { await navigator.clipboard.writeText(texte); return true; } catch { /* repli : sélection manuelle */ }
  if (champ) { champ.select(); try { return document.execCommand("copy"); } catch { return false; } }
  return false;
}

async function activerSync() {
  oublierCles();
  enregistrerCfgSync({ code: genererCode(), pin: ($("#sync-pin")?.value ?? "").trim(), rev: 0, modifieLe: new Date().toISOString(), derniere: null });
  rendreSynchro();
  await lancerSync(true);
  if (["sync_indisponible", "reseau"].includes(SYNC.derniereErreur) && !SYNC.cfg?.derniere) { const t = SYNC.message; enregistrerCfgSync(null); rendreSynchro(); messageSync(t); }
}

async function rejoindreSync() {
  const code = extraireCode($("#sync-lien")?.value);
  if (!code) { messageSync("Lien ou code invalide : colle le lien complet ou les 26 caractères du code."); return; }
  oublierCles();
  SYNC.lienEntrant = null;
  enregistrerCfgSync({ code, pin: ($("#sync-pin2")?.value ?? "").trim(), rev: 0, modifieLe: "", derniere: null });
  rendreSynchro();
  await lancerSync(true, { sansCreation: true }); // rejoindre ne crée jamais un groupe : un code mal recopié est refusé
  if (SYNC.derniereErreur || !SYNC.cfg?.derniere) { const t = SYNC.message; enregistrerCfgSync(null); SYNC.lienEntrant = code; rendreSynchro(); messageSync(t || "Synchronisation impossible."); } // le code reste dans le champ : seul le PIN est à corriger
}

$("#bloc-synchro")?.addEventListener("click", async (e) => {
  const id = e.target.closest("button")?.id;
  if (id === "btn-sync-activer") await activerSync();
  else if (id === "btn-sync-rejoindre") await rejoindreSync();
  else if (id === "btn-sync-maintenant") await lancerSync(true);
  else if (id === "btn-sync-copier") {
    const ok = await copierTexte($("#sync-lien-copie").value, $("#sync-lien-copie"));
    messageSync(ok ? "Lien copié. Garde-le pour toi : il donne accès à tes données chiffrées." : "Copie automatique impossible : sélectionne le lien et copie-le à la main.");
  } else if (id === "btn-sync-stop") {
    clearTimeout(SYNC.minuteur); oublierCles(); enregistrerCfgSync(null); rendreSynchro();
    messageSync("Cet appareil n'est plus synchronisé. Tes données restent ici et, chiffrées, sur le serveur (bouton « Effacer du serveur »).");
  } else if (id === "btn-sync-effacer") {
    if (!confirm("Effacer définitivement du serveur les données synchronisées ? Elles resteront sur les appareils qui les ont déjà, mais ne seront plus synchronisées.")) return;
    try { await effacerDistant(SYNC.cfg.code); clearTimeout(SYNC.minuteur); oublierCles(); enregistrerCfgSync(null); rendreSynchro(); messageSync("Données effacées du serveur. La synchronisation est arrêtée."); }
    catch (err) { messageSync(ERREURS_SYNC[err.code] ?? `Effacement impossible (${err.code ?? err.message}).`); }
  }
});

// Lien « …/#sync=CODE » : le code est retiré de la barre d'adresse (et de l'historique) dès qu'il est lu
function lireLienEntrant() {
  const code = extraireCode(location.hash);
  if (!code) return;
  history.replaceState(null, "", `${location.pathname}${location.search}#mon-profil`);
  rendreVue();
  if (syncActive() || etat.db) { rendreSynchro(); messageSync(syncActive() ? "Cet appareil est déjà synchronisé : arrête d'abord la synchronisation pour rejoindre un autre groupe." : ""); return; }
  SYNC.lienEntrant = code;
  rendreSynchro();
  messageSync("Lien de synchronisation détecté : saisis ton PIN s'il y en a un, puis clique sur « Rejoindre ».");
  $("#bloc-synchro")?.scrollIntoView({ block: "center" });
}
window.addEventListener("hashchange", lireLienEntrant);
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") planifierSync(800); });
window.addEventListener("online", () => planifierSync(800));
function demarrerSynchro() {
  rendreSynchro();
  lireLienEntrant();
  planifierSync(1500);
}

// ---------------------------------------------------------------- mode discrétion
// Remplace les montants en euros par •••• (les pourcentages restent visibles), pour montrer son profil à quelqu'un
let discret = false;
// Registre des originaux (réversibilité) : nœud texte -> { original, masque } ; élément -> { [attribut]: { original, masque } }
const originaux = new Map();
const ATTRIBUTS_DISCRETS = ["title", "data-bulle", "aria-label", "placeholder"];
const SANS_MASQUE = /^(SCRIPT|STYLE|TEXTAREA|INPUT)$/;
function elaguerOriginaux() {
  if (originaux.size <= 5000) return;
  for (const n of [...originaux.keys()]) if (!n.isConnected) originaux.delete(n);
}
function masquerNoeudTexte(n) {
  const v = n.nodeValue;
  if (!contientMontant(v) || SANS_MASQUE.test(n.parentNode?.nodeName ?? "")) return;
  // Si le nœud était déjà masqué et que la valeur diffère du masque, l'app l'a réécrit : la valeur actuelle est le nouvel original
  const masque = masquerTexte(v);
  n.nodeValue = masque;
  originaux.set(n, { original: v, masque });
  elaguerOriginaux();
}
function masquerAttribut(el, nom) {
  if (!el?.hasAttribute?.(nom)) return;
  const v = el.getAttribute(nom);
  if (!contientMontant(v)) return;
  const masque = masquerTexte(v);
  el.setAttribute(nom, masque);
  const entree = originaux.get(el) ?? {};
  entree[nom] = { original: v, masque };
  originaux.set(el, entree);
  elaguerOriginaux();
}
function masquerDans(racine) {
  if (!racine) return;
  if (racine.nodeType === 3) { masquerNoeudTexte(racine); return; }
  if (racine.nodeType !== 1) return;
  if (!SANS_MASQUE.test(racine.nodeName)) {
    const w = document.createTreeWalker(racine, NodeFilter.SHOW_TEXT);
    const noeuds = []; while (w.nextNode()) noeuds.push(w.currentNode);
    for (const n of noeuds) masquerNoeudTexte(n);
  }
  // Infobulles, bulles de survol des graphiques, lecteurs d'écran, placeholders
  const selecteur = ATTRIBUTS_DISCRETS.map((a) => `[${a}]`).join(",");
  for (const el of [racine, ...racine.querySelectorAll(selecteur)]) for (const nom of ATTRIBUTS_DISCRETS) masquerAttribut(el, nom);
}
function restaurerOriginaux() {
  for (const [cle, e] of originaux) {
    if (cle.nodeType === 3) { if (cle.nodeValue === e.masque) cle.nodeValue = e.original; continue; }
    for (const [nom, x] of Object.entries(e)) if (cle.getAttribute(nom) === x.masque) cle.setAttribute(nom, x.original);
  }
  originaux.clear();
}
const OPTIONS_OBSERVATEUR_DISCRET = { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRIBUTS_DISCRETS };
const observateurDiscret = new MutationObserver((ms) => {
  for (const m of ms) {
    if (m.type === "characterData") { if (m.target.nodeType === 3) masquerNoeudTexte(m.target); }
    else if (m.type === "attributes") masquerAttribut(m.target, m.attributeName);
    else m.addedNodes.forEach(masquerDans);
  }
});
function appliquerDiscret(on) {
  discret = on;
  document.documentElement.classList.toggle("discret", on);
  const b = $("#btn-discret"); b.setAttribute("aria-pressed", String(on)); b.textContent = on ? "👁 Afficher les montants" : "👁 Masquer les montants";
  memo.set("discret", on);
  if (on) { masquerDans(document.body); observateurDiscret.observe(document.body, OPTIONS_OBSERVATEUR_DISCRET); }
  else {
    observateurDiscret.disconnect();
    restaurerOriginaux(); // textes statiques et blocs non redessinés
    // On redessine ensuite tout pour retrouver les vrais montants
    rendreChampsPlacements(); remplirProfil(); rendreResultats(); rendreVue(); planifierTrajectoire();
  }
}
$("#btn-discret").addEventListener("click", () => appliquerDiscret(!discret));
// Raccourci Alt + H (⌥ + H sur Mac) : masquer ou afficher les montants d'un coup, pratique en partage d'écran
document.addEventListener("keydown", (e) => {
  if (e.altKey && !e.ctrlKey && !e.metaKey && e.code === "KeyH") { e.preventDefault(); appliquerDiscret(!discret); }
});

// ---------------------------------------------------------------- thème clair / sombre
// Par défaut : celui de l'appareil. Le bouton force l'autre, et le choix est retenu sur cet appareil.
const sombreSysteme = () => { try { return window.matchMedia("(prefers-color-scheme: dark)").matches; } catch (e) { return false; } };
function themeEffectif() { const t = document.documentElement.dataset.theme; return t === "dark" || t === "light" ? t : sombreSysteme() ? "dark" : "light"; }
function majBoutonTheme() {
  const sombre = themeEffectif() === "dark", b = $("#btn-theme");
  b.textContent = sombre ? "☀️ Mode clair" : "🌙 Mode sombre";
  b.setAttribute("aria-pressed", String(sombre));
}
function appliquerTheme(t) {
  if (t === "dark" || t === "light") document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme;
  memo.set("theme", t || "");
  majBoutonTheme();
}
$("#btn-theme").addEventListener("click", () => appliquerTheme(themeEffectif() === "dark" ? "light" : "dark"));
{ const t = memo.get("theme"); if (t === "dark" || t === "light") document.documentElement.dataset.theme = t; majBoutonTheme(); }
try { window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", majBoutonTheme); } catch (e) { /* navigateur ancien */ }
setTimeout(() => { if (memo.get("discret")) appliquerDiscret(true); }, 0);

// ---------------------------------------------------------------- niveaux de lecture (règles dans niveaux.js)
// Le niveau ne change que l'affichage : jamais etat.profil, jamais les calculs.
// Produit le HTML d'un panneau seulement s'il est visible au niveau courant (rendreResultats est rappelée à chaque changement de niveau)
function siNiveau(min, fn) { return visible(min, niveauCourant()) ? fn() : ""; }
function niveauCourant() { const n = document.documentElement.dataset.niveau; return NIVEAUX.includes(n) ? n : "avance"; }
// Libellés des onglets, des bandeaux « Étape N » et des boutons : une seule table (niveaux.js), les ancres ne changent pas
function majLibelles() {
  const n = niveauCourant();
  for (const v of ["profil", "reequilibrage", "trajectoire", "retraite", "transmission", "ideale", "suivi", "fiches", "plan"]) {
    const lien = $(`#lien-${v}`); if (lien) lien.textContent = libelleOnglet(v, n);
  }
  document.querySelectorAll("[data-lib]").forEach((el) => { el.textContent = nomVue(el.dataset.lib, n); });
  document.querySelectorAll("[data-lib-suite]").forEach((el) => { el.textContent = suiteVue(el.dataset.libSuite, n); });
}
function majSelecteurNiveau() {
  for (const b of document.querySelectorAll("#selecteur-niveau [data-niveau]")) {
    const actif = b.dataset.niveau === niveauCourant();
    b.setAttribute("aria-checked", String(actif)); b.tabIndex = actif ? 0 : -1;
  }
}
function majBadgeAvances() {
  const el = $("#badge-avances"); if (!el) return;
  const L = reglagesAvancesActifs(etat.profil, niveauCourant(), PROFIL_VIDE);
  el.hidden = L.length === 0;
  if (!L.length) { el.removeAttribute("title"); return; }
  $("#badge-avances-titre").textContent = `⚙ ${L.length} réglage${L.length > 1 ? "s" : ""} avancé${L.length > 1 ? "s" : ""} actif${L.length > 1 ? "s" : ""}`;
  $("#badge-avances-liste").textContent = L.map((r) => r.libelle).join(" · ");
  el.title = L.map((r) => `• ${r.libelle}`).join("\n");
  el.dataset.niveauCible = niveauLePlusBas(L);
}
function appliquerNiveau(n, { memoriser = true } = {}) {
  if (!NIVEAUX.includes(n)) return;
  document.documentElement.dataset.niveau = n;
  if (memoriser) memo.set("niveau", n);
  majSelecteurNiveau();
  majLibelles();
  rendreResultats(); // met aussi à jour le badge
  rendreVue(); // redirige vers « Mon profil » si l'onglet courant est masqué à ce niveau
  planifierTrajectoire();
  document.dispatchEvent(new CustomEvent("niveau:change", { detail: { niveau: n } }));
}
$("#selecteur-niveau").addEventListener("click", (e) => { const b = e.target.closest("[data-niveau]"); if (b) appliquerNiveau(b.dataset.niveau); });
$("#selecteur-niveau").addEventListener("keydown", (e) => {
  const d = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key]; if (!d) return;
  e.preventDefault();
  const n = NIVEAUX[(NIVEAUX.indexOf(niveauCourant()) + d + NIVEAUX.length) % NIVEAUX.length];
  appliquerNiveau(n); $(`#selecteur-niveau [data-niveau="${n}"]`).focus();
});
// Les champs masqués (détail des comptes, regroupement débutant) doivent être à jour dès qu'un niveau les révèle
document.addEventListener("niveau:change", () => remplirProfil());
document.addEventListener("click", (e) => { const b = e.target.closest("[data-aller-niveau]"); if (b) appliquerNiveau(b.dataset.allerNiveau); });
$("#badge-avances-voir").addEventListener("click", () => {
  appliquerNiveau($("#badge-avances").dataset.niveauCible || "avance");
  if (location.hash.split("?")[0] !== "#mon-profil") location.hash = "#mon-profil"; else window.scrollTo(0, 0);
});
// Premier lancement : écran de choix (Avancé présélectionné pour qui a déjà des données, Débutant sinon)
function ouvrirChoixNiveau() {
  const pre = niveauCourant();
  $("#choix-niveau-cartes").innerHTML = NIVEAUX.map((n) => `<label><input type="radio" name="niveau-choix" value="${n}"${n === pre ? " checked" : ""}><span><b>${INFOS_NIVEAUX[n].nom}${n === "avance" && DONNEES_EXISTANTES ? " (ton affichage actuel)" : ""}</b><span class="niv-desc">${INFOS_NIVEAUX[n].description}</span></span></label>`).join("");
  const d = $("#choix-niveau");
  if (typeof d.showModal === "function") { if (!d.open) d.showModal(); } else d.setAttribute("open", "");
}
$("#choix-niveau").addEventListener("cancel", (e) => e.preventDefault()); // un choix est attendu : Échap ne ferme pas l'écran
$("#choix-niveau-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const n = $("#choix-niveau-form input[name='niveau-choix']:checked")?.value ?? niveauCourant();
  const d = $("#choix-niveau"); if (typeof d.close === "function") d.close(); else d.removeAttribute("open");
  appliquerNiveau(n);
  if (n === "debutant" && (profilEstVierge(etat.profil) || !DONNEES_EXISTANTES)) ouvrirDecouverte(); // pas de données perso : on enchaîne sur la Découverte
});

// ---------------------------------------------------------------- événements de vie
const MODELES_EV = {
  heritage: { libelle: "Héritage ou donation", type: "entree", montant: 50000, annees: 1, dans: 15 },
  etudes: { libelle: "Études d'un enfant", type: "depense", montant: 8000, annees: 5, dans: 12 },
  voiture: { libelle: "Achat d'une voiture", type: "depense", montant: 20000, annees: 1, dans: 5 },
  travaux: { libelle: "Gros travaux", type: "depense", montant: 30000, annees: 1, dans: 8 },
  sabbatique: { libelle: "Année sabbatique", type: "pause", montant: 0, annees: 1, dans: 5 },
  autre: { libelle: "", type: "depense", montant: 0, annees: 1, dans: 1 },
};
const TYPES_EV = [["entree", "Rentrée d'argent"], ["depense", "Dépense"], ["pause", "Pause d'épargne"]];
function rendreEvenements() {
  const L = etat.profil.evenements ?? [];
  $("#liste-evenements").innerHTML = L.length ? L.map((e, i) => `<div class="evenement">
      <div><label for="ev-${i}-l">Quoi</label><input id="ev-${i}-l" type="text" class="texte" maxlength="50" data-ev="${i}.libelle" value="${echapper(e.libelle ?? "")}" placeholder="Libellé"></div>
      <div><label for="ev-${i}-t">Type</label><select id="ev-${i}-t" data-ev="${i}.type">${TYPES_EV.map(([v, l]) => `<option value="${v}" ${v === e.type ? "selected" : ""}>${l}</option>`).join("")}</select></div>
      <div><label for="ev-${i}-a">À ton âge</label><input id="ev-${i}-a" type="number" min="18" max="120" step="1" data-ev="${i}.age" value="${e.age ?? ""}"></div>
      <div><label for="ev-${i}-m">${e.type === "pause" ? "Montant (inutile)" : "Montant par an"}</label><input id="ev-${i}-m" type="number" min="0" step="500" data-ev="${i}.montant" value="${e.montant ?? 0}" ${e.type === "pause" ? "disabled" : ""}></div>
      <div><label for="ev-${i}-n">Pendant</label><input id="ev-${i}-n" type="number" min="1" max="40" step="1" data-ev="${i}.annees" value="${e.annees ?? 1}" title="années"></div>
      <button type="button" class="lien ev-suppr" data-suppr-ev="${i}" aria-label="Supprimer cet événement">Supprimer</button>
    </div>`).join("") + `<p class="note" style="margin:6px 0 0">${resumeEvenements(L)}</p>`
    : `<p class="small muted" style="margin:8px 0 0">Aucun événement prévu. Ajoute un héritage attendu, les études d'un enfant, une voiture, des travaux ou une année sans épargne.</p>`;
}
function resumeEvenements(L) {
  const entrees = L.filter((e) => e.type === "entree").reduce((t, e) => t + (Number(e.montant) || 0) * (Number(e.annees) || 1), 0);
  const depenses = L.filter((e) => e.type === "depense").reduce((t, e) => t + (Number(e.montant) || 0) * (Number(e.annees) || 1), 0);
  const pauses = L.filter((e) => e.type === "pause").reduce((t, e) => t + (Number(e.annees) || 1), 0);
  return `Au total : ${eur(entrees)} de rentrées, ${eur(depenses)} de dépenses${pauses ? `, ${pauses} an(s) sans épargne` : ""} (euros d'aujourd'hui, relevés de l'inflation dans la projection). Une rentrée part d'abord sur les livrets puis est répartie par le plan ; une dépense est payée par l'épargne de l'année, puis par les placements. Une rentrée avant l'achat de ta résidence n'est pas comptée dans l'apport : ajoute-la à l'aide familiale si elle doit servir à l'achat.`;
}
$("#liste-evenements").addEventListener("input", (ev) => {
  const k = ev.target.dataset.ev; if (!k) return;
  const [i, champ] = k.split(".");
  const e = etat.profil.evenements?.[Number(i)]; if (!e) return;
  const el = ev.target;
  if (el.type === "number" && el.max !== "" && el.value !== "" && Number(el.value) > Number(el.max)) el.value = el.max;
  e[champ] = el.type === "number" ? (el.value === "" ? null : Number(el.value)) : el.value;
  if (champ === "type") rendreEvenements();
  else { const n = $("#liste-evenements .note"); if (n) n.textContent = resumeEvenements(etat.profil.evenements); }
  apresSaisieProfil();
});
document.addEventListener("click", (ev) => {
  const a = ev.target.closest?.("[data-ajout-ev]"), s = ev.target.closest?.("[data-suppr-ev]");
  if (!a && !s) return;
  etat.profil.evenements ??= [];
  if (a) {
    const m = MODELES_EV[a.dataset.ajoutEv];
    etat.profil.evenements.push({ libelle: m.libelle, type: m.type, montant: m.montant, annees: m.annees, age: Math.min(120, (Number(etat.profil.age) || 30) + m.dans) });
  } else etat.profil.evenements.splice(Number(s.dataset.supprEv), 1);
  rendreEvenements();
  apresSaisieProfil();
});
// Frais réels saisis : ce qu'ils coûtent au-delà des frais de référence du plan
function majAideFrais() {
  const el = $("#aide-frais"); if (!el) return;
  const p = etat.profil, P = p.placements ?? {}, FR = etat.brouillon.fraisReference ?? {}, FP = p.frais ?? {};
  const lignes = [["assuranceVie", "assurance-vie", (P.assuranceVie ?? 0) + (P.assuranceVieUC ?? 0)], ["per", "PER", P.per ?? 0], ["bourse", "PEA et compte-titres", (P.pea ?? 0) + (P.cto ?? 0)]]
    .filter(([k]) => FP[k] !== "" && FP[k] != null)
    .map(([k, nom, m]) => { const extra = Math.max(0, Number(FP[k]) - (FR[k] ?? 0)); return { nom, k, m, extra, f: Number(FP[k]) }; });
  const vg = lignes.filter((x) => x.extra > 0.001);
  el.innerHTML = !lignes.length
    ? `Frais de référence du plan : ${String(FR.assuranceVie ?? 0.7).replace(".", ",")} % pour l'assurance-vie et le PER, ${String(FR.bourse ?? 0.2).replace(".", ",")} % pour les ETF du PEA. Si les tiens sont plus élevés, indique-les : la projection en tiendra compte. <a class="lien-fiche" href="#fiche-frais">Les frais expliqués</a>`
    : vg.length ? vg.map((x) => `${x.nom} : ${String(x.f).replace(".", ",")} %, soit ${String(Math.round(x.extra * 100) / 100).replace(".", ",")} point de plus que la référence${x.m > 0 ? `. Sur ${eur(x.m)} pendant 20 ans, cela fait environ ${eur(x.m * (Math.pow(1.05, 20) - Math.pow(1.05 - x.extra / 100, 20)))} de moins` : ""}`).join(" ; ") + `. Ces frais sont retirés du rendement dans Trajectoire et Retraite. <a class="lien-fiche" href="#fiche-frais">Comment les réduire</a>`
    : "Tes frais sont au niveau de la référence du plan : rien à retirer.";
}
// Garde les champs « Ta retraite » de « Mon profil » à jour quand on change l'onglet 4
function syncRetraite0() {
  const rr = etat.profil.retraite ?? {};
  for (const [id, k] of [["#r0-revenu", "revenu"], ["#r0-age", "ageDepart"], ["#r0-pension", "pension"]]) { const el = $(id); if (el && document.activeElement !== el) el.value = rr[k] ?? ""; }
  majAideRetraite0();
}
function choisirAgeDepart(a) {
  etat.profil.retraite ??= {};
  etat.profil.retraite.ageDepart = a >= (etat.brouillon.hypotheses.ageRetraite ?? 64) ? null : a;
  memo.set("profil-v2", etat.profil);
  syncRetraite0();
  planifierSauvegardeProfil();
  rendreRetraite();
}
$("#vue-retraite").addEventListener("click", (e) => { const b = e.target.closest?.("[data-age-depart]"); if (b) choisirAgeDepart(Number(b.dataset.ageDepart)); });
$("#vue-retraite").addEventListener("click", (e) => {
  const b = e.target.closest?.("[data-revenu-retraite]"); if (!b) return;
  etat.profil.retraite ??= {};
  etat.profil.retraite.revenu = Number(b.dataset.revenuRetraite);
  memo.set("profil-v2", etat.profil);
  syncRetraite0();
  planifierSauvegardeProfil();
  rendreRetraite();
});
$("#vue-retraite").addEventListener("change", (e) => {
  if (e.target.id === "r-age") choisirAgeDepart(Number(e.target.value));
  if (e.target.id === "r-mode" || e.target.id === "r-loyers" || e.target.id === "r-priorite") {
    etat.profil.retraite ??= {};
    if (e.target.id === "r-mode") etat.profil.retraite.modePension = e.target.value;
    else if (e.target.id === "r-priorite") etat.profil.retraite.priorite = e.target.value === "consommer" ? "consommer" : "transmettre";
    else etat.profil.retraite.compterLoyers = e.target.checked;
    memo.set("profil-v2", etat.profil); syncRetraite0(); planifierSauvegardeProfil(); rendreRetraite(); planifierTrajectoire();
  }
});
$("#vue-retraite").addEventListener("input", (e) => {
  if (e.target.id !== "r-revenu" && e.target.id !== "r-pension") return;
  etat.profil.retraite ??= {};
  const v = e.target.value === "" ? null : Math.max(0, Number(e.target.value));
  if (e.target.id === "r-revenu") etat.profil.retraite.revenu = v; else etat.profil.retraite.pension = v;
  memo.set("profil-v2", etat.profil);
  syncRetraite0();
  planifierSauvegardeProfil();
  clearTimeout(minuteurTrajectoire);
  minuteurTrajectoire = setTimeout(() => {
    const actif = document.activeElement?.id;
    rendreRetraite();
    if (actif) { const el = document.getElementById(actif); if (el) { el.focus(); const n = el.value.length; try { el.setSelectionRange(n, n); } catch {} } }
  }, 400);
});

// ---------------------------------------------------------------- profil
function rendreChoixEtablissements() {
  const E = etat.brouillon.etablissements ?? {};
  const options = (liste) => `<option value="">À préciser</option>` + (liste ?? []).map((x) => `<option value="${echapper(x)}">${echapper(x)}</option>`).join("");
  for (const [sel, chemin, liste] of [["#p-pea-etab", "pea.etablissement", E.pea?.choix], ["#c-pea-etab", "conjoint.pea.etablissement", E.pea?.choix], ["#p-av-type", "assuranceVie.type", E.assuranceVie?.choix]]) {
    const el = $(sel), v = lire(etat.profil, chemin) ?? "";
    const avecValeur = v && !(liste ?? []).includes(v) ? [...(liste ?? []), v] : liste;
    el.innerHTML = options(avecValeur);
    el.value = v;
  }
}
function rendreChoixProfil() {
  const plan = etat.brouillon;
  const R = plan.profilsRisque ?? {};
  const ids = Object.keys(R).filter((k) => k !== "defaut");
  const elR = $("#p-risque");
  elR.innerHTML = ids.map((k) => `<option value="${k}">${echapper(R[k].libelle ?? k)}</option>`).join("");
  elR.value = R[etat.profil.profilRisque] ? etat.profil.profilRisque : R.defaut;
  const P = plan.residence?.pays ?? {};
  const elP = $("#p-pays");
  elP.innerHTML = Object.entries(P).map(([k, x]) => `<option value="${k}">${echapper(x.libelle ?? k)}</option>`).join("");
  elP.value = P[etat.profil.pays] ? etat.profil.pays : "FR";
  $("#p-impot-pays").placeholder = String(P.AUTRE?.impotGains ?? 25);
  const r = profilRisque(plan, etat.profil);
  const bouts = [];
  if (r.partPrudente > 0) bouts.push(`${r.partPrudente} % du capital en assurance-vie et obligations dès le départ`);
  const mb = r.multiplicateurs?.bitcoin;
  if (mb != null && mb !== 1) bouts.push(`part du bitcoin × ${String(mb).replace(".", ",")}`);
  if (r.decalageAge) bouts.push(`passage à la prudence ${r.decalageAge < 0 ? "dès" : "à partir de"} ${plan.age.ageDebut + r.decalageAge} ans`);
  $("#aide-risque").textContent = bouts.length ? `${r.libelle} : ${bouts.join(", ")}.` : `${r.libelle} : le plan tel qu'il est écrit.`;
  // Conseil selon l'âge
  const age = Number(etat.profil.age) || 0, choisi = elR.value;
  const conseil = age < 40 ? { ok: ["dynamique", "equilibre"], texte: "Conseil à ton âge : Dynamique, ou Équilibré si les baisses de la bourse t'inquiètent. Jeune, tu as le temps de traverser les crises : le profil Prudent te ferait perdre beaucoup de rendement, et le plan devient de toute façon plus prudent en vieillissant." }
    : age < 55 ? { ok: ["dynamique", "equilibre"], texte: "Conseil à ton âge : Équilibré ou Dynamique. Le plan commence déjà à sécuriser une partie des placements chaque année à partir de la quarantaine." }
    : { ok: ["equilibre", "prudent"], texte: "Conseil à ton âge : Équilibré ou Prudent. La retraite approche : mieux vaut ne pas dépendre d'une forte baisse de la bourse juste avant d'avoir besoin de l'argent." };
  const el = $("#conseil-risque");
  el.textContent = age > 0 ? `${conseil.texte}${conseil.ok.includes(choisi) ? "" : ` Le profil ${R[choisi]?.libelle ?? ""} n'est pas celui qu'on conseille à ${age} ans.`}` : "";
  el.classList.toggle("attention", age > 0 && !conseil.ok.includes(choisi));
  // LEP : plafonds de revenus
  const L = plan.lep;
  if (L) {
    const ffL = foyerFiscal(normaliserProfil(etat.profil));
    const parDemi = (L.seuilRFRCouple - L.seuilRFR1Part) / 2;
    const seuilFoyer = L.seuilRFR1Part + parDemi * (ffL.parts - 1) * 2;
    const texte = `Revenus modestes = revenu fiscal de référence (sur ton avis d'impôt) au plus ${eur(L.seuilRFR1Part)} pour une personne seule, soit environ ${eur(Math.floor(L.seuilRFR1Part / 0.9 / 12 / 50) * 50)} net par mois, et ${eur(L.seuilRFRCouple)} pour un couple marié ou pacsé (2 parts), plus ${eur(parDemi)} par demi-part (enfants).${ffL.parts !== 1 && ffL.parts !== 2 ? ` Pour ton foyer (${String(ffL.parts).replace(".", ",")} parts) : ${eur(seuilFoyer)}.` : ""}`;
    let LE = null; try { LE = Number(etat.profil.salaireNetMensuel) > 0 ? lepEstime(plan, normaliserFoyer(plan, normaliserProfil(etat.profil))) : null; } catch (e) { LE = null; }
    const etonnant = !!(etat.profil.eligibleLEP && LE?.etonnant);
    $("#aide-lep").innerHTML = etonnant
      ? `<b>⚠ C'est étonnant :</b> avec ton salaire, ton revenu fiscal de référence serait d'environ ${eur(LE.rfr)}, au-dessus du plafond de ${eur(LE.seuil)} pour ton foyer. C'est possible seulement si tes revenus d'une des deux années précédentes étaient plus bas (voir ton avis d'impôt) ; sinon, la banque refusera l'ouverture : décoche la case. ${echapper(texte)}`
      : echapper(texte);
    $("#aide-lep").classList.toggle("attention", etonnant);
    const lien = $("#ligne-lep .aide-lien"); if (lien) lien.dataset.bulle = `LEP : 2,5 % sans impôt, plafond ${eur(PLAFONDS.lep)}. ${texte}`;
  }
  // Salaire dans 10 ans
  // Abondement : combien verser pour tout toucher
  const AB = etat.profil.abondement ?? {}, RA = plan.abondement ?? {};
  const surPEE = AB.acces === "pee" || (AB.acces !== "per" && AB.plan === "pee");
  const plafLegal = surPEE ? RA.plafondPEE ?? PLAFONDS.abondement.pee : RA.plafondPERCollectif ?? PLAFONDS.abondement.perco;
  $("#aide-acces").innerHTML = {
    "?": `Ton employeur ajoute peut-être de l'argent à ton épargne : regarde ton livret d'épargne salariale, ta fiche de paie (lignes « intéressement », « participation ») ou demande aux RH. Obligatoire dans les entreprises d'au moins 50 salariés. <a class="lien-fiche" href="#fiche-epargne-salariale">Comment savoir</a>`,
    non: "Pas de souci : ton PEA et ton PER individuel font le même travail, sans l'argent offert.",
    pee: `PEE : bloqué 5 ans (sauf achat du logement, mariage, 3e enfant, départ de l'entreprise…), gains sans impôt sur le revenu. <a class="lien-fiche" href="#fiche-epargne-salariale">Tout savoir</a>`,
    per: `PER d'entreprise : bloqué jusqu'à la retraite (sauf achat de la résidence principale), versements volontaires déductibles. <a class="lien-fiche" href="#fiche-epargne-salariale">Tout savoir</a>`,
    les2: `PEE (bloqué 5 ans) et PER d'entreprise (jusqu'à la retraite) : chacun peut avoir son propre abondement. Indique ci-dessous celui qui abonde le plus. <a class="lien-fiche" href="#fiche-epargne-salariale">Tout savoir</a>`,
  }[AB.acces ?? "?"] ?? "";
  const interN = Number(AB.interessement) || 0, tmiI = Number(etat.profil.tmi) || 0, eI = economieInteressement(etat.profil, interN), ecoI = eI.economie;
  $("#aide-interessement").textContent = interN > 0
    ? (AB.placer !== false
      ? `Placés, ils échappent à l'impôt sur le revenu${ecoI > 0.5 ? ` (environ ${eur(ecoI)} d'économie par an${eI.exact ? ", calculée sur ton revenu" : ` avec ta tranche à ${tmiI} %`})` : ""} : seulement 9,7 % de CSG et CRDS. Le plan les ajoute à ta bourse chaque année. Ne les compte pas dans ton épargne mensuelle.`
      : `Reçus directement, ils sont imposés comme ton salaire${ecoI > 0.5 ? ` (environ ${eur(ecoI)} d'impôt par an${eI.exact ? "" : ` avec ta tranche à ${tmiI} %`})` : ""}. Le plan ne les compte pas.`)
    : "Primes versées par l'entreprise en plus du salaire, en général au printemps. Tu as 15 jours pour choisir de les placer.";
  $("#aide-interessement").insertAdjacentHTML("beforeend", ` Pour te faire une idée : de 0 € (Stellantis en 2026) à environ 10 000 € (TotalEnergies). <a class="lien-fiche" href="#fiche-epargne-salariale">Exemples d'entreprises</a>`);
  $("#ab-plafond").placeholder = `≤ ${Math.round(plafLegal).toLocaleString("fr-FR")}`;
  const tauxAb = Number(AB.taux) > 0 ? Math.min(Number(AB.taux), RA.tauxMax ?? 300) : null;
  const interAb = AB.surInteressement && AB.placer !== false && !["non", "?"].includes(AB.acces) ? Number(AB.interessement) || 0 : 0;
  const plafAb = Math.min(plafLegal, Number(AB.plafond) > 0 ? Number(AB.plafond) : plafLegal);
  $("#aide-abondement").innerHTML = !AB.actif
    ? "Beaucoup d'entreprises ajoutent de l'argent à ce que tu verses : c'est l'abondement (souvent 50 à 300 %). Regarde le règlement du plan dans ton espace d'épargne salariale (Amundi, Natixis, Esalia, Epsor…) ou demande aux RH."
    : tauxAb && interAb >= plafAb / (tauxAb / 100) ? `Ton intéressement placé (${eur(interAb)} par an) suffit à toucher tout l'abondement (${eur(plafAb)} par an) : pas besoin de verser en plus. <a class="lien-fiche" href="#fiche-epargne-salariale">En savoir plus</a>`
    : tauxAb ? `Pour toucher tout l'abondement (${eur(plafAb)} par an), verse ${eur(Math.max(0, plafAb / (tauxAb / 100) - interAb))} par an, soit ${eur(Math.max(0, plafAb / (tauxAb / 100) - interAb) / 12)} par mois${interAb ? ` en plus de ton intéressement placé` : ""} : ton employeur t'offre ${eur(plafAb)}. Plafond légal en 2026 : ${eur(plafLegal)} par an. <a class="lien-fiche" href="#fiche-epargne-salariale">En savoir plus</a>`
    : "Indique le taux d'abondement (dans le règlement du plan ou ton espace d'épargne salariale).";
  // Impôt sur le revenu : tranche estimée et impôt de l'année, à partir du salaire saisi
  const pN = normaliserProfil(etat.profil), salN = Number(pN.salaireNetMensuel) || 0;
  const optEst = $("#p-tmi option[value='']");
  if (salN > 0) {
    const ff = foyerFiscal(pN), d = decomposerSalaire(salN, ff);
    if (optEst) optEst.textContent = `Estimée : ${d.tmi} %`;
    const saisie = etat.profil.tmi !== "" && etat.profil.tmi != null ? Number(etat.profil.tmi) : null;
    const impAn = d.impotMensuel * 12;
    let foyerTxt = "";
    if (ff.commun) {
      const dc = decomposerSalaire(Number(pN.conjoint?.salaireNetMensuel) || 0, { parts: 1 });
      const tot = impotBareme((d.netAvant + dc.netAvant) * 12 * 0.9, ff.parts, ff.partsBase).impot;
      foyerTxt = ` Pour le foyer (${String(ff.parts).replace(".", ",")} parts) : environ <b>${eur(tot)}</b> par an au total.`;
    }
    const perEco = etat.resultat?.per?.actif ? etat.resultat.per.economie : 0;
    const base = `Avec ton salaire seul : impôt d'environ <b>${eur(impAn)}</b> par an, soit ${eur(d.impotMensuel)} prélevés chaque mois (taux moyen ${pct(d.tauxPAS)}), tranche <b>${d.tmi} %</b>.`;
    let selon = "";
    if (saisie != null && saisie !== d.tmi) {
      // Ce que la tranche indiquée implique pour le revenu imposable et l'impôt du foyer
      const parts = ff.parts, i = BAREME.findIndex(([, t]) => t === saisie);
      const bas = i > 0 ? BAREME[i - 1][0] * parts : 0, haut = BAREME[i]?.[0] === Infinity ? null : BAREME[i][0] * parts;
      if (saisie > d.tmi) selon = ` <b>Avec la tranche de ${saisie} % que tu as indiquée</b>, le revenu imposable de ton foyer dépasse ${eur(bas)} : d'autres revenus s'ajoutent à ton salaire (conjoint, loyers, primes…). Ton impôt serait alors d'<b>au moins ${eur(impotBareme(bas, parts, ff.partsBase).impot)}</b> par an.`;
      else selon = ` <b>Avec la tranche de ${saisie} % que tu as indiquée</b>, le revenu imposable de ton foyer ne dépasse pas ${eur(haut)} (parts pour enfants, frais réels, pensions versées…). Ton impôt serait alors d'<b>au plus ${eur(impotBareme(haut, parts, ff.partsBase).impot)}</b> par an.`;
      selon += ` Le plan utilise ${saisie} % pour le PER : chaque 100 € versé y économise ${eur(saisie)}. Ton avis d'impôt fait foi.`;
    } else if (saisie == null) selon = " Cette tranche estimée est utilisée par le plan ; si ton avis d'impôt indique autre chose, choisis-la dans la liste.";
    // Taux marginal effectif (décote, quotient familial) : affiché seulement s'il s'écarte d'au moins 1 point de la tranche
    const FT = revenuImposableDe(pN), tme = FT ? tauxMarginalEffectif(FT.revenu, FT.parts, FT.partsBase) : null;
    const marginalTxt = tme != null && Math.abs(tme - d.tmi) >= 1
      ? ` Taux marginal effectif : <b>${Math.round(tme)} %</b>. La décote fait que chaque euro de revenu en plus te coûte ${tme > d.tmi ? "plus" : "moins"} que ta tranche.`
      : "";
    $("#aide-tmi").innerHTML = `${base}${marginalTxt}${selon}${foyerTxt}${perEco > 0.5 ? ` Avec le PER prévu par le plan : environ ${eur(perEco)} d'impôt en moins par an.` : ""} <a class="lien-fiche" href="#fiche-net-impot">Le détail</a>`;
  } else {
    if (optEst) optEst.textContent = "À préciser";
    $("#aide-tmi").textContent = "Indique ton salaire pour estimer ta tranche et ton impôt.";
  }
  // Plafond PER : où le trouver, et l'estimation du site
  const plafEst = salN > 0 ? plafondPEREstime(plan, pN.foyer?.actif ? etat.profil.salaireNetMensuel : salN) : null;
  $("#p-plafond-per").placeholder = plafEst ? `≈ ${Math.round(plafEst / 10) * 10}` : "estimé";
  $("#aide-plafond-per").innerHTML = `Il est écrit sur ton avis d'impôt (espace impots.gouv.fr → Documents), cadre « Plafond épargne retraite », ligne « Plafond pour les cotisations versées en 2026 » : ce total inclut les plafonds non utilisés des années précédentes.${plafEst ? ` Sans l'avis, estimation : environ <b>${eur(plafEst)}</b> par an (10 % de tes revenus d'activité, sans les reports).` : ""} <a class="lien-fiche" href="#fiche-per">Pas à pas</a>`;
  // PER : ce qu'il rapporte avec la tranche saisie (ou estimée)
  const tmiP = pN.tmi !== "" && pN.tmi != null ? Number(pN.tmi) : null;
  $("#aide-per").innerHTML = tmiP == null ? "Indique ta tranche d'imposition pour voir ce qu'un PER te rapporterait."
    : tmiP >= 30 ? `${etat.profil.refusPER ? "Tu y renonces, mais sache qu'a" : "A"}vec ta tranche à ${tmiP} %, chaque 100 € versé sur un PER te fait payer ${tmiP} € d'impôt en moins : c'est comme si l'État payait ${tmiP} % de ton épargne. Pour le même effort, un PER rapporte en général 10 à 45 % de plus qu'un PEA à la retraite, selon ta tranche à ce moment-là. <a class="lien-fiche" href="#fiche-per">Voir le calcul</a>`
    : (() => { const tE = etat.resultat?.per?.exact ? etat.resultat.per.tauxEffectif : tmiP, c = comparerPERPEA(tmiP, plan.per?.tmiRetraite ?? 11, 20, tE); return `Avec ta tranche à ${tmiP} % : 100 € versés ne baissent l'impôt que de ${eur(tE)}, et ils seront imposés à la sortie. Sur 20 ans, pour 100 € par mois de ta poche, ${eur(c.per)} avec le PER contre ${eur(c.pea)} avec le PEA (${c.gain >= 0 ? "+" : "−"}${pct(Math.abs(c.gain))}) : le PEA, disponible, est préférable. <a class="lien-fiche" href="#fiche-per">Voir le calcul</a>`; })();
  // Évolution de carrière : choix, et salaire estimé dans 10 ans et en fin de carrière (en euros d'aujourd'hui)
  const CR = plan.carrieres ?? {};
  const elC = $("#p-carriere");
  elC.innerHTML = Object.entries(CR).filter(([k]) => k !== "defaut").map(([k, c]) => `<option value="${k}">${echapper(c.libelle ?? k)}</option>`).join("");
  elC.value = CR[etat.profil.carriere] ? etat.profil.carriere : CR.defaut;
  const sal = Number(etat.profil.salaireNetMensuel) || 0, infl = (plan.hypotheses?.inflation ?? 0) / 100;
  const s10Saisi = Number(etat.profil.salaireDans10Ans) || 0;
  const indiv = normaliserFoyer(plan, { ...etat.profil, foyer: { actif: false }, salaireDans10Ans: null });
  const ageC = Number(etat.profil.age) || 30, fin = (plan.hypotheses?.ageRetraite ?? 64) - 1;
  const reelA = (y) => (sal * facteurSalaire(plan, indiv, y)) / Math.pow(1 + infl, y);
  const estime = Math.round((sal * facteurSalaire(plan, indiv, 10)) / 10) * 10;
  const nF = Math.max(0, fin - ageC);
  const parCarriere = Object.entries(CR).filter(([k]) => k !== "defaut").map(([k, c]) => {
    const pk = normaliserFoyer(plan, { ...etat.profil, carriere: k, foyer: { actif: false }, salaireDans10Ans: null });
    const r = (y) => (sal * facteurSalaire(plan, pk, y)) / Math.pow(1 + infl, y);
    return { k, nom: (c.libelle ?? k).split(" :")[0], a10: r(10), aFin: r(nF) };
  });
  const tousPareils = parCarriere.every((x) => Math.abs(x.a10 - parCarriere[0].a10) < 1 && Math.abs(x.aFin - parCarriere[0].aFin) < 1);
  const autres = parCarriere.filter((x) => x.k !== elC.value).map((x) => `${x.nom.toLowerCase()} : ${eur(x.a10)} et ${eur(x.aFin)}`).join(" ; ");
  $("#aide-carriere").innerHTML = sal > 0
    ? `Avec le profil choisi, ton salaire serait d'environ <b>${eur(reelA(10))}</b> dans 10 ans et <b>${eur(reelA(nF))}</b> à ${fin} ans, en euros d'aujourd'hui (inflation déduite).${tousPareils
      ? ` À ${ageC} ans, les trois profils donnent le même résultat : les hausses au-delà de l'inflation s'arrêtent à 50 ans (progressive) ou 55 ans (forte). Si tu espères encore une augmentation, indique ton salaire espéré dans 10 ans juste en dessous.`
      : ` Pour comparer, ${autres}.`}${s10Saisi > 0 ? ` Tu as indiqué ${eur(s10Saisi)} dans 10 ans : c'est ce montant qui compte pour les 10 prochaines années, puis le profil de carrière.` : ""} Les hausses de chaque profil se règlent dans « Mon plan ».`
    : "Hausse du salaire au-delà de l'inflation, selon l'âge.";
  $("#p-salaire10").placeholder = sal > 0 ? `≈ ${estime.toLocaleString("fr-FR")}` : "estimé";
  const s10 = Number(etat.profil.salaireDans10Ans) || 0;
  $("#aide-salaire10").textContent = s10 > 0 && sal > 0
    ? `Soit ${pct((Math.pow(s10 / sal, 0.1) - 1) * 100)} de hausse par an pendant 10 ans (inflation comprise), puis ton profil de carrière. L'épargne suit la même hausse ; l'achat, la trajectoire et la retraite en tiennent compte.`
    : `Laissé vide : ton profil de carrière donne environ ${eur(estime)} dans 10 ans (montant de l'époque, inflation comprise). Si tu as une idée plus précise, indique-la ici.`;
}
function rendreChampsPlacements() {
  rendreChoixEtablissements();
  rendreChoixProfil();
  const plan = etat.brouillon;
  const AIDE = {
    livretBancaire: "« Super livret » d'une banque, hors Livret A, LDDS et LEP. Pas le compte courant, qui n'est pas compté ici.",
    pel: "Plan d'épargne logement : compté dans l'apport pour la résidence principale.",
  };
  $("#placements").innerHTML = Object.entries(plan.enveloppes).filter(([id]) => id !== "assuranceVieUC" && id !== "comptesEtrangers").map(([id, e]) => id === "assuranceVie" ? champsAV(plan) :
    `<div class="champ"><label for="pl-${id}">${echapper(e.libelle)}${aideFiche(e.fiche, e.libelle)}</label><div class="saisie"><input id="pl-${id}" type="number" min="0" step="500" data-p="placements.${id}"><span>€</span></div></div>${AIDE[id] ? `<p class="note" style="margin:-4px 0 0">${AIDE[id]}</p>` : ""}`).join("");
}
// ---------------------------------------------------------------- Comptes à l'étranger (calculs dans devises.js)
// Le solde est saisi dans la devise du compte et stocké dans profil.comptesEtrangers ; son équivalent en euros est dérivé
// à chaque calcul (profilDeCalcul) et n'est jamais écrit dans profil.placements. Le libellé libre n'entre dans le DOM que par value/textContent.
const NOM_DEVISE_COMPTE = { ...NOM_DEVISE, CAD: "Dollar canadien (CAD)" };
const nomDevise = (d) => NOM_DEVISE_COMPTE[d] ?? d;
const ORIGINE_TAUX = { manuel: "saisi", jour: "du jour", reference: "de référence" };
const nouvelIdCompteEtranger = () => `ce-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
function creerChampCE(balise, attrs) { const e = document.createElement(balise); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; }
function ligneCompteEtranger(c) {
  const ligne = creerChampCE("div", { class: "ligne-ce", "data-ce-id": c.id });
  const type = creerChampCE("select", { "data-ce": "type", "aria-label": "Type de compte étranger" });
  for (const [id, t] of Object.entries(TYPES_COMPTES_ETRANGERS)) { const o = creerChampCE("option", { value: id }); o.textContent = `${t.libelle} (${t.exemples.join(", ")})`; type.append(o); }
  type.value = c.type;
  const devise = creerChampCE("select", { "data-ce": "devise", "aria-label": "Devise du compte" });
  for (const d of DEVISES_COMPTES) { const o = creerChampCE("option", { value: d }); o.textContent = nomDevise(d); devise.append(o); }
  devise.value = c.devise;
  const solde = creerChampCE("input", { type: "number", min: "0", step: "100", "data-ce": "solde", "aria-label": "Solde dans la devise du compte", placeholder: "Solde" });
  solde.value = c.solde > 0 ? c.solde : "";
  const libelle = creerChampCE("input", { type: "text", maxlength: "60", "data-ce": "libelle", "aria-label": "Usage local (facultatif)", placeholder: "Usage local (facultatif)" });
  libelle.value = c.libelle ?? "";
  const equiv = creerChampCE("span", { class: "small muted num", "data-ce-equiv": c.id });
  const suppr = creerChampCE("button", { type: "button", class: "lien", "data-ce-suppr": c.id, "aria-label": "Supprimer ce compte" });
  suppr.textContent = "Supprimer";
  ligne.append(type, devise, solde, libelle, equiv, suppr);
  return ligne;
}
// Taux du jour (BCE via /api/taux) : demandé seulement si un compte étranger en devise est renseigné, mis en cache 12 h dans localStorage
// (clé « tauxDuJour », jamais synchronisée). Échec réseau : silencieux, les taux de référence de devises.js restent utilisés.
const CLE_TAUX_JOUR = "tauxDuJour", DUREE_CACHE_TAUX = 12 * 3600 * 1000;
let tauxEnCours = false;
const aCompteEtrangerEnDevise = () => (etat.profil.comptesEtrangers ?? []).some((c) => c?.type in TYPES_COMPTES_ETRANGERS && DEVISES_COMPTES.includes(c.devise) && c.devise !== "EUR");
function tauxDuJourEnCache() {
  try {
    const c = JSON.parse(localStorage.getItem(CLE_TAUX_JOUR));
    const t = analyserTaux(c);
    const age = Date.now() - Date.parse(c?.recupereLe);
    return t && Number.isFinite(age) && age >= 0 && age < DUREE_CACHE_TAUX ? t : null;
  } catch { return null; }
}
async function chargerTauxDuJour() {
  if (etat.tauxDuJour || tauxEnCours || !aCompteEtrangerEnDevise()) return;
  const appliquer = (t) => { etat.tauxDuJour = t; rendreComptesEtrangers(); rendreResultats(); };
  const cache = tauxDuJourEnCache();
  if (cache) { appliquer(cache); return; }
  tauxEnCours = true;
  try {
    const r = await fetch("/api/taux", { headers: { Accept: "application/json" } });
    if (!r.ok) return;
    const t = analyserTaux(await r.json());
    if (!t) return;
    try { localStorage.setItem(CLE_TAUX_JOUR, JSON.stringify({ ...t, recupereLe: new Date().toISOString() })); } catch { /* stockage indisponible */ }
    appliquer(t);
  } catch { /* réseau indisponible : taux de référence */ }
  finally { tauxEnCours = false; }
}
function rendreComptesEtrangers() {
  const liste = $("#liste-comptes-etrangers"); if (!liste) return;
  liste.replaceChildren(...(etat.profil.comptesEtrangers ?? []).map(ligneCompteEtranger));
  const auto = tauxEffectifs({}, etat.tauxDuJour).taux;
  const champs = $("#champs-taux-change");
  champs.replaceChildren(...DEVISES_COMPTES.filter((d) => d !== "EUR").map((d) => {
    const div = creerChampCE("div", { class: "champ" });
    const lab = creerChampCE("label", { for: `ce-taux-${d}` }); lab.textContent = `1 € = … ${d}`;
    const inp = creerChampCE("input", { id: `ce-taux-${d}`, type: "number", min: "0", step: "0.0001", "data-ce-taux": d, placeholder: String(auto[d]) });
    inp.value = Number(etat.profil.tauxChange?.[d]) > 0 ? etat.profil.tauxChange[d] : "";
    div.append(lab, inp); return div;
  }));
  majEquivalentsCE();
}
// Met à jour les équivalents en euros, le total et la note sur les taux, sans reconstruire les champs (le focus reste en place)
function majEquivalentsCE() {
  if (!$("#liste-comptes-etrangers")) return;
  const T = tauxEffectifs(etat.profil, etat.tauxDuJour), C = consoliderEtrangers(etat.profil, T.taux);
  const parId = new Map(C.lignes.map((l) => [l.id, l]));
  document.querySelectorAll("#liste-comptes-etrangers [data-ce-equiv]").forEach((e) => { const l = parId.get(e.dataset.ceEquiv); e.textContent = l ? `≈ ${eur(l.soldeEUR)}` : "—"; });
  $("#total-comptes-etrangers").textContent = eur(C.totalEUR);
  const utilisees = [...new Set((etat.profil.comptesEtrangers ?? []).map((c) => c.devise))].filter((d) => d !== "EUR" && d in T.taux);
  const fmt = (n) => n.toLocaleString("fr-FR", { maximumFractionDigits: 5 });
  const date = new Date(`${T.date}T12:00:00`).toLocaleDateString("fr-FR");
  $("#note-taux-change").textContent = utilisees.length
    ? `Taux utilisés : ${utilisees.map((d) => `1 € = ${fmt(T.taux[d])} ${d} (${ORIGINE_TAUX[T.origine[d]]})`).join(" ; ")}. Taux BCE du ${date} quand ils ne sont pas saisis.`
    : "Aucun compte en devise étrangère : les montants en euros sont repris tels quels.";
}
function saisieComptesEtrangers(el) {
  if (el.dataset.ceTaux) {
    const v = Number(el.value);
    etat.profil.tauxChange ??= {};
    if (el.value !== "" && Number.isFinite(v) && v > 0) etat.profil.tauxChange[el.dataset.ceTaux] = v; else delete etat.profil.tauxChange[el.dataset.ceTaux];
  } else {
    const c = (etat.profil.comptesEtrangers ?? []).find((x) => x.id === el.closest("[data-ce-id]")?.dataset.ceId);
    if (!c) return;
    if (el.dataset.ce === "solde") c.solde = el.value === "" ? 0 : Math.max(0, Number(el.value) || 0);
    else if (el.dataset.ce === "libelle") c.libelle = el.value.slice(0, 60);
    else if (el.dataset.ce === "type" && el.value in TYPES_COMPTES_ETRANGERS) c.type = el.value;
    else if (el.dataset.ce === "devise" && DEVISES_COMPTES.includes(el.value)) c.devise = el.value;
  }
  majEquivalentsCE();
  apresSaisieProfil();
  if (el.dataset.ce === "devise") chargerTauxDuJour();
}
$("#bloc-comptes-etrangers").addEventListener("click", (e) => {
  const b = e.target.closest("button"); if (!b) return;
  if (b.id === "ajout-compte-etranger") {
    (etat.profil.comptesEtrangers ??= []).push({ id: nouvelIdCompteEtranger(), type: "epargneEtrangere", devise: "USD", solde: 0, libelle: "" });
    rendreComptesEtrangers();
    $("#liste-comptes-etrangers .ligne-ce:last-child [data-ce='solde']")?.focus();
    apresSaisieProfil();
    chargerTauxDuJour();
  } else if (b.dataset.ceSuppr) {
    etat.profil.comptesEtrangers = (etat.profil.comptesEtrangers ?? []).filter((c) => c.id !== b.dataset.ceSuppr);
    rendreComptesEtrangers();
    apresSaisieProfil();
  }
});
// Bloc « Exposition au change » du rééquilibrage : part de chaque devise dans le patrimoine financier (devises.js, approximation documentée)
function blocExpositionChange() {
  const profil = profilPourMoteur(), T = tauxEffectifs(etat.profil, etat.tauxDuJour);
  const x = expositionChange(etat.brouillon, profil, T.taux);
  if (!(x.totalEUR > 0)) return "";
  const lignes = Object.entries(x.parDevise).filter(([, v]) => v > 0.5).sort((a, b) => b[1] - a[1])
    .map(([d, v]) => `<tr><td>${echapper(nomDevise(d))}</td><td class="m">${x.pourcentages[d].toFixed(1).replace(".", ",")} %</td><td class="m">${eur(v)}</td></tr>`).join("");
  return `<section class="panneau" id="bloc-exposition-change" data-min="avance"><h2>Exposition au change</h2>
    <p class="note" style="margin:4px 0 8px">Part de ton patrimoine financier selon la devise : les ETF des enveloppes boursières sont répartis selon leur indice (réglable dans la poche bourse), les comptes à l'étranger restent dans leur devise, tout le reste est compté en euros. Approximation.</p>
    <div class="table-wrap"><table><thead><tr><th>Devise</th><th class="m">Part</th><th class="m">Montant</th></tr></thead><tbody>${lignes}</tbody></table></div></section>`;
}
// Petit « ? » à côté d'un libellé : mène à la fiche, sa définition s'affiche au survol
function aideFiche(fiche, nom) {
  const f = CONTENU_FICHES.find((x) => x.id === fiche);
  if (!f) return "";
  const def = LEXIQUE.find((e) => e.fiche === fiche && (e.mot === nom || nom?.startsWith(e.mot)))?.def ?? f.accroche;
  return `<a class="aide-lien" href="#fiche-${fiche}" data-bulle="${echapper(`${f.titre} : ${def}`)}" aria-label="Fiche ${echapper(f.titre)}">?</a>`;
}
function aideTerme(terme) {
  const e = LEXIQUE.find((x) => x.mot === terme || x.motifs.includes(terme));
  if (!e) return "";
  return `<a class="aide-lien" href="#fiche-${e.fiche ?? "lexique"}" data-bulle="${echapper(`${e.mot} : ${e.def}`)}" aria-label="Définition : ${echapper(e.mot)}">?</a>`;
}
document.querySelectorAll("[data-terme]").forEach((el) => el.insertAdjacentHTML("beforeend", aideTerme(el.dataset.terme)));

// Assurance-vie : un seul total, et la part en fonds euros (le reste en unités de compte)
function champsAV(plan) {
  return `<div class="champ"><label for="av-total">Assurance-vie (total du contrat)${aideFiche("assurance-vie", "Assurance-vie")}</label><div class="saisie"><input id="av-total" type="number" min="0" step="500"><span>€</span></div></div>
    <div class="champ"><label for="av-euros">dont en fonds euros${aideTerme("fonds en euros")}</label><div class="saisie"><input id="av-euros" type="number" min="0" max="100" step="5"><span>%</span></div></div>
    <p class="note" id="av-detail" style="margin:-4px 0 0"></p>`;
}
function remplirAV() {
  const pl = etat.profil.placements ?? {};
  const e = Number(pl.assuranceVie) || 0, uc = Number(pl.assuranceVieUC) || 0, t = e + uc;
  const part = t > 0 ? Math.round((100 * e) / t) : etat.profil.avPartEuros ?? 100;
  if ($("#av-total")) { $("#av-total").value = t || ""; $("#av-euros").value = part; }
  detailAV();
}
function detailAV() {
  const pl = etat.profil.placements ?? {};
  const e = Number(pl.assuranceVie) || 0, uc = Number(pl.assuranceVieUC) || 0;
  const el = $("#av-detail"); if (!el) return;
  el.textContent = e + uc > 0 ? `Soit ${eur(e)} en fonds euros (sans risque) et ${eur(uc)} en unités de compte (bourse). Le pourcentage figure sur ton relevé annuel ou dans ton espace client.` : "Le pourcentage en fonds euros figure sur ton relevé annuel ou dans ton espace client ; le reste est en unités de compte.";
}
function saisieAV() {
  const t = Math.max(0, Number($("#av-total").value) || 0);
  const part = Math.min(100, Math.max(0, $("#av-euros").value === "" ? 100 : Number($("#av-euros").value)));
  etat.profil.placements ??= {};
  etat.profil.avPartEuros = part;
  etat.profil.placements.assuranceVie = Math.round((t * part) / 100);
  etat.profil.placements.assuranceVieUC = t - etat.profil.placements.assuranceVie;
  detailAV();
}

// Estimation du prix d'un logement (lieu, type, surface)
const BASES_EST = ["projetRP", "logement", "projetLocatif"];
function htmlEstimateur(base) {
  const titre = { projetRP: "Estimer le prix et le loyer d'après le lieu et la surface (facultatif)", logement: "Estimer sa valeur d'après le lieu et la surface (facultatif)", projetLocatif: "Estimer le prix et le loyer d'après le lieu (facultatif)" }[base];
  return `<p class="titre-est">${titre}</p>
    <div class="champ"><label for="${base}-dep">Département</label><select id="${base}-dep" data-p="${base}.departement"><option value="">À choisir (ou tape directement la commune)</option>${DEPARTEMENTS.map(([c, n]) => `<option value="${c}">${c} · ${echapper(n)}</option>`).join("")}</select></div>
    <div class="champ champ-texte combo"><label for="${base}-commune">Commune ou arrondissement</label><input id="${base}-commune" type="text" class="texte commune-recherche" data-base="${base}" data-p="${base}.commune" placeholder="Tape les premières lettres ou le code postal" autocomplete="off" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="sug-${base}"><ul class="suggestions" id="sug-${base}" role="listbox" hidden></ul></div>
    <div class="champ"><label for="${base}-type">Type de logement</label><select id="${base}-type" data-p="${base}.typeLogement"><option value="appartement">Appartement</option><option value="maison">Maison</option></select></div>
    <div class="champ"><label for="${base}-surface">Surface${base === "projetLocatif" ? " (facultatif : déduite du prix sinon)" : ""}</label><div class="saisie"><input id="${base}-surface" type="number" min="9" max="1000" step="1" data-p="${base}.surface"><span>m²</span></div></div>
    <p class="resultat-est" id="est-${base}"></p>`;
}
document.querySelectorAll(".estimateur").forEach((el) => { el.innerHTML = htmlEstimateur(el.dataset.base); });

// Recherche de commune : la liste se réduit à chaque lettre tapée (nom, mot du nom ou code postal)
const combo = { base: null, items: [], actif: -1 };
function fermerSuggestions() {
  document.querySelectorAll(".suggestions").forEach((u) => { u.hidden = true; u.innerHTML = ""; });
  document.querySelectorAll(".commune-recherche").forEach((i) => i.setAttribute("aria-expanded", "false"));
  combo.base = null; combo.items = []; combo.actif = -1;
}
function afficherSuggestions(input) {
  const base = input.dataset.base, ul = $(`#sug-${base}`);
  const lieu = etat.profil[base] ?? {};
  if (!prixCharges()) { chargerPrix().then(() => { if (document.activeElement === input) afficherSuggestions(input); }).catch(() => {}); ul.hidden = false; ul.innerHTML = '<li class="muted small">Chargement des communes…</li>'; return; }
  const items = chercherCommunes(input.value, lieu.departement || null);
  combo.base = base; combo.items = items; combo.actif = items.length ? 0 : -1;
  ul.innerHTML = items.length ? items.map((it, k) => `<li role="option" id="sug-${base}-${k}" data-code="${it.code}" aria-selected="${k === 0}">${echapper(it.libelle)}${lieu.departement ? "" : ` <span class="muted small">· ${it.dep}</span>`}</li>`).join("")
    : input.value.trim() ? `<li class="muted small">Aucune commune${lieu.departement ? " dans ce département" : ""} ne commence par « ${echapper(input.value.trim())} »</li>` : "";
  ul.hidden = !ul.innerHTML;
  input.setAttribute("aria-expanded", String(!ul.hidden));
}
function choisirCommune(base, code) {
  const d = prixCharges(), c = d?.communes?.[code]; if (!c) return;
  const lieu = (etat.profil[base] ??= {});
  lieu.codeInsee = code; lieu.commune = libelleCommune(code); lieu.departement = c[1];
  $(`#${base}-commune`).value = lieu.commune; $(`#${base}-dep`).value = c[1];
  fermerSuggestions();
  apresSaisieProfil(); majEstimations();
}
document.querySelectorAll(".commune-recherche").forEach((input) => {
  input.addEventListener("input", () => { const l = (etat.profil[input.dataset.base] ??= {}); l.codeInsee = null; afficherSuggestions(input); });
  input.addEventListener("focus", () => { if (input.value.trim()) afficherSuggestions(input); });
  input.addEventListener("keydown", (e) => {
    if (combo.base !== input.dataset.base || !combo.items.length) return;
    const ul = $(`#sug-${combo.base}`);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      combo.actif = (combo.actif + (e.key === "ArrowDown" ? 1 : -1) + combo.items.length) % combo.items.length;
      ul.querySelectorAll("li[role=option]").forEach((li, k) => li.setAttribute("aria-selected", String(k === combo.actif)));
      ul.querySelector(`#sug-${combo.base}-${combo.actif}`)?.scrollIntoView({ block: "nearest" });
      input.setAttribute("aria-activedescendant", `sug-${combo.base}-${combo.actif}`);
    } else if (e.key === "Enter") { e.preventDefault(); if (combo.actif >= 0) choisirCommune(combo.base, combo.items[combo.actif].code); }
    else if (e.key === "Escape") fermerSuggestions();
  });
  input.addEventListener("blur", () => setTimeout(() => { if (combo.base === input.dataset.base) fermerSuggestions(); }, 150));
});
document.addEventListener("mousedown", (e) => {
  const li = e.target.closest?.(".suggestions li[data-code]"); if (!li) return;
  e.preventDefault(); choisirCommune(li.closest(".suggestions").id.slice(4), li.dataset.code);
});

// Rendement brut de la zone : loyer annuel (hors charges) / prix au m²
function zoneLocative(rend) {
  if (rend == null) return "";
  const t = rend < 3.5 ? "faible : zone chère, on mise surtout sur la valeur du bien" : rend < 5.5 ? "moyen : équilibre entre loyer et valeur" : rend < 8 ? "élevé : bons loyers pour le prix, vérifie la demande locative (emploi, transports)" : "très élevé : souvent une zone peu demandée, vacance et revente plus difficiles";
  return `Rendement brut de la zone : <b>${pct(rend)}</b> par an (${t}).`;
}
const depListe = {};
// Loyer de marché du projet d'achat (valeur dérivée, hors charges) : sert à comparer acheter et louer
function fixerLoyerEstime(valeur) {
  const P = etat.profil.projetRP; if (!P) return;
  const v = valeur > 0 ? valeur : null;
  if ((P.loyerEstime ?? null) === v) return;
  P.loyerEstime = v;
  apresSaisieProfil();
}
function majEstimations() {
  for (const base of BASES_EST) {
    const lieu = etat.profil[base] ?? {};
    const out = $(`#est-${base}`); if (!out) continue;
    if (!lieu.departement) { out.innerHTML = '<span class="muted small">Choisis un département ou tape directement la commune, puis le type et la surface.</span>'; if (base === "projetRP") fixerLoyerEstime(null); continue; }
    const d = prixCharges();
    if (!d) {
      out.innerHTML = '<span class="muted small">Chargement des prix…</span>';
      chargerPrix().then(majEstimations).catch((e) => { out.innerHTML = `<span class="small">Prix indisponibles ici (${echapper(e.message)}) : indique le montant toi-même.</span>`; });
      continue;
    }
    if (depListe[base] !== lieu.departement + "|" + lieu.commune) {
      depListe[base] = lieu.departement + "|" + lieu.commune;
      const inp = $(`#${base}-commune`);
      if (inp && document.activeElement !== inp) inp.value = lieu.commune ?? "";
    }
    const est = estimer(lieu);
    const surfaceDeduite = (base === "projetLocatif" || base === "projetRP") && !(Number(lieu.surface) > 0) && est?.m2 && Number(etat.profil[base]?.prix) > 0 ? Math.round(Number(etat.profil[base].prix) / est.m2) : null;
    const loy = base === "projetLocatif" || base === "projetRP" ? estimerLoyer(lieu, surfaceDeduite) : null;
    const morceaux = [];
    if (!est || est.introuvable) morceaux.push(`<span class="small">Pas de données de ventes ici (l'Alsace-Moselle et Mayotte ne sont pas couvertes) : indique le prix toi-même.</span>`);
    else {
      const ou = est.echelle === "commune" ? `à ${echapper(est.commune)}` : codeCommune(lieu) ? "dans le département (pas assez de ventes dans cette commune)" : "dans tout le département";
      const source = `prix médian des ventes ${est.type === "maison" ? "de maisons" : "d'appartements"} ${ou}, de juillet 2024 à juin 2026`;
      morceaux.push(est.prix
        ? `<span>Prix estimé : <b>${eur(est.prix)}</b></span><span class="small muted">${eur(est.m2)} le m² × ${est.surface} m² (${source})${base === "logement" ? "." : ". Dans le neuf, compter souvent plus cher."}</span>
           <button type="button" class="lien" data-utiliser="${base}" data-montant="${est.prix}">${base === "logement" ? "Utiliser cette valeur" : "Utiliser ce prix"}</button>`
        : `<span class="small">${eur(est.m2)} le m² (${source}).${base === "projetLocatif" ? "" : " Indique la surface pour estimer le prix."}</span>`);
    }
    if (loy) {
      const ouL = loy.echelle === "commune" ? `à ${echapper(loy.commune)}` : loy.echelle === "groupe" ? `autour de ${echapper(loy.commune)} (communes voisines regroupées, peu d'annonces)` : "dans le département";
      const fourchette = loy.fourchette ? `, la plupart des annonces entre ${String(loy.fourchette[0]).replace(".", ",")} et ${String(loy.fourchette[1]).replace(".", ",")} €` : "";
      const m2Txt = `${String(Math.round(loy.m2 * 10) / 10).replace(".", ",")} € le m² par mois charges comprises ${ouL}${fourchette}`;
      morceaux.push(loy.horsCharges
        ? `<span class="ligne-est">Loyer estimé : <b>${eur(loy.horsCharges)}</b> par mois hors charges</span><span class="small muted">${m2Txt} × ${loy.surface} m²${surfaceDeduite ? " (surface déduite du prix du bien)" : ""}, moins environ 10 % de charges. Source : carte des loyers 2025 du ministère du Logement (annonces du 3e trimestre 2025). Un meublé se loue en général 10 à 20 % plus cher.</span>
           ${base === "projetLocatif" ? `<button type="button" class="lien" data-utiliser-loyer="${loy.horsCharges}">Utiliser ce loyer</button>` : ""}`
        : `<span class="small">${m2Txt}. Indique la surface ou le prix du bien pour estimer le loyer.</span>`);
      if (est?.m2 && est.echelle === "commune") morceaux.push(`<span class="small">${zoneLocative((100 * loy.m2 * 0.9 * 12) / est.m2)} Prix ${eur(est.m2)} le m², loyer ${String(Math.round(loy.m2 * 0.9 * 10) / 10).replace(".", ",")} € le m² hors charges.</span>`);
      else if (est?.m2) morceaux.push(`<span class="small muted">Rendement de la zone non calculé : pas assez de ventes dans cette commune pour un prix au m² fiable (le prix du département fausserait le calcul).</span>`);
    }
    out.innerHTML = morceaux.join("");
    if (base === "projetRP") fixerLoyerEstime(loy?.horsCharges ?? null);
  }
}
$("#profil").addEventListener("click", (e) => {
  const bl = e.target.closest?.("[data-utiliser-loyer]");
  if (bl) { etat.profil.projetLocatif.loyer = Number(bl.dataset.utiliserLoyer); $("#pl-loyer").value = etat.profil.projetLocatif.loyer; apresSaisieProfil(); majVisibiliteProfil(); return; }
  const b = e.target.closest?.("[data-utiliser]"); if (!b) return;
  const montant = Number(b.dataset.montant);
  if (b.dataset.utiliser === "projetRP") { etat.profil.projetRP.prix = montant; $("#p-rp-prix").value = montant; }
  else if (b.dataset.utiliser === "projetLocatif") { etat.profil.projetLocatif.prix = montant; $("#pl-prix").value = montant; majVisibiliteProfil(); }
  else { etat.profil.logement.valeur = montant; $("#lg-valeur").value = montant; }
  apresSaisieProfil(); majEstimations();
});

// Placements regroupés (niveau Débutant) : 4 montants, répartis automatiquement dans les comptes (repartirGroupe, moteur.js)
function remplirPlacementsDebutant(champEnSaisie = null) {
  const p = etat.profil, pl = p.placements ?? {};
  for (const g of Object.keys(GROUPES_PLACEMENTS)) {
    const champ = $(`#pd-${g}`); if (!champ) continue;
    const total = totalGroupe(pl, g);
    const lecture = g === "autres" || groupePersonnalise(etat.brouillon, pl, g, p); // « Autres » : détail à saisir en Intermédiaire
    if (champ !== champEnSaisie) champ.value = total || ""; // le champ en cours de saisie n'est pas réécrit (curseur, zéros)
    champ.readOnly = lecture; // readonly (et non disabled) : la valeur reste lisible
    const mention = lecture && total > 0;
    $(`#lecture-pd-${g}`).hidden = !mention;
    $(`#aide-pd-${g}`).hidden = mention;
  }
  $("#ligne-pd-autres").hidden = totalGroupe(pl, "autres") === 0;
}
function saisieGroupeDebutant(el) {
  if (el.readOnly) return;
  const p = etat.profil, g = el.dataset.groupe;
  const avant = p.placements ?? {};
  p.placements = repartirGroupe(etat.brouillon, g, el.value === "" ? 0 : Number(el.value), avant, p);
  const contrats = contratsApresRepartition(p, p.placements, new Date(), avant);
  if (contrats.pea) p.pea = contrats.pea;
  if (contrats.assuranceVie) p.assuranceVie = contrats.assuranceVie;
  if (g === "assuranceVie") p.avPartEuros = 100; // tout en fonds euros
  remplirPlacementsDebutant(el);
  majAideRetraite0(); majAideFrais();
  apresSaisieProfil();
}
function remplirProfil() {
  (etat.profil.foyer ??= {}).situation = situationDe(etat.profil);
  if (etat.profil.foyer.actif && etat.profil.foyer.statut === "concubin" && !etat.profil.foyer.vue) etat.profil.foyer.vue = "foyer"; // anciens profils : épargne saisie pour le couple
  document.querySelectorAll("#profil [data-p]").forEach((el) => {
    const v = lire(etat.profil, el.dataset.p);
    if (el.type === "checkbox") el.checked = !!v; else el.value = v ?? "";
  });
  remplirAV();
  remplirPlacementsDebutant();
  rendreComptesEtrangers();
  chargerTauxDuJour();
  rendreChoixProfil();
  majVisibiliteProfil();
  marquerBudget();
  majEstimations();
  majAideRetraite0();
  majAideFrais();
  rendreEvenements();
}

// Salaire = épargne + dépenses : le champ modifié le moins récemment est calculé
const BUDGET = ["salaireNetMensuel", "epargneMensuelle", "depensesMensuelles"];
let ordreBudget = memo.get("ordre-budget") ?? ["depensesMensuelles", "epargneMensuelle", "salaireNetMensuel"];
if (!Array.isArray(ordreBudget) || ordreBudget.length !== 3) ordreBudget = ["depensesMensuelles", "epargneMensuelle", "salaireNetMensuel"];
function marquerBudget() {
  document.querySelectorAll("[data-budget]").forEach((el) => el.classList.toggle("auto", el.dataset.budget === ordreBudget[0]));
}
function completerBudget(champ) {
  if (champ) { ordreBudget = ordreBudget.filter((x) => x !== champ).concat(champ); memo.set("ordre-budget", ordreBudget); }
  const p = etat.profil;
  const conjoint = p.foyer?.actif && p.foyer.statut !== "concubin" ? Number(p.conjoint?.salaireNetMensuel) || 0 : 0;
  const sal = (Number(p.salaireNetMensuel) || 0) + conjoint, ep = Number(p.epargneMensuelle) || 0, dep = Number(p.depensesMensuelles) || 0;
  const c = ordreBudget[0];
  const v = c === "epargneMensuelle" ? sal - dep : c === "depensesMensuelles" ? sal - ep : ep + dep - conjoint;
  p[c] = Math.max(0, Math.round(v));
  const el = document.querySelector(`#profil [data-p="${c}"]`); if (el) el.value = p[c];
  marquerBudget();
}
// Budget du conjoint en concubinage : même règle, salaire = épargne + dépenses
const BUDGET_C = ["conjoint.salaireNetMensuel", "conjoint.epargneMensuelle", "conjoint.depensesMensuelles"];
let ordreBudgetC = memo.get("ordre-budget-c") ?? ["conjoint.depensesMensuelles", "conjoint.epargneMensuelle", "conjoint.salaireNetMensuel"];
if (!Array.isArray(ordreBudgetC) || ordreBudgetC.length !== 3) ordreBudgetC = ["conjoint.depensesMensuelles", "conjoint.epargneMensuelle", "conjoint.salaireNetMensuel"];
function completerBudgetC(champ) {
  const p = etat.profil;
  if (!(p.foyer?.actif && p.foyer.statut === "concubin")) return;
  if (champ) { ordreBudgetC = ordreBudgetC.filter((x) => x !== champ).concat(champ); memo.set("ordre-budget-c", ordreBudgetC); }
  const c = (p.conjoint ??= {});
  const sal = Number(c.salaireNetMensuel) || 0, ep = Number(c.epargneMensuelle) || 0, dep = Number(c.depensesMensuelles) || 0;
  const k = ordreBudgetC[0], cle = k.split(".")[1];
  // Rien de saisi encore : on ne calcule pas
  if (!sal && !ep && !dep) return;
  c[cle] = Math.max(0, Math.round(cle === "epargneMensuelle" ? sal - dep : cle === "depensesMensuelles" ? sal - ep : ep + dep));
  const el = document.querySelector(`#profil [data-p="${k}"]`); if (el) el.value = c[cle];
  document.querySelectorAll("[data-budget-c]").forEach((e) => e.classList.toggle("auto", `conjoint.${e.dataset.budgetC}` === ordreBudgetC[0]));
}
// Situation familiale : un seul choix, demandé dès le début
function situationDe(p) { return p.foyer?.actif ? (p.foyer.statut === "concubin" ? "concubin" : "marie") : "seul"; }
function majSituation() {
  const p = etat.profil, s = situationDe(p);
  const marie = s === "marie", concubin = s === "concubin";
  const nom = p.conjoint?.prenom?.trim() || "ton conjoint";
  $("#bloc-budget-conjoint").hidden = s === "seul";
  document.querySelectorAll(".ligne-concubin").forEach((e) => { e.hidden = !concubin; });
  $("#titre-budget-conjoint").textContent = concubin ? `Budget de ${nom}` : `Salaire de ${nom}`;
  $("#c-salaire").closest(".champ").querySelector("label").textContent = "Son salaire net après impôt";
  const lab = (id, t) => { const l = $(id)?.closest(".champ")?.querySelector("label"); if (l) l.firstChild.textContent = t; };
  lab("#p-salaire", s === "seul" ? "Salaire net après impôt (versé sur ton compte)" : "Ton salaire net après impôt");
  lab("#p-epargne", marie ? "Épargne du couple (les deux salaires)" : concubin ? "Ton épargne" : "Épargne");
  lab("#p-depenses", marie ? "Dépenses du couple (loyer et crédits compris)" : concubin ? "Tes dépenses (ta part du loyer et des crédits comprise)" : "Dépenses (loyer et crédits compris)");
  const vueFoyer = concubin && p.foyer?.vue !== "moi";
  $("#aide-situation").textContent = {
    seul: "",
    marie: "Mariés ou pacsés : une seule déclaration d'impôt et, souvent, un budget commun. Le salaire de ton conjoint s'ajoute au tien dans « Ton budget », et l'épargne, les dépenses et les placements saisis sont ceux du couple.",
    concubin: "En concubinage, chacun garde son budget et ses impôts. Indique ton budget puis celui de ton conjoint, et choisis si le calcul porte sur toi seul ou sur le couple.",
  }[s];
  $("#aide-budget-conjoint").textContent = marie ? "Il s'ajoute au tien : salaire du couple = épargne du couple + dépenses du couple."
    : vueFoyer ? `Calcul pour le couple : l'épargne des deux (${eur((Number(p.epargneMensuelle) || 0) + (Number(p.conjoint?.epargneMensuelle) || 0))} par mois) et les placements des deux. Dans « Tes placements », indique donc vos comptes à tous les deux.`
    : "Calcul pour toi seul : seuls ton salaire, ton épargne et tes placements comptent. Le budget de ton conjoint sert seulement si tu passes au calcul pour le couple.";
  $("#note-conjoint").textContent = marie ? "Le salaire de ton conjoint se saisit dans « Ton budget ». Son PEA compte en plus du tien (deux plafonds)." : vueFoyer ? "Son budget se saisit dans « Ton budget ». Son PEA compte en plus du tien (deux plafonds)." : "Son budget se saisit dans « Ton budget ».";
  $("#bloc-conjoint").closest(".panneau").querySelector("legend").textContent = s === "seul" ? "Foyer" : "Foyer et conjoint";
}

// Indépendant : champs selon la forme, résultats de la simulation (cotisations, IS, dividendes, IR, net en poche, PER)
function rendreIndependant() {
  const p = etat.profil, bloc = $("#bloc-independant"), sortie = $("#resultat-independant");
  if (!bloc || !sortie) return;
  const actif = p.statutPro === "independant";
  bloc.hidden = !actif;
  if (!actif) { sortie.innerHTML = ""; return; }
  const forme = p.independant?.forme ?? "", micro = forme.startsWith("micro"), societe = forme === "sasu" || forme === "eurl";
  bloc.querySelectorAll('[data-ind="micro"]').forEach((el) => { el.hidden = !micro; });
  bloc.querySelectorAll('[data-ind="societe"]').forEach((el) => { el.hidden = !societe; });
  bloc.querySelectorAll('[data-ind="eurl"]').forEach((el) => { el.hidden = forme !== "eurl"; });
  let r = null;
  try { r = simulerIndependant(etat.brouillon, p); } catch (e) { console.error(e); }
  if (!r) { sortie.innerHTML = `<p class="note" style="margin:0">Choisis ta forme d'exercice pour estimer ton revenu net, tes cotisations et ton impôt.</p>`; return; }
  const net = micro ? r.netAnnuel : r.netEnPoche;
  const chiffre = (valeur, libelle) => `<div><b class="num">${valeur}</b><span>${libelle}</span></div>`;
  const lignes = micro
    ? [chiffre(eur(r.cotisations), "cotisations sociales"), chiffre(eur(r.impot), p.independant.vl ? "impôt (versement libératoire)" : "impôt sur le revenu attribué"), chiffre(`${r.tmi} %`, "tranche d'imposition")]
    : [chiffre(eur(r.cotisations), "cotisations sociales"), chiffre(eur(r.is), "impôt sur les sociétés"),
       chiffre(eur(r.dividendesBruts), "dividendes bruts"), chiffre(eur(r.dividendesNets), "dividendes nets"),
       chiffre(eur(r.impot), "impôt sur le revenu attribué"), chiffre(`${r.tmi} %`, "tranche d'imposition")];
  const per = r.plafondPER;
  const opt = r.optimisation?.optimum;
  const alertes = r.alertes.length ? `<ul class="note attention">${r.alertes.map((a) => `<li>${echapper(a)}</li>`).join("")}</ul>` : "";
  sortie.innerHTML = `
    <div class="chiffres">
      ${chiffre(eur(net), "net en poche par an")}${chiffre(eur(net / 12), "net en poche par mois")}
      ${societe ? chiffre(pct(r.tauxPrelevementGlobal), "prélèvement global sur le résultat") : ""}
    </div>
    <div class="chiffres">${lignes.join("")}</div>
    <p class="note" style="margin:0">Plafond de versement PER déductible : <b class="num">${eur(per.plafond)}</b> par an (article ${per.regle} du CGI).</p>
    ${opt ? `<p class="note" style="margin:0">Rémunération qui maximise le net en poche (par pas de 1 000 €) : <b class="num">${eur(opt.remunerationNette)}</b> par an, soit <b class="num">${eur(opt.netEnPoche)}</b> en poche. Moins de rémunération, c'est moins de cotisations mais aussi moins de droits à la retraite.</p>` : ""}
    ${alertes}
    <div><button type="button" id="btn-net-independant">Utiliser ce net dans mon budget</button></div>
    <p class="note" style="margin:0">Estimation simplifiée : taux effectifs, sans chômage ni prévoyance, sans déficit reportable. ${lienFiche("independants", "Fiche : micro-entreprise, SASU ou EURL")}</p>`;
}
$("#resultat-independant")?.addEventListener("click", (e) => {
  if (!e.target.closest("#btn-net-independant")) return;
  let r = null;
  try { r = simulerIndependant(etat.brouillon, etat.profil); } catch (err) { console.error(err); }
  if (!r) return;
  etat.profil.salaireNetMensuel = Math.max(0, Math.round((r.netAnnuel ?? r.netEnPoche) / 12));
  completerBudget("salaireNetMensuel");
  remplirProfil();
  apresSaisieProfil();
  rendreChoixProfil();
});

function majVisibiliteProfil() {
  const p = etat.profil;
  majSituation();
  rendreIndependant();
  // Livret Jeune : seulement jusqu'à 25 ans (le tien, ou celui de ton conjoint si le calcul porte sur le couple)
  { const jeune = (Number(p.age) || 0) <= 25 || (p.foyer?.actif && !(p.foyer.statut === "concubin" && p.foyer.vue === "moi") && (Number(p.conjoint?.age) || 99) <= 25);
    const ch = $("#pl-livretJeune")?.closest(".champ"); if (ch) ch.hidden = !jeune && !(Number(p.placements?.livretJeune) > 0); }
  const chezSoi = !!p.proprietaire && (p.logement?.usage ?? "rp") === "rp";
  $("#ligne-loyer").hidden = chezSoi;
  $("#bloc-logement").hidden = !p.proprietaire;
  document.querySelector('.estimateur[data-base="projetRP"]').hidden = !p.projetRP?.actif;
  const L = p.logement ?? {};
  const valeurPart = (Number(L.valeur) || 0) * (L.part > 0 ? Math.min(100, L.part) : 100) / 100;
  $("#note-logement").textContent = p.proprietaire && valeurPart > 0
    ? `Ta part : ${eur(valeurPart)}${L.creditRestant > 0 ? `, soit ${eur(valeurPart - L.creditRestant)} une fois le crédit restant déduit` : ""}. Elle compte dans ton patrimoine (Trajectoire), pas dans les placements à répartir.${chezSoi ? "" : " Ce n'est pas ta résidence principale : indique le loyer que tu paies là où tu vis."}`
    : "";
  // Bien loué : loyers, charges, impôt et cash-flow ; revente possible pour un nouvel achat
  const loue = !!p.proprietaire && (L.usage ?? "rp") === "loue";
  $("#bloc-locatif").hidden = !loue;
  $("#ligne-vendre").hidden = !(chezSoi && p.projetRP?.actif);
  if (loue) {
    let fl = null; try { fl = fluxLocatif(etat.brouillon, normaliserProfil(p)); } catch (e) { console.error(e); }
    $("#note-locatif").innerHTML = fl && fl.loyers > 0
      ? `Par an (ta part) : ${eur(fl.loyers)} de loyers − ${eur(fl.charges)} de charges − ${eur(fl.impot)} d'impôt et de prélèvements sociaux${fl.regime === "lmnp-reel" ? " (l'amortissement efface en général l'impôt pendant des années ; il est réintégré dans la plus-value à la revente depuis 2025)" : ""}${fl.mensualiteAn > 0 ? ` − ${eur(fl.mensualiteAn)} de crédit` : ""} = <b>${fl.cashflow >= 0 ? "+" : "−"}${eur(Math.abs(fl.cashflow))}</b>, soit ${fl.cashflow >= 0 ? "+" : "−"}${eur(Math.abs(fl.cashflow / 12))} par mois. Ce flux s'ajoute à ton épargne dans Trajectoire et Retraite (et continue à la retraite) : ne compte donc ni ces loyers ni ce crédit dans ton budget.${fl.mensualiteAn > 0 && L.finCredit ? ` À la fin du crédit (${L.finCredit}), il augmente de ${eur(fl.mensualiteAn / 12)} par mois.` : ""}${fl.microDepasse ? " Attention : au-delà de 15 000 € de loyers par an, le micro-foncier n'est plus possible, c'est le régime réel." : ""}${fl.imposable > 0 ? texteTauxLoyers(fl.T, " ") : ""}`
      : "Indique le loyer encaissé et les charges pour calculer ce que ce bien te rapporte vraiment, impôt compris.";
  }
  if (p.proprietaire && !loue && Number(L.mensualite) > 0 && L.finCredit) $("#note-logement").textContent += ` À la fin du crédit (${L.finCredit}), tes ${eur(L.mensualite)} de mensualité redeviennent de l'épargne : Trajectoire en tient compte.`;
  // Projet d'investissement locatif : coût, crédit, cash-flow, TRI comparé au PEA
  $("#bloc-projet-locatif").hidden = !p.projetLocatif?.actif;
  if (p.projetLocatif?.actif) {
    let pr = null, an = null;
    try { pr = projetLocatifDe(etat.brouillon, normaliserProfil(p)); an = analyseLocatif(etat.brouillon, pr, 20); } catch (e) { console.error(e); }
    $("#note-projet-locatif").innerHTML = pr && an
      ? `Coût total ${eur(pr.cout)} (dont ${eur(pr.frais)} de frais de notaire), prêt de ${eur(pr.pret)} sur ${pr.duree} ans à ${pct(pr.taux)} : <b>${eur(pr.mensualite)}</b> par mois, assurance comprise. 1re année : cash-flow de <b>${an.cashflow1 >= 0 ? "+" : "−"}${eur(Math.abs(an.cashflow1 / 12))}</b> par mois après impôt${an.cashflow1 < 0 ? " (c'est ton effort d'épargne)" : ""}. Les intérêts baissent chaque année : au régime réel, l'impôt monte ; à la fin du crédit, le loyer devient un revenu. ${pr.anneeImposable == null ? "Au régime choisi, ces loyers ne seraient pas imposés pendant 30 ans." : `${pr.anneeImposable > 0 ? `Pas d'impôt sur les loyers les ${pr.anneeImposable} premières années (${pr.regime === "lmnp-reel" ? "l'amortissement" : "les charges et les intérêts"} l'effacent). ` : ""}${texteTauxLoyers(pr.impot)}`}<br>
        <b>Sur 20 ans</b> : rendement net (TRI) d'environ <b>${pct(an.tri * 100)}</b> par an, revente comprise (bien ${eur(an.vente)}, crédit restant ${eur(an.dette)}, impôt sur la plus-value ${eur(an.impotPV)}). Le même argent (apport + efforts) placé sur un PEA : environ <b>${pct(an.triPEA * 100)}</b> par an, soit ${eur(an.peaNet)} après impôts contre ${eur(an.final)} pour le locatif. ${an.tri > an.triPEA + 0.005 ? "Le locatif fait mieux grâce à l'effet de levier du crédit." : an.tri < an.triPEA - 0.005 ? "Le PEA fait mieux, sans les soucis de gestion." : "Les deux se valent : le PEA est plus simple et disponible."} Le projet est compté dans Trajectoire et Retraite (et dans ta capacité d'emprunt pour ta résidence) ; compare avec et sans dans « Comparer deux scénarios ». <a class="lien-fiche" href="#fiche-residence">Hypothèses</a>`
      : "Indique au moins le prix du bien.";
  }
  if (chezSoi && p.projetRP?.actif && L.vendrePourAchat) $("#note-logement").textContent += " Au moment du nouvel achat, ce logement est revendu : sa valeur nette du crédit restant rejoint l'apport.";
  planifierEndettement(p);
  $("#bloc-conjoint").hidden = !p.foyer?.actif || (p.foyer.statut === "concubin" && p.foyer.vue === "moi");
  $("#c-pea-date").disabled = $("#c-pea-vers").disabled = $("#c-pea-etab").disabled = !p.conjoint?.pea?.ouvert;
  $("#p-pea-date").disabled = $("#p-pea-vers").disabled = $("#p-pea-etab").disabled = !p.pea?.ouvert;
  const rp = !!p.projetRP?.actif;
  $("#p-rp-prix").disabled = $("#p-rp-type").disabled = $("#p-rp-imp").disabled = $("#p-rp-aide").disabled = !rp;
  $("#p-rp-copro").disabled = $("#p-rp-loyer-eq").disabled = $("#p-rp-ptz").disabled = !rp;
  $("#p-rp-loyer-eq").placeholder = p.projetRP?.loyerEstime > 0 ? `${Math.round(p.projetRP.loyerEstime)} (estimé)` : "loyer estimé";
  { const ptz = p.projetRP?.ptz ?? {};
    $("#bloc-ptz").hidden = !(rp && ptz.actif);
    $("#ligne-ptz-travaux").hidden = ptz.typeOperation !== "ancienTravaux"; }
  $("#ligne-impot-pays").hidden = p.pays !== "AUTRE";
  const accesES = p.abondement?.acces ?? "?";
  $("#bloc-es").hidden = accesES === "non" || accesES === "?";
  $("#ligne-ab-plan").hidden = accesES !== "les2";
  $("#ab-plan").disabled = $("#ab-taux").disabled = $("#ab-plafond").disabled = !p.abondement?.actif;
  $("#ab-placer").disabled = $("#ab-sur-inter").disabled = !(Number(p.abondement?.interessement) > 0);
  $("#p-av-type").disabled = $("#p-av-date").disabled = $("#p-av-apres70").disabled = !p.assuranceVie?.ouverte;
  $("#p-futur-age").disabled = $("#p-futur-cap").disabled = $("#p-futur-sal").disabled = $("#p-futur-ep").disabled = !p.futur?.actif;
  $("#p-rp-h").disabled = !rp || !p.projetRP?.imperatif;
}
function apresSaisieProfil() {
  memo.set("profil-v2", etat.profil);
  majCtaDecouverte();
  majVisibiliteProfil();
  rendreResultats();
  planifierTrajectoire();
  planifierSauvegardeProfil();
}
// Le minimum s'applique quand on quitte le champ (pour ne pas gêner la saisie)
$("#profil").addEventListener("change", (e) => {
  const el = e.target;
  if (el.type === "number" && el.min !== "" && el.value !== "" && Number(el.value) < Number(el.min) && /(^|\.)age$/.test(el.dataset.p ?? "")) {
    el.value = el.min; el.dispatchEvent(new Event("input", { bubbles: true }));
  }
});
// Retraite publique estimée en un clic depuis « Mon profil »
function estimerPensionProfil() {
  const plan = etat.brouillon, p0 = normaliserProfil(etat.profil), rr = p0.retraite ?? {};
  const ageArret = Math.min(plan.hypotheses.ageRetraite ?? 64, Number(rr.ageDepart) || (plan.hypotheses.ageRetraite ?? 64));
  const est = estimerPension(plan, p0, { ageDebut: rr.ageDebutCarriere, trimestresDeja: rr.trimestresDeja, ageArret, ageDemande: rr.ageDemande, trimestresEnfants: rr.trimestresEnfants });
  return { est, ageArret, montant: Math.round(est.demande.apres / 10) * 10, age: Math.ceil(est.demande.age) };
}
function majAideRetraite0() {
  const el = $("#aide-retraite0"); if (!el) return;
  const plan = etat.brouillon;
  let pN = null; try { pN = normaliserProfil(etat.profil); } catch { pN = null; }
  const rr = pN?.retraite ?? etat.profil.retraite ?? {};
  const mode = etat.profil.retraite?.modePension ?? "auto";
  const pension = Number(rr.pension) || 0;
  // Champ du montant : calculé (grisé) en mode automatique, saisi en mode manuel
  const ch = $("#r0-pension");
  if (ch) { ch.disabled = mode !== "manuel"; if (mode !== "manuel" && document.activeElement !== ch) ch.value = mode === "zero" ? 0 : pension || ""; }
  if ($("#r0-mode") && document.activeElement !== $("#r0-mode")) $("#r0-mode").value = mode;
  if ($("#r0-loyers")) { $("#r0-loyers").checked = etat.profil.retraite?.compterLoyers !== false; $("#r0-loyers").closest("label").hidden = !(etat.profil.proprietaire && etat.profil.logement?.usage === "loue") && !etat.profil.projetLocatif?.actif; }
  if ($("#r0-or")) { $("#r0-or").checked = !!etat.profil.retraite?.vendreOr; }
  const legal = plan.hypotheses?.ageRetraite ?? 64, dep = Math.min(legal, Number(rr.ageDepart) || legal), x = rr.pensionParAge?.[dep];
  if (mode === "auto") {
    el.innerHTML = x ? `En arrêtant à <b>${dep} ans</b> : environ <b>${eur(x.pension)}</b> par mois après impôt, versés à partir de ${x.agePension} ans (${x.trimestres} trimestres sur ${x.requis} pour le taux plein${x.decote ? `, décote de ${x.decote} trimestres` : ""}). Le montant se recalcule quand tu changes l'âge d'arrêt : arrêter plus tôt, c'est moins de trimestres et une retraite plus basse.${rr.pensionParAge?.[legal] && dep < legal ? ` À ${legal} ans, ce serait ${eur(rr.pensionParAge[legal].pension)}.` : ""} Estimation pour un salarié du privé${etat.profil.foyer?.actif ? ", pour toi seul (pas celle de ton conjoint)" : ""}. <a class="lien-fiche" href="#retraite">Le détail dans l'onglet 4</a>` : "Indique ton âge et ton salaire pour estimer ta retraite publique.";
    return;
  }
  let est = null; try { est = estimerPensionProfil(); } catch { /* profil incomplet */ }
  el.innerHTML = `${pension > 0 ? `Le plan compte ${eur(pension)} par mois de retraite publique à partir de ${rr.agePension ?? plan.retraitePublique?.ageLegal ?? 64} ans.` : "Par prudence, 0 € de retraite publique est compté : tout viendrait de tes placements."}${est ? ` Estimation pour ton profil : environ <b>${eur(est.montant)}</b> par mois après impôt, à partir de ${est.age} ans (${est.est.trimestres} trimestres).` : ""} Âge légal pour toi : ${est ? ageEnTexte(est.est.regles.ageLegal) : "64 ans"} ; on peut arrêter de travailler avant, mais la retraite publique n'est versée qu'à partir de cet âge. <a class="lien-fiche" href="#retraite">Le détail dans l'onglet 4</a>`;
}
$("#profil").addEventListener("input", (e) => {
  const el = e.target;
  if (el.closest("#bloc-comptes-etrangers")) { saisieComptesEtrangers(el); return; }
  if (el.id === "av-total" || el.id === "av-euros") { saisieAV(); apresSaisieProfil(); return; }
  if (el.dataset.groupe) { saisieGroupeDebutant(el); return; }
  if (!el.dataset.p) return;
  // Bornes des champs numériques (âge entre 18 et 120 ans…) : le maximum s'applique tout de suite
  if (el.type === "number" && el.max !== "" && el.value !== "" && Number(el.value) > Number(el.max)) el.value = el.max;
  const v = el.type === "checkbox" ? el.checked : (el.type === "month" || el.type === "text" || el.tagName === "SELECT") ? el.value : el.value === "" ? (el.placeholder ? null : 0) : Number(el.value);
  ecrire(etat.profil, el.dataset.p, v);
  if (el.dataset.p === "foyer.situation") {
    const f = (etat.profil.foyer ??= {});
    f.actif = v !== "seul"; if (v !== "seul") f.statut = v;
    if (v === "concubin" && !f.vue) f.vue = "moi";
  }
  if (BUDGET.includes(el.dataset.p)) completerBudget(el.dataset.p);
  else if (["conjoint.salaireNetMensuel", "foyer.actif", "foyer.situation"].includes(el.dataset.p)) completerBudget(null);
  if (BUDGET_C.includes(el.dataset.p)) completerBudgetC(el.dataset.p);
  if (el.dataset.p === "projetLocatif.actif" && v && !(Number(etat.profil.projetLocatif?.prix) > 0)) {
    Object.assign(etat.profil.projetLocatif, { age: Math.min(80, (Number(etat.profil.age) || 30) + 5), prix: 150000, type: "ancien", travaux: 0, apport: 20000, duree: 20, loyer: 650, charges: 1500, vacance: 1, regime: "micro" });
    remplirProfil();
  }
  if (el.dataset.p === "futur.actif" && v && !(etat.profil.futur.age > etat.profil.age)) {
    etat.profil.futur.age = (etat.profil.age ?? 30) + 10; $("#p-futur-age").value = etat.profil.futur.age;
  }
  if (["profilRisque", "age", "salaireNetMensuel", "salaireDans10Ans", "epargneMensuelle", "depensesMensuelles", "carriere", "tmi", "refusPER", "eligibleLEP", "foyer.actif", "foyer.statut", "foyer.situation", "foyer.vue", "conjoint.salaireNetMensuel", "conjoint.epargneMensuelle", "conjoint.depensesMensuelles", "enfants"].includes(el.dataset.p) || el.dataset.p.startsWith("abondement.")) rendreChoixProfil();
  memo.set("profil-v2", etat.profil);
  majVisibiliteProfil();
  majAideRetraite0();
  majAideFrais();
  if (["foyer.actif", "foyer.situation", "foyer.vue"].includes(el.dataset.p)) { rendreChampsPlacements(); remplirProfil(); }
  if (/^(projetRP|logement|projetLocatif)\./.test(el.dataset.p)) majEstimations();
  rendreResultats();
  // Les notes d'impôt citent l'économie du PER calculée par le plan : on les remet à jour après le calcul
  if (["tmi", "salaireNetMensuel", "epargneMensuelle", "refusPER", "plafondPER", "foyer.actif", "foyer.statut", "foyer.situation", "foyer.vue", "conjoint.salaireNetMensuel", "enfants"].includes(el.dataset.p)) rendreChoixProfil();
  planifierTrajectoire();
  planifierSauvegardeProfil();
});
$("#profil").addEventListener("submit", (e) => e.preventDefault());

// ---------------------------------------------------------------- profils des proches
// profils/{id}      : profils créés par l'auteur du plan (lus et modifiés par lui seul)
// situations/{id}   : la situation qu'un proche enregistre lui-même (lue par lui et par l'auteur)
const proches = {
  liste: [], situations: [], auteur: false, moi: null, mode: "local", // local | partage | lecture
  courant: memo.get("profil-courant") ?? { col: "exemple", id: "exemple" },
  reference: null, statut: "", zone: null, minuteur: null, enCours: false,
};
const cle = (c) => `${c.col}:${c.id}`;
const docCourant = () => (proches.courant.col === "profils" ? proches.liste : proches.courant.col === "situations" ? proches.situations : []).find((d) => d.id === proches.courant.id);
const profilModifie = () => !horsSauvegarde() && proches.courant.col !== "exemple" && proches.reference && JSON.stringify(etat.profil) !== JSON.stringify(proches.reference);
const nouvelId = () => (etat.db ? etat.db.collection("profils").doc().id : `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`);

// Stockage : base partagée si disponible, sinon ce navigateur
async function ecrireDoc(col, id, data) {
  if (etat.db) return etat.db.doc(`${col}/${id}`).set(data);
  const tout = memo.get(`local-${col}`) ?? {}; tout[id] = data; memo.set(`local-${col}`, tout); chargerLocal();
}
async function effacerDoc(col, id) {
  if (etat.db) return etat.db.doc(`${col}/${id}`).delete();
  const tout = memo.get(`local-${col}`) ?? {}; delete tout[id]; memo.set(`local-${col}`, tout); chargerLocal();
}
function chargerLocal() {
  for (const col of ["profils", "situations"]) {
    const tout = memo.get(`local-${col}`) ?? {};
    proches[col === "profils" ? "liste" : "situations"] = Object.entries(tout).map(([id, d]) => ({ id, ...d }));
  }
  apresChangementListes();
}

function apresChangementListes() {
  proches.liste.sort((a, b) => (a.nom ?? "").localeCompare(b.nom ?? "", "fr"));
  proches.situations.sort((a, b) => (a.nom ?? "").localeCompare(b.nom ?? "", "fr"));
  const d = docCourant();
  if (proches.courant.col !== "exemple" && !d && proches.pret && !etat.partage) { choisirProfil({ col: "exemple", id: "exemple" }); return; }
  if (d && !horsSauvegarde()) { // scénario partagé ou simulation : une mise à jour distante ne doit pas les écraser
    const distant = fusion(PROFIL_VIDE, d.profil);
    if (!proches.reference) { proches.reference = distant; if (JSON.stringify(etat.profil) !== JSON.stringify(distant) && !memo.get("profil-v2")) chargerDansFormulaire(distant); }
    else if (!profilModifie() && JSON.stringify(distant) !== JSON.stringify(proches.reference)) { proches.reference = distant; chargerDansFormulaire(distant); }
  }
  rendreProches();
  if (!$("#vue-suivi").hidden) rendreSuivi();
}

function chargerDansFormulaire(p) {
  const avait = !!etat.simulation;
  etat.simulation = null; // un profil chargé remplace toute simulation en cours
  etat.profil = completerProfil(clone(p));
  memo.set("profil-v2", etat.profil);
  remplirProfil(); rendreResultats(); planifierTrajectoire();
  majBandeauScenario();
  if (avait) document.dispatchEvent(new CustomEvent("simulation:change", { detail: { active: false } }));
}

function choisirProfil(c) {
  // Choisir un profil enregistré quitte le scénario partagé et toute simulation
  etat.partage = null; etat.simulation = null;
  retirerParamPartage();
  proches.courant = c; memo.set("profil-courant", c);
  brouillonReleve = null; moisReleve = null;
  proches.zone = null;
  if (c.col === "exemple") { proches.reference = null; chargerDansFormulaire(clone(PROFIL_EXEMPLE)); }
  else { const d = docCourant(); proches.reference = fusion(PROFIL_VIDE, d?.profil); chargerDansFormulaire(proches.reference); }
  proches.statut = "";
  rendreProches();
  document.dispatchEvent(new CustomEvent("profil:change")); // l'assistant recharge l'historique de ce profil
}

function planifierSauvegardeProfil() {
  if (proches.courant.col === "exemple" || proches.mode === "lecture" || horsSauvegarde()) { rendreEtatProfil(); return; }
  proches.statut = "Modifications en cours…"; rendreEtatProfil();
  clearTimeout(proches.minuteur);
  proches.minuteur = setTimeout(sauverProfilCourant, 1200);
}
async function sauverProfilCourant() {
  if (proches.enCours) { proches.minuteur = setTimeout(sauverProfilCourant, 600); return; }
  const d = docCourant(); if (!d || !profilModifie()) { proches.statut = ""; rendreEtatProfil(); return; }
  proches.enCours = true; proches.statut = "Enregistrement…"; rendreEtatProfil();
  const instantane = clone(etat.profil);
  try {
    await ecrireDoc(proches.courant.col, proches.courant.id, { nom: d.nom, profil: instantane, suivi: d.suivi ?? null, majLe: new Date().toISOString() });
    proches.reference = instantane; proches.statut = "Enregistré";
  } catch (err) {
    proches.statut = `Échec de l'enregistrement (${err?.code ?? "erreur"}). Les modifications sont gardées dans ce navigateur ; elles seront renvoyées à la prochaine modification.`;
  }
  proches.enCours = false; rendreEtatProfil();
}

function rendreEtatProfil() {
  majCtaDecouverte();
  const el = $("#etat-profil"); if (!el) return;
  const d = docCourant();
  let t;
  if (etat.partage) t = "Scénario partagé : rien n'est enregistré.";
  else if (etat.simulation) t = "Simulation What-If en cours : rien n'est enregistré.";
  else if (proches.courant.col === "exemple") t = "Profil d'exemple : rien n'est enregistré.";
  else if (proches.statut) t = proches.statut;
  else t = d?.majLe ? `Enregistré automatiquement · mis à jour le ${new Date(d.majLe).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })}` : "Enregistré automatiquement.";
  if (!etat.partage && !etat.simulation) {
    if (proches.courant.col === "profils" && proches.mode === "partage") t += " Visible par toi seul.";
    if (proches.courant.col === "situations" && proches.mode === "partage") t += proches.auteur ? " Situation envoyée par ce proche." : " Visible par toi et l'auteur du plan.";
    if (proches.mode === "local" && proches.courant.col !== "exemple") t += " (dans ce navigateur uniquement)";
  }
  el.textContent = t;
}

function rendreProches() {
  const sel = $("#sel-profil"); if (!sel) return;
  const opt = (c, nom) => `<option value="${echapper(cle(c))}">${echapper(nom || "Sans nom")}</option>`;
  let html = opt({ col: "exemple", id: "exemple" }, "Exemple");
  if (proches.auteur && proches.liste.length) html += `<optgroup label="Mes proches">${proches.liste.map((d) => opt({ col: "profils", id: d.id }, d.nom)).join("")}</optgroup>`;
  if (proches.situations.length) html += `<optgroup label="${proches.auteur ? "Situations envoyées par tes proches" : "Ma situation"}">${proches.situations.map((d) => opt({ col: "situations", id: d.id }, d.nom)).join("")}</optgroup>`;
  if (etat.partage) html = `<option value="partage:lien">🔗 Scénario partagé</option>` + html;
  sel.innerHTML = html;
  sel.value = etat.partage ? "partage:lien" : cle(proches.courant);

  const z = $("#actions-proches");
  const d = docCourant();
  if (etat.partage) {
    z.innerHTML = ""; // renommer, supprimer, créer : ces actions visent le profil enregistré, pas le scénario partagé
  } else if (proches.zone?.type === "nom") {
    z.innerHTML = `<label for="nom-profil" class="small">${proches.zone.libelle}</label>
      <div class="ligne-actions"><input id="nom-profil" class="texte" type="text" maxlength="60" value="${echapper(proches.zone.valeur ?? "")}" placeholder="Prénom">
      <button type="button" class="principal" id="nom-ok">${proches.zone.bouton}</button><button type="button" class="lien" id="nom-annuler">Annuler</button></div>`;
    setTimeout(() => $("#nom-profil")?.focus(), 0);
  } else if (proches.zone?.type === "supprimer") {
    z.innerHTML = `<p class="small" style="margin:0">Supprimer « ${echapper(d?.nom ?? "")} » ? C'est définitif.</p>
      <div class="ligne-actions"><button type="button" id="suppr-oui">Oui, supprimer</button><button type="button" class="lien" id="suppr-non">Non</button></div>`;
  } else {
    const boutons = [];
    if (proches.mode !== "lecture" && proches.auteur) boutons.push(`<button type="button" id="act-nouveau">Nouveau proche</button>`);
    if (proches.mode !== "lecture" && !proches.auteur && !proches.situations.length) boutons.push(`<button type="button" class="principal" id="act-ma-situation">Enregistrer ma situation</button>`);
    if (d && proches.mode !== "lecture") boutons.push(`<button type="button" class="lien" id="act-renommer">Renommer</button>`, `<button type="button" class="lien" id="act-supprimer">Supprimer</button>`);
    z.innerHTML = boutons.length ? `<div class="ligne-actions">${boutons.join("")}</div>` : "";
  }
  rendreEtatProfil();
}

$("#sel-profil").addEventListener("change", (e) => {
  const [col, ...reste] = e.target.value.split(":");
  if (col === "partage") return; // option d'affichage du scénario partagé : rien à charger
  if (profilModifie()) sauverProfilCourant();
  choisirProfil({ col, id: reste.join(":") });
});
$("#actions-proches").addEventListener("click", async (e) => {
  const id = e.target.id;
  const d = docCourant();
  if (id === "act-nouveau") proches.zone = { type: "nom", action: "nouveau", libelle: "Prénom du proche (le profil part de zéro)", bouton: "Créer" };
  else if (id === "act-ma-situation") proches.zone = { type: "nom", action: "situation", libelle: "Ton prénom, pour que l'auteur du plan te reconnaisse", bouton: "Enregistrer" };
  else if (id === "act-renommer") proches.zone = { type: "nom", action: "renommer", libelle: "Nouveau nom", bouton: "Renommer", valeur: d?.nom };
  else if (id === "act-supprimer") proches.zone = { type: "supprimer" };
  else if (id === "nom-annuler" || id === "suppr-non") proches.zone = null;
  else if (id === "suppr-oui" && d) {
    try {
      await effacerDoc(proches.courant.col, proches.courant.id);
      try { localStorage.removeItem(`chat-hist:${cle(proches.courant)}`); } catch { /* stockage indisponible */ } // l'historique de l'assistant suit le profil
      choisirProfil({ col: "exemple", id: "exemple" });
    }
    catch (err) { proches.statut = `Suppression impossible (${err?.code ?? "erreur"}).`; proches.zone = null; }
  } else if (id === "nom-ok") { await validerNom(); return; }
  else return;
  rendreProches();
});
$("#actions-proches").addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target.id === "nom-profil") { e.preventDefault(); validerNom(); } });

async function validerNom() {
  const nom = $("#nom-profil")?.value.trim();
  if (!nom) { $("#nom-profil")?.focus(); return; }
  const z = proches.zone; const maj = new Date().toISOString();
  try {
    if (z.action === "nouveau") {
      const id = nouvelId();
      await ecrireDoc("profils", id, { nom, profil: clone(PROFIL_VIDE), majLe: maj });
      if (!proches.liste.some((x) => x.id === id)) proches.liste.push({ id, nom, profil: clone(PROFIL_VIDE), majLe: maj });
      choisirProfil({ col: "profils", id });
    } else if (z.action === "situation") {
      const id = etat.db ? proches.moi : "moi";
      const profil = clone(etat.profil);
      await ecrireDoc("situations", id, { nom, profil, majLe: maj });
      if (!proches.situations.some((x) => x.id === id)) proches.situations.push({ id, nom, profil, majLe: maj });
      proches.courant = { col: "situations", id }; memo.set("profil-courant", proches.courant);
      proches.reference = fusion(PROFIL_VIDE, profil); proches.zone = null; proches.statut = "Enregistré"; rendreProches();
    } else if (z.action === "renommer") {
      const d = docCourant();
      await ecrireDoc(proches.courant.col, proches.courant.id, { nom, profil: clone(etat.profil), suivi: d?.suivi ?? null, majLe: maj });
      if (d) d.nom = nom; proches.reference = clone(etat.profil); proches.zone = null; rendreProches();
    }
  } catch (err) {
    proches.zone = null; proches.statut = `Action impossible (${err?.code ?? "erreur"}). Réessaie dans un instant.`; rendreProches();
  }
}

async function brancherProches(db, user, auteur) {
  if (!db) { proches.mode = "local"; proches.auteur = true; proches.pret = true; chargerLocal(); return; }
  proches.auteur = auteur;
  proches.moi = (await user?.id?.()) ?? null;
  proches.mode = auteur || proches.moi ? "partage" : "lecture";
  let attendus = auteur ? 2 : proches.moi ? 1 : 0;
  const pret = () => { if (--attendus <= 0) proches.pret = true; };
  if (attendus === 0) proches.pret = true;
  const surErreur = (err) => { proches.statut = `Profils enregistrés inaccessibles (${err.code}).`; pret(); rendreProches(); };
  if (auteur) {
    db.collection("profils").onSnapshot((qs) => { proches.liste = qs.docs.map((s) => ({ id: s.id, ...s.data() })); if (!qs.metadata.fromCache) pret(); apresChangementListes(); }, surErreur);
    db.collection("situations").onSnapshot((qs) => { proches.situations = qs.docs.map((s) => ({ id: s.id, ...s.data() })); if (!qs.metadata.fromCache) pret(); apresChangementListes(); }, surErreur);
  } else if (proches.moi) {
    db.doc(`situations/${proches.moi}`).onSnapshot((s) => { proches.situations = s.exists ? [{ id: s.id, ...s.data() }] : []; if (!s.metadata.fromCache) pret(); apresChangementListes(); }, surErreur);
  }
  rendreProches();
}

// ---------------------------------------------------------------- parcours « Découverte en 60 s »
// 5 questions → un nouveau profil « Découverte » pré-rempli avec des hypothèses prudentes (les autres profils ne sont jamais modifiés).
const OBJECTIFS_DECOUVERTE = [
  { id: "rp", libelle: "Acheter ma résidence principale", detail: "Le plan met de côté l'apport et vérifie si l'achat est finançable (prix de départ prudent, modifiable ensuite)." },
  { id: "epargne", libelle: "Faire fructifier mon épargne", detail: "Le plan répartit ton capital et ton épargne mensuelle selon ton âge et ton capital, sans projet particulier." },
  { id: "retraite", libelle: "Préparer ma retraite / mon indépendance financière", detail: "Le plan vise un revenu égal à tes dépenses actuelles, avec un départ à 60 ans si ton âge le permet ; la retraite publique est estimée automatiquement (modifiable dans l'onglet Retraite)." },
];
const ETAPES_DECOUVERTE = [
  { cle: "age", titre: "Quel âge as-tu ?", unite: "ans", min: 18, max: 80, pas: 1, aide: "Il sert à fixer la part de risque : plus on est jeune, plus le plan en accepte." },
  { cle: "salaireNetMensuel", titre: "Quel est ton salaire net mensuel ?", unite: "€ par mois", min: 1, max: 100000, pas: 50, aide: "Net après impôt si possible (même approximatif). Il sert à estimer tes dépenses, ton impôt et ce que la banque te prêterait." },
  { cle: "epargneMensuelle", titre: "Combien mets-tu de côté chaque mois ?", unite: "€ par mois", min: 0, max: 100000, pas: 50, aide: "Ce que tu peux épargner sans te priver. 0 est une réponse valable : le reste de ton salaire est compté comme dépenses." },
  { cle: "capital", titre: "Quel capital financier as-tu aujourd'hui ?", unite: "€", min: 0, max: 100000000, pas: 500, aide: "Livrets, placements, assurance-vie… hors immobilier. Il sera réparti prudemment : 6 mois de dépenses en livrets, le reste en PEA." },
  { cle: "objectif", titre: "Quel est ton objectif principal ?", choix: true },
];
const decouverte = { etape: 0, rep: {} };

function profilEstVierge(p) { return !(Number(p.salaireNetMensuel) > 0) && capitalDe(p) === 0; } // fonction (et non const) : appelée dès le premier rendu du profil
function majCtaDecouverte() { const el = $("#cta-decouverte"); if (el) el.hidden = !profilEstVierge(etat.profil); }

// Fonction pure : réponses → profil complet (hypothèses prudentes)
function profilDepuisDecouverte(r, aujourdhui = new Date()) {
  const p = clone(PROFIL_VIDE);
  const salaire = Math.max(0, Number(r.salaireNetMensuel) || 0);
  const epargne = Math.min(Math.max(0, Number(r.epargneMensuelle) || 0), salaire);
  const capital = Math.max(0, Number(r.capital) || 0);
  const depenses = Math.max(0, salaire - epargne);
  Object.assign(p, { age: Math.round(Number(r.age) || 30), salaireNetMensuel: salaire, epargneMensuelle: epargne, depensesMensuelles: depenses, statutPro: "stable", pays: "FR" });
  // Capital : 6 mois de dépenses en épargne de précaution (Livret A, puis LDDS), le reste en PEA (plafond de versements 150 000 €, puis compte-titres)
  p.placements = repartirCapitalPrudent(PLAN, capital, depenses);
  const pea = p.placements.pea;
  if (pea > 0) p.pea = { ouvert: true, dateOuverture: `${aujourdhui.getFullYear()}-${String(aujourdhui.getMonth() + 1).padStart(2, "0")}`, versements: pea, etablissement: "" };
  if (r.objectif === "rp") {
    p.loyerMensuel = Math.round((0.28 * salaire) / 10) * 10;
    Object.assign(p.projetRP, { actif: true, prix: Math.max(100000, Math.round((80 * salaire) / 5000) * 5000), type: "ancien", imperatif: false, horizonAnnees: 5 });
  } else if (r.objectif === "retraite") {
    p.retraite = { revenu: Math.max(1000, Math.round(depenses / 50) * 50), ageDepart: p.age < 59 ? 60 : null };
  }
  return p;
}

function rendreDecouverte() {
  const E = ETAPES_DECOUVERTE[decouverte.etape], n = ETAPES_DECOUVERTE.length, derniere = decouverte.etape === n - 1;
  $("#decouverte-progres").innerHTML = ETAPES_DECOUVERTE.map((_, i) => `<span class="${i <= decouverte.etape ? "fait" : ""}"></span>`).join("");
  let corps = `<p class="small muted" style="margin:0">Question ${decouverte.etape + 1} sur ${n}</p><h3>${echapper(E.titre)}</h3>`;
  if (E.choix) {
    corps += `<div class="dec-choix" role="radiogroup" aria-label="${echapper(E.titre)}">${OBJECTIFS_DECOUVERTE.map((o) => `<label><input type="radio" name="dec-objectif" value="${o.id}"${decouverte.rep.objectif === o.id ? " checked" : ""}><span><b>${echapper(o.libelle)}</b><br><span class="small muted">${echapper(o.detail)}</span></span></label>`).join("")}</div>`;
  } else {
    const v = decouverte.rep[E.cle];
    corps += `<div><label for="dec-champ" class="small muted">${echapper(E.unite)}</label><input id="dec-champ" type="number" inputmode="decimal" min="${E.min}" max="${E.max}" step="${E.pas}" value="${v ?? ""}" placeholder="0"></div><p class="note" style="margin:0">${echapper(E.aide)}</p>`;
  }
  corps += `<p class="dec-erreur" id="dec-erreur" role="alert"></p>`;
  $("#decouverte-corps").innerHTML = corps;
  $("#decouverte-retour").style.visibility = decouverte.etape === 0 ? "hidden" : "visible";
  $("#decouverte-suivant").textContent = derniere ? "Voir mon plan ✓" : "Suivant →";
  setTimeout(() => ($("#dec-champ") ?? $("#decouverte-corps input:checked") ?? $("#decouverte-corps input"))?.focus(), 0);
}

// Lit et contrôle la réponse de l'étape courante ; renvoie un message d'erreur ou null
function lireEtapeDecouverte() {
  const E = ETAPES_DECOUVERTE[decouverte.etape];
  if (E.choix) {
    const v = $("#decouverte-corps input:checked")?.value;
    if (!v) return "Choisis un objectif pour continuer.";
    decouverte.rep.objectif = v; return null;
  }
  const brut = $("#dec-champ").value.trim().replace(",", ".");
  if (brut === "" || !Number.isFinite(Number(brut))) return "Indique un nombre.";
  const v = Number(brut);
  if (v < E.min || v > E.max) return `Indique une valeur entre ${E.min.toLocaleString("fr-FR")} et ${E.max.toLocaleString("fr-FR")}.`;
  if (E.cle === "epargneMensuelle" && v > decouverte.rep.salaireNetMensuel) return "Ton épargne mensuelle ne peut pas dépasser ton salaire.";
  decouverte.rep[E.cle] = E.cle === "age" ? Math.round(v) : v;
  return null;
}

function ouvrirDecouverte() {
  decouverte.etape = 0; decouverte.rep = {};
  rendreDecouverte();
  const d = $("#decouverte");
  if (typeof d.showModal === "function") { if (!d.open) d.showModal(); } else d.setAttribute("open", "");
}
const fermerDecouverte = () => { const d = $("#decouverte"); if (typeof d.close === "function") d.close(); else d.removeAttribute("open"); };

async function validerDecouverte() {
  const p = profilDepuisDecouverte(decouverte.rep);
  const premierChoix = !NIVEAUX.includes(memo.get("niveau")); // niveau jamais choisi : la Découverte vaut choix du niveau Débutant
  let message;
  if (proches.auteur && proches.mode !== "lecture") {
    if (profilModifie()) sauverProfilCourant(); // les modifications en cours du profil actuel sont enregistrées avant de le quitter
    let nom = "Découverte", i = 2;
    while (proches.liste.some((x) => x.nom === nom)) nom = `Découverte ${i++}`;
    const id = nouvelId(), maj = new Date().toISOString();
    try {
      await ecrireDoc("profils", id, { nom, profil: clone(p), majLe: maj });
      if (!proches.liste.some((x) => x.id === id)) proches.liste.push({ id, nom, profil: clone(p), majLe: maj });
      choisirProfil({ col: "profils", id });
      message = `Profil « ${nom} » créé : tes autres profils n'ont pas changé. Ajuste-le dans « ${libelleOnglet("profil", premierChoix ? "debutant" : niveauCourant())} ».`;
    } catch (err) {
      $("#dec-erreur").textContent = `Création impossible (${err?.code ?? "erreur"}). Réessaie dans un instant.`;
      return;
    }
  } else {
    // Pas de sauvegarde possible (mode lecture) : on passe par le profil Exemple, qui n'est jamais enregistré
    choisirProfil({ col: "exemple", id: "exemple" });
    chargerDansFormulaire(p);
    message = "Profil de découverte chargé, non enregistré : il disparaîtra si tu changes de profil.";
  }
  if (premierChoix) {
    appliquerNiveau("debutant");
    message += " Tu es en mode Débutant : change de niveau à tout moment en haut de la page.";
  }
  proches.statut = message; rendreEtatProfil();
  fermerDecouverte();
  if (location.hash === "#reequilibrage") rendreVue(); else location.hash = "#reequilibrage";
}

$("#decouverte-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const erreur = lireEtapeDecouverte();
  if (erreur) { $("#dec-erreur").textContent = erreur; return; }
  if (decouverte.etape < ETAPES_DECOUVERTE.length - 1) { decouverte.etape++; rendreDecouverte(); }
  else validerDecouverte();
});
$("#decouverte-retour").addEventListener("click", () => {
  const E = ETAPES_DECOUVERTE[decouverte.etape];
  if (!E.choix) { const v = $("#dec-champ").value.trim().replace(",", "."); if (v !== "" && Number.isFinite(Number(v))) decouverte.rep[E.cle] = Number(v); } // garde la saisie en cours
  if (decouverte.etape > 0) { decouverte.etape--; rendreDecouverte(); }
});
$("#decouverte-fermer").addEventListener("click", fermerDecouverte);
$("#decouverte").addEventListener("click", (e) => { if (e.target.id === "decouverte") fermerDecouverte(); }); // clic sur le fond
$("#btn-decouverte").addEventListener("click", ouvrirDecouverte);
$("#cta-decouverte-bouton").addEventListener("click", ouvrirDecouverte);

// ---------------------------------------------------------------- calendrier des échéances
const calendrier = { vue: "profil", complet: false, message: "" };
const LIB_TYPE = { action: "À faire", fiscal: "Fiscalité", projet: "Projet", suivi: "Suivi", marche: "Marché" };

function evenementsCalendrier() {
  const plan = etat.brouillon;
  let ev = [];
  if (calendrier.vue === "tous" && proches.auteur) {
    for (const d of [...proches.liste, ...proches.situations]) {
      try {
        const p = normaliserProfil(fusion(PROFIL_VIDE, d.profil));
        ev.push(...echeancesProfil(plan, p, { releves: d.suivi?.releves ?? [] }).map((e) => ({ ...e, qui: d.nom })));
      } catch (err) { console.error(err); }
    }
  } else {
    const { suivi } = suiviCourant();
    ev.push(...echeancesProfil(plan, profilPourMoteur(), { releves: suivi?.releves ?? [] }));
  }
  ev.push(...echeancesGenerales(plan));
  return ev.sort((a, b) => a.date - b.date || (a.qui ?? "").localeCompare(b.qui ?? ""));
}

function blocCalendrier() {
  let ev;
  try { ev = evenementsCalendrier(); } catch (e) { console.error(e); return `<section class="panneau"><h2>Prochaines échéances</h2><div class="erreur">Calendrier indisponible : ${echapper(e.message)}.</div></section>`; }
  const visibles = calendrier.complet ? ev : ev.slice(0, 8);
  const parAnnee = new Map();
  for (const e of visibles) { const a = e.date.getFullYear(); if (!parAnnee.has(a)) parAnnee.set(a, []); parAnnee.get(a).push(e); }
  const quand = (e) => (e.approx ? `vers ${e.date.toLocaleDateString("fr-FR", { month: "short", year: "numeric" })}` : e.date.toLocaleDateString("fr-FR", { month: "long", year: "numeric" }));
  const liste = [...parAnnee].map(([annee, es]) => `<h3 class="annee">${annee}</h3><ul class="echeances">${es.map((e) => `<li>
      <span class="quand num">${quand(e)}</span>
      <div><span class="etiquette ${e.type}">${LIB_TYPE[e.type] ?? ""}</span> <b>${echapper(e.titre)}</b>${e.qui ? ` <span class="qui">${echapper(e.qui)}</span>` : ""}
        <div class="note">${echapper(e.detail)}${e.fiche ? ` ${lienFiche(e.fiche)}` : ""}</div></div></li>`).join("")}</ul>`).join("");
  const choix = proches.auteur && proches.liste.length + proches.situations.length > 0
    ? `<label for="cal-vue" class="small">Afficher</label><select id="cal-vue" style="width:auto"><option value="profil" ${calendrier.vue === "profil" ? "selected" : ""}>Ce profil</option><option value="tous" ${calendrier.vue === "tous" ? "selected" : ""}>Tous mes proches</option></select>` : "";
  const exporter = `<button type="button" id="cal-export">Exporter pour un agenda (CSV)</button>`;
  return `<section class="panneau"><h2>Prochaines échéances</h2>
    <p class="note" style="margin:4px 0 10px">Dates clés des ${etat.brouillon.calendrier?.horizonAnnees ?? 15} prochaines années. « Vers » : date estimée à partir de l'âge.</p>
    ${choix || exporter ? `<div class="ligne-actions" style="margin-bottom:8px">${choix}${exporter}</div>` : ""}
    ${calendrier.message ? `<p class="small" style="margin:0 0 8px">${echapper(calendrier.message)}</p>` : ""}
    ${liste || '<p class="muted small">Aucune échéance à venir.</p>'}
    ${ev.length > 8 ? `<button type="button" class="lien" id="cal-tout">${calendrier.complet ? "Afficher moins" : `Voir les ${ev.length} échéances`}</button>` : ""}
  </section>`;
}

$("#suivi").addEventListener("change", (e) => { if (e.target.id === "cal-vue") { calendrier.vue = e.target.value; calendrier.message = ""; rendreSuivi(); } });
$("#suivi").addEventListener("click", async (e) => {
  if (e.target.id === "cal-tout") { calendrier.complet = !calendrier.complet; rendreSuivi(); }
  if (e.target.id === "cal-export") {
    try {
      await telechargerFichier("echeances-plan-patrimoine.csv", new Blob(["﻿" + versCSV(evenementsCalendrier())], { type: "text/csv" }));
      calendrier.message = "Fichier enregistré. Dans Google Agenda : Paramètres > Importer et exporter > Importer ; dans Outlook : Fichier > Ouvrir et exporter > Importer.";
    } catch (err) {
      calendrier.message = err?.code === "declined" ? "Export annulé." : `Export impossible ici (${err?.code ?? "erreur"}).`;
    }
    rendreSuivi();
  }
});

// ---------------------------------------------------------------- suivi dans le temps
// Stocké dans le document du profil : suivi = { reference: { date, points }, releves: [{ date, placements, total }] }
const moisCourant = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; };
const ajouterMois = (a, n) => { const [y, m] = a.split("-").map(Number); const t = y * 12 + (m - 1) + n; return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`; };
const libMois = (a) => { const [y, m] = a.split("-").map(Number); return new Date(y, m - 1, 1).toLocaleDateString("fr-FR", { month: "short", year: "numeric" }); };
const totalPlacements = (pl) => Object.values(pl ?? {}).reduce((s, x) => s + (Number(x) || 0), 0);

// Familles de comptes pour le graphique « évolution par compte »
const FAMILLES = [
  { nom: "Livrets et PEL", comptes: ["livretA", "ldds", "lep", "livretJeune", "livretBancaire", "pel"], couleur: "--s6" },
  { nom: "Assurance-vie", comptes: ["assuranceVie", "assuranceVieUC"], couleur: "--s7" },
  { nom: "Bourse (PEA, CTO)", comptes: ["pea", "cto"], couleur: "--s1" },
  { nom: "PER", comptes: ["per"], couleur: "--s5" },
  { nom: "SCPI", comptes: ["scpi"], couleur: "--s3" },
  { nom: "Or", comptes: ["orPhysique"], couleur: "--s4" },
  { nom: "Bitcoin", comptes: ["plateformeCrypto", "coldWallet"], couleur: "--s2" },
];
function familleDe(id) { return FAMILLES.find((f) => f.comptes.includes(id)) ?? { nom: "Autres comptes", couleur: "--faint" }; }
function parFamille(placements) {
  const out = new Map();
  for (const [id, v] of Object.entries(placements ?? {})) {
    const f = familleDe(id); out.set(f.nom, (out.get(f.nom) ?? 0) + (Number(v) || 0));
  }
  return out;
}

// Relevés de test : profil « Exemple », ou profil qu'on ne peut pas enregistrer.
// Gardés en mémoire le temps de la visite, jamais enregistrés.
const suivisTest = new Map();
const RISQUES = new Set(["pea", "cto", "assuranceVieUC", "per", "plateformeCrypto", "coldWallet", "orPhysique", "scpi"]);
function genererSuiviExemple() {
  // 12 mois de relevés fictifs, tous les 2 mois, qui finissent sur les montants du profil
  const fin = clone(etat.profil.placements ?? {});
  const debut = ajouterMois(moisCourant(), -12);
  const releves = [];
  for (let k = 0; k <= 6; k++) {
    const t = k / 6;
    const placements = Object.fromEntries(Object.entries(fin).map(([e, v], i) => {
      const bruit = RISQUES.has(e) && k < 6 ? 0.07 * Math.sin(k * 1.3 + i) : 0;
      return [e, Math.round((Number(v) || 0) * (0.74 + 0.26 * t) * (1 + bruit))];
    }));
    releves.push({ date: ajouterMois(debut, 2 * k), placements, total: totalPlacements(placements) });
  }
  return { reference: { date: debut, points: referenceDepuis(releves[0].placements), exemple: true }, releves };
}

function suiviCourant() {
  const k = cle(proches.courant);
  if (proches.courant.col === "exemple") {
    if (!suivisTest.has(k)) suivisTest.set(k, genererSuiviExemple());
    return { suivi: suivisTest.get(k), test: true, exemple: true, doc: null };
  }
  const d = docCourant();
  if (d && proches.mode !== "lecture") return { suivi: d.suivi ?? null, test: false, exemple: false, doc: d };
  return { suivi: suivisTest.get(k) ?? null, test: true, exemple: false, doc: d };
}

async function ecrireSuivi(d, suivi) {
  d.suivi = suivi;
  const profil = clone(etat.profil);
  await ecrireDoc(proches.courant.col, proches.courant.id, { nom: d.nom, profil, suivi, majLe: new Date().toISOString() });
  proches.reference = profil;
}

function referenceDepuis(placements) {
  return referenceSuivi(etat.brouillon, { ...profilPourMoteur(), placements: clone(placements) });
}

let messageSuivi = "";
let tousLesComptes = false;
let brouillonReleve = null;
let moisReleve = null; // montants en cours de saisie dans « Noter un relevé »
let brouillonPRU = null; // capital versé (et solde du PEA-PME) lus dans un fichier importé, en attente du relevé
let importFichier = null; // { nom, resultat } : fichier CSV / Excel lu, en attente de validation par l'utilisateur
let minuterieApercu = null;

// Montants du profil, remplacés par ceux du brouillon de relevé en cours de saisie
function placementsBrouillon() {
  const p = { ...clone(etat.profil.placements ?? {}), ...(brouillonReleve ?? {}) };
  for (const k of Object.keys(p)) p[k] = Math.max(0, Number(p[k]) || 0);
  return p;
}
function aBrouillon() {
  const base = etat.profil.placements ?? {};
  return Object.entries(brouillonReleve ?? {}).some(([k, v]) => !(Math.abs((Number(v) || 0) - (Number(base[k]) || 0)) <= 0.5));
}

function appliquerPlacements(placements) {
  etat.profil.placements = clone(placements);
  memo.set("profil-v2", etat.profil);
  remplirProfil();
  rendreResultats();
  planifierTrajectoire();
}

async function actionSuivi(e) {
  const t = e.target;
  if (t.id === "releve-tous") { tousLesComptes = !tousLesComptes; rendreSuivi(); return; }
  if (t.id === "btn-exemple-reset") {
    etat.profil.placements = clone(PROFIL_EXEMPLE.placements);
    suivisTest.delete(cle(proches.courant));
    brouillonReleve = null; brouillonPRU = null; importFichier = null;
    appliquerPlacements(etat.profil.placements);
    messageSuivi = "Exemple remis à zéro.";
    rendreSuivi(); return;
  }
  if (t.id === "btn-fichier-annuler") { importFichier = null; messageSuivi = ""; rendreSuivi(); return; }
  if (t.id === "btn-fichier-ok") {
    if (!importFichier) return;
    const { montants, pru } = releveDepuisImport(importFichier.resultat.comptes);
    brouillonReleve = { ...(brouillonReleve ?? {}), ...montants };
    brouillonPRU = { ...(brouillonPRU ?? {}), ...pru };
    if (montants.pea !== undefined && !pru.peaPme) delete brouillonPRU.peaPme; // le solde du PEA importé ne contient plus de PEA-PME
    if (Object.keys(montants).some((k) => !((Number(etat.profil.placements?.[k]) || 0) > 0))) tousLesComptes = true;
    messageSuivi = `${Object.keys(montants).length} compte(s) rempli(s) depuis le fichier${Object.keys(pru).length ? " (capital versé inclus)" : ""}. Vérifie l'aperçu ci-dessous puis note le relevé.`;
    importFichier = null;
    rendreSuivi(); return;
  }
  if (t.id === "btn-coller") {
    const r = lireReleveColle($("#releve-colle")?.value ?? "");
    brouillonReleve = { ...(brouillonReleve ?? {}), ...r.montants };
    if (Object.keys(r.montants).some((k) => !((Number(etat.profil.placements?.[k]) || 0) > 0))) tousLesComptes = true;
    messageSuivi = Object.keys(r.montants).length
      ? `${Object.keys(r.montants).length} compte(s) rempli(s) : ${Object.entries(r.montants).map(([k, v]) => `${etat.brouillon.enveloppes[k]?.libelle ?? k} ${eur(v)}`).join(", ")}.${r.ignores.length ? ` Lignes non reconnues : ${r.ignores.slice(0, 5).join(" ; ")}${r.ignores.length > 5 ? "…" : ""}.` : ""} Vérifie l'aperçu ci-dessous puis note le relevé.`
      : "Aucune ligne reconnue. Écris une ligne par compte : le nom du compte puis le montant (ex. « Livret A ; 12 345,67 »).";
    rendreSuivi(); return;
  }
  const { suivi: actuel, test, doc: d } = suiviCourant();
  const suivi = clone(actuel ?? { releves: [] });
  try {
    if (t.id === "btn-releve") {
      const date = $("#suivi-mois").value || moisCourant();
      const placements = placementsBrouillon();
      const plusRecent = !suivi.releves.some((r) => r.date > date);
      const note = ($("#releve-note")?.value ?? "").trim().slice(0, 140);
      const pru = {};
      for (const id of COMPTES_PRU) {
        const e = brouillonPRU?.[id]; if (!e) continue;
        const entree = {};
        if (Number.isFinite(e.verse) && e.verse >= 0) entree.verse = e.verse;
        if (id === "peaPme" && Number.isFinite(e.solde) && e.solde >= 0) entree.solde = Math.min(e.solde, placements.pea ?? 0);
        if (Object.keys(entree).length) pru[id] = entree;
      }
      suivi.releves = suivi.releves.filter((r) => r.date !== date).concat([{ date, placements, total: totalPlacements(placements), ...(Object.keys(pru).length ? { pru } : {}), ...(note ? { note } : {}) }]).sort((a, b) => a.date.localeCompare(b.date));
      if (!suivi.reference) suivi.reference = { date: suivi.releves[0].date, points: referenceDepuis(suivi.releves[0].placements) };
      brouillonReleve = null; moisReleve = null; brouillonPRU = null; importFichier = null;
      if (plusRecent) appliquerPlacements(placements);
      messageSuivi = `Relevé de ${libMois(date)} noté${test ? " (test, non enregistré)" : ""}.${plusRecent ? " Tes montants de « Mon profil » sont mis à jour : les versements du mois prochain sont recalculés ci-dessous." : ""}`;
    } else if (t.dataset.supprReleve) {
      suivi.releves = suivi.releves.filter((r) => r.date !== t.dataset.supprReleve);
      if (!suivi.releves.length) suivi.reference = null;
      messageSuivi = "Relevé supprimé.";
    } else if (t.id === "btn-recaler") {
      const der = suivi.releves[suivi.releves.length - 1];
      if (!der) return;
      suivi.reference = { date: der.date, points: referenceDepuis(der.placements) };
      messageSuivi = `Prévision recalée sur ${libMois(der.date)} avec le plan actuel.`;
    } else return;
    if (test) suivisTest.set(cle(proches.courant), suivi);
    else await ecrireSuivi(d, suivi);
  } catch (err) {
    messageSuivi = `Enregistrement impossible (${err?.code ?? "erreur"}). Réessaie dans un instant.`;
  }
  rendreSuivi();
}

$("#suivi").addEventListener("change", (e) => { if (e.target.id === "suivi-mois") { moisReleve = e.target.value || null; planifierApercuSuivi(); } });

// Import d'un fichier CSV / Excel : lu dans le navigateur (FileReader), 2 Mo maximum, jamais envoyé au serveur
async function lireFichierDepose(fichier) {
  if (!fichier) return;
  importFichier = null;
  try {
    if (fichier.size > TAILLE_MAX_FICHIER) throw new Error(`Fichier trop volumineux (${(fichier.size / 1048576).toFixed(1).replace(".", ",")} Mo) : 2 Mo maximum.`);
    const buffer = await new Promise((ok, ko) => {
      const lecteur = new FileReader();
      lecteur.onload = () => ok(lecteur.result);
      lecteur.onerror = () => ko(new Error("Lecture du fichier impossible."));
      lecteur.readAsArrayBuffer(fichier);
    });
    importFichier = { nom: String(fichier.name).slice(0, 120), resultat: await lireFichierReleve(fichier.name, new Uint8Array(buffer)) };
    messageSuivi = "";
  } catch (err) {
    messageSuivi = err instanceof Error && err.message ? err.message : "Fichier illisible.";
  }
  rendreSuivi();
}
$("#suivi").addEventListener("change", (e) => {
  if (e.target.id !== "releve-fichier") return;
  const fichier = e.target.files?.[0];
  e.target.value = "";
  lireFichierDepose(fichier);
});
const zoneDepot = (e) => e.target.closest?.("#depot-releve");
$("#suivi").addEventListener("dragover", (e) => { const z = zoneDepot(e); if (z) { e.preventDefault(); z.classList.add("survol"); } });
$("#suivi").addEventListener("dragleave", (e) => zoneDepot(e)?.classList.remove("survol"));
$("#suivi").addEventListener("drop", (e) => {
  const z = zoneDepot(e); if (!z) return;
  e.preventDefault(); z.classList.remove("survol");
  lireFichierDepose(e.dataTransfer?.files?.[0]);
});
// Un fichier lâché à côté de la zone ferait quitter l'appli : on l'ignore sur l'onglet Suivi
for (const ev of ["dragover", "drop"]) window.addEventListener(ev, (e) => { if (!$("#vue-suivi").hidden && e.dataTransfer?.types?.includes("Files") && !zoneDepot(e)) e.preventDefault(); });

// Aperçu du fichier lu : construit en DOM avec textContent (les libellés viennent du fichier, jamais d'innerHTML)
function monterApercuImport() {
  const cible = $("#import-apercu"); if (!cible) return;
  cible.replaceChildren();
  if (!importFichier) return;
  const { nom, resultat: r } = importFichier;
  const el = (balise, texte, classe) => { const n = document.createElement(balise); if (texte != null) n.textContent = texte; if (classe) n.className = classe; return n; };
  cible.append(el("p", `Fichier lu : ${nom}`, "small"));
  cible.append(el("p", `Colonnes ${r.devine ? "devinées (aucun en-tête reconnu)" : "détectées"} : libellé « ${r.colonnes.libelle} », solde « ${r.colonnes.solde} », ${r.colonnes.verse ? `versements cumulés « ${r.colonnes.verse} »` : "pas de colonne de versements cumulés (le capital versé sera estimé)"}.`, "small muted"));
  const ids = Object.keys(r.comptes);
  if (ids.length) {
    const table = el("table"), tete = el("tr"), corps = el("tbody");
    for (const [titre, classe] of [["Compte reconnu"], ["Solde", "m"], ["Capital versé", "m"]]) tete.append(el("th", titre, classe));
    table.append(el("thead")); table.firstChild.append(tete);
    for (const id of ids) {
      const ligne = el("tr");
      ligne.append(el("td", id === "peaPme" ? "PEA-PME" : (etat.brouillon.enveloppes[id]?.libelle ?? id)));
      ligne.append(el("td", eur(r.comptes[id].solde), "m"));
      ligne.append(el("td", r.comptes[id].verse == null ? "—" : eur(r.comptes[id].verse), "m"));
      corps.append(ligne);
    }
    table.append(corps);
    const enveloppe = el("div", null, "table-wrap"); enveloppe.append(table); cible.append(enveloppe);
  } else cible.append(el("p", "Aucun compte reconnu dans ce fichier : vérifie que les libellés contiennent le nom du compte (PEA, compte-titres, assurance vie, PER…).", "small"));
  if (r.ignores.length) {
    const detail = el("details"), liste = el("ul", null, "small muted");
    detail.append(el("summary", `${r.ignores.length}${r.ignores.length >= 50 ? " ou plus" : ""} ligne(s) non reconnue(s), ignorée(s)`, "small"));
    for (const l of r.ignores.slice(0, 8)) liste.append(el("li", l.slice(0, 80)));
    detail.append(liste); cible.append(detail);
  }
  const actions = el("div", null, "ligne-actions");
  if (ids.length) { const ok = el("button", "Utiliser ces montants", "principal"); ok.type = "button"; ok.id = "btn-fichier-ok"; actions.append(ok); }
  const annuler = el("button", "Annuler", "lien"); annuler.type = "button"; annuler.id = "btn-fichier-annuler"; actions.append(annuler);
  cible.append(actions);
}
$("#suivi").addEventListener("input", (e) => {
  const id = e.target.dataset?.releve; if (!id) return;
  brouillonReleve ??= {};
  brouillonReleve[id] = e.target.value === "" ? 0 : Number(e.target.value);
  const total = totalPlacements({ ...(etat.profil.placements ?? {}), ...brouillonReleve });
  const el = $("#releve-total"); if (el) el.textContent = eur(total);
  planifierApercuSuivi();
});

function planifierApercuSuivi() {
  clearTimeout(minuterieApercu);
  minuterieApercu = setTimeout(() => {
    const a = $("#releve-apercu"); if (a) a.innerHTML = htmlApercuReleve();
    const m = $("#suivi-mois-prochain"); if (m) m.innerHTML = htmlMoisProchain();
  }, 400);
}

function graphiqueSuivi(ref, releves) {
  const { W, H, g, d, h, b } = GEOM;
  const dernier = releves.length ? moisEntre(ref.date, releves[releves.length - 1].date) : 0;
  const N = Math.max(12, Math.min((ref.points.length - 1) * 12, Math.ceil((dernier + 12) / 6) * 6));
  const prev = Array.from({ length: N + 1 }, (_, m) => prevuA(ref, m));
  const pts = releves.map((r) => ({ m: moisEntre(ref.date, r.date), v: r.total, date: r.date, note: r.note })).filter((p) => p.m >= 0 && p.m <= N);
  const ymax = echelle(Math.max(...prev.map((p) => p?.p90 ?? 0), ...pts.map((p) => p.v)));
  const x = (m) => g + (m * (W - g - d)) / N;
  const y = (v) => H - b - (Math.max(0, v) * (H - b - h)) / ymax;
  let svg = `<svg class="graphe" viewBox="0 0 ${W} ${H}" role="img" aria-label="Placements réels comparés à la prévision">`;
  for (let k = 0; k <= 4; k++) { const v = (ymax * k) / 4; svg += `<line class="grille-l" x1="${g}" x2="${W - d}" y1="${y(v)}" y2="${y(v)}"/><text x="${g - 8}" y="${y(v) + 4}" text-anchor="end">${keur(v)}</text>`; }
  const pasX = N <= 24 ? 3 : N <= 60 ? 6 : 12;
  for (let m = 0; m <= N; m += pasX) svg += `<text x="${x(m)}" y="${H - 9}" text-anchor="middle">${libMois(ajouterMois(ref.date, m))}</text>`;
  svg += `<line class="axe" x1="${g}" x2="${W - d}" y1="${H - b}" y2="${H - b}"/>`;
  const bande = prev.map((p, m) => `${x(m).toFixed(1)},${y(p.p90).toFixed(1)}`).concat(prev.map((p, m) => `${x(m).toFixed(1)},${y(p.p10).toFixed(1)}`).reverse()).join(" ");
  svg += `<polygon points="${bande}" fill="var(--s1)" fill-opacity="0.13"/>`;
  svg += `<path d="${prev.map((p, m) => `${m ? "L" : "M"}${x(m).toFixed(1)},${y(p.c).toFixed(1)}`).join("")}" fill="none" stroke="var(--muted)" stroke-width="1.5" stroke-dasharray="5 4"/>`;
  if (pts.length > 1) svg += `<path d="${pts.map((p, i) => `${i ? "L" : "M"}${x(p.m).toFixed(1)},${y(p.v).toFixed(1)}`).join("")}" fill="none" stroke="var(--s2)" stroke-width="2" stroke-linejoin="round"/>`;
  for (const p of pts) svg += `<circle cx="${x(p.m)}" cy="${y(p.v)}" r="4.5" fill="var(--s2)" stroke="var(--surface)" stroke-width="2"/>${p.note ? `<text x="${x(p.m)}" y="${y(p.v) - 10}" text-anchor="middle" font-size="12" fill="var(--warn)">✎</text>` : ""}`;
  svg += colonnesSurvol(Array.from({ length: N + 1 }, (_, m) => m), x, (m) => {
    const p = prev[m], r = pts.find((q) => q.m === m);
    return `${libMois(ajouterMois(ref.date, m))}\n${r ? `Relevé : ${eur(r.v)}\n${r.note ? `Note : ${r.note}\n` : ""}` : ""}Prévu (central) : ${eur(p.c)}\nFourchette : ${eur(p.p10)} – ${eur(p.p90)}`;
  }, "curseur-suivi");
  svg += `</svg>`;
  return svg + `<div class="legende-g"><span><span class="pastille" style="background:var(--s2);border-radius:50%"></span>Tes relevés</span><span><span class="trait" style="background:var(--muted)"></span>Prévision du plan (pointillés)</span><span><span class="pastille" style="background:var(--s1);opacity:.35"></span>Fourchette normale : 8 scénarios sur 10</span></div>`;
}

// Barres empilées : chaque relevé, découpé par famille de comptes
function graphiqueComptes(releves) {
  const liste = releves.slice(-12);
  const { W, H, g, d, h, b } = GEOM;
  const familles = [...FAMILLES, { nom: "Autres comptes", couleur: "--faint" }].filter((f) => liste.some((r) => (parFamille(r.placements).get(f.nom) ?? 0) > 0.5));
  const ymax = echelle(Math.max(...liste.map((r) => r.total), 1));
  const pas = (W - g - d) / liste.length;
  const larg = Math.min(46, pas * 0.62);
  const y = (v) => H - b - (v * (H - b - h)) / ymax;
  let svg = `<svg class="graphe" viewBox="0 0 ${W} ${H}" role="img" aria-label="Montant de chaque famille de comptes à chaque relevé">`;
  for (let k = 0; k <= 4; k++) { const v = (ymax * k) / 4; svg += `<line class="grille-l" x1="${g}" x2="${W - d}" y1="${y(v)}" y2="${y(v)}"/><text x="${g - 8}" y="${y(v) + 4}" text-anchor="end">${keur(v)}</text>`; }
  liste.forEach((r, i) => {
    const cx = g + pas * (i + 0.5), x0 = cx - larg / 2;
    const pf = parFamille(r.placements);
    let cumul = 0;
    for (const f of familles) {
      const v = pf.get(f.nom) ?? 0; if (v <= 0.5) continue;
      const y1 = y(cumul + v), y0 = y(cumul);
      const haut = Math.max(0, y0 - y1 - 2);
      if (haut > 0) svg += `<rect x="${x0.toFixed(1)}" y="${(y1).toFixed(1)}" width="${larg.toFixed(1)}" height="${haut.toFixed(1)}" rx="2" fill="var(${f.couleur})"/>`;
      cumul += v;
    }
    if (liste.length <= 8 || (liste.length - 1 - i) % 2 === 0) svg += `<text x="${cx}" y="${H - 9}" text-anchor="middle">${libMois(r.date)}</text>`;
    const detail = familles.map((f) => [f.nom, pf.get(f.nom) ?? 0]).filter(([, v]) => v > 0.5).map(([n, v]) => `${n} : ${eur(v)}`).join("\n");
    svg += `<rect x="${(cx - pas / 2).toFixed(1)}" y="${h}" width="${pas.toFixed(1)}" height="${H - b - h}" fill="transparent" data-bulle="${echapper(`${libMois(r.date)} · total ${eur(r.total)}\n${detail}`)}"/>`;
  });
  svg += `<line class="axe" x1="${g}" x2="${W - d}" y1="${H - b}" y2="${H - b}"/></svg>`;
  return svg + `<div class="legende-g">${familles.map((f) => `<span><span class="pastille" style="background:var(${f.couleur})"></span>${f.nom}</span>`).join("")}</div>`;
}

function resultatSuivi() {
  let res = etat.resultat;
  try { if (etat.futur) res = analyser(etat.brouillon, profilPourMoteur()); } catch (e) { console.error(e); }
  return res;
}

function htmlApercuReleve() {
  if (!aBrouillon()) return "";
  const c = comparerReleve(etat.profil.placements ?? {}, placementsBrouillon());
  const lib = (id) => echapper(etat.brouillon.enveloppes[id]?.libelle ?? id);
  const signe = c.ecartTotal < 0 ? "−" : "+";
  let h = `<p class="small" style="margin:10px 0 4px"><b>Ce relevé change ${c.nbChanges} compte(s)</b> : total ${eur(c.totalAvant)} → <b class="num">${eur(c.totalApres)}</b> (${signe}${eur(Math.abs(c.ecartTotal))}).</p>`;
  if (c.nbAVerifier) h += `<ul class="small" style="margin:0 0 4px">${c.lignes.filter((l) => l.aVerifier).map((l) => `<li><span class="niveau alerte">À vérifier</span> ${lib(l.id)} : ${eur(l.avant)} → ${eur(l.apres)} (${echapper(l.motif)})</li>`).join("")}</ul>`;
  return h + `<p class="note" style="margin:0">Les virements et achats d'ETF recalculés sur ces montants sont plus bas, dans « Si tu notes ce relevé ».</p>`;
}

function htmlMoisProchain() {
  const plan = etat.brouillon;
  const env = (id) => plan.enveloppes[id]?.libelle ?? id;
  const releves = suiviCourant().suivi?.releves ?? [];
  let res = null, provisoire = false;
  // Un relevé daté avant le dernier ne met pas à jour le profil : pas d'aperçu des virements dans ce cas
  const moisSaisi = moisReleve ?? moisCourant();
  if (aBrouillon() && !releves.some((r) => r.date > moisSaisi)) {
    try { res = analyser(plan, { ...profilPourMoteur(), placements: placementsBrouillon() }); provisoire = true; } catch (e) { console.error(e); return ""; }
  } else {
    res = resultatSuivi();
    if (!res || !releves.length) return "";
  }
  const mvts = res.mouvements;
  const libMvt = (m) => m.sens === "arbitrage" ? `${m.transfert ? "Transférer de" : "Arbitrer de"} ${env(m.enveloppe)} vers ${env(m.vers)}` : `${m.sens === "retrait" ? (m.annuel ? "Vendre une fois cette année sur" : "Retirer de") : "Verser sur"} ${env(m.enveloppe)}`;
  const titre = provisoire ? `Si tu notes ce relevé · ${eur(res.profil.epargneMensuelle)} à répartir` : `Le mois prochain · ${eur(res.profil.epargneMensuelle)} à répartir`;
  const note = provisoire ? "Calculé sur les montants saisis ci-dessus, relevé pas encore noté : virements du mois et achats d'ETF qui en découlent." : "D'après ton dernier relevé, voici les virements qui rapprochent chaque compte de sa cible.";
  return `<section class="panneau"><h2>${titre}</h2>
      <p class="note" style="margin:4px 0 8px">${note}</p>
      <div class="table-wrap"><table><tbody>${mvts.map((m) => `<tr><td>${texteLie(libMvt(m))}${m.note ? `<div class="note">${texteLie(m.note)}</div>` : ""}</td><td class="m"><span class="${m.sens === "retrait" ? "ecart-moins" : m.sens === "versement" ? "ecart-plus" : "muted"}">${m.sens === "retrait" ? "−" : m.sens === "versement" ? "+" : "⇄ "}${eur(m.montant)}</span></td></tr>`).join("") || '<tr><td class="muted">Aucun mouvement.</td></tr>'}</tbody></table></div>
      <p class="small" style="margin:8px 0 0"><a class="lien-fiche" href="#reequilibrage">Voir le détail et les actions dans « ${nomVue("reequilibrage", niveauCourant())} » →</a></p></section>`;
}

function rendreSuivi() {
  clearTimeout(minuterieApercu);
  const plan = etat.brouillon;
  const { suivi, test, exemple, doc } = suiviCourant();
  const nom = exemple ? "Exemple" : doc?.nom ?? "ce profil";
  const releves = suivi?.releves ?? [];
  const ref = suivi?.reference;
  const der = releves[releves.length - 1], avant = releves[releves.length - 2];
  const resAuj = resultatSuivi();
  const env = (id) => plan.enveloppes[id]?.libelle ?? id;

  // Comptes proposés dans la saisie : ceux qui ont un montant, ou tous sur demande
  const montants = { ...(etat.profil.placements ?? {}), ...(brouillonReleve ?? {}) };
  const ids = Object.keys(plan.enveloppes).filter((id) => id !== "comptesEtrangers").filter((id) => tousLesComptes || (Number(montants[id]) || 0) > 0 || (der?.placements?.[id] ?? 0) > 0);
  const lignesSaisie = ids.map((id) => `<tr><td>${lienFiche(plan.enveloppes[id].fiche, env(id)) || echapper(env(id))}</td>
    <td class="m muted">${der ? eur(der.placements?.[id] ?? 0) : "—"}</td>
    <td class="m"><div class="saisie"><input type="number" min="0" step="10" data-releve="${id}" value="${Number(montants[id]) || 0}" aria-label="Solde ${echapper(env(id))}"><span>€</span></div></td></tr>`).join("");

  let html = `<div class="etape" style="margin:0"><p><b>Le suivi, chaque mois.</b> Tu recopies le solde de chaque compte ; le site compare au plan et te dit quoi verser le mois suivant.</p></div>
  <section class="panneau"><h2>Comment ça marche</h2>
    <ol class="mode">
      <li>Une fois par mois (ou par trimestre), ouvre l'appli de chaque banque et recopie le solde de chaque compte dans « Noter un relevé » ci-dessous.</li>
      <li>Le site met à jour tes montants dans « Mon profil » et recalcule les versements du mois suivant pour continuer le ${lierTermes("rééquilibrage")}.</li>
      <li>Les graphiques montrent si ton patrimoine avance comme prévu, et comment chaque famille de comptes évolue.</li>
    </ol>
    ${test ? `<p class="small" style="margin:12px 0 0"><span class="mode-test">Mode test</span> ${exemple
      ? "Profil « Exemple » : 12 mois de relevés fictifs sont déjà notés. Modifie les montants, note un relevé, supprime-en : rien n'est enregistré."
      : "Ces relevés ne sont pas enregistrés (profil non enregistré ou accès en lecture seule) : ils disparaîtront en quittant la page."}
      ${exemple ? `<button type="button" class="lien" id="btn-exemple-reset">Recommencer l'exemple</button>` : ""}</p>` : ""}
  </section>
  <section class="panneau"><h2>Noter un relevé · ${echapper(nom)}</h2>
    <p class="small" style="margin:4px 0 6px">${(() => {
      const er = etatReleve(releves, plan.calendrier?.frequenceReleveMois ?? 3, moisCourant());
      if (!er.dernier) return '<span class="niveau info">Premier relevé</span> Il servira de point de départ pour comparer au plan.';
      if (er.du && er.retardMois === 0) return `<span class="niveau info">À faire</span> Relevé de ${libMois(er.prochain)} attendu ce mois-ci.`;
      if (er.du) return `<span class="niveau alerte">En retard</span> Relevé attendu depuis ${libMois(er.prochain)} (${er.retardMois} mois de retard ; dernier relevé : ${libMois(er.dernier)}).`;
      return `<span class="muted">Prochain relevé conseillé : ${libMois(er.prochain)}.</span>`;
    })()}</p>
    <p class="note" style="margin:4px 0 10px">Les montants sont pré-remplis avec ceux de ton profil : corrige ceux qui ont changé, puis note le relevé.</p>
    <div class="ligne-actions" style="margin-bottom:8px"><label for="suivi-mois" class="small">Mois du relevé</label><input type="month" id="suivi-mois" value="${moisReleve ?? moisCourant()}" style="width:auto"></div>
    <div class="table-wrap"><table class="saisie-releve"><thead><tr><th>Compte</th><th class="m">${der ? `Relevé de ${libMois(der.date)}` : "Dernier relevé"}</th><th class="m">Solde aujourd'hui</th></tr></thead>
      <tbody>${lignesSaisie || '<tr><td colspan="3" class="muted">Aucun compte avec un montant : affiche tous les comptes.</td></tr>'}</tbody>
      <tfoot><tr><td><b>Total</b></td><td class="m muted">${der ? eur(der.total) : "—"}</td><td class="m"><b class="num" id="releve-total">${eur(totalPlacements(montants))}</b></td></tr></tfoot></table></div>
    <div class="champ" style="margin-top:10px"><label for="releve-note">Note (facultatif) : ce qui explique un saut</label><input id="releve-note" type="text" class="texte" maxlength="140" placeholder="Ex. prime d'intéressement versée, achat d'une voiture 8 000 €, baisse des marchés"></div>
    <div id="depot-releve" class="depot">
      <p style="margin:0 0 6px"><b>Importer un fichier</b> (CSV ou Excel .xlsx, 2 Mo maximum) : glisse-le ici ou choisis-le.</p>
      <input type="file" id="releve-fichier" accept=".csv,.tsv,.txt,.xlsx" aria-label="Choisir un fichier de relevé (CSV ou Excel)">
      <p class="small muted" style="margin:6px 0 0">Export de BoursoBank, Trade Republic, Fortuneo, Linxea… Colonnes reconnues : libellé du compte, solde (valorisation) et, si elles existent, versements cumulés (capital investi). Le fichier est lu dans ton navigateur et n'est jamais envoyé. Ancien format .xls : enregistre-le d'abord en .xlsx ou en .csv.</p>
      <div id="import-apercu"></div>
    </div>
    <details style="margin-top:10px"><summary class="small"><b>Coller un relevé</b> (texte, Excel ou export CSV : une ligne par compte)</summary>
      <textarea id="releve-colle" rows="5" style="width:100%;margin-top:6px" placeholder="Livret A ; 12 345,67&#10;LDDS ; 8 100&#10;PEA Trade Republic ; 31 250,40 €&#10;Assurance vie fonds euros ; 25 000"></textarea>
      <div class="ligne-actions" style="margin-top:6px"><button type="button" id="btn-coller">Remplir les montants</button><span class="small muted">Le nom du compte est reconnu par mots-clés (Livret A, LDDS, PEA, compte-titres, assurance vie, PER, SCPI, bitcoin…).</span></div>
    </details>
    <div id="releve-apercu" aria-live="polite">${htmlApercuReleve()}</div>
    <div class="ligne-actions" style="margin-top:10px">
      <button type="button" class="principal" id="btn-releve">Noter ce relevé</button>
      <button type="button" class="lien" id="releve-tous">${tousLesComptes ? "Masquer les comptes vides" : "Afficher tous les comptes"}</button>
    </div>
    ${messageSuivi ? `<p class="small" style="margin:8px 0 0">${echapper(messageSuivi)}</p>` : ""}
  </section>`;

  html += `<div id="suivi-mois-prochain">${htmlMoisProchain()}</div>`;

  if (releves.length && ref) {
    const prem = releves[0];
    const p = prevuA(ref, moisEntre(ref.date, der.date));
    const mois = moisEntre(prem.date, der.date);
    const epargneEst = (etat.profil.epargneMensuelle ?? 0) * mois;
    const variation = der.total - prem.total;
    let statut = null;
    if (p) {
      const ecart = der.total - p.c;
      statut = der.total > p.p90 ? ["info", "Au-dessus de la fourchette : mieux que prévu"] : der.total < p.p10 ? ["alerte", "Sous la fourchette : moins bien que prévu, vérifie l'épargne versée"] : ecart >= 0 ? ["info", "En avance sur la prévision"] : ["info", "Dans la fourchette, un peu sous la prévision : rien d'inquiétant"];
      statut.push(ecart);
    }
    const tuiles = [
      [`Dernier relevé · ${libMois(der.date)}`, eur(der.total)],
      ["Prévu par le plan à cette date", p ? eur(p.c) : "hors prévision"],
      ["Écart", p ? `${statut[2] >= 0 ? "+" : "−"}${eur(Math.abs(statut[2]))} (${statut[2] >= 0 ? "+" : "−"}${pct(Math.abs((100 * statut[2]) / (p.c || 1)))})` : "—"],
      [`Depuis ${libMois(prem.date)}`, `${variation >= 0 ? "+" : "−"}${eur(Math.abs(variation))}`],
    ];
    html += `<section class="panneau"><h2>Où tu en es par rapport au plan</h2>
      ${statut ? `<p class="small" style="margin:8px 0 0"><span class="niveau ${statut[0]}">${statut[0] === "alerte" ? "Attention" : "Bien"}</span> ${statut[1]}.</p>` : ""}
      <div class="tuiles quatre">${tuiles.map(([k, v]) => `<div class="tuile"><span>${k}</span><b class="num">${v}</b></div>`).join("")}</div>
      ${mois > 0 ? `<p class="note" style="margin:0 0 10px">Sur ${mois} mois : environ ${eur(epargneEst)} venus de ton épargne (${eur(etat.profil.epargneMensuelle ?? 0)} par mois) et ${variation - epargneEst >= 0 ? "+" : "−"}${eur(Math.abs(variation - epargneEst))} de gains ou pertes des placements (estimation).</p>` : ""}
      ${graphiqueSuivi(ref, releves)}</section>`;

    // Prix de revient (PRU) et plus-values latentes : PEA, PEA-PME, CTO, assurance-vie, PER
    const versProgrammes = {};
    for (const m of resAuj?.mouvements ?? []) if (m.sens === "versement") versProgrammes[m.enveloppe] = (versProgrammes[m.enveloppe] ?? 0) + (Number(m.montant) || 0);
    const pruRes = calculerPRU(releves, versProgrammes);
    if (pruRes.comptes.length) {
      const libPRU = (id) => (id === "peaPme" ? "PEA-PME" : env(id));
      const fmtPV = (x) => (x == null ? '<span class="muted">—</span>' : `<span class="${x >= 0 ? "ecart-plus" : "ecart-moins"}">${x >= 0 ? "+" : "−"}${eur(Math.abs(x))}</span>`);
      const fmtPct = (x) => (x == null ? "—" : `${x >= 0 ? "+" : "−"}${pct(Math.abs(x))}`);
      const lignesPRU = pruRes.comptes.map((c) => `<tr><td>${echapper(libPRU(c.id))}</td><td class="m">${eur(c.solde)}</td>
        <td class="m">${c.verse == null ? '<span class="muted" title="Il faut un fichier avec les versements cumulés, ou au moins deux relevés">inconnu</span>' : `${eur(c.verse)}${c.estime ? ' <span class="small muted">estimé</span>' : ""}`}</td>
        <td class="m">${fmtPV(c.pv)}</td><td class="m">${fmtPct(c.pvPct)}</td></tr>`).join("");
      const T = pruRes.total;
      html += `<section class="panneau"><h2>Prix de revient et plus-values latentes</h2>
        <p class="note" style="margin:4px 0 8px">Part de ton argent versé (le capital) et gains ou pertes non réalisés sur tes comptes de bourse et d'assurance-vie.</p>
        <div class="table-wrap"><table><thead><tr><th>Compte</th><th class="m">Valeur actuelle</th><th class="m">Capital versé</th><th class="m">Plus-value latente</th><th class="m">%</th></tr></thead><tbody>${lignesPRU}</tbody>
        ${T ? `<tfoot><tr><td><b>Total${T.complet ? "" : " (comptes connus)"}</b></td><td class="m">${eur(T.solde)}</td><td class="m">${eur(T.verse)}</td><td class="m"><b>${fmtPV(T.pv)}</b></td><td class="m">${fmtPct(T.pvPct)}</td></tr></tfoot>` : ""}</table></div>
        <p class="note" style="margin:8px 0 0">Le capital versé est celui de ton fichier (colonne « versements cumulés ») quand il existe. Sinon il est <b>estimé</b> : solde du premier relevé, plus les versements prévus par le plan depuis. Importe un fichier avec les versements cumulés pour un chiffre exact. Gains avant impôt et prélèvements sociaux.</p></section>`;
    }

    // Évolution par compte
    const cibles = new Map((resAuj?.reeq.comptes ?? []).map((c) => [c.enveloppe, c.cible]));
    const idsTable = Object.keys(plan.enveloppes).filter((id) => (der.placements?.[id] ?? 0) > 0.5 || (avant?.placements?.[id] ?? 0) > 0.5 || (cibles.get(id) ?? 0) > 0.5);
    const lignesComptes = idsTable.map((id) => {
      const v = der.placements?.[id] ?? 0, a = avant?.placements?.[id] ?? 0, c = cibles.get(id) ?? 0;
      const fmt = (x) => (Math.abs(x) < 0.5 ? '<span class="muted">0 €</span>' : `<span class="${x > 0 ? "ecart-plus" : "ecart-moins"}">${x > 0 ? "+" : "−"}${eur(Math.abs(x))}</span>`);
      return `<tr><td><span class="pastille" style="background:var(${familleDe(id).couleur})"></span>${lienFiche(plan.enveloppes[id].fiche, env(id)) || echapper(env(id))}</td>
        ${avant ? `<td class="m">${eur(a)}</td>` : ""}<td class="m">${eur(v)}</td>${avant ? `<td class="m">${fmt(v - a)}</td>` : ""}<td class="m">${eur(c)}</td><td class="m">${fmt(c - v)}</td></tr>`;
    }).join("");
    html += `<section class="panneau"><h2>Évolution compte par compte</h2>
      <p class="note" style="margin:4px 0 8px">Chaque barre est un relevé, découpée par famille de comptes. Survole une barre pour le détail.</p>
      ${graphiqueComptes(releves)}
      <div class="table-wrap" style="margin-top:12px"><table><thead><tr><th>Compte</th>${avant ? `<th class="m">${libMois(avant.date)}</th>` : ""}<th class="m">${libMois(der.date)}</th>${avant ? '<th class="m">Variation</th>' : ""}<th class="m">Cible du plan</th><th class="m">Reste à faire</th></tr></thead><tbody>${lignesComptes}</tbody></table></div>
      <p class="note" style="margin:8px 0 0">« Reste à faire » : ce qu'il manque (+) ou ce qu'il y a en trop (−) sur chaque compte par rapport à la cible d'aujourd'hui. L'épargne des prochains mois le comble petit à petit.</p></section>`;

    const lignes = releves.slice().reverse().map((r) => {
      const q = prevuA(ref, moisEntre(ref.date, r.date));
      const e = q ? r.total - q.c : null;
      return `<tr><td>${libMois(r.date)}${r.note ? `<div class="small muted">✎ ${echapper(r.note)}</div>` : ""}</td><td class="m">${eur(r.total)}</td><td class="m">${q ? eur(q.c) : "—"}</td>
        <td class="m">${e == null ? "—" : `<span class="${e >= 0 ? "ecart-plus" : "ecart-moins"}">${e >= 0 ? "+" : "−"}${eur(Math.abs(e))}</span>`}</td>
        <td class="m"><button type="button" class="lien" data-suppr-releve="${r.date}" aria-label="Supprimer le relevé de ${libMois(r.date)}">Supprimer</button></td></tr>`;
    }).join("");
    html += `<section class="panneau"><h2>Tous les relevés</h2>
        <div class="table-wrap" style="margin-top:8px"><table><thead><tr><th>Mois</th><th class="m">Total réel</th><th class="m">Prévu</th><th class="m">Écart</th><th></th></tr></thead><tbody>${lignes}</tbody></table></div>
        <p class="note" style="margin:10px 0 0">La prévision part du relevé de ${libMois(ref.date)}, avec le plan de l'époque. Après un changement de plan ou un gros événement (achat, héritage), recale-la sur le dernier relevé.
        <button type="button" class="lien" id="btn-recaler">Recaler la prévision sur le dernier relevé</button></p>
      </section>`;
  } else {
    html += `<section class="panneau"><p class="muted" style="margin:0">Aucun relevé pour l'instant. Le premier relevé fixe le point de départ de la prévision ; les suivants montrent si ton patrimoine avance comme prévu.</p></section>`;
  }
  $("#suivi").innerHTML = html + blocCalendrier();
  monterApercuImport();
}
$("#suivi").addEventListener("click", actionSuivi);

// ---------------------------------------------------------------- réglages du plan
const GROUPES = [
  { titre: "Épargne de sécurité", aide: "Montant retenu : le plus grand des trois critères, puis limité par le plafond. Laisser vide pour ignorer.", champs: [
    { c: "securite.minimum", l: "Minimum", u: "€" },
    { c: "securite.pourcentCapital", l: "Part du capital", u: "%" },
    { c: "securite.moisDepenses", l: "Mois de dépenses", u: "mois", vide: true },
    { c: "securite.plafond", l: "Plafond", u: "€", vide: true },
    { c: "securite.plafondPourcentCapital", l: "Jamais plus de (part du capital)", u: "%", vide: true },
    { c: "securite.moisDepensesSelonStatut.independant", l: "Indépendant : au moins", u: "mois" },
    { c: "securite.moisDepensesSelonStatut.precaire", l: "CDD, intérim : au moins", u: "mois" },
  ] },
  { titre: "Profils de risque", aide: "Chaque proche choisit son profil dans « Mon profil ». Part prudente : % du capital placé d'emblée en assurance-vie et obligations. Décalage : années ajoutées à l'âge de départ de la prudence (négatif = plus tôt). Coefficients appliqués aux % des paliers.", special: "risque", champs: [
    { c: "profilsRisque.defaut", l: "Profil par défaut", type: "choix", options: Object.keys(PLAN.profilsRisque).filter((k) => k !== "defaut").map((k) => [k, PLAN.profilsRisque[k].libelle]) },
  ] },
  { titre: "Retraite publique (estimation)", aide: "Paramètres de l'estimation de la retraite publique dans l'onglet Retraite (salarié du privé). Âge légal et trimestres pour les nés à partir de 1969 ; les générations précédentes suivent le tableau de la fiche.", champs: [
    { c: "retraitePublique.ageLegal", l: "Âge légal", u: "ans" },
    { c: "retraitePublique.trimestresRequis", l: "Trimestres pour le taux plein", u: "trim." },
    { c: "retraitePublique.ageTauxPlein", l: "Taux plein automatique", u: "ans" },
    { c: "retraitePublique.pass", l: "Plafond de la Sécurité sociale", u: "€/an" },
    { c: "retraitePublique.agircPrixAchat", l: "Agirc-Arrco : prix d'un point", u: "€", pas: 0.0001 },
    { c: "retraitePublique.agircValeurPoint", l: "Agirc-Arrco : valeur d'un point", u: "€", pas: 0.0001 },
    { c: "retraitePublique.netSurBrutSalaire", l: "Salaire net / brut", u: "%" },
    { c: "retraitePublique.netSurBrutPension", l: "Pension nette / brute", u: "%" },
  ] },
  { titre: "Bitcoin : quand acheter", aide: "On n'achète que si le cours est au moins X % sous le record ; sinon l'argent prévu attend sur le livret. Mettre à jour le record après un nouveau plus haut.", champs: [
    { c: "bitcoin.recordDollars", l: "Record historique", u: "$" },
    { c: "bitcoin.dateRecord", l: "Date du record (AAAA-MM-JJ)", type: "texte" },
    { c: "bitcoin.baisseMinPourAcheter", l: "Acheter seulement à partir de", u: "% sous le record" },
  ] },
  { titre: "Bourse : ce qu'on achète", aide: "Répartition de chaque versement destiné à la bourse (PEA, compte-titres, assurance-vie en unités de compte, PER). Affichée dans les mouvements du mois et la fiche PEA.", champs: [
    { c: "investissementBourse.0.nom", l: "Ligne 1", type: "texte" },
    { c: "investissementBourse.0.part", l: "Ligne 1 : part", u: "%" },
    { c: "investissementBourse.0.exemples", l: "Ligne 1 : exemples éligibles PEA", type: "texte" },
    { c: "investissementBourse.1.nom", l: "Ligne 2", type: "texte" },
    { c: "investissementBourse.1.part", l: "Ligne 2 : part", u: "%" },
    { c: "investissementBourse.1.exemples", l: "Ligne 2 : exemples éligibles PEA", type: "texte" },
  ] },
  { titre: "Paliers de capital", aide: "Part du capital total par classe. La bourse reçoit le reste. Entre deux paliers, la répartition évolue progressivement.", special: "paliers" },
  { titre: "Ajustement selon l'âge", aide: "À partir de l'âge de départ, des points de % passent chaque année des classes risquées vers l'assurance-vie et les obligations.", champs: [
    { c: "age.ageDebut", l: "Âge de départ", u: "ans" },
    { c: "age.pointsParAn", l: "Points basculés par an", u: "pts", pas: 0.5 },
    { c: "age.maxPoints", l: "Maximum basculé", u: "pts" },
    { c: "age.vitesseRelative.bitcoin", l: "Vitesse de réduction du bitcoin", u: "×", pas: 0.5 },
    { c: "age.vitesseRelative.bourse", l: "Vitesse de réduction de la bourse", u: "×", pas: 0.5 },
  ] },
  { titre: "Protection de l'apport", aide: "Part de l'apport mise à l'abri selon le nombre d'années avant l'achat. Horizon vide = au-delà. Pour un achat impératif, seule la part que l'épargne future ne couvrira pas est protégée.", special: "apport", champs: [
    { c: "apport.horizonImperatifMax", l: "Achat impératif : dans au plus", u: "ans" },
    { c: "apport.partSiImperatif", l: "Achat impératif : part protégée", u: "%", pas: 5 },
  ] },
  { titre: "Rééquilibrage des placements existants", aide: "L'épargne du mois comble d'abord les manques. Les excédents sont déplacés par petites étapes ; les écarts sous la tolérance sont ignorés.", champs: [
    { c: "reequilibrage.dureeMois", l: "Étaler les transferts sur au moins", u: "mois" },
    { c: "reequilibrage.dureeMaxMois", l: "et au plus (rythme automatique)", u: "mois" },
    { c: "reequilibrage.toleranceEuros", l: "Tolérance", u: "€", pas: 100 },
    { c: "reequilibrage.sansRetraitAvantAnnees.pea", l: "Aucun retrait du PEA avant", u: "ans" },
    { c: "reequilibrage.arbitrageInterne", l: "Arbitrer dans l'assurance-vie plutôt que racheter", type: "coche" },
  ] },
  { titre: "Bitcoin, or et SCPI", aide: "Au-delà du maximum, le bitcoin quitte la plateforme pour un portefeuille matériel. L'or et les SCPI s'achètent par tranches : l'épargne attend sur le livret.", champs: [
    { c: "remplissage.bitcoin.0.max", l: "Maximum gardé sur la plateforme", u: "€", pas: 500 },
    { c: "flux.seuilsAchat.or", l: "Tranche d'achat de l'or", u: "€", pas: 100 },
    { c: "flux.seuilsAchat.scpi", l: "Tranche d'achat des SCPI", u: "€", pas: 100 },
  ] },
  { titre: "Hypothèses de projection", aide: "Rendements annuels moyens. Bourse, or, bitcoin et SCPI sont bruts ; livrets et assurance-vie sont nets. La volatilité fixe la largeur de l'éventail.", special: "rendements", champs: [
    { c: "hypotheses.fraisEntree.scpi", l: "Frais d'entrée SCPI", u: "%" },
    { c: "hypotheses.inflation", l: "Inflation", u: "%", pas: 0.1 },
    { c: "hypotheses.correlations", id: "hyp-correlations", min: "avance", l: "Corrélations entre actifs", type: "choix", options: [["dynamiques", "Dynamiques (krachs : les actifs risqués chutent ensemble)"], ["independantes", "Indépendantes (modèle simple)"]] },
    { c: "carrieres.defaut", l: "Carrière par défaut", type: "choix", options: Object.keys(PLAN.carrieres).filter((k) => k !== "defaut").map((k) => [k, PLAN.carrieres[k].libelle.split(" :")[0]]) },
    { c: "carrieres.progressive.phases.0.1", l: "Progressive : hausse au-delà de l'inflation", u: "%/an" },
    { c: "carrieres.progressive.phases.0.0", l: "Progressive : jusqu'à", u: "ans" },
    { c: "carrieres.forte.phases.0.1", l: "Forte : hausse au-delà de l'inflation", u: "%/an", pas: 0.1 },
    { c: "carrieres.forte.phases.0.0", l: "Forte : jusqu'à", u: "ans" },
    { c: "carrieres.forte.phases.1.1", l: "Forte : ensuite", u: "%/an", pas: 0.1 },
    { c: "carrieres.forte.phases.1.0", l: "Forte : jusqu'à", u: "ans" },
    { c: "hypotheses.ageFinProjection", l: "Projection jusqu'à", u: "ans" },
    { c: "hypotheses.ageRetraite", l: "Fin de l'épargne (retraite)", u: "ans" },
    { c: "hypotheses.valorisationImmobiliere", l: "Valorisation de la résidence", u: "%/an", pas: 0.1 },
    { c: "hypotheses.simulations", l: "Scénarios tirés au hasard", u: "", pas: 100 },
  ] },
  { titre: "Fiscalité à la sortie", aide: "Part des gains prélevée si l'on vendait tout (règles 2026 : flat tax 31,4 %, PEA de plus de 5 ans 18,6 %, assurance-vie de plus de 8 ans 7,5 % + 17,2 %, SCPI : TMI + 17,2 %). À revérifier chaque année.", champs: [
    { c: "fiscalite.gains.pea", l: "PEA (plus de 5 ans)", u: "%", pas: 0.1 },
    { c: "fiscalite.gains.cto", l: "Compte-titres", u: "%", pas: 0.1 },
    { c: "fiscalite.gains.assuranceVie", l: "Assurance-vie (plus de 8 ans)", u: "%", pas: 0.1 },
    { c: "fiscalite.gains.livretBancaire", l: "Livret bancaire", u: "%", pas: 0.1 },
    { c: "fiscalite.gains.plateformeCrypto", l: "Bitcoin", u: "%", pas: 0.1 },
    { c: "fiscalite.gains.scpi", l: "SCPI", u: "%", pas: 0.1 },
    { c: "fiscalite.or.taxeForfaitaire", l: "Or : taxe sur le prix de vente", u: "%", pas: 0.1 },
    { c: "fiscalite.or.plusValue", l: "Or : taxe sur la plus-value", u: "%", pas: 0.1 },
    { c: "fiscalite.or.abattementParAnApres2Ans", l: "Or : abattement par an après 2 ans", u: "%", pas: 1 },
  ] },
  { titre: "Achat de la résidence principale", aide: "Apport disponible = livrets au-dessus de l'épargne de sécurité, plus la part de l'épargne du mois mise de côté pour l'achat.", champs: [
    { c: "achatRP.partEpargneVersApport", l: "Épargne du mois mise de côté", u: "%", pas: 5 },
    { c: "achatRP.tauxEndettementMax", l: "Taux d'endettement max", u: "%" },
    { c: "achatRP.dureeMaxAnnees", l: "Durée max du prêt", u: "ans" },
    { c: "achatRP.tauxCredit", l: "Taux du crédit", u: "%", pas: 0.05 },
    { c: "achatRP.tauxAssuranceEmprunteur", l: "Assurance emprunteur", u: "%", pas: 0.05 },
    { c: "achatRP.apportMinPourcentCout", l: "Apport minimum (frais de notaire au moins)", u: "% coût" },
    { c: "achatRP.fraisNotairePourcent.ancien", l: "Frais de notaire (ancien)", u: "%", pas: 0.5 },
    { c: "achatRP.fraisNotairePourcent.neuf", l: "Frais de notaire (neuf)", u: "%", pas: 0.5 },
    { c: "achatRP.ageMaxFinPret", l: "Âge max en fin de prêt", u: "ans" },
  ] },
  { titre: "Couple / foyer", aide: "Âge utilisé pour la répartition et les projections d'un couple. Le prêt, lui, est toujours limité par l'âge du plus âgé.", champs: [
    { c: "foyer.ageReference", l: "Âge de référence du foyer", type: "choix", options: [["moyenne", "Moyenne des deux âges"], ["plus-age", "Âge du plus âgé"]] },
  ] },
  { titre: "PER (plan d'épargne retraite)", aide: "Le PER prend une part de l'épargne destinée à la bourse quand la tranche d'imposition est assez élevée. Plafonds de déduction 2026 à revérifier chaque année.", champs: [
    { c: "per.tmiMin", l: "PER conseillé à partir d'une TMI de", u: "%" },
    { c: "per.partEpargneSelonTMI.30", l: "Part de l'épargne mensuelle (TMI 30 %)", u: "%" },
    { c: "per.partEpargneSelonTMI.41", l: "Part de l'épargne mensuelle (TMI 41 %)", u: "%" },
    { c: "per.partEpargneSelonTMI.45", l: "Part de l'épargne mensuelle (TMI 45 %)", u: "%" },
    { c: "per.plafondMin", l: "Plancher de déduction", u: "€/an" },
    { c: "per.plafondMax", l: "Plafond de déduction maximal", u: "€/an" },
    { c: "per.tmiRetraite", l: "TMI supposée à la retraite", u: "%" },
    { c: "per.reinvestirEconomie", l: "Réépargner l'économie d'impôt", type: "coche" },
    { c: "etablissements.per.recommande", l: "PER recommandé", type: "texte" },
  ] },
  { titre: "Calendrier et suivi", aide: "Échéances affichées dans l'onglet Suivi.", champs: [
    { c: "calendrier.moisRevue", l: "Mois de la revue annuelle (1 à 12)", u: "mois" },
    { c: "calendrier.frequenceReleveMois", l: "Un relevé de suivi tous les", u: "mois" },
    { c: "calendrier.horizonAnnees", l: "Échéances affichées sur", u: "ans" },
  ] },
  { titre: "Établissements", aide: "Où ouvrir, garder ou transférer. Listes séparées par des virgules ; les noms doivent correspondre aux choix proposés dans le formulaire.", champs: [
    { c: "etablissements.pea.recommande", l: "PEA : établissement recommandé", type: "texte" },
    { c: "etablissements.pea.aConserver", l: "PEA : établissements à conserver", type: "liste" },
    { c: "etablissements.pea.choix", l: "PEA : choix du formulaire", type: "liste" },
    { c: "etablissements.assuranceVie.recommande", l: "Assurance-vie : contrat recommandé", type: "texte" },
    { c: "etablissements.assuranceVie.aConserver", l: "Assurance-vie : types à conserver", type: "liste" },
  ] },
  { titre: "Assurance-vie et plafonds", aide: "Répartition de la part prudente, et plafonds de versement réglementaires (à mettre à jour si la loi change).", champs: [
    { c: "repartitionPrudent.fondsEuros", l: "Fonds euros", u: "%" },
    { c: "repartitionPrudent.obligations", l: "Obligations", u: "%" },
    { c: "enveloppes.livretA.plafond", l: "Plafond Livret A", u: "€" },
    { c: "enveloppes.ldds.plafond", l: "Plafond LDDS", u: "€" },
    { c: "enveloppes.pea.plafond", l: "Plafond PEA", u: "€" },
    { c: "enveloppes.lep.plafond", l: "Plafond LEP", u: "€" },
    { c: "enveloppes.pel.plafond", l: "Plafond PEL", u: "€" },
    { c: "lep.seuilRFR1Part", l: "LEP : revenu fiscal max (1 part)", u: "€" },
    { c: "lep.seuilRFRCouple", l: "LEP : revenu fiscal max (couple)", u: "€" },
  ] },
  { titre: "Résidence fiscale hors de France", aide: "Hors de France, PEA, PER, LEP, Livret A, LDDS et PEL ne reçoivent plus d'argent neuf (les comptes existants sont conservés), et les gains sont imposés au taux moyen du pays. Taux approximatifs, à vérifier sur place.", special: "pays" },
];

const saisie = (attrs, unite, valeur) =>
  `<div class="saisie"><input type="number" ${attrs} value="${valeur ?? ""}"><span>${unite}</span></div>`;

function colonnesPaliers(plan) {
  const set = new Set(["bitcoin", "or", "scpi", "prudent"]);
  plan.paliers.forEach((p) => Object.keys(p.cibles).forEach((k) => set.add(k)));
  return [...set].filter((c) => c !== plan.classeReste && plan.classes[c]);
}

function rendreReglages() {
  const plan = etat.brouillon;
  const html = GROUPES.map((g, gi) => {
    let corps = "";
    if (g.special === "paliers") {
      const cols = colonnesPaliers(plan);
      corps = `<div class="table-wrap"><table><thead><tr><th>Capital</th>${cols.map((c) => `<th>${plan.classes[c].libelle}</th>`).join("")}<th></th></tr></thead><tbody>
        ${plan.paliers.map((p, i) => `<tr><td>${saisie(`id="pal-${i}-capital" data-palier="${i}" data-k="capital" step="5000" min="0" aria-label="Capital du palier ${i + 1}"`, "€", p.capital)}</td>
          ${cols.map((c) => `<td>${saisie(`id="pal-${i}-${c}" data-palier="${i}" data-k="${c}" step="1" min="0" max="100" aria-label="${plan.classes[c].libelle}, palier ${i + 1}"`, "%", p.cibles[c] ?? 0)}</td>`).join("")}
          <td><button type="button" class="lien" data-suppr-palier="${i}" aria-label="Supprimer le palier ${i + 1}">Supprimer</button></td></tr>`).join("")}
        </tbody></table></div><button type="button" id="ajout-palier" style="margin-top:8px">Ajouter un palier</button>`;
    } else if (g.special === "apport") {
      corps = `<div class="table-wrap"><table><thead><tr><th>Achat dans (au plus)</th><th>Part protégée</th><th></th></tr></thead><tbody>
        ${plan.apport.protection.map((t, i) => `<tr><td>${saisie(`id="app-${i}-h" data-tranche="${i}" data-k="horizonMaxAnnees" step="1" min="0" placeholder="au-delà" aria-label="Horizon de la tranche ${i + 1}"`, "ans", t.horizonMaxAnnees)}</td>
          <td>${saisie(`id="app-${i}-p" data-tranche="${i}" data-k="part" step="5" min="0" max="100" aria-label="Part protégée, tranche ${i + 1}"`, "%", t.part)}</td>
          <td><button type="button" class="lien" data-suppr-tranche="${i}" aria-label="Supprimer la tranche ${i + 1}">Supprimer</button></td></tr>`).join("")}
        </tbody></table></div><button type="button" id="ajout-tranche" style="margin-top:8px">Ajouter une tranche</button>`;
    } else if (g.special === "risque") {
      const ids = Object.keys(plan.profilsRisque ?? {}).filter((k) => k !== "defaut");
      const cel = (k, ch, u, pas) => `<td>${saisie(`id="pr-${k}-${ch.replace(/\./g, "-")}" data-chemin="profilsRisque.${k}.${ch}" step="${pas}" aria-label="${ch}, profil ${k}"`, u, lire(plan, `profilsRisque.${k}.${ch}`))}</td>`;
      corps = `<div class="table-wrap"><table><thead><tr><th>Profil</th><th>Part prudente</th><th>Décalage</th><th>Bitcoin</th><th>Or</th><th>SCPI</th></tr></thead><tbody>
        ${ids.map((k) => `<tr><td>${echapper(plan.profilsRisque[k].libelle ?? k)}</td>${cel(k, "partPrudente", "%", 5)}${cel(k, "decalageAge", "ans", 1)}${cel(k, "multiplicateurs.bitcoin", "×", 0.1)}${cel(k, "multiplicateurs.or", "×", 0.1)}${cel(k, "multiplicateurs.scpi", "×", 0.1)}</tr>`).join("")}
        </tbody></table></div>`;
    } else if (g.special === "pays") {
      const P = plan.residence?.pays ?? {};
      corps = `<div class="table-wrap"><table><thead><tr><th>Pays</th><th>Impôt sur les gains</th><th>Équivalents locaux</th></tr></thead><tbody>
        ${Object.entries(P).filter(([k]) => k !== "FR").map(([k, x]) => `<tr><td>${echapper(x.libelle ?? k)}</td>
          <td>${saisie(`id="pays-${k}" data-chemin="residence.pays.${k}.impotGains" step="0.5" min="0" aria-label="Impôt sur les gains, ${x.libelle}"`, "%", x.impotGains)}</td>
          <td><input type="text" class="texte" id="pays-${k}-eq" data-chemin="residence.pays.${k}.equivalents" data-texte="1" aria-label="Équivalents locaux, ${x.libelle}" value="${echapper(x.equivalents ?? "")}"></td></tr>`).join("")}
        </tbody></table></div>`;
    } else if (g.special === "rendements") {
      corps = `<div class="table-wrap"><table><thead><tr><th>Classe</th><th>Rendement</th><th>Volatilité</th></tr></thead><tbody>
        ${Object.keys(plan.classes).map((c) => `<tr><td>${plan.classes[c].libelle}</td>
          <td>${saisie(`id="rd-${c}" data-chemin="hypotheses.rendements.${c}" step="0.1" aria-label="Rendement ${plan.classes[c].libelle}"`, "%", plan.hypotheses.rendements[c])}</td>
          <td>${saisie(`id="vol-${c}" data-chemin="hypotheses.volatilites.${c}" step="1" min="0" aria-label="Volatilité ${plan.classes[c].libelle}"`, "%", plan.hypotheses.volatilites?.[c])}</td></tr>`).join("")}
        </tbody></table></div>`;
    }
    const champs = (g.champs ?? []).map((f, fi) => {
      const id = `r-${gi}-${fi}`;
      if (f.type === "texte" || f.type === "liste") {
        const v = lire(plan, f.c);
        return `<div class="champ champ-texte"><label for="${id}">${f.l}</label><input id="${id}" type="text" class="texte" data-chemin="${f.c}" data-${f.type}="1" value="${echapper(Array.isArray(v) ? v.join(", ") : v ?? "")}"></div>`;
      }
      if (f.type === "choix") return `<div class="champ champ-texte"${f.min ? ` data-min="${f.min}"` : ""}><label for="${id}">${f.l}</label><select id="${f.id ?? id}"${f.min ? ` data-min="${f.min}"` : ""} data-chemin="${f.c}" data-texte="1">${f.options.map(([v, t]) => `<option value="${v}" ${lire(plan, f.c) === v ? "selected" : ""}>${t}</option>`).join("")}</select></div>`;
      if (f.type === "coche") return `<label class="coche"><input id="${id}" type="checkbox" data-chemin="${f.c}" data-coche="1" ${lire(plan, f.c) ? "checked" : ""}> ${f.l}</label>`;
      return `<div class="champ"><label for="${id}">${f.l}</label>${saisie(`id="${id}" data-chemin="${f.c}" ${f.vide ? 'data-vide="1" placeholder="—"' : ""} step="${f.pas ?? 1}"`, f.u, lire(plan, f.c))}</div>`;
    }).join("");
    return `<section class="panneau groupe${g.special === "paliers" ? " large" : ""}"><h2>${g.titre}</h2><p class="aide">${g.aide}</p>${corps}${champs ? `<div class="champs" ${corps ? 'style="margin-top:14px"' : ""}>${champs}</div>` : ""}</section>`;
  }).join("");
  $("#reglages").innerHTML = html;
  appliquerDroitsPlan();
}

// Lecture seule pour les proches : ils voient le plan sans pouvoir le modifier
function appliquerDroitsPlan() {
  const lecture = !etat.auteur;
  $("#lien-plan").textContent = lecture ? "Le plan" : "Mon plan";
  $("#btn-enregistrer").hidden = lecture || !etat.peutEnregistrer && !!window.claude;
  $("#btn-annuler").hidden = lecture;
  $("#zone-defaut").hidden = lecture;
  document.querySelectorAll("#reglages input, #reglages select, #reglages button").forEach((el) => { el.disabled = lecture; });
  if (lecture) {
    if (modifie()) { etat.brouillon = clone(etat.reference); }
    $("#info-droits").textContent = "Plan de l'auteur, en lecture seule. Pour essayer un autre niveau de risque, choisis un « Profil de risque » dans « Mon profil ».";
  }
}

function apresChangementPlan() { rendreChoixEtablissements(); rendreChoixProfil(); rendreStatut(); rendreResultats(); planifierTrajectoire(); }

$("#reglages").addEventListener("input", (e) => {
  if (!etat.auteur) return;
  const el = e.target; const plan = etat.brouillon;
  const brut = el.value === "" ? null : Number(el.value);
  if (el.dataset.coche) ecrire(plan, el.dataset.chemin, el.checked);
  else if (el.dataset.texte) ecrire(plan, el.dataset.chemin, el.value.trim());
  else if (el.dataset.liste) ecrire(plan, el.dataset.chemin, el.value.split(",").map((x) => x.trim()).filter(Boolean));
  else if (el.dataset.chemin) ecrire(plan, el.dataset.chemin, brut === null && !el.dataset.vide ? 0 : brut);
  else if (el.dataset.palier) {
    const p = plan.paliers[+el.dataset.palier];
    if (el.dataset.k === "capital") p.capital = brut ?? 0; else p.cibles[el.dataset.k] = brut ?? 0;
  } else if (el.dataset.tranche) {
    plan.apport.protection[+el.dataset.tranche][el.dataset.k] = el.dataset.k === "part" ? brut ?? 0 : brut;
  } else return;
  apresChangementPlan();
});
$("#reglages").addEventListener("click", (e) => {
  if (!etat.auteur) return;
  const plan = etat.brouillon; const t = e.target;
  if (t.id === "ajout-palier") {
    const der = plan.paliers[plan.paliers.length - 1];
    plan.paliers.push({ capital: (der?.capital ?? 0) * 2 || 50000, cibles: clone(der?.cibles ?? {}) });
  } else if (t.dataset.supprPalier) plan.paliers.splice(+t.dataset.supprPalier, 1);
  else if (t.id === "ajout-tranche") plan.apport.protection.push({ horizonMaxAnnees: null, part: 0 });
  else if (t.dataset.supprTranche) plan.apport.protection.splice(+t.dataset.supprTranche, 1);
  else return;
  rendreReglages(); apresChangementPlan();
});

// Boutons
$("#btn-annuler").addEventListener("click", () => {
  if (!etat.auteur) return; etat.brouillon = clone(etat.reference); rendreReglages(); apresChangementPlan(); });

function zoneDefautInitiale() {
  $("#zone-defaut").innerHTML = `<button type="button" class="lien" id="btn-defaut">Revenir au plan par défaut</button>`;
}
$("#zone-defaut").addEventListener("click", (e) => {
  if (e.target.id === "btn-defaut") {
    $("#zone-defaut").innerHTML = `<span class="small">Remplacer tous les réglages par ceux du fichier plan.js ?</span>
      <button type="button" id="defaut-oui">Oui, remplacer</button> <button type="button" class="lien" id="defaut-non">Non</button>`;
  } else if (e.target.id === "defaut-oui" && etat.auteur) {
    etat.brouillon = clone(PLAN); zoneDefautInitiale(); rendreReglages(); apresChangementPlan();
  } else if (e.target.id === "defaut-non") zoneDefautInitiale();
});

$("#btn-enregistrer").addEventListener("click", async () => {
  if (!etat.auteur) return;
  const bouton = $("#btn-enregistrer");
  bouton.disabled = true; bouton.textContent = "Enregistrement…";
  const majLe = new Date().toISOString();
  try {
    if (etat.db) {
      await etat.db.doc("plan/actuel").set({ plan: clone(etat.brouillon), majLe });
      etat.source = "partage";
    } else {
      memo.set("planLocal", { plan: etat.brouillon, majLe });
      etat.source = "local";
    }
    etat.reference = clone(etat.brouillon); etat.majLe = majLe;
    $("#info-droits").textContent = etat.db ? "Enregistré. Tes proches voient ce plan." : "Enregistré dans ce navigateur.";
  } catch (err) {
    $("#info-droits").textContent = `Échec de l'enregistrement (${err?.code ?? err?.message ?? "erreur"}). Tes modifications sont toujours là, réessaie dans un instant.`;
  }
  bouton.textContent = "Enregistrer le plan";
  rendreStatut();
});

// ---------------------------------------------------------------- fiches mémo
// Fiche risques : chaque famille de comptes du profil face à sa garantie
function blocRisques(res) {
  const plan = etat.brouillon, pl = res.profil.placements ?? {}, n = res.profil.personnes ?? 1;
  const G = plan.garanties ?? {};
  const somme = (ids) => ids.reduce((t, id) => t + (Number(pl[id]) || 0), 0);
  const ok = '<span class="ecart-plus">✓ Couvert</span>', ko = (t) => `<span class="ecart-moins">⚠ ${t}</span>`, neutre = (t) => `<span class="muted">${t}</span>`;
  const lignes = [
    ["Livret A, LDDS, LEP, Livret Jeune", somme(["livretA", "ldds", "lep", "livretJeune"]), "Garantie à part (en plus des 100 000 €)", ok],
    ["Livret bancaire et PEL", somme(["livretBancaire", "pel"]), `${eur((G.depotsParBanque ?? 100000) * n)} par banque${n > 1 ? " (couple)" : ""}, compte courant compris`, (v) => (v > (G.depotsParBanque ?? 100000) * n ? ko("Au-dessus : répartir entre banques") : ok)],
    ["Assurance-vie", somme(["assuranceVie", "assuranceVieUC"]), `${eur((G.assuranceParAssureur ?? 70000) * n)} par assureur${n > 1 ? " (couple)" : ""}`, (v) => (v > (G.assuranceParAssureur ?? 70000) * n ? ko("Au-dessus : 2e assureur") : ok)],
    ["PEA et compte-titres", somme(["pea", "cto"]), "Titres à ton nom, rendus en cas de faillite (70 000 € s'ils sont introuvables)", neutre("Pas de garantie contre la baisse")],
    ["PER", somme(["per"]), "Selon le contrat : comme un compte-titres, ou avec tes assurances-vie s'il est assuré", neutre("À vérifier")],
    ["Or physique", somme(["orPhysique"]), "Aucune : ne dépend d'aucun établissement", neutre("Le ranger en lieu sûr")],
    ["Bitcoin sur la plateforme", somme(["plateformeCrypto"]), "Aucune", (v) => (v > 5000 ? ko("Au-dessus de 5 000 € : cold wallet") : neutre("Garder peu"))],
    ["Bitcoin sur cold wallet", somme(["coldWallet"]), "Aucune : dépend de tes mots de récupération", neutre("Les garder en lieu sûr")],
    ["SCPI", somme(["scpi"]), "Aucune : capital non garanti, revente parfois lente", neutre("Diversifier")],
  ].filter(([, v]) => v > 0.5).map(([nom, v, g, st]) => `<tr><td>${texteLie(nom)}</td><td class="m">${eur(v)}</td><td>${echapper(g)}</td><td class="m">${typeof st === "function" ? st(v) : st}</td></tr>`).join("");
  return lignes ? `<div class="table-wrap"><table><thead><tr><th>Comptes</th><th class="m">Montant</th><th>Garantie en cas de faillite</th><th class="m">Statut</th></tr></thead><tbody>${lignes}</tbody></table></div>
    <p class="note" style="margin:8px 0 0">Le site ne sait pas dans quelle banque ou chez quel assureur est chaque compte : il suppose le pire (tout au même endroit). Fais le calcul par établissement avec les étapes ci-dessous.</p>` : '<p class="small muted" style="margin:0">Aucun placement saisi pour ce profil.</p>';
}

// Fiche PER : ce que le PER rapporterait au proche, pour un même effort
function blocCalculPER(res) {
  const plan = etat.brouillon, p = res.profil, per = res.per ?? {};
  const tmi = per.tmi ?? (p.tmi !== "" && p.tmi != null ? Number(p.tmi) : null);
  if (tmi == null) return '<p class="small" style="margin:0">Indique ta tranche d\'imposition (TMI) dans « Mon profil » pour voir ce qu\'un PER te rapporterait.</p>';
  const n = Math.max(1, (plan.hypotheses.ageRetraite ?? 64) - (p.agePrincipal ?? p.age ?? 30));
  const tret = plan.per?.tmiRetraite ?? 11, r = 0.06 / 12, F = (Math.pow(1 + r, 12 * n) - 1) / r;
  const effort = 100, tauxPER = per.exact ? per.tauxEffectif : tmi, mPER = effort / (1 - tauxPER / 100);
  const capPER = mPER * F, versePER = mPER * 12 * n, netPER = capPER - (versePER * tret) / 100 - (capPER - versePER) * (PFU / 100);
  const cap = effort * F, verse = effort * 12 * n, netPEA = cap - (cap - verse) * (PRELEVEMENTS.PS_CAPITAL / 100), netCTO = cap - (cap - verse) * (PFU / 100);
  const gain = (100 * (netPER / netPEA - 1));
  const ab = res.abondement;
  const ligneAb = ab?.mensuel > 0.5 ? `<p class="verdict ok" style="margin:0 0 8px"><b>Abondement :</b> en versant ${eur(ab.mensuel)} par mois sur ton ${ab.surPER ? "PER d'entreprise" : "PEE"}, ton employeur ajoute ${eur(ab.abondementAn)} par an. C'est la première chose à faire.</p>` : "";
  return ligneAb + `<p class="small" style="margin:0 0 8px">Ta tranche : <b>${tmi} %</b>. Chaque 100 € versé sur un PER te fait économiser <b>${eur(tauxPER)}</b> d'impôt${per.exact ? " (taux réel de ton versement prévu, décote et changement de tranche compris)" : " (estimation à ta tranche)"}.${per.actif ? ` Le plan prévoit ${eur(per.mensuel)} par mois, soit <b>${eur(per.economie)} d'impôt en moins par an</b>${per.exact ? `, soit ${Math.round(per.tauxEffectif)} % du versement` : " (estimation à ta tranche)"}.` : per.raison === "refus" && per.economiePossible > 0.5 ? ` Tu as refusé le PER : environ ${eur(per.economiePossible)} d'impôt par an laissés de côté.` : ""}</p>
    <div class="table-wrap"><table><thead><tr><th>Pour 100 € par mois de ta poche pendant ${n} ans</th><th class="m">À la retraite, après impôts</th></tr></thead><tbody>
      <tr><td>PER (${eur(mPER)} placés par mois grâce à l'économie d'impôt)</td><td class="m"><b>${eur(netPER)}</b></td></tr>
      <tr><td>PEA</td><td class="m">${eur(netPEA)}</td></tr>
      <tr><td>Compte-titres</td><td class="m">${eur(netCTO)}</td></tr>
    </tbody></table></div>
    <p class="small" style="margin:8px 0 0">${gain > 5 ? `<b>Le PER fait ${pct(gain)} de mieux que le PEA</b> pour le même effort.` : `Avec ta tranche, l'avantage sur le PEA est faible (${pct(gain)}) : le PEA, disponible, est plus intéressant.`} Hypothèses : 6 % par an, tranche à la retraite de ${tret} %, sortie en capital, montants de l'époque.</p>`;
}

function blocDansTonPlan(f, res) {
  if (f.id === "risques") return blocRisques(res);
  if (f.id === "per") return blocCalculPER(res) + '<div style="margin-top:12px"></div>' + blocDansTonPlanCommun(f, res);
  if (f.id === "net-impot") return blocNetImpot();
  if (f.id === "frais") return blocFrais();
  if (f.id === "epargne-salariale") return blocEpargneSalariale(res) + blocDansTonPlanCommun(f, res);
  return blocDansTonPlanCommun(f, res);
}
function blocFrais() {
  const p = normaliserProfil(etat.profil), P = p.placements ?? {}, out = [];
  const avTot = (P.assuranceVie ?? 0) + (P.assuranceVieUC ?? 0);
  const avType = p.assuranceVie?.type ?? "";
  if (p.assuranceVie?.ouverte) {
    const cher = ["Banque traditionnelle", "Assureur ou mutuelle", "Gestion pilotée en ligne"].includes(avType);
    out.push(`<li><b>Assurance-vie</b> (${echapper(avType || "type non précisé")}${avTot > 0 ? `, ${eur(avTot)}` : ""}) : ${cher ? `frais probablement élevés. Retrouve sur ton relevé annuel les frais de gestion et ceux des fonds ; si le total dépasse 1,5 % par an, continue d'alimenter plutôt un contrat en ligne (garde l'ancien s'il a plus de 8 ans). À 1,5 % de frais de plus, ${eur(avTot)} sur 20 ans, c'est environ ${eur(avTot * (Math.pow(1.055, 20) - Math.pow(1.04, 20)))} de moins.` : "type de contrat généralement peu cher. Vérifie quand même les frais des supports."}</li>`);
  }
  if (p.pea?.ouvert) {
    const cher = p.pea.etablissement === "Banque traditionnelle";
    out.push(`<li><b>PEA</b> (${echapper(p.pea.etablissement || "établissement non précisé")}) : ${cher ? "les banques traditionnelles prennent souvent 0,5 % ou plus par ordre et parfois des frais de garde. Un transfert vers un courtier en ligne coûte au plus 150 € et garde l'ancienneté du PEA." : "courtier en ligne : frais de courtage faibles. Choisis des ETF à 0,1 à 0,3 % par an."}</li>`);
  }
  if ((P.per ?? 0) > 0) out.push(`<li><b>PER</b> : vérifie 0 % sur versement et environ 0,5 % par an ; la gestion pilotée « à horizon » ajoute souvent des frais.</li>`);
  if ((P.epargneSalariale ?? 0) > 0) out.push(`<li><b>Épargne salariale</b> : compare les frais courants des FCPE proposés ; préfère un fonds indiciel actions monde.</li>`);
  return out.length ? `<ul class="points" style="margin:0">${out.join("")}</ul>` : `<p class="small muted" style="margin:0">Indique tes contrats dans « Mon profil » (type d'assurance-vie, établissement du PEA) pour voir ce qu'il faut vérifier.</p>`;
}
function blocNetImpot() {
  const p = normaliserProfil(etat.profil), n = Number(p.salaireNetMensuel) || 0;
  if (!(n > 0)) return `<p class="small muted" style="margin:0">Indique ton salaire net après impôt dans « Mon profil » pour voir le détail.</p>`;
  const ff = foyerFiscal(p), d = decomposerSalaire(n, { ...ff, netSurBrut: etat.brouillon.retraitePublique?.netSurBrutSalaire ?? 78 });
  const tmiSaisie = p.tmi !== "" && p.tmi != null ? Number(p.tmi) : null;
  return `<div class="table-wrap"><table><tbody>
      <tr><td>Salaire brut (estimé, salarié non cadre)</td><td class="m">≈ ${eur(d.brut)}</td></tr>
      <tr><td>Cotisations sociales</td><td class="m">≈ − ${eur(d.brut - d.netAvant)}</td></tr>
      <tr><td><b>Net avant impôt</b></td><td class="m"><b>≈ ${eur(d.netAvant)}</b></td></tr>
      <tr><td>Impôt prélevé à la source (taux moyen ≈ ${pct(d.tauxPAS)})</td><td class="m">≈ − ${eur(d.impotMensuel)}</td></tr>
      <tr><td><b>Net après impôt</b> (ce que tu as saisi)</td><td class="m"><b>${eur(n)}</b></td></tr>
    </tbody></table></div>
    <p class="small" style="margin:8px 0 0">${ff.commun ? "Imposition commune avec ton conjoint (2 parts). " : "Personne seule (1 part). "}Tranche marginale estimée : <b>${d.tmi} %</b>${tmiSaisie == null ? ` : tu peux la saisir dans « Mon profil », bloc « Tes impôts » (vérifie-la sur ton avis d'impôt).` : tmiSaisie !== d.tmi ? `, alors que tu as saisi ${tmiSaisie} % : ton avis d'impôt fait foi (enfants, autres revenus, réductions…).` : `, comme celle que tu as saisie.`} Si le brut estimé est loin de ta fiche de paie, vérifie que tu as bien saisi le net <i>après</i> impôt.</p>`;
}
function blocEpargneSalariale(res) {
  const A = etat.profil.abondement ?? {}, acces = A.acces ?? "?", ab = res.abondement;
  const etatAcces = { "?": "Tu n'as pas encore indiqué si ton entreprise propose une épargne salariale : c'est la première chose à vérifier.", non: "Tu as indiqué que ton entreprise ne propose pas d'épargne salariale (ou que tu n'es pas salarié).", pee: "Ton entreprise propose un PEE.", per: "Ton entreprise propose un PER d'entreprise.", les2: "Ton entreprise propose un PEE et un PER d'entreprise." }[acces] ?? "";
  let html = `<p class="small" style="margin:0 0 8px">${etatAcces} <a class="lien-fiche" href="#mon-profil">Modifier dans « Mon profil », bloc « Ton employeur »</a></p>`;
  if (ab) html += `<p class="verdict ok" style="margin:0 0 8px"><b>Argent offert par ton employeur :</b> ${eur(ab.abondementAn)} par an (${eur(ab.net)} après CSG et CRDS)${ab.mensuel > 0.5 ? `, en versant ${eur(ab.mensuel)} par mois${ab.interessement > 0 ? " et en plaçant ton intéressement" : ""}` : ab.interessement > 0 ? ", grâce à ton intéressement placé" : ""}. Sur 10 ans, cela fait ${eur(ab.net * 10)} sans compter les gains.</p>`;
  else if (acces !== "?" && acces !== "non") html += `<p class="small" style="margin:0 0 8px">Pas d'abondement indiqué. Si ton entreprise en verse un, coche « Mon employeur abonde mes versements » et indique le taux.</p>`;
  return html;
}
function blocDansTonPlanCommun(f, res) {
  const plan = etat.brouillon;
  const ids = [f.id, ...(f.couvre ?? [])];
  const vise = (env) => ids.includes(plan.enveloppes[env]?.fiche);
  const comptes = res.reeq.comptes.filter((c) => vise(c.enveloppe));
  const cons = res.consignes.filter((c) => ids.includes(c.fiche));
  let html = "";
  if (comptes.length) html += `<div class="table-wrap"><table><thead><tr><th>Compte</th><th class="m">Actuel</th><th class="m">Cible</th></tr></thead><tbody>${comptes.map((c) => `<tr><td>${f.couvre ? lienFiche(plan.enveloppes[c.enveloppe].fiche, echapper(plan.enveloppes[c.enveloppe].libelle)) : echapper(plan.enveloppes[c.enveloppe].libelle)}<div class="statut-compte">${echapper(c.texte)}</div></td><td class="m">${eur(c.actuel)}</td><td class="m">${eur(c.cible)}</td></tr>`).join("")}</tbody></table></div>`;
  const mvts = res.mouvements.filter((m) => vise(m.enveloppe) || (m.vers && vise(m.vers)));
  if (mvts.length) html += `<p class="small" style="margin:8px 0 0"><b>Ce mois-ci :</b> ${mvts.map((m) => `${m.sens === "retrait" ? "retirer" : m.sens === "arbitrage" ? "arbitrer" : "verser"} ${eur(m.montant)} ${m.sens === "versement" ? "sur" : "de"} ${echapper(plan.enveloppes[m.enveloppe].libelle)}${m.vers ? ` vers ${echapper(plan.enveloppes[m.vers].libelle)}` : ""}`).join(" ; ")}.</p>`;
  if (f.id === "residence" && res.achat) {
    const i = res.achat.ideal;
    html += `<p class="small" style="margin:0">${i ? `Âge idéal pour un bien à ${eur(res.achat.prix)} : <b>${i.age} ans</b> (apport ${eur(i.apportRequis)}, prêt ${eur(i.pret)} sur ${i.duree} ans, ${eur(i.mensualite)} par mois).` : `Bien à ${eur(res.achat.prix)} : hors de portée avant la limite du plan.`}</p>`;
  }
  if (cons.length) html += `<ul class="consignes" style="margin-top:10px">${cons.map((c) => `<li><span class="niveau ${c.niveau}">${{ action: "À faire", info: "Bon à savoir", alerte: "Attention" }[c.niveau]}</span><span>${texteLie(c.texte, f.id)}</span></li>`).join("")}</ul>`;
  return html || `<p class="small muted" style="margin:0">Ce placement n'apparaît pas dans la répartition actuelle du profil.</p>`;
}

// ---------------------------------------------------------------- épargne idéale
// Les placements à avoir, dans l'ordre où les remplir, et où tu en es pour chacun.
// statut : fait | afaire | verifier | non (pas pour toi) | plustard
const PASTILLES = { fait: "C'est fait", afaire: "À faire", verifier: "À vérifier", non: "Pas pour toi", plustard: "Plus tard" };
function produitsIdeaux(res) {
  const plan = etat.brouillon, p = normaliserProfil(etat.profil), P = p.placements ?? {};
  const H = plan.hypotheses ?? {}, A = p.abondement ?? {}, acces = A.acces ?? "?";
  const cible = (envs) => res.reeq.comptes.filter((c) => envs.includes(c.enveloppe)).reduce((t, c) => t + c.cible, 0);
  const tmi = p.tmi !== "" && p.tmi != null ? Number(p.tmi) : null;
  const age = Number(p.age) || 30;
  const L = [];

  // 1. Le coussin de sécurité
  const lep = P.lep ?? 0;
  L.push({ etape: 1, id: "lep", nom: "LEP (livret d'épargne populaire)", fiche: "lep", badge: "Si tu y as droit",
    pourquoi: "Le meilleur livret de France : plus rapporteur que le Livret A, sans risque, sans impôt, disponible à tout moment.",
    chips: ["2,5 % par an", "0 impôt", "Plafond 10 000 €", "Revenus modestes"],
    ...(!p.eligibleLEP ? { statut: "non", texte: "Réservé aux revenus modestes. Si tes revenus baissent, pense à lui : c'est le premier à remplir." }
      : lep >= 9999 ? { statut: "fait", texte: `Rempli (${eur(lep)}).` }
      : { statut: "afaire", texte: lep > 0 ? `${eur(lep)} sur 10 000 € : à compléter en premier.` : "Tu y as droit : ouvre-le et remplis-le en premier." }) });
  if (age <= 25) L.push({ etape: 1, id: "livret-jeune", nom: "Livret Jeune", fiche: "livret-jeune", badge: "De 12 à 25 ans",
    pourquoi: "Un petit livret réservé aux jeunes, souvent mieux payé que le Livret A, sans impôt.",
    chips: ["Taux ≥ Livret A", "0 impôt", "Plafond 1 600 €"],
    ...((P.livretJeune ?? 0) >= 1599 ? { statut: "fait", texte: "Rempli." } : { statut: "afaire", texte: `Tu y as droit jusqu'à tes 25 ans${(P.livretJeune ?? 0) > 0 ? ` : ${eur(P.livretJeune)} sur 1 600 €` : ""}.` }) });
  const SEC = ["lep", "livretJeune", "livretA", "ldds", "livretBancaire"];
  const secA = SEC.reduce((t, e) => t + (P[e] ?? 0), 0), secC = res.alloc?.securite ?? cible(SEC), apport = res.alloc?.projet ?? 0;
  L.push({ etape: 1, id: "livret-a", nom: "Livret A + LDDS", fiche: "livrets", badge: "Indispensable",
    pourquoi: "Ton épargne de sécurité : l'argent des imprévus (panne, perte d'emploi), garanti par l'État et disponible en un clic. C'est elle qui te permet de ne jamais vendre ta bourse au mauvais moment.",
    chips: ["1,7 % par an", "0 impôt", `Plafonds ${eur(PLAFONDS.livretA)} + ${eur(PLAFONDS.ldds)}`, "Dispo immédiate"],
    ...(secA >= secC * 0.95 ? { statut: "fait", texte: `${eur(secA)} sur tes livrets : ton épargne de sécurité (${eur(secC)} selon ton plan) est en place${apport > 0.5 ? `, et ${eur(apport)} y sont gardés pour l'apport de ton achat` : ""}.${secA - secC - apport > 2000 ? ` Le surplus (${eur(secA - secC - apport)}) travaillera mieux ailleurs : voir l'onglet Rééquilibrage.` : ""}` }
      : { statut: "afaire", texte: `${eur(secA)} sur tes livrets, pour ${eur(secC)} d'épargne de sécurité visés par ton plan.` }) });

  // 2. L'argent offert par l'employeur
  const ab = res.abondement;
  L.push({ etape: 2, id: "abondement", nom: "Épargne salariale avec abondement (PEE, PER d'entreprise)", fiche: "epargne-salariale", badge: "Si ton employeur le propose",
    pourquoi: "Le seul placement qui double ton argent le jour même : ton employeur ajoute jusqu'à 3 € pour chaque euro versé. Aucun autre produit ne rapporte autant.",
    chips: ["Jusqu'à +300 % immédiat", "Pas d'impôt sur le revenu", "Souvent 500 à 4 000 €/an offerts", "Bloqué 5 ans ou jusqu'à la retraite"],
    ...(acces === "?" ? { statut: "verifier", texte: "Demande à ton employeur s'il propose un PEE ou un PER d'entreprise avec abondement, puis indique-le dans « Mon profil »." }
      : acces === "non" ? { statut: "non", texte: "Ton employeur n'en propose pas. Si tu changes d'emploi, pose la question." }
      : !ab ? { statut: "verifier", texte: "Tu as un plan, mais pas d'abondement indiqué : vérifie le règlement du plan." }
      : ab.complet ? { statut: "fait", texte: `Tu touches tout l'abondement : ${eur(ab.abondementAn)} offerts par an.` }
      : { statut: "afaire", texte: `Tu touches ${eur(ab.abondementAn)} sur ${eur(ab.plafond)} possibles par an : verse ${eur(ab.versementAn / 12)} par mois pour tout avoir.` }) });

  // 3. Le moteur de ta richesse
  const peaV = Number(p.pea?.versements) || 0;
  L.push({ etape: 3, id: "pea", nom: "PEA (plan d'épargne en actions)", fiche: "pea", badge: "Indispensable",
    pourquoi: `Le moteur de ton patrimoine : des ETF qui suivent des milliers d'entreprises, environ ${pct(H.rendements?.bourse ?? 7)} par an en moyenne sur le long terme, et plus d'impôt sur le revenu après 5 ans.`,
    chips: [`≈ ${pct(H.rendements?.bourse ?? 7)} par an (moyenne)`, `${pct(PRELEVEMENTS.PS_CAPITAL)} sur les gains après 5 ans`, `Plafond ${eur(PLAFONDS.pea)} versés`, "Ouvrir tôt pour prendre date"],
    ...(p.pea?.ouvert ? { statut: "fait", texte: `Ouvert${p.pea.dateOuverture ? ` depuis ${new Date(p.pea.dateOuverture + "-01T12:00").toLocaleDateString("fr-FR", { month: "long", year: "numeric" })}` : ""}${(P.pea ?? 0) > 0 ? `, ${eur(P.pea)} dessus` : ""}.` }
      : { statut: "afaire", texte: "À ouvrir maintenant, même avec 10 € : le compteur des 5 ans démarre à l'ouverture." }) });

  // 4. Les cadeaux fiscaux
  const per = res.per;
  const tret = plan.per?.tmiRetraite ?? 11;
  const tauxE = per?.exact ? per.tauxEffectif : tmi, cmp = tmi != null ? comparerPERPEA(tmi, tret, 20, tauxE) : null;
  const calcul = cmp ? `100 € versés font baisser l'impôt de ${eur(tauxE)}${p.tmiEstimee ? ` (tranche estimée à ${tmi} % d'après tes revenus)` : ""}, mais ces versements seront imposés à la sortie (environ ${tret} % à la retraite). Sur 20 ans, pour 100 € par mois de ta poche : ${eur(cmp.per)} avec le PER contre ${eur(cmp.pea)} avec le PEA, après impôts, soit ${cmp.gain >= 0 ? "+" : "−"}${pct(Math.abs(cmp.gain))}.` : "";
  L.push({ etape: 4, id: "per", nom: "PER (plan d'épargne retraite)", fiche: "per", badge: "Si tu paies assez d'impôt",
    pourquoi: "L'État paie une partie de ton épargne : chaque versement baisse ton impôt de 30 à 45 %, et l'argent est investi en bourse jusqu'à la retraite (ou l'achat de ta résidence principale).",
    chips: ["−30 à −45 % d'impôt", "Investi en ETF", "Bloqué jusqu'à la retraite", "Plafond sur l'avis d'impôt"],
    ...(p.refusPER ? { statut: "non", texte: `Tu l'as écarté${per?.economiePossible > 0.5 ? ` : environ ${eur(per.economiePossible)} d'impôt par an laissés de côté` : ""}.` }
      : tmi == null ? { statut: "verifier", texte: "Indique ta tranche d'imposition dans « Mon profil » pour savoir s'il vaut le coup." }
      : per?.actif ? ((P.per ?? 0) > 0 ? { statut: "fait", texte: `Ouvert. Le plan y verse ${eur(per.mensuel)} par mois : environ ${eur(per.economie)} d'impôt en moins par an${per.exact ? "" : " (estimation à ta tranche)"}.` }
        : { statut: "afaire", texte: `À ouvrir : ${eur(per.mensuel)} par mois, environ ${eur(per.economie)} d'impôt en moins par an${per.exact ? "" : " (estimation à ta tranche)"}.` })
      : per?.raison === "pas-de-flux-bourse" ? { statut: "plustard", texte: `Intéressant pour toi : ${calcul} Mais pour l'instant toute ton épargne va à la sécurité ou à l'apport ; le plan commencera le PER ensuite.` }
      : per?.raison === "age" ? { statut: "non", texte: "Depuis 2026, les versements faits après 70 ans ne sont plus déductibles." }
      : per?.raison === "non-resident" ? { statut: "non", texte: "Réservé aux résidents fiscaux français." }
      : { statut: "non", texte: `${calcul} ${cmp && cmp.gain > 5 ? "Le gain existe, mais ton plan ne prend le PER qu'à partir d'une tranche de 30 %." : "Pas la peine de bloquer l'argent jusqu'à la retraite : le PEA fait aussi bien ou mieux."}` }) });
  const avOuverte = !!p.assuranceVie?.ouverte;
  L.push({ etape: 4, id: "assurance-vie", nom: "Assurance-vie", fiche: avOuverte ? "assurance-vie" : "meilleures-assurances-vie", badge: "Indispensable",
    pourquoi: "Le couteau suisse : disponible à tout moment, impôts allégés après 8 ans, et jusqu'à 152 500 € par enfant transmis sans droits de succession.",
    chips: ["Fiscalité douce après 8 ans", "152 500 € transmis sans droits", "Fonds euros garanti ou ETF", "Ouvrir tôt pour prendre date"],
    ...(avOuverte ? { statut: "fait", texte: `Ouverte${(P.assuranceVie ?? 0) + (P.assuranceVieUC ?? 0) > 0 ? ` (${eur((P.assuranceVie ?? 0) + (P.assuranceVieUC ?? 0))})` : ""}.` }
      : { statut: "afaire", texte: "À ouvrir maintenant avec un petit montant, en ligne et sans frais d'entrée : le compteur des 8 ans démarre à l'ouverture. Voir la fiche « Les meilleures assurances-vie »." }) });

  // 5. Quand le reste est plein
  L.push({ etape: 5, id: "cto", nom: "Compte-titres", fiche: "cto", badge: "Plus tard",
    pourquoi: "Pour continuer à investir en bourse sans limite quand le PEA est plein, ou pour les ETF qui n'entrent pas dans un PEA.",
    chips: ["Sans plafond", "31,4 % sur les gains", "Disponible"],
    ...(peaV >= 140000 || (P.cto ?? 0) > 0 ? { statut: (P.cto ?? 0) > 0 ? "fait" : "afaire", texte: (P.cto ?? 0) > 0 ? `${eur(P.cto)} dessus.` : "Ton PEA est presque plein : c'est le moment." }
      : { statut: "plustard", texte: `Quand ton PEA sera plein (${eur(peaV)} versés sur ${eur(PLAFONDS.pea)}).` }) });
  L.push({ etape: 5, id: "residence", nom: "Résidence principale", fiche: "residence", badge: "Projet de vie",
    pourquoi: "Le seul investissement qu'on peut faire avec l'argent de la banque : le crédit remplace le loyer, et la plus-value à la revente est exonérée d'impôt.",
    chips: ["Plus-value sans impôt", "Effet de levier du crédit", "Fin du loyer"],
    ...(p.proprietaire && (p.logement?.usage ?? "rp") === "rp" ? { statut: "fait", texte: "Tu es propriétaire de ton logement." }
      : p.projetRP?.actif ? { statut: "afaire", texte: res.achat?.ideal ? `Projet prévu : un bien à ${eur(res.achat.prix)}, idéalement à ${res.achat.ideal.age} ans.` : "Projet prévu : voir l'onglet Trajectoire." }
      : { statut: "plustard", texte: "Pas de projet indiqué. Tu peux en tester un dans « Mon profil »." }) });
  const paliers = plan.paliers ?? [];
  const seuil = (c) => paliers.find((x) => (x.cibles?.[c] ?? 0) > 0)?.capital;
  const div = [["bitcoin", "bitcoin"], ["or", "or physique"], ["scpi", "SCPI"]];
  const prevus = div.filter(([c]) => (res.alloc?.[c] ?? 0) > 0.5);
  L.push({ etape: 5, id: "diversification", nom: "Diversification : or, SCPI, bitcoin", fiche: "or", badge: "Plus tard",
    pourquoi: "Des petites parts qui ne bougent pas comme la bourse : l'or protège dans les crises, les SCPI versent des loyers, le bitcoin peut beaucoup monter (et beaucoup baisser).",
    chips: div.map(([c, n]) => `${n} dès ${eur(seuil(c) ?? 0)}`),
    ...(prevus.length ? { statut: "afaire", texte: `Ton plan prévoit : ${prevus.map(([c, n]) => `${n} ${eur(res.alloc[c])}`).join(", ")}.` }
      : { statut: "plustard", texte: `Pas encore : ton plan les ajoute à partir de ${eur(Math.min(...div.map(([c]) => seuil(c) ?? Infinity)))} de capital.` }) });
  return L;
}
// Ce que tu laisses sur la table chaque année
function argentPerdu(res) {
  const p = normaliserProfil(etat.profil), P = p.placements ?? {}, A = p.abondement ?? {};
  const out = [], tmi = Number(p.tmi) || 0;
  const ab = res.abondement;
  if (ab && !ab.complet) out.push(["Abondement non touché", ab.plafond - ab.abondementAn, "epargne-salariale"]);
  if ((A.acces ?? "?") === "?" && !["independant", "etudiant", "retraite"].includes(p.statutPro)) out.push(["Abondement possible, à vérifier auprès de ton employeur", null, "epargne-salariale"]);
  if (p.refusPER && res.per?.economiePossible > 0.5) out.push(["Impôt non économisé (PER écarté)", res.per.economiePossible, "per"]);
  if (p.eligibleLEP && (P.lep ?? 0) < 9999) out.push(["LEP pas rempli (2,5 % au lieu de 1,7 %)", ((PLAFONDS.lep - (P.lep ?? 0)) * 0.8) / 100, "lep"]);
  const inter = Number(A.interessement) || 0;
  if (inter > 0 && A.placer === false && !["non", "?"].includes(A.acces) && tmi > 0) out.push(["Impôt payé sur l'intéressement reçu au lieu d'être placé", economieInteressement(p, inter).economie, "epargne-salariale"]);
  if ((P.livretBancaire ?? 0) > 1000 && (P.livretA ?? 0) + (P.ldds ?? 0) < 34900) out.push(["Super livret imposé alors que le Livret A et le LDDS ne sont pas pleins", null, "livret-bancaire"]);
  return out;
}
function rendreEpargneIdeale() {
  const res = etat.resultat, el = $("#ideale");
  if (!res) { el.innerHTML = `<p class="note">Remplis d'abord « Mon profil ».</p>`; return; }
  const L = produitsIdeaux(res);
  const concernes = L.filter((x) => x.statut !== "non" && x.statut !== "plustard");
  const faits = concernes.filter((x) => x.statut === "fait").length;
  const part = concernes.length ? (100 * faits) / concernes.length : 0;
  const ETAPES = {
    1: ["Le coussin de sécurité", "Avant tout placement : de quoi faire face aux imprévus sans rien vendre. Sans risque, sans impôt, disponible tout de suite."],
    2: ["L'argent offert", "Si ton employeur ajoute de l'argent, c'est la priorité absolue : aucun placement ne rapporte autant."],
    3: ["Le moteur de ton patrimoine", "La bourse sur le long terme, dans l'enveloppe la moins imposée."],
    4: ["Les cadeaux fiscaux", "Ouvrir tôt pour prendre date, et laisser l'État payer une partie de ton épargne."],
    5: ["Quand le reste est en place", "Pour aller plus loin, une fois les bases solides."],
  };
  const carte = (x) => `<article class="produit ${x.statut}">
      <div class="tete"><h4>${lienFiche(x.fiche, echapper(x.nom))}</h4><span class="etiquette ${x.badge === "Indispensable" ? "projet" : x.badge.startsWith("Si") ? "action" : ""}">${echapper(x.badge)}</span></div>
      <p class="pourquoi">${texteLie(x.pourquoi, x.fiche)}</p>
      <ul class="chips">${x.chips.map((c) => `<li>${echapper(c)}</li>`).join("")}</ul>
      <div class="pour-toi"><span class="etat-pt ${x.statut}">${PASTILLES[x.statut]}</span><span>${echapper(x.texte)}</span></div>
    </article>`;
  const perdu = argentPerdu(res);
  const totalPerdu = perdu.reduce((t, x) => t + (x[1] ?? 0), 0);
  el.innerHTML = `
    <section class="panneau">
      <div class="ideal-tete">
        <div><h2>L'épargne idéale</h2>
          <p>Les placements qu'il faut avoir et dont il faut profiter quand on y a droit, dans l'ordre où les remplir. C'est la logique de ton plan : d'abord la sécurité, puis l'argent offert, puis la bourse dans les enveloppes les moins imposées. Pour chacun, où tu en es d'après ton profil.</p></div>
        <div class="score"><b>${faits} / ${concernes.length}</b><span>placements qui te concernent déjà en place</span><span class="jauge"><span style="width:${part}%;background:var(--accent)"></span></span></div>
      </div>
    </section>
    <section class="panneau bandeau-frais"><h3>⚠ Attention aux frais</h3><p class="small" style="margin:0">Pour chaque placement ci-dessous, ouvre-le là où les frais sont bas : 0 % sur les versements, environ 0,5 % par an, des ETF. Avec 2 % de frais par an au lieu de 0,5 %, 100 € par mois pendant 30 ans donnent 69 400 € au lieu de 91 400 €. <a class="lien-fiche" href="#fiche-frais">Tout sur les frais</a></p></section>
    ${perdu.length ? `<section class="panneau attention"><h3 style="margin:0 0 8px">Ce que tu laisses sur la table</h3>
      <div class="table-wrap"><table class="table-perdu"><tbody>${perdu.map(([t, m, f]) => `<tr><td>${lienFiche(f, echapper(t))}</td><td class="m">${m == null ? "à vérifier" : `${eur(m)} par an`}</td></tr>`).join("")}</tbody></table></div>
      ${totalPerdu > 0.5 ? `<p class="small" style="margin:8px 0 0">Au moins <b>${eur(totalPerdu)} par an</b>, soit ${eur(totalPerdu * 10)} sur 10 ans sans compter ce que cet argent aurait rapporté.</p>` : ""}</section>` : ""}
    ${Object.entries(ETAPES).map(([n, [titre, intro]]) => {
      const items = L.filter((x) => x.etape === Number(n));
      return items.length ? `<section class="etape-ideale"><h3><span class="num">${n}</span>${titre}</h3><p>${intro}</p><div class="produits">${items.map(carte).join("")}</div></section>` : "";
    }).join("")}
    <section class="panneau" style="margin-top:18px"><h3 style="margin:0 0 8px">Les règles d'or</h3>
      <ul class="points">
        <li>Ouvre tôt le PEA et l'assurance-vie, même avec 10 € : leurs avantages fiscaux dépendent de leur âge, pas du montant.</li>
        <li>Programme des versements automatiques chaque mois, le lendemain de la paie : on n'épargne pas ce qui reste, on dépense ce qui reste.</li>
        <li>Pas plus d'un mois de dépenses sur le compte courant : au-delà, l'argent perd de la valeur avec l'inflation.</li>
        <li>Ne jamais vendre sa bourse dans une crise : c'est l'épargne de sécurité qui paie les imprévus (voir la simulation de crise dans Trajectoire).</li>
        <li>Fuir les frais : pas de frais d'entrée sur une assurance-vie, des ETF plutôt que des fonds à 2 % par an.</li>
      </ul></section>
    <section class="panneau"><h3 style="margin:0 0 8px">À éviter</h3>
      <ul class="points">
        <li>Les produits « garantis » à rendement mirobolant, les placements promis sur les réseaux sociaux, le trading de produits complexes.</li>
        <li>Les contrats vendus en agence avec 3 à 5 % de frais sur chaque versement.</li>
        <li>Le super livret imposé tant que le Livret A, le LDDS (et le LEP si tu y as droit) ne sont pas pleins.</li>
        <li>Mettre toute son épargne salariale en actions de sa propre entreprise.</li>
        <li>Laisser l'intéressement ou la participation partir par défaut sans choisir les fonds.</li>
      </ul>
      <p class="small muted" style="margin:8px 0 0">Les taux et plafonds sont ceux de novembre 2026. Les détails, les cas particuliers et les sources sont dans chaque fiche.</p></section>`;
}

const HAUT_FICHES = ["frais", "lexique", "risques", "net-impot"];
// Bandeau « Attention aux frais » des fiches de placements
function bandeauFrais(f) {
  if (!f.frais?.length) return "";
  return `<section class="panneau bandeau-frais"><h3>⚠ Attention aux frais</h3>
    <p class="small">C'est ce qui fait le plus de différence sur la durée : 1 % de frais en plus par an, c'est environ 17 % de capital en moins au bout de 30 ans. Avant d'ouvrir, vérifie chaque ligne dans le document d'informations clés (DIC). <a class="lien-fiche" href="#fiche-frais">Tout sur les frais</a></p>
    <div class="table-wrap"><table><thead><tr><th>Frais</th><th>À viser</th><th>Trop cher</th></tr></thead><tbody>${f.frais.map(([t, bon, cher]) => `<tr><td><b>${echapper(t)}</b></td><td>${echapper(bon)}</td><td>${echapper(cher)}</td></tr>`).join("")}</tbody></table></div></section>`;
}
// Exemples d'abondement de grandes entreprises (fiche Épargne salariale)
const ENTREPRISES_TRIEES = [...ENTREPRISES].sort((a, b) => b.max - a.max);
function blocEntreprises() {
  const lien = ([t, u]) => `<a href="${u}" target="_blank" rel="noopener">${echapper(t)}</a>`;
  return `<p style="margin:0 0 8px">Le maximum légal (11 534 € par an) n'est presque jamais atteint. Dans les grandes entreprises, l'abondement va le plus souvent de <b>quelques centaines d'euros à environ 4 000 € par an</b>. Voici des barèmes trouvés dans des accords et des documents publics, du plus généreux au plus modeste :</p>
    <div class="table-wrap"><table class="tableau-fiche"><thead><tr><th>Entreprise</th><th>Plans</th><th>Barème</th><th class="m">Abondement maximum par an</th><th class="m">À verser pour tout toucher</th><th>Source</th></tr></thead><tbody>
    ${ENTREPRISES_TRIEES.map((e) => `<tr>
      <td class="fort">${echapper(e.nom)}<div class="small muted">${echapper(e.secteur)} · ${echapper(e.annee)}</div></td>
      <td>${echapper(e.plans)}</td>
      <td>${echapper(e.bareme)}${e.total ? `<div class="small muted">${echapper(e.total)}</div>` : ""}${e.note ? `<div class="small muted">${echapper(e.note)}</div>` : ""}</td>
      <td class="m"><b>${eur(e.max)}</b></td>
      <td class="m">${e.verser ? `${eur(e.verser)}<div class="small muted">${eur(e.verser / 12)} par mois</div>` : '<span class="muted">selon le barème</span>'}</td>
      <td class="small">${echapper(e.fiabilite)}<br>${e.sources.map(lien).join("<br>")}${e.profil ? `<br><button type="button" class="lien" data-entreprise="${echapper(e.nom)}">Tester dans mon profil</button>` : ""}</td>
    </tr>`).join("")}
    </tbody></table></div>
    <p style="margin:12px 0 6px"><b>Les offres d'actions réservées aux salariés</b> : une autre forme d'argent offert, mais investie dans une seule entreprise.</p>
    <ul class="points">${OFFRES_ACTIONS.map(([n, a, t, src]) => `<li><b>${echapper(n)}</b> (${echapper(a)}) : ${echapper(t)}. ${lien(src)}</li>`).join("")}</ul>
    <p class="note" style="margin:8px 0 0">Ces barèmes sont renégociés tous les 1 à 3 ans et peuvent varier selon la filiale ou le statut : ce sont des ordres de grandeur pour se projeter, par exemple avant de postuler. Le règlement de ton plan fait foi. Pour les barèmes par tranches, « Tester dans mon profil » utilise un taux moyen qui donne le même abondement maximum.</p>`;
}
// Top 3 des assurances-vie, avec la recommandation pour le profil
function blocTop3(f) {
  const res = etat.resultat, P = normaliserProfil(etat.profil).placements ?? {};
  let reco = "";
  if (res) {
    const a = res.alloc ?? {}, prudent = (a.prudent ?? 0) + (a.projet ?? 0), bourse = a.bourse ?? 0;
    const part = prudent + bourse > 0 ? (100 * prudent) / (prudent + bourse) : 0;
    const choix = part >= 30 ? f.top3[0] : f.top3[1];
    const av = (P.assuranceVie ?? 0) + (P.assuranceVieUC ?? 0);
    reco = `<p class="verdict ok" style="margin:0 0 12px"><b>Pour ton profil : ${echapper(choix.nom)}.</b> ${part >= 30 ? `Ton plan met environ ${pct(part)} de ta part placée (hors livrets) sur la partie prudente : le fonds en euros compte beaucoup, et celui de Linxea Spirit 2 est l'un des meilleurs.` : `Ton plan met surtout ta part placée en bourse (${pct(100 - part)}) : les frais de 0,30 % de Lucya CNP sur les ETF font la plus grande différence.`}${av > 70000 ? ` Avec ${eur(av)} en assurance-vie, ouvre aussi un contrat chez un autre assureur (Lucya Cardif par exemple) pour rester sous la garantie de 70 000 € par assureur.` : ""}</p>`;
  }
  return reco + `<div class="produits">${f.top3.map((x, i) => `<article class="produit${i === 0 ? " fait" : ""}">
      <div class="tete"><h4><span class="num-top">${i + 1}</span> ${echapper(x.nom)}</h4><span class="etiquette ${i === 0 ? "projet" : "action"}">${echapper(x.titre)}</span></div>
      <p class="small muted" style="margin:0">${echapper(x.assureur)}</p>
      <ul class="chips">${x.chiffres.map((c) => `<li>${echapper(c)}</li>`).join("")}</ul>
      <p class="pourquoi"><b>Pour qui :</b> ${texteLie(x.pourQui, f.id)}</p>
      <div><b class="small">Pourquoi on le choisit</b><ul class="arguments pour">${x.pour.map((t) => `<li>${texteLie(t, f.id)}</li>`).join("")}</ul></div>
      <div><b class="small">Ses limites</b><ul class="arguments contre">${x.contre.map((t) => `<li>${texteLie(t, f.id)}</li>`).join("")}</ul></div>
    </article>`).join("")}</div>
    <p class="note" style="margin:8px 0 0">Classement établi pour ce plan (gestion libre, ETF, fonds en euros, arbitrages gratuits) à partir des comparatifs d'octobre et novembre 2026. Aucun lien commercial avec ces contrats. Les taux et bonus changent chaque année : vérifie le DIC avant d'ouvrir.</p>`;
}
// Intéressement et participation versés par de grandes entreprises
function blocPrimes() {
  const lien = ([t, u]) => `<a href="${u}" target="_blank" rel="noopener">${echapper(t)}</a>`;
  return `<p style="margin:0 0 8px">Ces primes dépendent des résultats : elles peuvent doubler, baisser de moitié ou disparaître d'une année à l'autre. Voici ce que de grandes entreprises ont réellement versé récemment, de la plus généreuse à la plus faible :</p>
    <div class="table-wrap"><table class="tableau-fiche"><thead><tr><th>Entreprise</th><th>Période</th><th>Ce qui a été versé</th><th>Source</th></tr></thead><tbody>
    ${PRIMES.map((x) => `<tr><td class="fort">${echapper(x.nom)}</td><td class="small">${echapper(x.annee)}</td><td>${echapper(x.texte)}</td><td class="small">${lien(x.source)}</td></tr>`).join("")}
    </tbody></table></div>
    <p class="note" style="margin:8px 0 0">Montants moyens bruts par salarié en France, tirés de communiqués, d'articles de presse et de documents syndicaux (vérifiés le 13 novembre 2026). Le montant de chacun dépend souvent de son salaire et de son temps de présence. Pour ton plan, saisis plutôt une moyenne prudente de tes dernières années dans « Mon profil », champ « Intéressement + participation » : une année faible arrive toujours.</p>`;
}
function appliquerEntreprise(nom) {
  const e = ENTREPRISES.find((x) => x.nom === nom);
  if (!e?.profil) return;
  const P = e.profil;
  Object.assign(etat.profil.abondement, { acces: P.acces, actif: true, plan: P.plan ?? (P.acces === "pee" ? "pee" : "pereco"), taux: P.taux, plafond: P.plafond, surInteressement: !!P.surInteressement });
  remplirProfil();
  apresSaisieProfil();
}
document.addEventListener("click", (ev) => {
  const b = ev.target.closest?.("[data-entreprise]");
  if (!b) return;
  appliquerEntreprise(b.dataset.entreprise);
  location.hash = "#mon-profil";
  setTimeout(() => $("#ab-acces")?.scrollIntoView({ block: "center" }), 50);
});
$("#ab-exemple").innerHTML = `<option value="">Choisir une entreprise…</option>${ENTREPRISES_TRIEES.filter((e) => e.profil).map((e) => `<option value="${echapper(e.nom)}">${echapper(e.nom)} : jusqu'à ${eur(e.max)} par an</option>`).join("")}`;
$("#ab-exemple").addEventListener("change", (ev) => { const v = ev.target.value; ev.target.value = ""; if (v) appliquerEntreprise(v); });
// ---------------------------------------------------------------- simulateur « Impact des frais » (fiche Les frais)
// Valeurs de départ = profil actif ; null tant que l'utilisateur n'y a pas touché (elles suivent alors le profil).
const fraisSim = { capital: null, mensuel: null, annees: null };
document.addEventListener("profil:change", () => { fraisSim.capital = fraisSim.mensuel = fraisSim.annees = null; });
function valeursFraisSim() {
  const p = etat.profil;
  const ageRetraite = etat.brouillon?.hypotheses?.ageRetraite ?? 64;
  const parDefaut = Math.min(40, Math.max(10, ageRetraite - (Number(p.age) || 30)));
  return {
    capital: fraisSim.capital ?? Math.round(capitalDe(profilDeCalcul(p))),
    mensuel: fraisSim.mensuel ?? Math.round(Number(p.epargneMensuelle) || 0),
    annees: fraisSim.annees ?? parDefaut,
  };
}
function depensesPourFrais() {
  const p = etat.profil;
  if (Number(p.depensesMensuelles) > 0) return Number(p.depensesMensuelles);
  const reste = (Number(p.salaireNetMensuel) || 0) - (Number(p.epargneMensuelle) || 0);
  return reste > 0 ? reste : 0;
}
function graphiqueFrais(r) {
  const W = 640, H = 240, g = { l: 56, r: 12, t: 12, b: 26 };
  const max = Math.max(1, r.capitalOptimise);
  const x = (a) => g.l + ((W - g.l - g.r) * a) / r.annees;
  const y = (v) => H - g.b - ((H - g.t - g.b) * v) / max;
  const ligne = (s) => s.map((v, a) => `${a ? "L" : "M"}${x(a).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const aire = `${ligne(r.optimise)} ${r.charge.map((v, a) => `L${x(r.annees - a).toFixed(1)},${y(r.charge[r.annees - a]).toFixed(1)}`).join(" ")} Z`;
  let axes = "";
  for (const f of [0, 0.5, 1]) axes += `<line class="axe" x1="${g.l}" x2="${W - g.r}" y1="${y(max * f)}" y2="${y(max * f)}"/><text x="${g.l - 6}" y="${y(max * f) + 4}" text-anchor="end">${keur(max * f)}</text>`;
  for (const f of [0, 0.5, 1]) axes += `<text x="${x(r.annees * f)}" y="${H - 6}" text-anchor="${f === 0 ? "start" : f === 1 ? "end" : "middle"}">${f === 0 ? "départ" : `${Math.round(r.annees * f)} ans`}</text>`;
  return `<svg class="graphe fs-graphe" viewBox="0 0 ${W} ${H}" role="img" aria-label="Évolution du capital sur ${r.annees} ans avec ${FRAIS_CHARGE} % de frais par an, comparée à ${FRAIS_OPTIMISE} % de frais par an">${axes}<path class="c-ecart" d="M${aire.slice(1)}"/><path class="c-cher" d="${ligne(r.charge)}"/><path class="c-bon" d="${ligne(r.optimise)}"/></svg>`;
}
function resultatFrais(v) {
  const dep = depensesPourFrais();
  const r = comparerFrais({ capital: v.capital, mensuel: v.mensuel, annees: v.annees, depensesMensuelles: dep });
  const nbAnnees = (x) => `${(Math.round(x * 10) / 10).toLocaleString("fr-FR")} an${x >= 2 ? "s" : ""}`;
  const equivalent = r.anneesDepenses != null
    ? `Cela représente <b>${nbAnnees(r.anneesDepenses)} de dépenses</b> (${eur(dep)} par mois dans ton profil) : autant d'années de vie, ou de retraite, que les frais te prennent.`
    : `Renseigne tes dépenses (ou ton salaire) dans « Mon profil » pour voir ce que cela représente en années de dépenses.`;
  return `<div class="fs-cartes">
      <div class="fs-carte cher"><span>Contrat chargé en frais · ${pct(FRAIS_CHARGE)} par an</span><b class="num">${eur(r.capitalCharge)}</b><span>assurance-vie bancaire, fonds actifs</span></div>
      <div class="fs-carte bon"><span>Enveloppe optimisée · ${pct(FRAIS_OPTIMISE)} par an</span><b class="num">${eur(r.capitalOptimise)}</b><span>PEA + ETF</span></div>
    </div>
    <div class="fs-ecart" role="status"><span class="small">Capté par les frais en ${r.annees} an${r.annees > 1 ? "s" : ""}</span><span class="gros num">${eur(r.ecart)}</span>
      <p>Soit ${pct(r.ecartPct)} du capital que tu aurais pu avoir, pour ${eur(r.verse)} versés en tout. ${equivalent}</p>
      <p>Avec la règle des 4 %, cet écart aurait payé <b>${eur(r.renteMensuelle4pct)} par mois</b> de retraite en plus.</p></div>
    ${graphiqueFrais(r)}
    <div class="fs-legende"><span><i style="background:var(--warn)"></i>Frais ${pct(FRAIS_CHARGE)}</span><span><i style="background:var(--accent)"></i>Frais ${pct(FRAIS_OPTIMISE)}</span><span>La zone colorée est ce que les frais captent.</span></div>`;
}
function blocSimulateurFrais() {
  const v = valeursFraisSim();
  return `<div class="frais-sim" id="frais-sim">
    <div class="fs-saisie">
      <label><span>Capital de départ (€)</span><input type="number" inputmode="decimal" min="0" max="100000000" step="1000" value="${v.capital}" data-fs="capital"></label>
      <label><span>Versement mensuel (€)</span><input type="number" inputmode="decimal" min="0" max="100000" step="50" value="${v.mensuel}" data-fs="mensuel"></label>
      <label><span>Horizon : <b id="fs-annees-txt">${v.annees}</b> ans</span><input type="range" min="1" max="50" step="1" value="${v.annees}" data-fs="annees" aria-label="Horizon en années"><input type="number" inputmode="numeric" min="1" max="50" step="1" value="${v.annees}" data-fs="annees-nb" aria-label="Horizon en années (saisie)"></label>
    </div>
    <p class="small muted" style="margin:0">Valeurs de départ prises dans ton profil actif. <button type="button" class="lien" data-fs-reset>Revenir aux valeurs de mon profil</button></p>
    <div id="fs-resultat" aria-live="polite">${resultatFrais(v)}</div>
  </div>`;
}
$("#fiches").addEventListener("input", (e) => {
  const cle = e.target.dataset?.fs;
  if (!cle) return;
  const racine = e.target.closest("#frais-sim");
  const nombre = (min, max) => Math.min(max, Math.max(min, Number(String(e.target.value).replace(",", ".")) || 0));
  if (cle === "capital") fraisSim.capital = nombre(0, 1e8);
  else if (cle === "mensuel") fraisSim.mensuel = nombre(0, 1e5);
  else {
    fraisSim.annees = Math.round(nombre(1, 50));
    // curseur et champ numérique restent synchronisés (sans réécrire le champ en cours de saisie)
    for (const el of racine.querySelectorAll('[data-fs="annees"], [data-fs="annees-nb"]')) if (el !== e.target) el.value = fraisSim.annees;
    racine.querySelector("#fs-annees-txt").textContent = fraisSim.annees;
  }
  racine.querySelector("#fs-resultat").innerHTML = resultatFrais(valeursFraisSim());
});
$("#fiches").addEventListener("click", (e) => {
  if (!e.target.closest?.("[data-fs-reset]")) return;
  fraisSim.capital = fraisSim.mensuel = fraisSim.annees = null;
  rendreFiches();
});

function rendreFiches() {
  const id = location.hash.startsWith("#fiche-") ? location.hash.slice(7).split("?")[0] : null;
  const f = CONTENU_FICHES.find((x) => x.id === id);
  const verifie = new Date(VERIFIE_LE + "T12:00").toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
  if (!f) {
    const intro = `<p class="note" style="margin:0 0 12px">Un mémo par compte : ce que c'est, où l'ouvrir, comment faire, et ce que ton plan prévoit. Les mots compliqués sont expliqués dans le lexique. Informations vérifiées le ${verifie}.</p>`;
    const tout = `<div class="cartes">${CONTENU_FICHES.filter((x) => x.guide || HAUT_FICHES.includes(x.id)).map((x) => `<a class="carte carte-guide" href="#fiche-${x.id}"><span class="etiquette projet">${x.guide ? "À lire en premier" : x.id === "risques" ? "Se protéger" : x.id === "net-impot" ? "Comprendre sa paie" : x.id === "frais" ? "Attention aux frais" : "Les mots expliqués"}</span><h2>${x.titre}</h2><p>${echapper(x.accroche)}</p></a>`).join("")}</div>
      <h3 class="annee" style="margin:20px 0 8px">Une fiche par compte</h3>
      <div class="cartes">${CONTENU_FICHES.filter((x) => !x.guide && !HAUT_FICHES.includes(x.id)).map((x) => `<a class="carte" href="#fiche-${x.id}"><h2>${x.titre}</h2><p>${echapper(x.accroche)}</p></a>`).join("")}</div>`;
    const niv = niveauCourant();
    if (niv !== "debutant") { $("#fiches").innerHTML = intro + tout; return; }
    // Débutant : un parcours de 6 fiches d'abord, toutes les autres repliées (aucune fiche n'est retirée)
    const parcours = PARCOURS_DEBUTANT.map((e, i) => { const x = CONTENU_FICHES.find((y) => y.id === e.id); return x ? `<a class="carte carte-guide" href="#fiche-${x.id}"><span class="etiquette projet">Étape ${i + 1} sur ${PARCOURS_DEBUTANT.length}</span><h2>${x.titre}</h2><p>${echapper(e.phrase)}</p></a>` : ""; }).join("");
    $("#fiches").innerHTML = intro + `<h3 class="annee" style="margin:0 0 8px">Par où commencer</h3><div class="cartes" id="parcours-fiches">${parcours}</div>
      <details class="toutes-fiches" style="margin-top:20px"><summary><b>Toutes les fiches</b></summary><div style="margin-top:12px">${tout}</div></details>`;
    return;
  }
  const res = etat.resultat;
  const L = (t) => texteLie(t, f.id);
  $("#fiches").innerHTML = `<article class="fiche-detail">
    <a class="retour" href="#fiches">← Toutes les fiches</a>
    <h2 class="titre-fiche">${f.titre}</h2>
    <p class="accroche">${L(f.accroche)}</p>
    ${bandeauFrais(f)}
    ${f.guide || f.id === "lexique" ? "" : `<p class="small muted" style="margin:0">Dans ton plan : ${L(f.role)}</p>
    <section class="panneau encart"><h3>Dans ton plan, pour ce profil</h3>${res ? blocDansTonPlan(f, res) : ""}</section>`}
    <section><h3>L'essentiel</h3><dl class="essentiel">${f.essentiel.map(([k, v]) => `<div><dt>${k}</dt><dd>${L(v)}</dd></div>`).join("")}</dl></section>
    ${f.sections.map((sec) => `<section><h3>${sec.titre}</h3>${sec.special === "entreprises" ? blocEntreprises() : sec.special === "top3" ? blocTop3(f) : sec.special === "primes" ? blocPrimes() : sec.special === "simulateurFrais" ? blocSimulateurFrais() : ""}${sec.points ? `<${sec.ordonne ? "ol" : "ul"} class="points">${sec.points.map((p) => `<li>${L(p)}</li>`).join("")}</${sec.ordonne ? "ol" : "ul"}>` : ""}${sec.tableau ? `<div class="table-wrap"><table class="tableau-fiche"><thead><tr>${sec.tableau.entetes.map((h) => `<th>${echapper(h)}</th>`).join("")}</tr></thead><tbody>${sec.tableau.lignes.map((l) => `<tr>${l.map((c, i) => `<td${i === 0 ? ' class="fort"' : ""}>${L(c)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>` : ""}</section>`).join("")}
    ${f.videos?.length ? `<section><h3>En vidéo</h3><ul class="points">${f.videos.map(([t, u, n]) => `<li><a class="lien-video" href="${u}" target="_blank" rel="noopener">▶ ${echapper(t)}</a>${n ? ` <span class="muted small">${echapper(n)}</span>` : ""}</li>`).join("")}</ul></section>` : ""}
    ${f.etapes?.length ? `<section><h3>Étapes</h3><ol class="points">${f.etapes.map((p) => `<li>${L(p)}</li>`).join("")}</ol></section>` : ""}
    ${f.attention?.length ? `<section class="vigilance"><h3>Points de vigilance</h3><ul class="points">${f.attention.map((p) => `<li>${L(p)}</li>`).join("")}</ul></section>` : ""}
    <p class="note">${f.guide || f.id === "lexique" ? `Mis à jour le ${verifie}.` : `Informations vérifiées le ${verifie}. Taux, plafonds et fiscalité évoluent : les revérifier avant d'agir. Les plateformes citées sont des exemples, pas des recommandations.`}${f.sources.length ? ` Sources : ${f.sources.map(([t, u]) => `<a href="${u}" target="_blank" rel="noopener">${echapper(t)}</a>`).join(" · ")}.` : ""}</p>
  </article>`;
}

// ---------------------------------------------------------------- onglets
// ---------------------------------------------------------------- Transmission : succession et donation (calculs dans succession.js)
// Les champs « succession.* » sont liés au profil par data-p ; les montants en euros passent par eur(), donc par le mode discrétion (Alt+H).
const DETENUS_TEXTE = { pp: "pleine propriété", np: "nue-propriété", us: "usufruit", "pp+us": "pleine propriété (un quart) et usufruit" };
const SITUATION_TEXTE = { seul: "Seul(e)", mariage: "Marié(e)", pacs: "Pacsé(e)", concubin: "En concubinage" };
const OPTION_TEXTE = {
  quart_pp: "Un quart en pleine propriété", usufruit: "Usufruit de toute la succession",
  quart_pp_usufruit: "Un quart en pleine propriété et usufruit du reste", quotite_disponible: "Quotité disponible en pleine propriété",
  communaute_universelle: "Si changement de régime (notaire) : communauté universelle",
};
const heritierTexte = (h) => (h.lien === "conjoint" ? "Conjoint survivant" : h.lien === "pacs" ? "Partenaire de PACS" : h.lien === "concubin" ? "Concubin" : `Enfant ${h.id.replace("enfant", "")}`);
// ---------------------------------------------------------------- Quitter la France : exit tax et sort des comptes (fiscal.js, moteur.js)
// Les champs « simulationDepart.* » sont liés au profil par data-p ; le rendu est construit sans innerHTML (textContent) et les montants passent par eur() (mode discrétion).
const ACTION_DEPART = { conserver: "Conserver", cloturer: "Clôturer", gelerVersements: "Conserver, arrêter les versements" };
function noeudDepart(balise, texte, attrs = {}) { const e = creerChampCE(balise, attrs); if (texte != null) e.textContent = texte; return e; }
function ligneTableDepart(cellules) {
  const tr = document.createElement("tr");
  cellules.forEach(([texte, montant]) => tr.append(noeudDepart("td", texte, montant ? { class: "m num" } : {})));
  return tr;
}
function rendreDepart() {
  const bloc = $("#dp-resultat"); if (!bloc) return;
  const plan = etat.brouillon, p = etat.profil, D = { ...DEPART_DEFAUT, ...(p.simulationDepart ?? {}) };
  const select = $("#dp-pays");
  if (!select.options.length) {
    select.append(noeudDepart("option", "Choisis un pays", { value: "" }));
    for (const [code, v] of Object.entries(plan.residence?.pays ?? {})) if (code !== "FR") select.append(noeudDepart("option", v.libelle ?? code, { value: code }));
  }
  const calcul = profilPourMoteur();
  const T = tauxEffectifs(p, etat.tauxDuJour);
  const epargneEtrangere = consoliderEtrangers(p, T.taux).lignes.filter((l) => l.type === "epargneEtrangere").reduce((t, l) => t + l.soldeEUR, 0);
  const titresDefaut = Math.round((Number(calcul.placements?.cto) || 0) + epargneEtrangere);
  $("#dp-titres").placeholder = String(titresDefaut);
  const titres = D.valeurTitres == null ? titresDefaut : Number(D.valeurTitres) || 0;
  const annees = D.anneesResidence10 == null ? 10 : Number(D.anneesResidence10) || 0;
  const x = exitTax({ valeurTitres: titres, plusValuesLatentes: D.plusValuesLatentes, moinsValuesLatentes: D.moinsValuesLatentes, participation50: D.participation50 === true, anneesResidence10: annees, destination: D.destination === "autre" ? "autre" : "ue" });
  const enfants = [];
  const verdict = noeudDepart("p", null, { style: "margin:8px 0 4px" });
  verdict.append(noeudDepart("b", x.assujetti ? "Exit tax : tu serais assujetti(e)." : "Exit tax : tu ne serais pas assujetti(e)."));
  enfants.push(verdict);
  const motifs = noeudDepart("ul", null, { class: "points" });
  x.motifs.forEach((m) => motifs.append(noeudDepart("li", m)));
  enfants.push(motifs);
  if (x.assujetti) {
    const tab = noeudDepart("table"), corps = noeudDepart("tbody");
    corps.append(
      ligneTableDepart([["Base imposable (plus-values latentes moins moins-values latentes)", false], [eur(x.base), true]]),
      ligneTableDepart([["Impôt sur le revenu (prélèvement forfaitaire)", false], [eur(x.impotIR), true]]),
      ligneTableDepart([["Prélèvements sociaux", false], [eur(x.prelevementsSociaux), true]]),
      ligneTableDepart([["Total", false], [eur(x.total), true]]),
      ligneTableDepart([["Sursis de paiement", false], [x.sursis === "automatique" ? "Automatique (UE ou EEE avec convention)" : "Sur demande, avec garanties", false]]),
      ligneTableDepart([["Dégrèvement possible si les titres sont gardés", false], [`${x.degrevementApresAns} ans`, false]]),
    );
    corps.lastElementChild.previousElementSibling.previousElementSibling.classList.add("tm-ligne-total");
    tab.append(corps);
    const wrap = noeudDepart("div", null, { class: "table-wrap" }); wrap.append(tab); enfants.push(wrap);
    const notes = noeudDepart("ul", null, { class: "points small muted" });
    x.notes.forEach((m) => notes.append(noeudDepart("li", m)));
    enfants.push(notes);
  }
  // Sort de chaque compte
  const lignes = consequencesDepart(plan, calcul, D.pays || "AUTRE");
  enfants.push(noeudDepart("h3", "Sort de tes comptes", { style: "margin:12px 0 4px" }));
  if (!lignes.length) enfants.push(noeudDepart("p", "Aucun compte avec un solde à examiner (les comptes à l'étranger ne sont pas concernés).", { class: "muted", style: "margin:0" }));
  else {
    const wrap = noeudDepart("div", null, { class: "table-wrap" }), tab = noeudDepart("table"), tete = noeudDepart("thead"), tr = document.createElement("tr");
    ["Compte", "Solde", "Décision", "Pourquoi"].forEach((t, i) => tr.append(noeudDepart("th", t, i === 1 ? { class: "m" } : {})));
    tete.append(tr);
    const corps = noeudDepart("tbody");
    lignes.forEach((l) => {
      const ligne = document.createElement("tr");
      ligne.append(noeudDepart("td", l.libelle), noeudDepart("td", eur(l.solde), { class: "m num" }), noeudDepart("td", ACTION_DEPART[l.action] ?? l.action), noeudDepart("td", l.explication));
      corps.append(ligne);
    });
    tab.append(tete, corps); wrap.append(tab); enfants.push(wrap);
  }
  enfants.push(noeudDepart("p", NOTE_CONSEQUENCES_DEPART, { class: "small muted", style: "margin:8px 0 0" }));
  bloc.replaceChildren(...enfants);
}
function rendreTransmission() {
  const sortie = $("#tm-resultat"); if (!sortie) return;
  const p = etat.profil;
  rendreDepart();
  // Champs liés au profil (sauf celui qu'on est en train de saisir)
  document.querySelectorAll("#vue-transmission [data-p]").forEach((el) => {
    if (el === document.activeElement) return;
    const v = lire(p, el.dataset.p);
    if (el.type === "checkbox") el.checked = !!v; else el.value = v ?? "";
  });
  const annee = new Date().getFullYear();
  let entree, r;
  try { entree = entreeDepuisProfil(profilDeCalcul(p), annee); r = simulerSuccession(entree); }
  catch (e) { console.error(e); sortie.innerHTML = `<p class="erreur">Simulation impossible : ${echapper(e.message)}</p>`; return; }
  const sit = entree.situation, couple = sit === "mariage" || sit === "pacs", avecEnfants = entree.enfants > 0;
  $("#tm-rappel").innerHTML = `Repris de ton profil : <b>${SITUATION_TEXTE[sit]}</b> · tu as <b>${entree.ageDefunt} ans</b>${sit !== "seul" ? ` · ton conjoint ou partenaire a <b>${entree.ageConjoint} ans</b>` : ""} · <b>${entree.enfants}</b> enfant${entree.enfants > 1 ? "s" : ""}. Pour les changer, va dans <a class="lien-fiche" href="#mon-profil">Mon profil</a>.`;
  const montre = (id, on) => { const el = $(id); if (el) el.hidden = !on; };
  montre("#tm-ch-union", couple); montre("#tm-ch-regime", sit === "mariage");
  montre("#tm-ch-testament", sit === "pacs" || sit === "concubin"); montre("#tm-ch-mineur", sit === "seul" || sit === "concubin");
  montre("#tm-ch-clause", sit !== "seul");
  montre("#tm-ch-option", sit === "mariage" && avecEnfants && entree.regime !== "communaute_universelle"); montre("#tm-ch-ddv", sit === "mariage" && avecEnfants);
  montre("#tm-ch-noncommuns", sit === "mariage" && avecEnfants); montre("#tm-ch-propres", sit !== "seul" && entree.regime !== "communaute_universelle");
  $("#tm-noncommuns").max = String(entree.enfants);
  // Options du conjoint impossibles dans cette situation : grisées (« auto » reste toujours disponible) ; si la valeur enregistrée
  // est devenue impossible, simulerSuccession se replie sur le quart en pleine propriété et l'indique dans les hypothèses
  const possibles = optionsPossibles(entree);
  document.querySelectorAll("#tm-option option").forEach((o) => { o.disabled = o.value !== "auto" && !possibles.includes(o.value); });

  const M = r.masse;
  const lignesH = r.heritiers.map((h) => `<tr><td>${heritierTexte(h)}</td><td>${h.recuSuccession > 0 ? DETENUS_TEXTE[h.droitsDetenus] ?? "" : "—"}</td><td class="m">${eur(h.recuSuccession)}</td><td class="m">${eur(h.avHorsSuccession)}</td><td class="m">${eur(h.abattement)}</td><td class="m">${eur(h.droitsTotal)}</td><td class="m"><b>${eur(h.net)}</b></td></tr>`).join("");
  const synthese = `<section class="panneau" id="tm-synthese">
    <h2>Ce que tes héritiers recevraient</h2>
    <p class="small muted" style="margin:0 0 8px">Masse successorale nette : <b>${eur(M.masseNette)}</b> (actifs de la succession ${eur(M.actifBrut)}${M.abattementRP > 0 ? `, moins l'abattement de 20 % sur la résidence principale ${eur(M.abattementRP)}` : ""}, moins les dettes ${eur(M.passif)}, moins le forfait funéraire ${eur(M.forfaitFuneraire)}). L'assurance-vie et le PER sont hors succession.</p>
    ${r.heritiers.length ? `<div class="table-wrap"><table><thead><tr><th>Héritier</th><th>Reçoit en</th><th class="m">Reçu (valeur fiscale)</th><th class="m">Assurance-vie et PER</th><th class="m">Abattement</th><th class="m">Droits</th><th class="m">Net</th></tr></thead><tbody>${lignesH}
      <tr class="tm-ligne-total"><td colspan="5">Total</td><td class="m">${eur(r.totalDroits)}</td><td class="m">${eur(r.netTransmis)}</td></tr></tbody></table></div>
    <p style="margin:8px 0 0">Droits totaux : <b>${eur(r.totalDroits)}</b> · net transmis : <b>${eur(r.netTransmis)}</b> · taux effectif : <b>${pct(r.tauxEffectif)}</b></p>` : `<p class="muted">Aucun héritier modélisé dans cette situation (voir les points hors périmètre).</p>`}
    ${r.hypotheses.length ? `<ul class="points tm-liste">${r.hypotheses.map((h) => `<li>${echapper(h)}</li>`).join("")}</ul>` : ""}
    <details style="margin-top:8px"><summary class="small">Hors périmètre de cette estimation</summary><ul class="points">${r.horsPerimetre.map((h) => `<li>${echapper(h)}</li>`).join("")}</ul></details>
    <p class="note" style="margin:8px 0 0">${lienFiche("heritage", "Fiche Héritage et transmission")}</p>
  </section>`;

  let options = "";
  let lignesO = [];
  try { lignesO = comparerOptionsConjoint(entree); } catch (e) { console.error(e); }
  if (lignesO.length) {
    const meilleure = lignesO.find((l) => l.option !== "communaute_universelle");
    const corps = lignesO.map((l) => `<tr${l === meilleure ? ' class="meilleure"' : ""}><td>${OPTION_TEXTE[l.option] ?? l.option}${l === meilleure ? " (la moins chère)" : ""}</td><td class="m">${eur(l.droits1erDeces)}</td><td class="m">${eur(l.droits2eDeces)}</td><td class="m">${eur(l.total)}</td><td class="m">${eur(l.netEnfants)}</td></tr>`).join("");
    options = `<section class="panneau" id="tm-options" data-min="avance">
      <h2>Options du conjoint survivant : deux décès</h2>
      <p class="small muted" style="margin:0 0 8px">Droits payés par les enfants au premier décès, puis au second (à valeurs constantes, sans consommation du patrimoine).</p>
      <div class="table-wrap"><table><thead><tr><th>Option</th><th class="m">1er décès</th><th class="m">2e décès</th><th class="m">Total des droits</th><th class="m">Net pour les enfants</th></tr></thead><tbody>${corps}</tbody></table></div>
    </section>`;
  }
  sortie.innerHTML = synthese + options;

  // Donation de nue-propriété
  const D = p.succession?.projetDonation ?? {};
  const bloc = $("#tm-donation-resultat");
  const sansEnfant = entree.enfants <= 0;
  document.querySelectorAll("#tm-donation input").forEach((el) => { el.disabled = sansEnfant; });
  if (sansEnfant) bloc.innerHTML = `<p class="muted" style="margin:0">Indique au moins un enfant dans <a class="lien-fiche" href="#mon-profil">Mon profil</a> pour simuler une donation.</p>`;
  else if (!(Number(D.valeur) > 0)) bloc.innerHTML = `<p class="muted" style="margin:0">Saisis la valeur du bien à donner pour voir l'économie de droits.</p>`;
  else {
    let d = null;
    // Reste de la succession : part moyenne reçue par chaque enfant dans la simulation ci-dessus (elle s'ajoute au bien au décès)
    const recus = r.heritiers.filter((h) => h.lien === "enfant").map((h) => h.recuSuccession);
    const autres = recus.length ? recus.reduce((t, x) => t + x, 0) / recus.length : 0;
    try { d = simulerDonationNP({ valeur: Number(D.valeur), ageDonateur: entree.ageDefunt, enfants: entree.enfants, donations: entree.donations, annee, croissance: (Number(D.croissance) || 0) / 100, anneesAvantDeces: Number(D.annees) || 0, autresBiensParEnfant: autres }); }
    catch (e) { console.error(e); }
    bloc.innerHTML = d ? `<p style="margin:0">À ${entree.ageDefunt} ans, la nue-propriété vaut <b>${pct(d.nuePropriete)}</b> du bien, soit <b>${eur(d.valeurNP)}</b> à partager entre ${entree.enfants} enfant${entree.enfants > 1 ? "s" : ""}.</p>
      <div class="table-wrap"><table><tbody>
        <tr><td>Droits si tu donnes aujourd'hui</td><td class="m">${eur(d.droitsDonation)}</td></tr>
        ${d.droitsDecesAvecDonation > 0 || autres > 0 ? `<tr><td>Droits au décès sur le reste de la succession (donation rappelée si moins de 15 ans)</td><td class="m">${eur(d.droitsDecesAvecDonation)}</td></tr>` : ""}
        <tr><td>Droits si rien n'est donné : bien et reste de la succession transmis au décès, dans ${Number(D.annees) || 0} ans</td><td class="m">${eur(d.droitsSansDonation)}</td></tr>
        <tr class="tm-ligne-total"><td>Économie de droits</td><td class="m">${eur(d.economie)}</td></tr></tbody></table></div>
      <p class="small muted" style="margin:8px 0 4px">Le reste de ta succession (${eur(autres)} par enfant dans la simulation ci-dessus) est pris en compte : une donation de moins de 15 ans est rappelée au décès et consomme l'abattement de 100 000 €. Si le bien donné figure déjà dans tes placements ou ton logement, il est compté deux fois dans ce reste.</p>
      <p class="small muted" style="margin:8px 0 4px">Renouvellements de l'abattement de 100 000 € par enfant (tous les 15 ans) :</p>
      <ul class="points">${d.calendrier.map((l) => `<li>${l.annee}, à ${l.age} ans : ${eur(l.abattementParEnfant)} par enfant, nue-propriété à ${pct(l.nuePropriete)}</li>`).join("")}</ul>` : "";
  }
}
$("#vue-transmission").addEventListener("input", (e) => {
  const el = e.target;
  if (!el.dataset?.p) return;
  if (el.type === "number" && el.max !== "" && el.value !== "" && Number(el.value) > Number(el.max)) el.value = el.max;
  const v = el.type === "checkbox" ? el.checked : el.tagName === "SELECT" ? el.value : el.value === "" ? (el.placeholder ? null : 0) : Number(el.value);
  ecrire(etat.profil, el.dataset.p, v);
  memo.set("profil-v2", etat.profil);
  rendreTransmission();
  planifierSauvegardeProfil();
});

function rendreVue() {
  const vues = { "#epargne-ideale": "ideale", "#mon-profil": "profil", "#simulation": "profil", "#reequilibrage": "reequilibrage", "#trajectoire": "trajectoire", "#retraite": "retraite", "#transmission": "transmission", "#suivi": "suivi", "#fiches": "fiches", "#mon-plan": "plan" };
  const chemin = location.hash.split("?")[0]; // « #mon-profil?p=… » : seule la partie avant « ? » désigne l'onglet
  let vue = chemin.startsWith("#fiche-") ? "fiches" : vues[chemin] ?? "profil";
  if (!visible($(`#lien-${vue}`)?.dataset.min, niveauCourant())) { vue = "profil"; history.replaceState(null, "", "#mon-profil"); } // onglet masqué à ce niveau
  const avant = document.querySelector("section[id^='vue-']:not([hidden])")?.id;
  for (const v of ["profil", "reequilibrage", "trajectoire", "retraite", "transmission", "ideale", "suivi", "fiches", "plan"]) {
    $(`#vue-${v}`).hidden = v !== vue;
    const lien = $(`#lien-${v}`);
    if (v === vue) lien.setAttribute("aria-current", "page"); else lien.removeAttribute("aria-current");
  }
  if (vue === "trajectoire") rendreTrajectoire();
  if (vue === "retraite") rendreRetraite();
  if (vue === "transmission") rendreTransmission();
  if (vue === "suivi") { messageSuivi = ""; rendreSuivi(); }
  if (vue === "fiches") rendreFiches();
  if (vue === "ideale") rendreEpargneIdeale();
  if (avant !== `vue-${vue}` || vue === "fiches") window.scrollTo(0, 0);
}
window.addEventListener("hashchange", () => { ouvrirLienPartage(); rendreVue(); });

// ---------------------------------------------------------------- chargement du plan enregistré
// Plans enregistrés avec une version plus ancienne du modèle : on garde tes
// valeurs, mais l'ordre de remplissage des comptes reprend celui du modèle.
function migrer(stocke) {
  const plan = fusion(PLAN, stocke);
  // Les liens vers les fiches suivent toujours la version du site
  for (const [id, e] of Object.entries(PLAN.enveloppes)) if (plan.enveloppes[id]) plan.enveloppes[id].fiche = e.fiche;
  if ((stocke?.version ?? 1) < PLAN.version) {
    // Version 5 : Livret Jeune ajouté aux listes de comptes
    for (const chemin of ["residence.reserveesFrance", "achatRP.enveloppesApport"]) {
      const l = lire(plan, chemin);
      if (Array.isArray(l) && !l.includes("livretJeune")) l.splice(Math.max(0, l.indexOf("lep") + 1), 0, "livretJeune");
    }
    const maxBtc = stocke?.remplissage?.bitcoin?.find?.((e) => typeof e === "object")?.max;
    plan.remplissage = clone(PLAN.remplissage);
    // Version 6 : cold wallet à partir de 5 000 € (au lieu de 2 000 €), taux de crédit actualisé
    if (maxBtc != null && (stocke?.version ?? 1) >= 6) plan.remplissage.bitcoin[0].max = maxBtc;
    if ((stocke?.version ?? 1) < 6 && plan.achatRP?.tauxCredit === 3.3) plan.achatRP.tauxCredit = PLAN.achatRP.tauxCredit;
    // Version 7 : immobilier valorisé comme l'inflation (au lieu de 1 %), bitcoin suivi en dollars
    if ((stocke?.version ?? 1) < 7 && plan.hypotheses?.valorisationImmobiliere === 1) plan.hypotheses.valorisationImmobiliere = PLAN.hypotheses.valorisationImmobiliere;
    // Version 10 : « Comptes à l'étranger » (traités comme un compte-titres) ajoutés aux listes de comptes
    if ((stocke?.version ?? 1) < 10) {
      if (Array.isArray(plan.reequilibrage?.venteGroupee) && !plan.reequilibrage.venteGroupee.includes("comptesEtrangers")) {
        const k = plan.reequilibrage.venteGroupee.indexOf("cto");
        plan.reequilibrage.venteGroupee.splice(k >= 0 ? k + 1 : plan.reequilibrage.venteGroupee.length, 0, "comptesEtrangers");
      }
      if (plan.fiscalite?.gains && plan.fiscalite.gains.comptesEtrangers == null) plan.fiscalite.gains.comptesEtrangers = PLAN.fiscalite.gains.comptesEtrangers;
    }
    plan.version = PLAN.version;
  }
  return plan;
}

function appliquerPlanEnregistre(doc, source) {
  const plan = migrer(doc.plan);
  const etaitModifie = modifie();
  etat.reference = plan; etat.source = source; etat.majLe = doc.majLe;
  if (!etaitModifie) { etat.brouillon = clone(plan); rendreReglages(); }
  apresChangementPlan();
}

async function brancherStockage() {
  const claude = window.claude;
  const db = claude?.use ? await claude.use("db") : null;
  etat.downloads = claude?.use ? await claude.use("downloads") : null;
  const user = claude?.use ? await claude.use("user") : null;
  if (!db) {
    etat.chargement = false;
    // Sur claude.ai sans base (visiteur non connecté) : lecture seule. En local : tout est permis.
    etat.auteur = !claude;
    etat.peutEnregistrer = etat.auteur;
    const local = memo.get("planLocal");
    if (local?.plan && etat.auteur) appliquerPlanEnregistre(local, "local");
    $("#info-droits").textContent = "Enregistrement dans ce navigateur uniquement.";
    appliquerDroitsPlan();
    brancherProches(null, null, true);
    rendreStatut();
    return;
  }
  etat.db = db;
  const peutEcrire = (await user?.canEdit?.()) ?? false;
  etat.peutEnregistrer = peutEcrire;
  etat.auteur = peutEcrire;
  $("#info-droits").textContent = "Le plan enregistré est celui que voient tes proches.";
  appliquerDroitsPlan();
  brancherProches(db, user, peutEcrire);

  const minuteur = setTimeout(() => { etat.chargement = false; $("#info-droits").textContent = "Le plan enregistré n'est pas joignable pour l'instant : le plan par défaut s'affiche."; rendreStatut(); }, 10000);
  db.doc("plan/actuel").onSnapshot((snap) => {
    if (!snap.metadata?.fromCache) clearTimeout(minuteur);
    etat.chargement = false;
    if (snap.exists && snap.data()?.plan) appliquerPlanEnregistre(snap.data(), "partage");
    else {
      // Rien de partagé : reprendre un plan enregistré auparavant dans ce navigateur
      const local = memo.get("planLocal");
      if (local?.plan && !modifie() && etat.auteur) {
        etat.brouillon = migrer(local.plan); rendreReglages();
        $("#info-droits").textContent = "Plan retrouvé dans ce navigateur : enregistre-le pour que tes proches le voient.";
      }
      apresChangementPlan();
    }
  }, (err) => {
    clearTimeout(minuteur); etat.chargement = false;
    $("#info-droits").textContent = `Plan enregistré illisible (${err.code}). Le plan par défaut s'affiche.`;
    rendreStatut();
  });
}

// ---------------------------------------------------------------- scénarios hors enregistrement
// Deux situations où le profil affiché n'est PAS celui qui est enregistré (voir horsSauvegarde) :
//   • scénario partagé : ouvert par un lien « #mon-profil?p=… », remplace l'affichage sans toucher aux profils enregistrés ;
//   • simulation What-If : valeurs proposées par l'assistant, appliquées en mémoire, annulables.
function majBandeauScenario() {
  const b = $("#bandeau-scenario");
  if (!b) return;
  const partage = !!etat.partage, sim = !!etat.simulation;
  b.hidden = !(partage || sim);
  if (!b.hidden) {
    $("#bandeau-texte").textContent = partage
      ? `🔗 Scénario partagé : tu peux le modifier et le simuler, rien n'est enregistré dans tes profils.${sim ? " Une simulation What-If est en cours." : ""}`
      : "🧪 Simulation What-If en cours : rien n'est enregistré tant que tu ne gardes pas ces valeurs.";
    $("#bandeau-annuler").hidden = !sim;
    $("#bandeau-garder").hidden = !(sim && !partage);
    $("#bandeau-retour").hidden = !partage;
  }
  rendreEtatProfil();
}
const finSimulationEvt = () => document.dispatchEvent(new CustomEvent("simulation:change", { detail: { active: false } }));
const retirerParamPartage = () => { if (/[?&]p=/.test(location.hash)) history.replaceState(null, "", `${location.pathname}${location.search}#mon-profil`); };

/** Ouvre le scénario du lien courant (si présent et valide). N'écrase ni le profil enregistré ni son brouillon. */
function ouvrirLienPartage() {
  const l = lireProfilPartage();
  if (!l) return false;
  if (etat.partage === l.code) return true;
  if (profilModifie()) sauverProfilCourant(); // modifications en attente du profil enregistré : sauvées avant de passer au scénario
  const avait = !!etat.simulation;
  etat.simulation = null;
  etat.partage = l.code;
  etat.profil = l.profil;
  remplirProfil(); rendreResultats(); planifierTrajectoire();
  rendreProches(); majBandeauScenario();
  if (avait) finSimulationEvt();
  document.dispatchEvent(new CustomEvent("profil:change"));
  return true;
}
/** Quitte le scénario partagé et/ou la simulation : retour au profil enregistré (avec son brouillon). */
function retourMonProfil() {
  if (!etat.partage && !etat.simulation) return;
  const avait = !!etat.simulation, c = proches.courant, d = docCourant();
  const de = memo.get("profil-v2-de");
  const brouillon = de == null || de === `${c.col}:${c.id}` ? memo.get("profil-v2") : null;
  etat.partage = null; etat.simulation = null;
  retirerParamPartage();
  const base = c.col === "exemple" ? PROFIL_EXEMPLE : PROFIL_VIDE;
  chargerDansFormulaire(brouillon ? fusion(base, brouillon) : c.col !== "exemple" && d ? fusion(PROFIL_VIDE, d.profil) : clone(base));
  rendreProches();
  if (avait) finSimulationEvt();
  document.dispatchEvent(new CustomEvent("profil:change"));
}

/**
 * Applique un patch validé par l'assistant (liste blanche) sur une copie du profil, puis recalcule tout.
 * La simulation reste en mémoire : voir horsSauvegarde (aucune écriture du profil ni du brouillon).
 */
function appliquerSimulation(patch) {
  try {
    const avant = etat.resultat?.achat?.ideal?.age ?? null;
    if (!etat.simulation) {
      if (profilModifie()) sauverProfilCourant(); // un profil modifié à l'instant est enregistré AVANT de simuler
      etat.simulation = { base: clone(etat.profil) };
    }
    const p = clone(etat.profil);
    const ageLegalPlan = etat.brouillon.hypotheses?.ageRetraite ?? 64;
    for (const [chemin, v] of Object.entries(patch)) ecrire(p, chemin, chemin === "retraite.ageDepart" && v >= ageLegalPlan ? null : v); // l'âge du plan = pas d'arrêt anticipé
    etat.profil = completerProfil(p);
    remplirProfil(); rendreResultats(); planifierTrajectoire();
    if (!$("#vue-ideale").hidden) rendreEpargneIdeale();
    majBandeauScenario();
    const apres = etat.resultat?.achat?.ideal?.age ?? null;
    const resume = apres != null && avant != null && apres !== avant ? `Âge d'achat idéal : ${avant} → ${apres} ans. Résultats et trajectoire recalculés.`
      : apres != null && avant == null ? `Âge d'achat idéal : ${apres} ans. Résultats et trajectoire recalculés.`
      : "Résultats, rééquilibrage et trajectoire recalculés.";
    return { ok: true, resume };
  } catch (err) {
    console.error("simulation What-If", err);
    annulerSimulation();
    return { ok: false, erreur: "calcul impossible" };
  }
}
function annulerSimulation() {
  if (!etat.simulation) return false;
  const base = etat.simulation.base;
  etat.simulation = null;
  chargerDansFormulaire(base); // remet le profil d'avant et réaffiche le bandeau
  finSimulationEvt();
  return true;
}
function garderSimulation() {
  if (!etat.simulation || etat.partage) return;
  etat.simulation = null;
  memo.set("profil-v2", etat.profil);
  majBandeauScenario();
  planifierSauvegardeProfil();
  finSimulationEvt();
}
$("#bandeau-annuler").addEventListener("click", () => annulerSimulation());
$("#bandeau-garder").addEventListener("click", garderSimulation);
$("#bandeau-retour").addEventListener("click", retourMonProfil);

// Bouton « Partager ce profil » : lien magique copié dans le presse-papiers
$("#btn-partager").addEventListener("click", async () => {
  const bouton = $("#btn-partager"), msg = $("#msg-partage");
  const url = `${location.href.split("#")[0]}#mon-profil?p=${encoderProfilPartage(etat.profil, PROFIL_VIDE)}`;
  if (url.length > 8000) { msg.textContent = "Ce profil est trop volumineux pour tenir dans un lien : utilise plutôt l'export .json."; return; }
  let ok = false;
  try { await navigator.clipboard.writeText(url); ok = true; } catch {
    const t = document.createElement("textarea");
    t.value = url; t.style.position = "fixed"; t.style.opacity = "0";
    document.body.appendChild(t); t.select();
    try { ok = document.execCommand("copy"); } catch { ok = false; }
    t.remove();
  }
  if (ok) {
    bouton.textContent = "✓ Lien copié";
    setTimeout(() => { bouton.textContent = "🔗 Partager ce profil"; }, 2200);
    msg.textContent = "Lien copié. Il contient tes montants (revenus, placements…) mais ni prénom ni nom d'établissement : ne l'envoie qu'à des personnes de confiance. Les données restent dans l'adresse (après le #), elles ne sont envoyées à aucun serveur.";
  } else {
    msg.innerHTML = `Copie automatique impossible : copie ce lien à la main. <input class="texte" id="lien-partage" type="text" readonly value="${echapper(url)}" style="width:100%;margin-top:6px">`;
    $("#lien-partage").select();
  }
});

// ---------------------------------------------------------------- PWA : service worker et état du réseau
// Les calculs sont 100 % locaux : hors-ligne, seule l'IA en ligne est suspendue (assistant.js gère son propre bandeau).
function majReseau() {
  const horsLigne = navigator.onLine === false;
  document.documentElement.dataset.reseau = horsLigne ? "hors-ligne" : "en-ligne";
  const pastille = $("#indicateur-horsligne");
  if (pastille) pastille.hidden = !horsLigne;
}
window.addEventListener("online", majReseau);
window.addEventListener("offline", majReseau);
majReseau();

// Service worker : HTTPS ou localhost uniquement (contrainte du navigateur). Un échec d'enregistrement n'est jamais bloquant.
if ("serviceWorker" in navigator && (location.protocol === "https:" || ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname))) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("service-worker.js").catch((e) => console.warn("PWA : service worker non enregistré", e));
  });
}

// Alerte de millésime fiscal : bandeau d'information, masquable ; le masquage est mémorisé par appareil (jamais synchronisé)
function montrerAlerteMillesime() {
  try {
    const alerte = alerteMillesime();
    if (!alerte) return;
    const cle = `alerte-millesime-vue:${alerte.annee}`;
    let vue = false;
    try { vue = localStorage.getItem(cle) === "1"; } catch { /* stockage indisponible : on affiche le bandeau */ }
    const ancre = $("#bandeau-scenario");
    if (vue || !ancre) return;
    const b = document.createElement("div");
    b.className = "bandeau";
    b.id = "alerte-millesime";
    b.setAttribute("role", "status");
    b.style.cssText = "display:flex;align-items:center;justify-content:space-between;gap:8px 12px;flex-wrap:wrap;margin:0 0 12px";
    const texte = document.createElement("span");
    texte.textContent = alerte.texte;
    const bouton = document.createElement("button");
    bouton.type = "button";
    bouton.textContent = "Masquer";
    bouton.addEventListener("click", () => {
      try { localStorage.setItem(cle, "1"); } catch { /* sans effet bloquant */ }
      b.remove();
    });
    b.append(texte, bouton);
    ancre.insertAdjacentElement("beforebegin", b);
  } catch { /* l'alerte ne doit jamais empêcher le démarrage */ }
}

// Centre d'alertes proactives (alertes.js) : calcul local, masquage par période, par profil et par appareil (jamais synchronisé).
// Le niveau de lecture est géré en CSS par data-min ; textContent seulement (le texte vient de calculs, jamais de HTML).
let alertesCourantes = [], alertesProfil = null; // dernières alertes calculées sur le profil réel, et le profil concerné
const cleMasquageAlerte = (a) => `alerte-vue:${cleProfilCourant()}:${a.cle}`;
function afficherAlertes() {
  const bloc = $("#bloc-alertes");
  if (!bloc) return;
  const visibles = alertesCourantes.filter((a) => !memo.get(cleMasquageAlerte(a)));
  bloc.replaceChildren();
  for (const a of visibles) {
    const carte = document.createElement("div");
    carte.className = `alerte-carte ${a.niveau}`;
    if (a.min) carte.dataset.min = a.min;
    const titre = document.createElement("b"); titre.textContent = a.titre;
    const texte = document.createElement("p"); texte.textContent = a.texte;
    const actions = document.createElement("div"); actions.className = "alerte-actions";
    if (a.vue) {
      const voir = document.createElement("a");
      voir.className = "lien-fiche"; voir.href = `#${a.vue}`; voir.textContent = "Voir";
      actions.append(voir);
    }
    if (a.fiche && FICHES[a.fiche]) {
      const fiche = document.createElement("a");
      fiche.className = "lien-fiche"; fiche.href = `#fiche-${a.fiche}`; fiche.textContent = `Fiche ${FICHES[a.fiche]}`;
      actions.append(fiche);
    }
    const masquer = document.createElement("button");
    masquer.type = "button"; masquer.textContent = "Masquer";
    masquer.addEventListener("click", () => { memo.set(cleMasquageAlerte(a), true); afficherAlertes(); }); // aucun recalcul
    actions.append(masquer);
    carte.append(titre, texte, actions);
    bloc.append(carte);
  }
  bloc.hidden = visibles.length === 0;
}
// `gele` : situation future simulée. Profil partagé : aucune alerte. Simulation What-If ou situation future : on garde
// les dernières alertes du profil réel, sans rien recalculer.
function majAlertes(analyse, gele = false) {
  try {
    const bloc = $("#bloc-alertes");
    if (!bloc) return;
    if (etat.partage) { alertesCourantes = []; alertesProfil = null; bloc.replaceChildren(); bloc.hidden = true; return; }
    if (etat.simulation || gele) {
      if (alertesProfil !== cleProfilCourant()) { alertesCourantes = []; alertesProfil = null; }
      afficherAlertes();
      return;
    }
    let releves = null, reference = null;
    try { const { suivi, test } = suiviCourant(); if (!test && suivi?.releves?.length) { releves = suivi.releves; reference = suivi.reference ?? null; } } catch { /* sans Suivi : pas de bilan mensuel */ }
    try { alertesCourantes = detecterAlertes(etat.brouillon, profilPourMoteur(), { analyse, releves, reference }); alertesProfil = cleProfilCourant(); }
    catch (e) { console.warn("Alertes indisponibles", e); alertesCourantes = []; }
    afficherAlertes();
  } catch (e) { console.warn("Alertes : rendu impossible", e); }
}

// ---------------------------------------------------------------- démarrage
rendreChampsPlacements();
remplirProfil();
rendreReglages();
rendreVue();
apresChangementPlan();
montrerAlerteMillesime();
majBandeauScenario(); // lien partagé ouvert au chargement : bandeau « Scénario partagé »
// Assistant : lit le plan, le profil et le dernier résultat à chaque question (aucun état dupliqué)
monterAssistant({
  getContexte: () => ({ plan: etat.brouillon, res: etat.resultat, profil: etat.profil, niveau: niveauCourant(), tauxDuJour: etat.tauxDuJour }), // le niveau règle seulement le ton de la réponse
  getCleProfil: cleProfilCourant, // historique du chat : une clé par profil (chat-hist:<col>:<id>)
  appliquerPatch: appliquerSimulation,
  annulerSimulation,
});
brancherStockage();
demarrerSynchro();
majSelecteurNiveau();
majLibelles();
if (PREMIER_LANCEMENT) ouvrirChoixNiveau();
