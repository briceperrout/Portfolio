import { PLAN } from "./plan.js";
import { analyserTaux, DEVISES, NOM_DEVISE, devisesParDefaut, DEVISES_COMPTES, TYPES_COMPTES_ETRANGERS, tauxEffectifs, consoliderEtrangers, avecComptesEtrangers, expositionChange } from "./devises.js";
import { analyser, foyerScpiDe, capitalDe, GROUPES_PLACEMENTS, grouperAllocation, totalGroupe, groupePersonnalise, repartirGroupe, contratsApresRepartition, repartirCapitalPrudent, eur, pct, pretTauxZero, profilRisque, dureeTexte, diagnosticAchat, facteurSalaire, normaliserFoyer, equilibreContributions } from "./moteur.js";
import { projetLocatifDe, analyseLocatif, mensualitePret } from "./locatif.js";
import { fiscaliteScpi, comparerNuePropriete, delaiJouissance, TMI_PAR_DEFAUT } from "./alternatifs.js";
import { achatPourProjection, comparaisonAchatLocation, projeter, situationFuture, fluxLocatif } from "./projection.js";
import { echeancesProfil, echeancesGenerales } from "./calendrier.js";
import { genererRecapHTML, encoderProfilPartage, decoderProfilPartage } from "./recap.js";
import { FICHES as CONTENU_FICHES } from "./fiches.js";
import { LEXIQUE, lierTermes } from "./lexique.js";
import { DEPARTEMENTS, chargerPrix, chargerDepartement, departementCharge, departementDe, prixCharges, estimer, estimerLoyer, libelleCommune, chercherCommunes, codeCommune } from "./immobilier.js";
import { estimerPension, ageEnTexte } from "./pension.js";
import { decomposerSalaire, foyerFiscal, impotBareme, tauxMarginalEffectif, BAREME, PRELEVEMENTS, PFU, PLAFONDS, alerteMillesime } from "./fiscal.js";
import { plafondPEREstime, revenuImposableDe, economieInteressement, endettementBancaire, lepEstime, simulerIndependant } from "./moteur.js";
import { monterAssistant } from "./assistant.js";
import { masquerTexte, contientMontant } from "./discretion.js";
import { detecterAlertes } from "./alertes.js";
import { TYPES_CREDIT, creditsDuProfil, creditsMensuelsDe, mensualitesConso, prioriserCredits, arbitrerRemboursement } from "./credits.js";
import { NIVEAUX, INFOS_NIVEAUX, visible, reglagesAvancesActifs, niveauLePlusBas, nomVue, libelleOnglet, suiteVue } from "./niveaux.js";
import { genererCode, extraireCode, formaterCode, creerLien, estCleSynchronisable, synchroniser, effacerDistant, oublierCles } from "./sync.js";

import { $, clone, lire, ecrire, fusion, memo, crochets, cleProfilCourant, horsSauvegarde, keur, etat, echapper, DEPART_DEFAUT, PTZ_DEFAUT, SUCCESSION_DEFAUT, PROFIL_EXEMPLE, PROFIL_VIDE, proches, cle, docCourant, GEOM, ORDRE, COULEUR, TYPES_EV } from "./ui/commun.js";
import { rendreTransmission, monterTransmission } from "./vues/transmission.js";
import { rendreSuivi, monterSuivi, suiviCourant, ecrireSuivi, suivisTest, reinitialiserBrouillonReleve, ouvrirSuivi } from "./vues/suivi.js";
import { rendreFiches, rendreEpargneIdeale, monterFiches } from "./vues/fiches.js";
import { rendreTrajectoire, planifierTrajectoire, scenariosGardes, garderScenarios, monterTrajectoire } from "./vues/trajectoire.js";
import { rendreRetraite, monterRetraite } from "./vues/retraite.js";

// ---------------------------------------------------------------- outils

// Niveau de lecture (Débutant / Intermédiaire / Avancé) : lu au plus tôt pour éviter un flash d'affichage complet.
// Mémorisé par appareil (clé « niveau »), jamais synchronisé : estCleSynchronisable() ne l'accepte pas.
const NIVEAU_MEMORISE = memo.get("niveau");
const PREMIER_LANCEMENT = !NIVEAUX.includes(NIVEAU_MEMORISE);
const DONNEES_EXISTANTES = PREMIER_LANCEMENT && [memo.get("profil-v2"), memo.get("local-profils")].some((v) => v && typeof v === "object" && Object.keys(v).length > 0);
document.documentElement.dataset.niveau = PREMIER_LANCEMENT ? (DONNEES_EXISTANTES ? "avance" : "debutant") : NIVEAU_MEMORISE;

const FICHES = Object.fromEntries(CONTENU_FICHES.map((f) => [f.id, f.titre]));
export function texteLie(t, exclure) { return lierTermes(echapper(t), { exclure }); }
export function lienFiche(id, texte) { return FICHES[id] ? `<a class="lien-fiche" href="#fiche-${id}">${texte ?? `Fiche ${FICHES[id]}`}</a>` : ""; }

// ---------------------------------------------------------------- état
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

Object.assign(etat, {
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
});
const modifie = () => JSON.stringify(etat.brouillon) !== JSON.stringify(etat.reference);

// Profil passé aux calculs : le profil enregistré + le total converti des comptes étrangers dans placements.comptesEtrangers
// (dérivé ici, jamais écrit dans etat.profil, donc jamais sauvegardé, exporté ni synchronisé).
export function profilDeCalcul(profil = etat.profil) { return avecComptesEtrangers(profil, tauxEffectifs(profil, etat.tauxDuJour).taux); }
export function profilPourMoteur() { return profilDeCalcul(normaliserProfil(etat.profil)); }
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
  p.logement = { usage: "rp", origine: "achat", part: 100, typeLogement: "appartement", tauxCredit: null, assuranceCredit: 0, ...(p.logement ?? {}) };
  if (!Array.isArray(p.credits)) p.credits = []; // anciens profils : un seul crédit au logement et l'agrégat creditsMensuels
  p.projetRP = { typeLogement: "appartement", loyerEquivalent: null, chargesCoproMensuelles: null, ...(p.projetRP ?? {}), ptz: { ...PTZ_DEFAUT, ...(p.projetRP?.ptz ?? {}) } };
  const acces0 = p.abondement?.acces ?? (p.abondement?.actif ? (p.abondement.plan === "pee" ? "pee" : "per") : "?");
  p.abondement = { actif: false, plan: "pereco", taux: null, plafond: null, interessement: null, placer: true, surInteressement: false, ...(p.abondement ?? {}), acces: acces0 };
  p.succession = { ...SUCCESSION_DEFAUT, ...(p.succession ?? {}), donationAnterieure: { ...SUCCESSION_DEFAUT.donationAnterieure, ...(p.succession?.donationAnterieure ?? {}) }, projetDonation: { ...SUCCESSION_DEFAUT.projetDonation, ...(p.succession?.projetDonation ?? {}) } };
  p.simulationDepart = { ...DEPART_DEFAUT, ...(p.simulationDepart ?? {}) };
  p.scpiDetail = { partEtrangere: 0, impotEtranger: 0, delaiJouissanceMois: null, ...(p.scpiDetail ?? {}) };
  if (!Array.isArray(p.comptesEtrangers)) p.comptesEtrangers = [];
  if (!p.tauxChange || typeof p.tauxChange !== "object" || Array.isArray(p.tauxChange)) p.tauxChange = {};
  if (p.placements) delete p.placements.comptesEtrangers; // solde dérivé au calcul, jamais enregistré
  p.assuranceVie ??= {};
  if (p.assuranceVie.ouverte == null) p.assuranceVie.ouverte = !!(p.assuranceVie.type || p.assuranceVie.dateOuverture || (p.placements?.assuranceVie ?? 0) + (p.placements?.assuranceVieUC ?? 0) > 0);
  return p;
}
// Phrase sur le taux d'impôt appliqué aux loyers (tranche retenue, changement de tranche, décote)
export function A_MAX() { return etat.brouillon?.achatRP?.tauxEndettementMax ?? 35; }
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

export function normaliserProfil(source) {
  const p = clone(source);
  if (p.assuranceVie?.ouverte === false) p.assuranceVie = { ouverte: false, type: "" };
  if (p.proprietaire && (p.logement?.usage ?? "rp") === "rp") p.loyerMensuel = 0;
  if (!p.pea?.ouvert) p.pea = { ouvert: false, versements: 0 };
  p.creditsMensuels = creditsMensuelsDe(p); // liste de crédits non vide : source unique de l'agrégat
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

export function blocAchat(res) {
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

export function rendreResultats() {
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
  rendreArbitrageCredit();
  rendreScpi();
  rendreEquilibre();
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
export async function telechargerFichier(fichier, blob) {
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

export function cadre(ages, ymax) {
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
export function colonnesSurvol(ages, x, bulle, idCurseur) {
  const { W, H, g, d, h, b } = GEOM;
  const l = (W - g - d) / Math.max(1, ages.length - 1);
  return `<line id="${idCurseur}" class="curseur" x1="0" x2="0" y1="${h}" y2="${H - b}" stroke="var(--faint)" stroke-width="1" visibility="hidden"/>` +
    ages.map((a, i) => `<rect x="${x(i) - l / 2}" y="${h}" width="${l}" height="${H - b - h}" fill="transparent" data-x="${x(i)}" data-curseur="${idCurseur}" data-bulle="${echapper(bulle(i))}"/>`).join("");
}
// Maximum de l'axe : 4 graduations « rondes »
export function echelle(v) {
  const brut = Math.max(1, v * 1.04) / 4, mag = Math.pow(10, Math.floor(Math.log10(brut)));
  const pas = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].map((k) => k * mag).find((x) => x >= brut);
  return pas * 4;
}

monterTrajectoire(); // écouteurs de l'onglet Trajectoire (vues/trajectoire.js), attachés à cet endroit comme avant le découpage
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
// ---------------------------------------------------------------- retraite
monterRetraite(); // écouteurs de l'onglet Retraite (vues/retraite.js), attachés à cet endroit comme avant le découpage
// PER et PEA pour un même effort de 100 € par mois pendant n ans à 6 % par an, sortie en capital
// tauxEffectif : taux réel d'économie d'impôt du versement (économie exacte ÷ versement) ; à défaut, la tranche
export function comparerPERPEA(tmi, tret, n = 20, tauxEffectif = tmi) {
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
crochets.ecriture = (k) => {
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
export function siNiveau(min, fn) { return visible(min, niveauCourant()) ? fn() : ""; }
export function niveauCourant() { const n = document.documentElement.dataset.niveau; return NIVEAUX.includes(n) ? n : "avance"; }
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
export function syncRetraite0() {
  const rr = etat.profil.retraite ?? {};
  for (const [id, k] of [["#r0-revenu", "revenu"], ["#r0-age", "ageDepart"], ["#r0-pension", "pension"]]) { const el = $(id); if (el && document.activeElement !== el) el.value = rr[k] ?? ""; }
  majAideRetraite0();
}
export function choisirAgeDepart(a) {
  etat.profil.retraite ??= {};
  etat.profil.retraite.ageDepart = a >= (etat.brouillon.hypotheses.ageRetraite ?? 64) ? null : a;
  memo.set("profil-v2", etat.profil);
  syncRetraite0();
  planifierSauvegardeProfil();
  rendreRetraite();
}

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
export function creerChampCE(balise, attrs) { const e = document.createElement(balise); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; }
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
// ---------------------------------------------------------------- crédits en cours et arbitrage « rembourser ou placer » (credits.js)
// Liste dans profil.credits ; quand elle n'est pas vide, elle devient la source de creditsMensuels (champ « Dont mensualités » en lecture seule).
// Aucune valeur saisie n'entre dans le DOM autrement que par value / textContent.
const nouvelIdCredit = () => `cr-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const nd = (balise, attrs = {}, ...enfants) => { const e = document.createElement(balise); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); e.append(...enfants); return e; };
function champCredit(libelle, controle) { const l = nd("label", { class: "ligne-credit-etiq" }); l.append(libelle, controle); return l; }
function ligneCredit(c) {
  const ligne = nd("div", { class: "ligne-credit", "data-cr-id": c.id });
  const type = nd("select", { "data-cr": "type", "aria-label": "Type de crédit" });
  for (const [id, nom] of Object.entries(TYPES_CREDIT)) { const o = nd("option", { value: id }); o.textContent = nom; type.append(o); }
  type.value = c.type in TYPES_CREDIT ? c.type : "autre";
  const nombreChamp = (cle, etiquette, attrs, valeur) => { const i = nd("input", { type: "number", min: "0", "data-cr": cle, ...attrs }); i.value = valeur != null && valeur !== "" && valeur !== 0 ? valeur : ""; return champCredit(etiquette, i); };
  const libelle = nd("input", { type: "text", maxlength: "60", "data-cr": "libelle", placeholder: "Libellé (facultatif)", "aria-label": "Libellé du crédit" });
  libelle.value = c.libelle ?? "";
  const fin = nd("input", { type: "month", "data-cr": "finCredit", "aria-label": "Date de fin du crédit" });
  fin.value = typeof c.finCredit === "string" ? c.finCredit : "";
  const variable = nd("input", { type: "checkbox", "data-cr": "tauxVariable" });
  variable.checked = !!c.tauxVariable;
  const lVariable = nd("label", { class: "coche" }); lVariable.append(variable, " Taux variable");
  const suppr = nd("button", { type: "button", class: "lien", "data-cr-suppr": c.id, "aria-label": "Supprimer ce crédit" });
  suppr.textContent = "Supprimer";
  ligne.append(
    champCredit("Type", type), champCredit("Libellé", libelle),
    nombreChamp("capitalRestant", "Capital restant dû (€)", { step: "100" }, c.capitalRestant),
    nombreChamp("taux", "Taux annuel (%)", { step: "0.05", max: "30" }, c.taux),
    champCredit("Fin du crédit", fin),
    nombreChamp("mensualite", "Mensualité hors assurance (€, facultatif)", { step: "10", placeholder: "calculée" }, c.mensualite),
    nombreChamp("assuranceMensuelle", "Assurance (€/mois)", { step: "1" }, c.assuranceMensuelle),
    lVariable,
  );
  if (c.type === "immo") {
    const usage = nd("select", { "data-cr": "usage", "aria-label": "Usage du bien" });
    for (const [v, t] of [["residence", "Résidence"], ["locatif", "Bien locatif"]]) { const o = nd("option", { value: v }); o.textContent = t; usage.append(o); }
    usage.value = c.usage === "locatif" ? "locatif" : "residence";
    const reel = nd("input", { type: "checkbox", "data-cr": "regimeReel" });
    reel.checked = !!c.regimeReel;
    const lReel = nd("label", { class: "coche" }); lReel.append(reel, " Régime réel (intérêts déduits)");
    ligne.append(champCredit("Usage du bien", usage), lReel);
  }
  ligne.append(suppr);
  return ligne;
}
function majCreditsDerives() {
  const p = etat.profil, actif = Array.isArray(p.credits) && p.credits.length > 0;
  const champ = $("#p-credits");
  if (actif) {
    if (p.creditsMensuelsSaisis == null) p.creditsMensuelsSaisis = Number(p.creditsMensuels) || 0; // valeur saisie avant la liste
    p.creditsMensuels = mensualitesConso(p);
  } else if (p.creditsMensuelsSaisis != null) {
    p.creditsMensuels = p.creditsMensuelsSaisis; // liste vidée : retour à la mensualité saisie
    delete p.creditsMensuelsSaisis;
  }
  if (champ) { champ.readOnly = actif; champ.value = p.creditsMensuels; }
  const note = $("#note-credits-derives"); if (note) note.hidden = !actif;
}
function rendreCredits() {
  const liste = $("#liste-credits"); if (!liste) return;
  liste.replaceChildren(...(etat.profil.credits ?? []).map(ligneCredit));
  majCreditsDerives();
}
function saisieCredit(el) {
  const c = (etat.profil.credits ?? []).find((x) => x.id === el.closest("[data-cr-id]")?.dataset.crId);
  if (!c || !el.dataset.cr) return;
  const k = el.dataset.cr, v = el.value;
  if (k === "type") { if (v in TYPES_CREDIT) { c.type = v; if (v !== "immo") { delete c.usage; delete c.regimeReel; } if (v === "revolving") c.tauxVariable = true; rendreCredits(); } }
  else if (k === "libelle") c.libelle = v.slice(0, 60);
  else if (k === "finCredit") c.finCredit = /^\d{4}-\d{2}$/.test(v) ? v : null;
  else if (k === "usage") c.usage = v === "locatif" ? "locatif" : "residence";
  else if (k === "tauxVariable" || k === "regimeReel") c[k] = el.checked;
  else if (k === "taux" || k === "mensualite") c[k] = v === "" || !Number.isFinite(Number(v)) ? null : Math.max(0, Number(v));
  else if (k === "capitalRestant" || k === "assuranceMensuelle") c[k] = v === "" ? 0 : Math.max(0, Number(v) || 0);
  majCreditsDerives();
  apresSaisieProfil();
}
$("#bloc-credits").addEventListener("click", (e) => {
  const b = e.target.closest("button"); if (!b) return;
  if (b.id === "ajout-credit") {
    (etat.profil.credits ??= []).push({ id: nouvelIdCredit(), type: "conso", libelle: "", capitalRestant: 0, taux: null, finCredit: null, mensualite: null, assuranceMensuelle: 0, tauxVariable: false });
    rendreCredits();
    $("#liste-credits .ligne-credit:last-child [data-cr='capitalRestant']")?.focus();
    apresSaisieProfil();
  } else if (b.dataset.crSuppr) {
    etat.profil.credits = (etat.profil.credits ?? []).filter((c) => c.id !== b.dataset.crSuppr);
    rendreCredits();
    apresSaisieProfil();
  }
});

// Arbitrage : les listes déroulantes ne sont reconstruites que si leurs options changent (le focus et la saisie restent en place)
const ENVELOPPES_ARBITRAGE = ["livretA", "ldds", "assuranceVie", "pea", "cto", "per"];
function majOptions(select, options) {
  const signature = JSON.stringify(options);
  if (select.dataset.signature === signature) return;
  const avant = select.value;
  select.replaceChildren(...options.map(([v, t]) => { const o = nd("option", { value: v }); o.textContent = t; return o; }));
  select.dataset.signature = signature;
  if (options.some(([v]) => v === avant)) select.value = avant;
}
const montantNum = (v) => nd("b", { class: "num" }, eur(v));
const ligneTexte = (...parts) => nd("p", { class: "small", style: "margin:0" }, ...parts);
function rendreArbitrageCredit() {
  const zone = $("#res-arbitrage-credit"), liste = $("#liste-priorite-credits");
  if (!zone || !liste) return;
  try {
    const plan = etat.brouillon, profil = profilPourMoteur(), auj = new Date();
    const P = prioriserCredits(plan, profil, auj);
    // Liste priorisée : du crédit le plus coûteux au moins coûteux
    const nomCredit = (c) => c.libelle || TYPES_CREDIT[c.type];
    if (!P.credits.length && !P.exclus.length) {
      liste.replaceChildren(nd("p", { class: "note", style: "margin:0" }, "Aucun crédit renseigné : ajoute-les ci-dessus ou dans « Ton logement »."));
      zone.replaceChildren(); majOptions($("#arb-credit"), []);
      return;
    }
    const items = P.credits.map((c) => {
      const li = nd("li", { class: "small" });
      li.append(`${nomCredit(c)} : coût ${pct(c.coutNet)}${c.coutNet !== c.taux ? ` net d'impôt (taux ${pct(c.taux)})` : ""}, reste `, montantNum(c.capitalRestant), `, indemnité éventuelle `, montantNum(c.iraTotale), c.prioritaire ? ` : coûte plus que l'épargne sans risque (${pct(P.rendementNetPrudent)})` : ` : moins cher que l'épargne sans risque (${pct(P.rendementNetPrudent)})`);
      return li;
    });
    const ex = P.exclus.map((c) => nd("li", { class: "small muted" }, `${nomCredit(c)} : ${c.motif}`));
    liste.replaceChildren(nd("p", { class: "note", style: "margin:0 0 4px" }, "Du plus coûteux au moins coûteux :"), nd("ol", { class: "liste-priorite-credits" }, ...items, ...ex));

    const creditsListe = creditsDuProfil(profil, auj).filter((c) => c.type !== "ptz" && !c.incomplet && c.capitalRestant > 0);
    majOptions($("#arb-credit"), creditsListe.map((c) => [c.id, `${nomCredit(c)} (${pct(c.taux)})`]));
    majOptions($("#arb-enveloppe"), ENVELOPPES_ARBITRAGE.filter((id) => plan.enveloppes?.[id]).map((id) => [id, plan.enveloppes[id].libelle]));
    const credit = creditsListe.find((c) => c.id === $("#arb-credit").value) ?? creditsListe[0];
    if (!credit) { zone.replaceChildren(nd("p", { class: "note", style: "margin:0" }, "Complète le taux, la fin et le capital restant d'un crédit pour simuler un remboursement.")); return; }
    const saisi = $("#arb-capital").value === "" ? credit.capitalRestant : Math.max(0, Number($("#arb-capital").value) || 0);
    const a = arbitrerRemboursement(plan, profil, credit, saisi, { mode: $("#arb-mode").value, enveloppe: $("#arb-enveloppe").value, ira: $("#arb-ira").value, aujourdhui: auj });
    const sorties = [];
    if (a.verdict !== "sans-objet") {
      const compare = a.rendementGaranti != null ? `${pct(a.rendementGaranti)} par an pour le remboursement (certain), contre ${pct(a.rendementNetEspere)} net espéré pour le placement${a.prime > 0 ? `, auquel j'ajoute ${pct(a.prime)} de prime de risque` : ""}.` : "Rendement du remboursement indéterminé.";
      sorties.push(
        ligneTexte("Indemnité de remboursement : ", montantNum(a.ira), ` (${a.regle}).`),
        ligneTexte("Intérêts économisés : ", montantNum(a.interetsEconomises), " ; assurance économisée : ", montantNum(a.assuranceEconomisee), "."),
        ligneTexte("Gain certain, indemnité déduite : ", nd("b", { class: "num" }, `${a.gainCertain >= 0 ? "+" : "−"}${eur(Math.abs(a.gainCertain))}`), "."),
        ligneTexte("À la fin du crédit, après impôt : ", montantNum(a.valeurRembourser), " en remboursant, contre ", montantNum(a.valeurPlacer), " en plaçant ", montantNum(a.sortie), " (écart ", nd("b", { class: "num" }, `${a.ecart >= 0 ? "+" : "−"}${eur(Math.abs(a.ecart))}`), ")."),
        ligneTexte(compare),
        nd("p", { class: "verdict-credit small", style: "margin:0" }, a.verdict === "rembourser"
          ? "Rembourser semble l'emporter : l'économie d'intérêts est certaine et dépasse ce que le placement peut raisonnablement rapporter."
          : "Placer semble l'emporter, mais ce rendement n'est pas garanti : le crédit, lui, coûte à coup sûr."),
      );
    }
    if (a.avertissements.length) sorties.push(nd("ul", { class: "small", style: "margin:0;padding-left:18px" }, ...a.avertissements.map((t) => nd("li", {}, t))));
    sorties.push(nd("p", { class: "note", style: "margin:0" }, "Simulation indicative, fondée sur des hypothèses de rendement du plan : le décompte exact vient de ta banque. ", ...(FICHES["remboursement-anticipe"] ? [nd("a", { class: "lien-fiche", href: "#fiche-remboursement-anticipe" }, `Fiche ${FICHES["remboursement-anticipe"]}`)] : [])));
    zone.replaceChildren(...sorties);
  } catch (e) { console.warn("Arbitrage crédit indisponible", e); }
}

// SCPI : taux global d'imposition du foyer (tranche réelle, part européenne) et comparaison nue-propriété / pleine propriété (alternatifs.js)
const nombreOuNull = (v) => (v === "" || v == null || !Number.isFinite(Number(v)) ? null : Number(v));
function rendreScpi() {
  const note = $("#res-scpi");
  if (!note) return;
  try {
    const profil = profilPourMoteur(), d = profil.scpiDetail ?? {};
    const r = fiscaliteScpi(foyerScpiDe(profil), 1000, { partEtrangere: d.partEtrangere, impotEtranger: d.impotEtranger });
    note.textContent = `Taux global d'imposition de tes revenus SCPI : ${pct(r.tauxGlobal)} (${r.mode === "exact" ? "calculé sur ton revenu imposable" : `estimé à partir de ta tranche${r.tmiEstimee ? ` (${TMI_PAR_DEFAUT} % par défaut, tranche inconnue)` : ""}`}). Il alimente l'impôt à la sortie de tes SCPI dans les projections.`;
  } catch (e) { console.warn("Fiscalité SCPI indisponible", e); }
  rendreNuePropriete();
}
function rendreNuePropriete() {
  const zone = $("#res-nue-propriete");
  if (!zone) return;
  try {
    const plan = etat.brouillon, profil = profilPourMoteur(), d = profil.scpiDetail ?? {}, H = plan.hypotheses ?? {};
    const montant = nombreOuNull($("#np-montant").value) ?? 0;
    const distribution = nombreOuNull($("#np-distribution").value) ?? H.rendements?.scpi ?? 0;
    const frais = nombreOuNull($("#np-frais").value) ?? H.fraisEntree?.scpi ?? 0;
    $("#np-distribution").placeholder = `${String(H.rendements?.scpi ?? 0).replace(".", ",")} (plan)`;
    $("#np-frais").placeholder = `${String(H.fraisEntree?.scpi ?? 0).replace(".", ",")} (plan)`;
    if (!(montant > 0)) { zone.replaceChildren(nd("p", { class: "note", style: "margin:0" }, "Saisis un montant pour lancer la comparaison.")); return; }
    const fisc = fiscaliteScpi(foyerScpiDe(profil), (montant * distribution) / 100, { partEtrangere: d.partEtrangere, impotEtranger: d.impotEtranger });
    const c = comparerNuePropriete({ montant, dureeAns: Number($("#np-duree").value), tauxDistribution: distribution, revalorisation: nombreOuNull($("#np-reval").value) ?? 0,
      decote: nombreOuNull($("#np-decote").value), fraisEntree: frais, delaiJouissanceMois: delaiJouissance(H, d.delaiJouissanceMois), tauxFiscal: fisc.tauxGlobal });
    if (!c) { zone.replaceChildren(); return; }
    const signe = (x) => `${x >= 0 ? "+" : "−"}${Math.abs(x).toLocaleString("fr-FR", { maximumFractionDigits: 1 })}`;
    zone.replaceChildren(
      ligneTexte(`Décote de la nue-propriété : ${pct(c.decote)} (${c.decoteEstimee ? "estimée" : "saisie"}). Valeur des parts en pleine propriété à l'échéance : `, montantNum(c.valeurFinaleNP), "."),
      ligneTexte(`Rendement annuel (TRI) : ${pct(c.triNP)} en nue-propriété, contre ${pct(c.triPP)} en pleine propriété, revenus nets d'impôt au taux de ${pct(fisc.tauxGlobal)} (écart ${signe(c.ecart)} point${Math.abs(c.ecart) >= 2 ? "s" : ""}).`),
      ligneTexte("Revenus nets reçus en pleine propriété sur la période : ", montantNum(c.revenusNetsPP), "."),
      nd("ul", { class: "small", style: "margin:0;padding-left:18px" }, ...c.avertissements.map((t) => nd("li", {}, t))),
    );
  } catch (e) { console.warn("Nue-propriété indisponible", e); }
}

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
  const dep = departementDe({ codeInsee: code }); if (!dep) return;
  const lieu = (etat.profil[base] ??= {});
  lieu.codeInsee = code; lieu.commune = libelleCommune(code); lieu.departement = dep;
  $(`#${base}-commune`).value = lieu.commune; $(`#${base}-dep`).value = dep;
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
    if (!departementCharge(departementDe(lieu))) {
      out.innerHTML = '<span class="muted small">Chargement des prix…</span>';
      chargerDepartement(departementDe(lieu)).then(majEstimations).catch((e) => { out.innerHTML = `<span class="small">Prix indisponibles ici (${echapper(e.message)}) : indique le montant toi-même.</span>`; });
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
    if (est?.horsDvf) morceaux.push(`<span class="small">Pas de prix DVF pour ce département : l'Alsace-Moselle et Mayotte relèvent du livre foncier. Saisis le prix du bien toi-même.</span>`);
    else if (!est || est.introuvable) morceaux.push(`<span class="small">Pas de données de ventes ici : indique le prix toi-même.</span>`);
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
export function remplirProfil() {
  (etat.profil.foyer ??= {}).situation = situationDe(etat.profil);
  if (etat.profil.foyer.actif && etat.profil.foyer.statut === "concubin" && !etat.profil.foyer.vue) etat.profil.foyer.vue = "foyer"; // anciens profils : épargne saisie pour le couple
  document.querySelectorAll("#profil [data-p]").forEach((el) => {
    const v = lire(etat.profil, el.dataset.p);
    if (el.type === "checkbox") el.checked = !!v; else el.value = v ?? "";
  });
  remplirAV();
  remplirPlacementsDebutant();
  rendreComptesEtrangers();
  rendreCredits();
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
  document.querySelectorAll(".ligne-marie").forEach((e) => { e.hidden = !marie; });
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
export function apresSaisieProfil() {
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
// Équilibre des contributions aux charges du foyer (Profil) : texte issu de equilibreContributions ; le MutationObserver de la discrétion masque les montants à l'insertion.
function rendreEquilibre() {
  const sortie = $("#eq-resultat"); if (!sortie) return;
  let r = null;
  try { r = equilibreContributions(profilPourMoteur(), etat.brouillon); } catch (e) { console.error(e); }
  if (!r) { sortie.innerHTML = ""; sortie.hidden = true; return; }
  sortie.hidden = false;
  if (!r.disponible) { sortie.innerHTML = `<p class="note" style="margin:0">Renseigne la part des dépenses du foyer payée par ton conjoint pour vérifier que chacun contribue à proportion de ses revenus.</p>`; return; }
  const prenom = etat.profil.conjoint?.prenom?.trim() || "Ton conjoint";
  const nom = r.surcontributeur === "B" ? prenom : "Toi";
  let texte;
  if (Math.abs(r.ecart) < 1) texte = "Contributions équilibrées : chacun paie la part qui correspond à ses revenus.";
  else {
    texte = `${nom === "Toi" ? "Tu paies" : `${echapper(prenom)} paie`} <b>${eur(Math.abs(r.ecart))}</b> par mois de plus que la répartition proportionnelle aux revenus. ${r.surcontributeur === "B" ? `Un virement de <b>${eur(r.virementMensuel)}</b> par mois de ta part vers ${etat.profil.conjoint?.prenom?.trim() ? echapper(prenom) : "ton conjoint"} rééquilibrerait les contributions.` : `Un virement de <b>${eur(r.virementMensuel)}</b> par mois de la part de ${etat.profil.conjoint?.prenom?.trim() ? echapper(prenom) : "ton conjoint"} vers toi rééquilibrerait les contributions.`}`;
    texte += r.separatif
      ? ` Sur ${r.horizonAns} ans, ${nom === "Toi" ? "tu n'accumules pas" : `${echapper(prenom)} n'accumule pas`} environ <b>${eur(r.manqueAGagner)}</b> (rendement prudent du plan, ${pct(r.rendement)} par an) : en séparation de biens, en PACS ou en concubinage, l'épargne reste à celui qui la constitue.`
      : " En communauté, l'épargne issue des revenus appartient au couple : cet écart ne crée pas de différence de patrimoine.";
  }
  sortie.innerHTML = `<div class="table-wrap"><table><thead><tr><th></th><th class="m">Contribution à proportion des revenus</th><th class="m">Payé aujourd'hui</th></tr></thead><tbody>
    <tr><td>Toi</td><td class="m">${eur(r.theoriqueA)}</td><td class="m">${eur(r.payeA)}</td></tr>
    <tr><td>${echapper(prenom)}</td><td class="m">${eur(r.theoriqueB)}</td><td class="m">${eur(r.payeB)}</td></tr></tbody></table></div>
    <p class="small" style="margin:8px 0 0">${texte}</p>`;
}
$("#profil").addEventListener("input", (e) => {
  const el = e.target;
  if (el.closest("#bloc-comptes-etrangers")) { saisieComptesEtrangers(el); return; }
  if (el.closest("#bloc-credits")) { saisieCredit(el); return; }
  if (el.closest("#bloc-arbitrage-credit")) { rendreArbitrageCredit(); return; }
  if (el.closest("#bloc-nue-propriete")) { rendreNuePropriete(); return; }
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
const profilModifie = () => !horsSauvegarde() && proches.courant.col !== "exemple" && proches.reference && JSON.stringify(etat.profil) !== JSON.stringify(proches.reference);
const nouvelId = () => (etat.db ? etat.db.collection("profils").doc().id : `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`);

// Stockage : base partagée si disponible, sinon ce navigateur
export async function ecrireDoc(col, id, data) {
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
  reinitialiserBrouillonReleve();
  proches.zone = null;
  if (c.col === "exemple") { proches.reference = null; chargerDansFormulaire(clone(PROFIL_EXEMPLE)); }
  else { const d = docCourant(); proches.reference = fusion(PROFIL_VIDE, d?.profil); chargerDansFormulaire(proches.reference); }
  proches.statut = "";
  rendreProches();
  document.dispatchEvent(new CustomEvent("profil:change")); // l'assistant recharge l'historique de ce profil
}

export function planifierSauvegardeProfil() {
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

monterSuivi(); // écouteurs de la vue Suivi et du calendrier (vues/suivi.js), attachés à cet endroit comme avant le découpage

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
    { c: "fiscalite.gains.scpi", l: "SCPI (vide : suit ta tranche d'imposition)", u: "%", pas: 0.1, vide: true },
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

monterFiches(); // écouteurs des vues Fiches / Épargne idéale (vues/fiches.js), attachés à cet endroit comme avant le découpage

monterTransmission(); // écouteurs de la vue Transmission (vues/transmission.js), attachés à cet endroit comme avant le découpage

// ---------------------------------------------------------------- onglets
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
  if (vue === "suivi") ouvrirSuivi();
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
    // Version 11 : la fiscalité des SCPI suit la tranche réelle du foyer (l'ancienne valeur figée, 30 % + prélèvements sociaux, redevient « automatique »)
    if ((stocke?.version ?? 1) < 11 && plan.fiscalite?.gains && plan.fiscalite.gains.scpi === 30 + PRELEVEMENTS.PS_PATRIMOINE) plan.fiscalite.gains.scpi = null;
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
