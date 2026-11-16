import { PLAN } from "./plan.js";
import { analyser, eur, pct, profilRisque, dureeTexte, diagnosticAchat, facteurSalaire, carriereDe, hausseReelle, normaliserFoyer } from "./moteur.js";
import { projetLocatifDe, analyseLocatif } from "./locatif.js";
import { projeter, projeterCentral, referenceSuivi, situationFuture, contexteRetraite, evaluerRetraite, CRISES, simulerCrise, fluxLocatif } from "./projection.js";
import { SCENARIOS_FISCAUX, NEUTRE, optionFiscale, comparerTaux } from "./evolution-fiscale.js";
import { echeancesProfil, echeancesGenerales, versCSV } from "./calendrier.js";
import { genererRecapHTML, encoderProfilPartage, decoderProfilPartage } from "./recap.js";
import { FICHES as CONTENU_FICHES, VERIFIE_LE } from "./fiches.js";
import { LEXIQUE, lierTermes } from "./lexique.js";
import { DEPARTEMENTS, chargerPrix, prixCharges, estimer, estimerLoyer, libelleCommune, chercherCommunes, codeCommune } from "./immobilier.js";
import { estimerPension, ageEnTexte } from "./pension.js";
import { decomposerSalaire, foyerFiscal, impotBareme, BAREME } from "./fiscal.js";
import { ENTREPRISES, OFFRES_ACTIONS, PRIMES } from "./entreprises.js";
import { plafondPEREstime, endettementBancaire, lepEstime } from "./moteur.js";
import { monterAssistant } from "./assistant.js";

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
const memo = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) {
    try {
      // Scénario partagé ou simulation What-If en cours : le brouillon enregistré du profil n'est jamais écrasé
      if (k === "profil-v2" && horsSauvegarde()) return;
      localStorage.setItem(k, JSON.stringify(v));
      // Le brouillon du formulaire est rattaché au profil sélectionné : il ne se mélange pas avec un autre profil
      if (k === "profil-v2") localStorage.setItem("profil-v2-de", JSON.stringify(cleProfilCourant()));
    } catch {}
  },
};
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
const PROFIL_EXEMPLE = {
  age: 32, salaireNetMensuel: 3200, epargneMensuelle: 1000, depensesMensuelles: 1800, tmi: "30",
  pays: "FR", statutPro: "stable", eligibleLEP: false, creditsMensuels: 0,
  futur: { actif: false, age: 40, capital: null, salaire: null, epargne: null },
  proprietaire: false, loyerMensuel: 900,
  placements: { livretA: 22950, ldds: 12000, livretBancaire: 5050, assuranceVie: 25000, assuranceVieUC: 0, pea: 30000, cto: 0, orPhysique: 0, plateformeCrypto: 5000, coldWallet: 0, scpi: 0, per: 0 },
  pea: { ouvert: true, dateOuverture: "2023-03", versements: 26000, etablissement: "Banque traditionnelle" },
  assuranceVie: { ouverte: true, dateOuverture: "2019-06", type: "Banque traditionnelle" },
  projetRP: { actif: true, prix: 320000, type: "ancien", imperatif: false, horizonAnnees: 3, aideFamiliale: 0, ageChoisi: null, departement: "", commune: "", typeLogement: "appartement", surface: null },
  salaireDans10Ans: null, rythmeReequilibrage: "", avPartEuros: 100,
  logement: { usage: "rp", origine: "achat", part: 100, valeur: null, creditRestant: 0, finCredit: null, departement: "", commune: "", typeLogement: "appartement", surface: null },
  abondement: { acces: "?", actif: false, plan: "pereco", taux: null, plafond: null, interessement: null, placer: true, surInteressement: false },
  foyer: { actif: false, statut: "marie" },
  conjoint: { prenom: "", age: 31, salaireNetMensuel: 2400, pea: { ouvert: false, versements: 0, etablissement: "" } },
};

const PROFIL_VIDE = {
  age: 30, salaireNetMensuel: 0, epargneMensuelle: 0, depensesMensuelles: 0, proprietaire: false, loyerMensuel: 0,
  pays: "FR", statutPro: "", eligibleLEP: false, creditsMensuels: 0,
  futur: { actif: false, age: null, capital: null, salaire: null, epargne: null },
  placements: {}, pea: { ouvert: false, versements: 0, etablissement: "" }, assuranceVie: { ouverte: false, type: "" },
  projetRP: { actif: false, prix: 0, type: "ancien", imperatif: false, horizonAnnees: 0, aideFamiliale: 0, ageChoisi: null, departement: "", commune: "", typeLogement: "appartement", surface: null },
  salaireDans10Ans: null, rythmeReequilibrage: "", avPartEuros: 100,
  logement: { usage: "rp", origine: "achat", part: 100, valeur: null, creditRestant: 0, finCredit: null, departement: "", commune: "", typeLogement: "appartement", surface: null },
  abondement: { acces: "?", actif: false, plan: "pereco", taux: null, plafond: null, interessement: null, placer: true, surInteressement: false },
  foyer: { actif: false, statut: "marie" },
  conjoint: { prenom: "", age: 30, salaireNetMensuel: 0, pea: { ouvert: false, versements: 0, etablissement: "" } },
};
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
};
const modifie = () => JSON.stringify(etat.brouillon) !== JSON.stringify(etat.reference);

function profilPourMoteur() { return normaliserProfil(etat.profil); }
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
  p.projetRP = { typeLogement: "appartement", ...(p.projetRP ?? {}) };
  const acces0 = p.abondement?.acces ?? (p.abondement?.actif ? (p.abondement.plan === "pee" ? "pee" : "per") : "?");
  p.abondement = { actif: false, plan: "pereco", taux: null, plafond: null, interessement: null, placer: true, surInteressement: false, ...(p.abondement ?? {}), acces: acces0 };
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
  // Tranche d'imposition non saisie : estimée à partir des revenus (barème 2026)
  if ((p.tmi === "" || p.tmi == null) && Number(p.salaireNetMensuel) > 0) {
    p.tmi = decomposerSalaire(p.salaireNetMensuel, foyerFiscal(p)).tmi;
    p.tmiEstimee = true;
  }
  // Retraite publique : estimée automatiquement pour chaque âge d'arrêt possible (moins de trimestres = décote)
  const rr = (p.retraite ??= {});
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
    <h3 style="margin:16px 0 4px">Et si j'achetais plus tôt ou plus tard ?</h3>
    <p class="note" style="margin:0 0 6px">Livrets, épargne, aide : livrets au-delà de la sécurité, épargne mise de côté chaque mois${a.aide > 0 ? ` et ${eur(a.aide)} d'aide familiale (comptée à chaque âge)` : " et aide familiale (aucune indiquée)"}. Autres placements : bourse, assurance-vie… vendables pour compléter (valeur d'aujourd'hui). Prêt possible : le maximum que la banque prêterait avec ton salaire à cet âge. Le même calcul sert pour l'âge choisi et l'achat impératif.</p>
    <div class="table-wrap"><table><thead><tr><th>Achat à</th><th class="m">Livrets, épargne, aide</th><th class="m">Autres placements</th><th class="m">Apport nécessaire</th><th class="m">Prêt possible</th><th class="m">Mensualité</th><th class="m">Verdict</th></tr></thead><tbody>${lignes}</tbody></table></div>
  </section>`;
}

// Poche bourse : combien acheter de chaque ETF avec le virement du mois, sur quel compte, et l'exposition par devise
let montantDCA = null;
const DEVISES = ["USD", "EUR", "GBP", "CHF", "JPY", "Autres"];
const NOM_DEVISE = { USD: "Dollar (USD)", EUR: "Euro (EUR)", GBP: "Livre (GBP)", CHF: "Franc suisse (CHF)", JPY: "Yen (JPY)", Autres: "Autres devises" };
// Exposition par défaut d'un ETF : celle du plan, sinon déduite du nom de l'indice
function devisesParDefaut(x) {
  const ref = (x.devises ? x : PLAN.investissementBourse?.find((y) => y.nom === x.nom)) ?? {};
  if (ref.devises) {
    const o = {}; for (const [k, v] of Object.entries(ref.devises)) { const c = DEVISES.find((d) => k.includes(`(${d})`)) ?? "Autres"; o[c] = (o[c] ?? 0) + v; } return o;
  }
  const n = x.nom.toLowerCase();
  if (/s&p|nasdaq|usa|etats-unis|états-unis|\bus\b/.test(n)) return { USD: 100 };
  if (/europe 600|stoxx 600|msci europe/.test(n)) return { EUR: 51, GBP: 23, CHF: 15, Autres: 11 };
  if (/world|monde|acwi/.test(n)) return { USD: 72, EUR: 9, JPY: 5, GBP: 4, CHF: 3, Autres: 7 };
  if (/émergent|emergent|emerging|\bem\b/.test(n)) return { Autres: 100 };
  if (/cac|euro stoxx|emu|zone euro/.test(n)) return { EUR: 100 };
  return null;
}
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
  return `<section class="panneau" id="poche-bourse"><h2>Ta poche bourse : quoi acheter ce mois-ci</h2>
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
function rendreResultats() {
  let res, sim;
  try { sim = profilSimule(); res = analyser(etat.brouillon, sim.profil); }
  catch (e) {
    console.error(e);
    const msg = `<div class="erreur">Le plan ne peut pas être appliqué : ${echapper(e.message)}. Vérifie les réglages (au moins un palier est nécessaire).</div>`;
    $("#resultats").innerHTML = msg; $("#apercu").innerHTML = msg; return;
  }
  const plan = etat.brouillon;
  etat.resultat = res;
  if (!$("#vue-ideale").hidden) rendreEpargneIdeale();
  $("#total-capital").textContent = eur(res.capital);
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

  const nomProfil = proches.courant.col === "exemple" ? "Exemple" : docCourant()?.nom ?? "";
  const F = sim.futur;
  const bandeauFutur = F ? `<div class="bandeau"><b>Situation simulée à ${res.profil.agePrincipal ?? res.profil.age} ans${F.annees ? `, dans ${F.annees} an(s)` : ""}</b> : capital ${eur(F.capital)} (${F.estime.capital ? "estimé en suivant le plan, rendements moyens" : "saisi"}), salaire ${eur(res.profil.salaireNetMensuel)} par mois${F.estime.salaire ? " (estimé)" : ""}, épargne ${eur(res.profil.epargneMensuelle)} par mois${F.estime.epargne ? " (estimée)" : ""}.${F.achatAvant ? " L'achat de la résidence, prévu avant cet âge, n'est pas pris en compte." : ""} Les résultats ci-dessous concernent cette situation future, pas celle d'aujourd'hui.</div>` : "";
  etat.futur = F;
  const p = res.profil;
  $("#resultats").innerHTML = `
    <div class="etape" style="margin:0"><p><b>Étape 2 sur 4.</b> Ce que le plan demande pour ce profil : d'abord les actions, dans l'ordre, puis les versements du mois et le montant visé sur chaque compte.</p></div>
    ${bandeauFutur}
    <div class="panneau entete-res">
      <div class="qui-res"><b>${echapper(nomProfil || "Profil")}</b><span class="small muted">${p.agePrincipal ?? p.age} ans · ${eur(res.capital)} placés · ${eur(p.epargneMensuelle)} d'épargne par mois · profil ${echapper(profilRisque(plan, p).libelle ?? "")}</span></div>
      <div class="ligne-actions"><a class="bouton" href="#mon-profil">Modifier mon profil</a>${etat.downloads ? `<button type="button" id="btn-recap">Télécharger le récapitulatif</button>` : ""}</div>
      ${recapMessage ? `<p class="small muted" style="margin:0;flex-basis:100%">${echapper(recapMessage)}</p>` : ""}
    </div>
    <div class="grille-res">
      <div class="pile">
        <section class="panneau">${titre("À faire", aFaire.length)}
          <p class="note" style="margin:4px 0 0">Les actions à mener, de la plus importante à la moins urgente. Les mots soulignés en pointillé mènent à leur fiche.</p>
          ${aFaire.length ? `<ol class="a-faire">${aFaire.map(item).join("")}</ol>` : '<p class="muted small" style="margin:10px 0 0">Rien à faire de particulier : continue les versements du mois.</p>'}</section>
        <section class="panneau"><h2>Ce mois-ci · ${eur(p.epargneMensuelle)} d'épargne à répartir</h2>
          <p class="note" style="margin:4px 0 0">Les virements à faire ce mois-ci pour rapprocher chaque compte de sa cible.</p>
          <div class="table-wrap" style="margin-top:8px"><table><tbody>${mvts || '<tr><td class="muted">Aucun mouvement ce mois-ci.</td></tr>'}</tbody></table></div></section>
        <section class="panneau"><h2>Montant visé sur chaque compte</h2><p class="note" style="margin:4px 0 8px">${eqTexte} L'argent déjà placé reste sur son compte quand le plan l'autorise ; l'épargne du mois comble les manques et les excédents sont déplacés petit à petit.</p>
          ${blocRythme(res)}
          <div class="table-wrap"><table><thead><tr><th>Compte</th><th class="m">Actuel</th><th class="m">Cible</th><th class="m">Écart</th></tr></thead><tbody>${comptes}</tbody></table></div></section>
        <section class="panneau"><h2>Répartition cible</h2><p class="note" style="margin:4px 0 0">Comment le plan répartit ton capital entre les grandes familles de placements.</p>${blocAllocation(res)}</section>
        ${blocPocheBourse(res)}
        <div class="etape" style="margin:0"><a class="bouton" href="#mon-profil">← Mon profil</a><a class="bouton principal" href="#trajectoire">Étape 3 : trajectoire →</a></div>
      </div>
      <div class="pile">
        ${alertes.length ? `<section class="panneau attention">${titre("Attention", alertes.length)}<ul class="infos">${alertes.map(item).join("")}</ul></section>` : ""}
        <section class="panneau">${titre("Bon à savoir", infos.length)}
          ${infos.length ? `<ul class="infos">${infos.map(item).join("")}</ul>` : '<p class="muted small" style="margin:10px 0 0">Rien de plus à signaler.</p>'}</section>
      </div>
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

// Récapitulatif téléchargeable
let recapMessage = "";
const slug = (s) => (s || "profil").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
$("#resultats").addEventListener("click", async (e) => {
  if (e.target.id !== "btn-recap" || !etat.downloads) return;
  const bouton = e.target; bouton.disabled = true; bouton.textContent = "Préparation…";
  try {
    const plan = etat.brouillon, res = etat.resultat;
    let nom = proches.courant.col === "exemple" ? "Exemple" : docCourant()?.nom ?? "Profil";
    if (etat.futur) nom += ` · simulation à ${res.profil.agePrincipal ?? res.profil.age} ans`;
    const proj = projeter(plan, profilPourMoteur(), { inclureAchat: true });
    const { suivi } = suiviCourant();
    const echeances = [...echeancesProfil(plan, profilPourMoteur(), { releves: suivi?.releves ?? [] }), ...echeancesGenerales(plan)].sort((a, b) => a.date - b.date);
    const planDate = etat.source === "partage" && etat.majLe ? new Date(etat.majLe).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" }) : null;
    const html = genererRecapHTML({ plan, nom, profil: res.profil, res, proj, echeances, fiches: CONTENU_FICHES, planDate });
    const d = new Date();
    await etat.downloads.save({ filename: `plan-action-${slug(nom)}-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}.html`, data: new Blob([html], { type: "text/html" }) });
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
  ages.forEach((a, i) => { if (a % 5 === 0 || i === 0) s += `<text x="${x(i)}" y="${H - 9}" text-anchor="middle">${a} ans</text>`; });
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
// Projection mise en cache : la même sert à « Trajectoire » et à « Retraite »
let cacheProjection = { cle: null, r: null };
function projectionCourante(inclureAchat = true) {
  const r = { ...(etat.profil.retraite ?? {}) };
  const cle = JSON.stringify([etat.brouillon, { ...etat.profil, retraite: r }, inclureAchat]);
  if (cacheProjection.cle !== cle) cacheProjection = { cle, r: projeter(etat.brouillon, profilPourMoteur(), { inclureAchat }) };
  return cacheProjection.r;
}

function rendreTrajectoire() {
  const plan = etat.brouillon, H = plan.hypotheses;
  const achatHTML = etat.resultat ? blocAchat(etat.resultat) : "";
  $("#achat-trajectoire").innerHTML = achatHTML || `<section class="panneau"><h2>Résidence principale</h2><p class="small muted" style="margin:6px 0 0">Pas de projet d'achat pour ce profil. Pour savoir à quel âge acheter et quel apport viser, coche « Projet d'achat » dans <a class="lien-fiche" href="#mon-profil">Mon profil</a>.</p></section>`;
  let r;
  try { r = projectionCourante($("#t-achat").checked); }
  catch (e) { console.error(e); $("#trajectoire").innerHTML = `<div class="erreur">La projection ne peut pas être calculée : ${echapper(e.message)}.</div>`; return; }
  const reel = $("#t-reel").checked;
  const defl = (i) => (reel ? Math.pow(1 + (H.inflation ?? 0) / 100, -i) : 1);
  const C = r.central, E = r.eventail;
  const iR = Math.max(0, Math.min(C.length - 1, (H.ageRetraite ?? 64) - C[0].age));
  const iF = C.length - 1;
  const unite = reel ? "en euros d'aujourd'hui" : "en euros de l'époque";

  const tuiles = [
    [`À ${C[iR].age} ans (médiane)`, eur(E[iR].p50 * defl(iR))],
    [`Fourchette à ${C[iR].age} ans`, `${keur(E[iR].p10 * defl(iR))} – ${keur(E[iR].p90 * defl(iR))}`],
    [`Patrimoine net à ${C[iF].age} ans`, eur(C[iF].net * defl(iF))],
    [`Après impôts à ${C[iF].age} ans`, eur(C[iF].apresImpots * defl(iF))],
  ];
  let infoAchat = "";
  if (r.achat) {
    const a = r.achat, i = C.findIndex((p) => p.evenement === "achat");
    infoAchat = i >= 0
      ? `Achat de la résidence à ${a.age} ans (${a.imperatif ? "date impérative" : "âge idéal"}) : ${eur(a.prix)}, apport ${eur(a.apportRequis)} prélevé sur les placements, prêt de ${eur(a.pret)} sur ${a.duree} ans (${eur(a.mensualite)}/mois). Le loyer s'arrête, la mensualité est déduite de l'épargne.`
      : `L'achat prévu à ${a.age} ans n'a pas pu être financé dans le scénario central.`;
    if (r.achatsRates > 0) infoAchat += ` Dans ${Math.round((100 * r.achatsRates) / r.simulations)} % des scénarios, l'apport manque à cette date.`;
  } else if (etat.profil.projetRP?.actif && $("#t-achat").checked) infoAchat = "Aucun âge d'achat finançable avant la limite du plan : l'achat n'est pas inclus.";

  // Repères : tous les 5 ans, plus la retraite, l'achat et la fin de la projection
  const idx = [...new Set(C.map((p, i) => i).filter((i) => i % 5 === 0 || i === iR || i === iF || C[i].evenement === "achat"))].sort((x, y) => x - y);
  const gain = (x, mis) => (mis > 0.5 ? (x - mis) / mis : null);
  const celluleGain = (x, mis, f, i) => {
    const g = i === 0 ? null : gain(x, mis);
    return `<td class="m">${eur(x * f)}${g == null ? "" : `<div class="small ${g >= 0 ? "ecart-plus" : "ecart-moins"}">${g >= 0 ? "+" : "−"}${pct(Math.abs(100 * g))}</div>`}</td>`;
  };
  const lignesGains = idx.map((i) => {
    const f = defl(i), mis = C[i].verse;
    return `<tr><td>${C[i].age} ans${C[i].evenement === "achat" ? " · achat" : ""}</td><td class="m">${mis > 0.5 ? eur(mis * f) : '<span class="small muted">déjà tout récupéré</span>'}</td>
      ${celluleGain(E[i].p10, mis, f, i)}${celluleGain(E[i].p50, mis, f, i)}${celluleGain(E[i].p90, mis, f, i)}${celluleGain(C[i].financier, mis, f, i)}
      <td class="m"><b>${i === 0 ? "—" : E[i].probaGain >= 1 ? "100 %" : E[i].probaGain >= 0.995 ? "plus de 99 %" : `${Math.round(100 * E[i].probaGain)} %`}</b></td></tr>`;
  }).join("");
  // Après impôts : impôt du scénario central, et même taux d'impôt sur les gains pour les autres scénarios
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

  const tranches = blocTranches(r, defl, unite);
  $("#trajectoire").innerHTML = `
    <section class="panneau"><h2>Trajectoire du patrimoine</h2>
      <p class="note" style="margin:4px 0 0">${etat.profil.foyer?.actif ? "Foyer : les âges affichés sont l'âge de référence du couple. " : ""}Chaque année, le plan est réappliqué : paliers, âge, protection de l'apport. L'épargne suit le salaire (${normaliserProfil(etat.profil).salaireDans10Ans > 0 ? "selon ton salaire espéré dans 10 ans, puis ta carrière" : `carrière « ${echapper((carriereDe(plan, etat.profil).libelle ?? "").split(" :")[0])} »`}) et s'arrête à ${r.retraite?.age ?? H.ageRetraite} ans. Montants ${unite}.</p>
      <div class="tuiles quatre">${tuiles.map(([k, v]) => `<div class="tuile"><span>${k}</span><b class="num">${v}</b></div>`).join("")}</div>
      ${infoAchat ? `<p class="small" style="margin:0">${echapper(infoAchat)}</p>` : ""}
      ${r.per?.actif ? `<p class="small" style="margin:6px 0 0">PER : ${eur(r.per.annuel)} versés par an jusqu'à ${Math.min(H.ageRetraite ?? 64, 70)} ans, ${plan.per?.reinvestirEconomie ? `et ${eur(r.per.economie)} d'économie d'impôt réépargnés chaque année` : "économie d'impôt non réépargnée"}. Dans « après impôts », les versements déduits sont imposés à ${plan.per?.tmiRetraite ?? 0} % à la sortie (hypothèse).</p>` : ""}
    </section>
    ${blocObjectifs(r)}
    ${tranches}
    <section class="panneau"><h2>Composition des placements · scénario central</h2>
      <p class="note" style="margin:4px 0 8px">Rendements moyens du plan chaque année. Survole le graphique pour le détail.</p>${graphiqueComposition(C, defl, r.achat)}</section>
    <section class="panneau"><h2>Éventail des possibles · ${r.simulations} scénarios</h2>
      <p class="note" style="margin:4px 0 8px">Les rendements sont tirés au hasard chaque année selon la volatilité de chaque classe (bitcoin très variable). La médiane est sous le scénario central : les années de baisse pèsent plus que les années de hausse.</p>${graphiqueEventail(C, E, defl)}</section>
    <section class="panneau" id="bloc-crise"><h2>Et si une crise arrivait ?</h2>
      <p class="note" style="margin:4px 0 10px">On rejoue une crise passée sur ton portefeuille, puis les rendements moyens du plan. Pour voir ce que tu risques, et pourquoi il ne faut pas paniquer.</p>
      <div class="ligne-actions">
        <label for="crise-choix" class="small">Crise</label><select id="crise-choix" style="width:auto">${Object.entries(CRISES).map(([k, c]) => `<option value="${k}" ${k === uiCrise.id ? "selected" : ""}>${echapper(c.libelle)}</option>`).join("")}</select>
        <label for="crise-moment" class="small">Quand</label><select id="crise-moment" style="width:auto">${[["bientot", "L'année prochaine"], ["avant", "5 ans avant ta retraite"], ["retraite", "L'année où tu arrêtes de travailler"]].map(([k, l]) => `<option value="${k}" ${k === uiCrise.moment ? "selected" : ""}>${l}</option>`).join("")}</select>
      </div>
      <div id="crise-resultat" style="margin-top:10px"></div>
    </section>
    <section class="panneau"><h2>Ce que rapporte ton épargne</h2>
      ${(() => { const RR = r.retraite; return RR ? `<p class="verdict ok" style="margin:4px 0 8px"><b>Hypothèses retraite utilisées :</b> arrêt de travail à ${RR.age} ans, puis ${eur(RR.revenu)} par mois (après impôt, en euros d'aujourd'hui) pris sur tes placements${RR.pension > 0 ? `, moins ${eur(RR.pension)} de retraite publique à partir de ${RR.agePension} ans` : ", sans retraite publique comptée"}. <a class="lien-fiche" href="#mon-profil">Modifier dans « Mon profil », bloc « Ta retraite »</a></p>` : ""; })()}
      <p class="note" style="margin:4px 0 8px">« Argent mis » : ton capital de départ, plus toute l'épargne versée jusqu'à cet âge${r.achat ? ", moins l'apport sorti pour l'achat" : ""}. Sous chaque montant, le gain ou la perte par rapport à cet argent mis. Pessimiste : 1 scénario sur 10 fait moins bien ; optimiste : 1 sur 10 fait mieux ; médiane : la moitié fait mieux, la moitié moins bien ; central : rendements moyens chaque année. Placements seulement, avant impôts.</p>
      <div class="table-wrap"><table><thead><tr><th>Âge</th><th class="m">Argent mis</th><th class="m">Pessimiste</th><th class="m">Médiane</th><th class="m">Optimiste</th><th class="m">Central</th><th class="m">Chances d'avoir gagné</th></tr></thead><tbody>${lignesGains}</tbody></table></div>
      <p class="note" style="margin:8px 0 0">« Chances d'avoir gagné » : part des ${r.simulations} scénarios où les placements valent plus que l'argent mis à cet âge. Ces chances ne montent pas toujours avec l'âge : l'épargne des dernières années n'a pas encore eu le temps de rapporter, et un krach juste avant la date regardée suffit à faire repasser quelques scénarios sous l'argent mis. Après ${H.ageRetraite ?? 64} ans, l'argent mis diminue des revenus que tu te verses.</p>
    </section>
    <section class="panneau"><h2>Après impôts, si tout était vendu</h2>
      <p class="note" style="margin:4px 0 8px">Patrimoine net : placements moins les impôts dus si tout était vendu à cet âge, plus ${etat.profil.proprietaire || r.achat ? "l'immobilier net du crédit restant (colonne « Immobilier net »)" : "l'immobilier s'il y en a"}. Chaque scénario a sa ligne ; sous chaque montant, le total des impôts qui seraient payés.</p>
      <div class="table-wrap"><table><thead><tr><th>Âge</th><th class="m">Immobilier net</th><th class="m">Pessimiste</th><th class="m">Médiane</th><th class="m">Optimiste</th><th class="m">Central</th></tr></thead><tbody>${lignesImpots}</tbody></table></div>
      <p class="note" style="margin:8px 0 0">Impôts calculés pour le scénario central selon la fiscalité ${plan.fiscalite?.verifieeLe ? `vérifiée le ${new Date(plan.fiscalite.verifieeLe + "T12:00").toLocaleDateString("fr-FR")}` : "du plan"} (gains de chaque compte, or au régime le plus favorable, résidence principale exonérée${r.per?.actif ? ", PER imposé à la sortie" : ""}) . Pessimiste, médiane et optimiste : chacun des scénarios tirés au hasard est taxé avec sa propre répartition et ses propres gains (moins de gains et plus de livrets quand les marchés ont stagné, donc moins d'impôt), puis on prend le 1er dixième, la médiane et le 9e dixième du résultat après impôts. Immobilier net : valeur du logement moins le crédit restant ; il est valorisé de ${pct(H.valorisationImmobiliere ?? 0)} par an (hypothèse modifiable dans « Mon plan »), donc en euros d'aujourd'hui il ne monte que si ce taux dépasse l'inflation (${pct(H.inflation ?? 0)}). Ne sont pas comptés : les impôts payés lors des rééquilibrages, les abattements annuels de l'assurance-vie et la plus-value d'un logement autre que la résidence principale.</p>
    </section>
    <section class="panneau" id="bloc-ab">${blocScenarios(r, reel)}</section>
    <section class="panneau" id="bloc-fiscal"></section>`;
  rendreCrise();
  rendreFiscal();
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
  let r; try { r = projectionCourante($("#t-achat").checked); } catch { return; }
  const S = scenariosGardes();
  if (t.id === "ab-figer" && S.length < MAX_SCENARIOS) S.push({ nom: $("#ab-nom")?.value?.trim() || "", date: new Date().toISOString(), points: r.central.map((p, i) => ({ age: p.age, net: p.net, i })) });
  else if (t.dataset.supprSc) S.splice(Number(t.dataset.supprSc), 1);
  garderScenarios(S);
  $("#bloc-ab").innerHTML = blocScenarios(r, $("#t-reel").checked);
});
$("#t-reel").addEventListener("change", rendreTrajectoire);

// Crise rejouée : trois trajectoires (sans crise, en gardant le cap, en paniquant)
const uiCrise = { id: memo.get("crise-id") ?? "2008", moment: memo.get("crise-moment") ?? "bientot" };
function rendreCrise() {
  const out = $("#crise-resultat"); if (!out) return;
  const plan = etat.brouillon, H = plan.hypotheses;
  const p = profilPourMoteur(), age0 = Math.round(normaliserProfil(p).age ?? 30);
  const PRage = projectionCourante($("#t-achat").checked).retraite?.age ?? H.ageRetraite ?? 64;
  const ageDebut = uiCrise.moment === "bientot" ? age0 + 1 : uiCrise.moment === "avant" ? Math.max(age0 + 1, PRage - 5) : Math.max(age0 + 1, PRage);
  let r;
  try { r = simulerCrise(plan, p, { crise: uiCrise.id, ageDebut, inclureAchat: $("#t-achat").checked }); }
  catch (e) { console.error(e); out.innerHTML = `<p class="erreur">Simulation impossible : ${echapper(e.message)}</p>`; return; }
  const reel = $("#t-reel").checked, infl = (H.inflation ?? 0) / 100;
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
  return `<section class="panneau"><h2>Tous les 5 ans</h2>
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
  const plan = etat.brouillon, H = plan.hypotheses, R = r.retraite, C = r.central;
  if (!R || !C?.length) return "";
  const infl = (H.inflation ?? 0) / 100;
  const besoinAn = Math.max(0, R.revenu - (R.pension > 0 ? R.pension : 0)) * 12;
  const objectif = besoinAn * 25; // règle des 4 % : on retire 4 % du capital par an
  const a = etat.resultat?.alloc ?? {}, tot = Object.values(a).reduce((t, x) => t + x, 0);
  const rNom = tot > 0 ? Object.entries(a).reduce((t, [c, m]) => t + (m * (H.rendements?.[c] ?? 0)) / 100, 0) / tot : 0.05;
  const rr = Math.max(0.005, (1 + rNom) / (1 + infl) - 1); // rendement réel moyen du portefeuille
  const reel = (p, i) => p.financier / Math.pow(1 + infl, i);
  const ageR = R.age;
  let coast = null, fire = null;
  for (let i = 0; i < C.length; i++) {
    const p = C[i]; if (p.age > ageR) break;
    const v = reel(p, i);
    if (!coast && v * Math.pow(1 + rr, ageR - p.age) >= objectif) coast = { age: p.age, v };
    if (!fire && v >= objectif) fire = { age: p.age, v };
  }
  if (!(objectif > 0)) return `<section class="panneau"><h2>Liberté financière</h2><p class="small muted" style="margin:0">Ta retraite publique couvre l'objectif : pas besoin de capital pour le revenu visé.</p></section>`;
  const v0 = reel(C[0], 0);
  return `<section class="panneau"><h2>Liberté financière</h2>
    <p class="note" style="margin:4px 0 8px">Règle des 4 % : un capital de 25 fois tes besoins annuels permet en général de retirer 4 % par an pendant 30 ans sans être à court. Tes besoins : ${eur(besoinAn / 12)} par mois${R.pension > 0 ? " (après la retraite publique comptée)" : ""}, soit un objectif de <b>${eur(objectif)}</b> en euros d'aujourd'hui.</p>
    <div class="tuiles">
      <div class="tuile"><span>Ton capital placé aujourd'hui</span><b class="num">${eur(v0)}</b><span class="small muted">${pct((100 * v0) / objectif)} de l'objectif</span></div>
      <div class="tuile"><span>Coast FIRE (ne plus épargner)</span><b class="num">${coast ? (coast.age <= C[0].age ? "déjà atteint" : `à ${coast.age} ans`) : "pas avant la retraite"}</b><span class="small muted">rendement réel moyen ${pct(rr * 100)} par an</span></div>
      <div class="tuile"><span>Liberté financière (tout de suite)</span><b class="num">${fire ? `à ${fire.age} ans` : `pas avant ${ageR} ans`}</b><span class="small muted">capital ≥ ${keur(objectif)}</span></div>
    </div>
    <p class="note" style="margin:8px 0 0">${coast ? `À partir de ${coast.age <= C[0].age ? "maintenant" : `${coast.age} ans`}, même sans épargner un euro de plus, ton capital (${eur(coast.v)}) grandirait jusqu'à environ ${eur(objectif)} à ${ageR} ans grâce aux seuls intérêts composés. Tu pourrais alors épargner moins, ou travailler moins, sans renoncer à ta retraite.` : `En suivant le plan, ton capital n'atteint pas ce seuil avant ${ageR} ans : il faut continuer d'épargner jusqu'à la retraite.`} Scénario central, en euros d'aujourd'hui, avant impôts sur les gains. La règle des 4 % vient d'études américaines ; en France, beaucoup visent plutôt 3,5 % (28 fois les besoins) par prudence.</p>
  </section>`;
}
function rendreRetraite() {
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
  const saisie = `<section class="panneau"><h2>Tes hypothèses</h2>
    <div class="champs" style="max-width:600px;margin-top:10px">
      <div class="champ"><label for="r-revenu"><b>Une retraite convenable pour toi</b>, par mois, après impôt, en euros d'aujourd'hui</label><div class="saisie"><input id="r-revenu" type="number" min="0" step="100" value="${p0.retraite?.revenu ?? ""}" placeholder="${plan.retraite?.revenuMensuelDefaut ?? 2000}"><span>€/mois</span></div></div>
      ${repere ? `<p class="note" style="margin:-4px 0 0">${repere}</p>` : ""}
      ${optionsAge ? `<div class="champ"><label for="r-age">Âge où tu arrêtes de travailler</label><select id="r-age">${optionsAge}</select></div>` : ""}
      <div class="champ"><label for="r-mode">Retraite publique</label><select id="r-mode">${[["auto", "Estimée automatiquement (suit l'âge d'arrêt)"], ["manuel", "Montant que j'indique"], ["zero", "Ne pas la compter (prudence)"]].map(([v, l]) => `<option value="${v}" ${(etat.profil.retraite?.modePension ?? "auto") === v ? "selected" : ""}>${l}</option>`).join("")}</select></div>
      <div class="champ"><label for="r-pension">Retraite publique comptée (nette après impôt, en euros d'aujourd'hui)</label><div class="saisie"><input id="r-pension" type="number" min="0" step="10" value="${p0.retraite?.pension ?? ""}" placeholder="0" ${(etat.profil.retraite?.modePension ?? "auto") === "manuel" ? "" : "disabled"}><span>€/mois</span></div></div>
      <p class="note" style="margin:-4px 0 0">${(etat.profil.retraite?.modePension ?? "auto") === "auto" ? `Calculée pour un arrêt à ${ageDepart} ans${(Number(p0.retraite?.pension) || 0) > 0 ? `, versée à partir de ${R?.agePension ?? ageLegal} ans` : ""} : elle change toute seule quand tu changes l'âge d'arrêt (moins de trimestres = retraite plus basse). Détail plus bas, dans « Estimer ta retraite publique ».` : (Number(p0.retraite?.pension) || 0) > 0 ? `Versée à partir de ${R?.agePension ?? ageLegal} ans.` : "Aucune retraite publique comptée : tout vient de tes placements."}</p>
      ${aLoyers ? `<label class="coche"><input type="checkbox" id="r-loyers" ${etat.profil.retraite?.compterLoyers !== false ? "checked" : ""}> Compter les loyers nets de mes biens loués dans mes revenus à la retraite</label>
      <p class="note" style="margin:-4px 0 0">${etat.profil.retraite?.compterLoyers !== false ? "Oui, ils sont comptés : chaque année, les loyers nets (après charges, impôt et crédit) rejoignent tes placements, ce qui réduit ce que tu dois y puiser. Décoche pour voir ta retraite sans eux (bien vendu, travaux, vacance…)." : "Non comptés : à partir de ta retraite, les loyers nets ne servent plus à financer ton revenu (le crédit encore en cours, lui, reste payé)."}</p>` : ""}
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
  const ok = R.probaDure >= 0.9, moyen = R.probaDure >= 0.7;
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
  const brut1 = (12 * R.besoin * Math.pow(1 + infl, iR)) / (1 - (R.taux ?? 0));
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
  const blocAge = `<section class="panneau"><h2>À quel âge peux-tu t'arrêter ?</h2>
    <p class="note" style="margin:4px 0 0">Le plus tôt possible pour te verser ${eur(R.revenu)} par mois jusqu'à ${R.ageFin} ans <b>en transmettant à ${R.ageFin} ans tout le capital que tu avais en arrêtant</b> (en euros d'aujourd'hui). À ${ageLegal} ans, on s'arrête quoi qu'il arrive.</p>
    <div class="tuiles" style="grid-template-columns:repeat(2,minmax(0,1fr))">
      <div class="tuile"><span>Scénario central (rendements moyens)</span><b class="num">${fmtAge(centralAge)}</b></div>
      <div class="tuile"><span>Scénario pessimiste (ça marche dans 9 cas sur 10)</span><b class="num" id="age-pessimiste">${fmtAge(P?.age, !P)}</b></div>
    </div>
    <div class="ligne-actions" id="actions-age">${boutonsAge(centralAge, P?.age, ageDepart, ageLegal)}</div>
    <p class="note" style="margin:8px 0 0">Pessimiste : on rejoue 200 scénarios de marchés tirés au hasard (krachs compris) ; l'âge retenu est celui où le capital est transmis intact dans au moins 9 scénarios sur 10. C'est la version prudente à retenir.</p>
  </section>`;
  $("#retraite").innerHTML = saisie + blocObjectifs(r) + blocAge + blocLiberte(r) + blocPension(p0) + `
    <section class="panneau"><h2>Ce que ça donne</h2>
      <div class="tuiles">${tuiles.map(([k, v]) => `<div class="tuile"><span>${k}</span><b class="num">${v}</b></div>`).join("")}</div>
      <div class="tuiles" style="grid-template-columns:repeat(2,minmax(0,1fr));margin-top:0">
        <div class="tuile"><span>Pessimiste (9 cas sur 10) : revenu possible sans entamer le capital</span><b class="num" id="pess-preserve">${P ? `${eur(P.revenuPreserve)}/mois` : '<span class="muted small">calcul en cours…</span>'}</b></div>
        <div class="tuile"><span>Pessimiste (9 cas sur 10) : revenu possible en consommant tout d'ici ${C[iF].age} ans</span><b class="num" id="pess-consomme">${P ? `${eur(P.revenuConsomme)}/mois` : '<span class="muted small">calcul en cours…</span>'}</b></div>
      </div>
      ${verdict}
      <p class="note" style="margin:10px 0 0">Tous les montants sont en euros d'aujourd'hui (inflation déduite). Les revenus possibles sont calculés dans le scénario central (rendements moyens), impôts sur les ventes compris : environ ${pct(100 * (R.taux ?? 0))} de chaque retrait la première année, puis un peu plus chaque année, car la part de gains dans ce qu'il reste augmente (le capital restant continue de rapporter). Chaque scénario tiré au hasard est taxé avec ses propres gains. Non déduit : l'abattement annuel de l'assurance-vie de plus de 8 ans (4 600 € de gains par an sans impôt sur le revenu, 9 200 € pour un couple marié ou pacsé), ce qui rend le calcul un peu prudent, de quelques centaines d'euros d'impôt par an au plus.</p>
    </section>
    <section class="panneau"><h2>Ton capital pendant la retraite</h2>
      <p class="note" style="margin:4px 0 8px">Chaque année, le revenu est pris sur les placements, et le reste continue d'être placé selon le plan (de plus en plus prudent avec l'âge). En euros d'aujourd'hui.</p>
      ${graphe}
      <div class="table-wrap" style="margin-top:12px"><table><thead><tr><th>Âge</th><th class="m">Revenu versé / mois</th><th class="m">Pessimiste</th><th class="m">Médiane</th><th class="m">Optimiste</th><th class="m">Central</th></tr></thead><tbody>${lignes}</tbody></table></div>
    </section>
    <section class="panneau"><h2>Comment se verser ce revenu</h2>
      <ol class="points" style="margin-top:10px">
        <li>${texteLie(`Une fois par an (en janvier, par exemple), retirer 12 mois de revenu : environ ${eur(reel(brut1, iR))} la première année (en euros d'aujourd'hui), impôts compris, soit ${pct(tauxRetrait)} du capital. On le met sur le compte courant ou un livret, et on se fait un virement automatique chaque mois.`)}</li>
        <li>${texteLie(`Garder une réserve sans risque (livrets, fonds euros, obligations) d'au moins 2 à 3 ans de retraits. Avec le plan, elle représente ${anneesReserve != null ? `environ ${String(Math.round(anneesReserve * 10) / 10).replace(".", ",")} années de retraits` : "—"} au départ.`)}</li>
        <li>${texteLie("Les bonnes années, vendre surtout ce qui dépasse sa cible (c'est le rééquilibrage du plan). Les années de forte baisse de la bourse, puiser dans la réserve sans risque plutôt que vendre des actions au plus bas, puis la reconstituer quand la bourse remonte.")}</li>
        <li>${texteLie("Garder le reste investi selon le plan : à 64 ans, il reste plus de 25 ans à tenir, et une part de bourse est ce qui permet au capital de durer et d'être transmis.")}</li>
      </ol>
      <h3 style="margin:16px 0 4px">D'où vient l'argent la première année</h3>
      <p class="note" style="margin:0 0 6px">Pour garder la répartition du plan, on vend chaque famille de placements au prorata (en euros d'aujourd'hui)${aDeLOr && !vendreOr ? ", sauf l'or physique" : ""}.</p>
      ${aDeLOr ? `<p class="${vendreOr ? "verdict ko" : "note"}" style="margin:0 0 6px">${vendreOr ? "<b>Tu as choisi de vendre aussi ton or physique.</b> C'est possible, mais déconseillé : " : "<b>Ton or physique n'est pas vendu.</b> "}${vendreOr ? "l'or" : "L'or"} physique n'est pas fait pour financer la retraite : il protège contre les crises graves et se transmet (pièces et lingots, avec une fiscalité de transmission comme le reste du patrimoine). Mieux vaut le garder et puiser dans la bourse, l'assurance-vie et l'épargne. Il ne serait vendu qu'en dernier recours, si tout le reste était épuisé. <a class="lien-fiche" href="#mon-profil">Changer ce choix (« Ta retraite » dans Mon profil)</a></p>` : ""}
      <div class="table-wrap"><table><thead><tr><th>Placement</th><th class="m">Montant à ${pR.age} ans</th><th class="m">Part</th><th class="m">À vendre dans l'année</th></tr></thead><tbody>${lignesVentes}</tbody></table></div>
    </section>
    <section class="panneau"><h2>Impôts et transmission</h2>
      <ul class="points" style="margin-top:10px">
        <li>${texteLie("Assurance-vie de plus de 8 ans : rachats partiels réguliers ; chaque année, 4 600 € de gains (9 200 € pour un couple) sont exonérés d'impôt sur le revenu. Seule la part de gains de chaque retrait est imposée.")}</li>
        <li>${texteLie("PEA de plus de 5 ans : retraits sans impôt sur le revenu, seulement 18,6 % de prélèvements sociaux sur la part de gains. Le PEA reste ouvert.")}</li>
        <li>${texteLie("Compte-titres : la plus-value de chaque vente est imposée à 31,4 %. PER : à la retraite, sortie en capital (les versements déduits sont imposés au barème, les gains à 31,4 %) ou en rente.")}</li>
        <li>${texteLie("Pour transmettre, l'assurance-vie est l'outil le plus avantageux : les sommes versées avant 70 ans sont transmises jusqu'à 152 500 € par bénéficiaire sans droits de succession ; après 70 ans, 30 500 € de versements au total (les gains sont exonérés). Le PEA, lui, est fermé au décès et entre dans la succession.")}</li>
        <li>${texteLie("Une piste souvent citée : puiser d'abord dans le PEA et le compte-titres, et dans l'assurance-vie surtout dans la limite de l'abattement annuel, pour garder l'assurance-vie pour la transmission. À faire valider par un conseiller ou un notaire selon ta situation.")}</li>
        <li>Droits de succession, abattements, donations : <a class="lien-fiche" href="#fiche-heritage">tout sur l'héritage</a>. Pour aller plus loin : <a class="lien-fiche" href="#fiche-optimisation-fiscale">optimisation fiscale</a>.</li>
      </ul>
      <p class="note" style="margin:10px 0 0">Limites : simulation fondée sur les rendements du plan ; elle ne compte ni la dépendance (maison de retraite), ni les droits de succession, ni une éventuelle retraite publique si tu la laisses à 0 €.</p>
    </section>`;
  majPension();
  lancerPessimiste();
}
// Chances de réussite de chaque objectif (parmi les scénarios tirés au hasard)
function blocObjectifs(r) {
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
  return `<section class="panneau"><h2>Tes objectifs : chances de réussite</h2>
    <p class="note" style="margin:4px 0 10px">En suivant le plan, sur ${n} scénarios de marchés tirés au hasard (bonnes et mauvaises années, krachs compris).</p>
    <ul class="objectifs">${items.map(([t, p]) => { const [l, c] = niveau(p); const v = Math.round(100 * p); return `<li><span>${echapper(t)}</span><span class="jauge" role="img" aria-label="${v} %"><span style="width:${v}%;background:${c}"></span></span><b class="num">${p >= 0.995 && p < 1 ? "> 99" : v} %</b><span class="small muted">${l}</span></li>`; }).join("")}</ul>
  </section>`;
}

// Estimation de la retraite publique (base + complémentaire)
function blocPension(p0) {
  const plan = etat.brouillon, RP = plan.retraitePublique ?? {};
  const rr = p0.retraite ?? {};
  const ages = Array.from({ length: 70 - 62 + 1 }, (_, k) => 62 + k);
  return `<section class="panneau" id="bloc-pension"><h2>Estimer ta retraite publique</h2>
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
    <p class="small" style="margin:0 0 8px">Né(e) vers ${est.naissance} : âge légal <b>${ageEnTexte(est.regles.ageLegal)}</b>, <b>${est.regles.trimestres} trimestres</b> pour le taux plein. Avec un premier emploi à ${est.debut} ans et un arrêt à ${ageArret} ans : <b>${est.trimestres} trimestres</b>${manque ? `, soit ${manque} de moins que le taux plein` : ", assez pour le taux plein"}. Salaire annuel moyen retenu (25 meilleures années, brut, plafonné) : ${eur(est.sam)} ; ${est.points.toLocaleString("fr-FR")} points de complémentaire.</p>
    ${ageArret < est.regles.ageLegal ? `<p class="verdict ko" style="margin:0 0 8px"><b>Tu arrêtes à ${ageArret} ans : la retraite publique n'est versée qu'à partir de ${ageEnTexte(est.regles.ageLegal)} au plus tôt.</b> Entre les deux, tes placements doivent tout payer, et tu ne valides plus de trimestres.</p>` : ""}
    <div class="table-wrap"><table><thead><tr><th>Si tu la demandes</th><th class="m">Taux</th><th class="m">Base (net)</th><th class="m">Complémentaire (net)</th><th class="m">Total net / mois</th><th class="m">Après impôt</th></tr></thead><tbody>${tab}</tbody></table></div>
    <p class="note" style="margin:8px 0 0">En euros d'aujourd'hui. Approximations : 4 trimestres par année travaillée, salaires passés déduits de ton profil de carrière, trimestres pour enfants seulement si tu les indiques, pas de trimestres pour chômage ou maladie, complémentaire réduite comme la base en cas de décote. Surcote de 1,25 % par trimestre travaillé après l'âge légal au-delà de la durée requise ; +10 % sur la base et la complémentaire avec au moins 3 enfants (champ « Enfants à charge » de « Mon profil » ; compte aussi les enfants élevés, même plus à charge) ; plus de malus Agirc-Arrco depuis décembre 2023. « Après impôt » : barème 2026 pour une personne seule, abattement de 10 % compris (<a class="lien-fiche" href="#fiche-net-impot">net avant ou après impôt ?</a>). Les règles peuvent encore changer d'ici ta retraite.</p>
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
function comparerPERPEA(tmi, tret, n = 20) {
  const r = 0.06 / 12, F = (Math.pow(1 + r, 12 * n) - 1) / r;
  const m = 100 / (1 - tmi / 100), cap = m * F, verse = m * 12 * n;
  const per = cap - (verse * tret) / 100 - (cap - verse) * 0.314;
  const capE = 100 * F, pea = capE - (capE - 1200 * n) * 0.186;
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
    if (etat.downloads) await etat.downloads.save({ filename: fichier, data: blob });
    else { const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = fichier; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); }
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

// ---------------------------------------------------------------- mode discrétion
// Remplace les montants en euros par •••• (les pourcentages restent visibles), pour montrer son profil à quelqu'un
let discret = false;
const RE_MONTANT = /−?-?\+?\d[\d\s\u00a0\u202f.,]*\s?k?€/g;
function masquerDans(racine) {
  if (!racine) return;
  if (racine.nodeType === 3) { if (/\d\s?k?€/.test(racine.nodeValue)) racine.nodeValue = racine.nodeValue.replace(RE_MONTANT, (m) => (m.includes("k€") ? "•• k€" : "•••• €")); return; }
  if (racine.nodeType !== 1 || /^(SCRIPT|STYLE|TEXTAREA|INPUT)$/.test(racine.nodeName)) return;
  const w = document.createTreeWalker(racine, NodeFilter.SHOW_TEXT);
  const noeuds = []; while (w.nextNode()) noeuds.push(w.currentNode);
  for (const n of noeuds) masquerDans(n);
  for (const el of racine.querySelectorAll?.("[title]") ?? []) if (/\d\s?k?€/.test(el.title)) el.title = el.title.replace(RE_MONTANT, "•••• €");
}
const observateurDiscret = new MutationObserver((ms) => { for (const m of ms) { if (m.type === "characterData") masquerDans(m.target); else m.addedNodes.forEach(masquerDans); } });
function appliquerDiscret(on) {
  discret = on;
  document.documentElement.classList.toggle("discret", on);
  const b = $("#btn-discret"); b.setAttribute("aria-pressed", String(on)); b.textContent = on ? "👁 Afficher les montants" : "👁 Masquer les montants";
  memo.set("discret", on);
  if (on) { masquerDans(document.body); observateurDiscret.observe(document.body, { childList: true, subtree: true, characterData: true }); }
  else {
    observateurDiscret.disconnect();
    // On redessine tout pour retrouver les vrais montants
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
$("#vue-retraite").addEventListener("change", (e) => {
  if (e.target.id === "r-age") choisirAgeDepart(Number(e.target.value));
  if (e.target.id === "r-mode" || e.target.id === "r-loyers") {
    etat.profil.retraite ??= {};
    if (e.target.id === "r-mode") etat.profil.retraite.modePension = e.target.value; else etat.profil.retraite.compterLoyers = e.target.checked;
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
    const lien = $("#ligne-lep .aide-lien"); if (lien) lien.dataset.bulle = `LEP : 2,5 % sans impôt, plafond 10 000 €. ${texte}`;
  }
  // Salaire dans 10 ans
  // Abondement : combien verser pour tout toucher
  const AB = etat.profil.abondement ?? {}, RA = plan.abondement ?? {};
  const surPEE = AB.acces === "pee" || (AB.acces !== "per" && AB.plan === "pee");
  const plafLegal = surPEE ? RA.plafondPEE ?? 3844.8 : RA.plafondPERCollectif ?? 7689.6;
  $("#aide-acces").innerHTML = {
    "?": `Ton employeur ajoute peut-être de l'argent à ton épargne : regarde ton livret d'épargne salariale, ta fiche de paie (lignes « intéressement », « participation ») ou demande aux RH. Obligatoire dans les entreprises d'au moins 50 salariés. <a class="lien-fiche" href="#fiche-epargne-salariale">Comment savoir</a>`,
    non: "Pas de souci : ton PEA et ton PER individuel font le même travail, sans l'argent offert.",
    pee: `PEE : bloqué 5 ans (sauf achat du logement, mariage, 3e enfant, départ de l'entreprise…), gains sans impôt sur le revenu. <a class="lien-fiche" href="#fiche-epargne-salariale">Tout savoir</a>`,
    per: `PER d'entreprise : bloqué jusqu'à la retraite (sauf achat de la résidence principale), versements volontaires déductibles. <a class="lien-fiche" href="#fiche-epargne-salariale">Tout savoir</a>`,
    les2: `PEE (bloqué 5 ans) et PER d'entreprise (jusqu'à la retraite) : chacun peut avoir son propre abondement. Indique ci-dessous celui qui abonde le plus. <a class="lien-fiche" href="#fiche-epargne-salariale">Tout savoir</a>`,
  }[AB.acces ?? "?"] ?? "";
  const interN = Number(AB.interessement) || 0, tmiI = Number(etat.profil.tmi) || 0;
  $("#aide-interessement").textContent = interN > 0
    ? (AB.placer !== false
      ? `Placés, ils échappent à l'impôt sur le revenu${tmiI ? ` (environ ${eur((interN * tmiI) / 100)} d'économie par an avec ta tranche à ${tmiI} %)` : ""} : seulement 9,7 % de CSG et CRDS. Le plan les ajoute à ta bourse chaque année. Ne les compte pas dans ton épargne mensuelle.`
      : `Reçus directement, ils sont imposés comme ton salaire${tmiI ? ` (environ ${eur((interN * tmiI) / 100)} d'impôt par an)` : ""}. Le plan ne les compte pas.`)
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
    $("#aide-tmi").innerHTML = `${base}${selon}${foyerTxt}${perEco > 0.5 ? ` Avec le PER prévu par le plan : environ ${eur(perEco)} d'impôt en moins par an.` : ""} <a class="lien-fiche" href="#fiche-net-impot">Le détail</a>`;
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
    : (() => { const c = comparerPERPEA(tmiP, plan.per?.tmiRetraite ?? 11); return `Avec ta tranche à ${tmiP} % : 100 € versés ne baissent l'impôt que de ${eur(tmiP)}, et ils seront imposés à la sortie. Sur 20 ans, pour 100 € par mois de ta poche, ${eur(c.per)} avec le PER contre ${eur(c.pea)} avec le PEA (${c.gain >= 0 ? "+" : "−"}${pct(Math.abs(c.gain))}) : le PEA, disponible, est préférable. <a class="lien-fiche" href="#fiche-per">Voir le calcul</a>`; })();
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
  $("#placements").innerHTML = Object.entries(plan.enveloppes).filter(([id]) => id !== "assuranceVieUC").map(([id, e]) => id === "assuranceVie" ? champsAV(plan) :
    `<div class="champ"><label for="pl-${id}">${echapper(e.libelle)}${aideFiche(e.fiche, e.libelle)}</label><div class="saisie"><input id="pl-${id}" type="number" min="0" step="500" data-p="placements.${id}"><span>€</span></div></div>${AIDE[id] ? `<p class="note" style="margin:-4px 0 0">${AIDE[id]}</p>` : ""}`).join("");
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
  const titre = { projetRP: "Estimer le prix d'après le lieu et la surface (facultatif)", logement: "Estimer sa valeur d'après le lieu et la surface (facultatif)", projetLocatif: "Estimer le prix et le loyer d'après le lieu (facultatif)" }[base];
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
function majEstimations() {
  for (const base of BASES_EST) {
    const lieu = etat.profil[base] ?? {};
    const out = $(`#est-${base}`); if (!out) continue;
    if (!lieu.departement) { out.innerHTML = '<span class="muted small">Choisis un département ou tape directement la commune, puis le type et la surface.</span>'; continue; }
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
    const surfaceDeduite = base === "projetLocatif" && !(Number(lieu.surface) > 0) && est?.m2 && Number(etat.profil.projetLocatif?.prix) > 0 ? Math.round(Number(etat.profil.projetLocatif.prix) / est.m2) : null;
    const loy = base === "projetLocatif" ? estimerLoyer(lieu, surfaceDeduite) : null;
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
           <button type="button" class="lien" data-utiliser-loyer="${loy.horsCharges}">Utiliser ce loyer</button>`
        : `<span class="small">${m2Txt}. Indique la surface ou le prix du bien pour estimer le loyer.</span>`);
      if (est?.m2 && est.echelle === "commune") morceaux.push(`<span class="small">${zoneLocative((100 * loy.m2 * 0.9 * 12) / est.m2)} Prix ${eur(est.m2)} le m², loyer ${String(Math.round(loy.m2 * 0.9 * 10) / 10).replace(".", ",")} € le m² hors charges.</span>`);
      else if (est?.m2) morceaux.push(`<span class="small muted">Rendement de la zone non calculé : pas assez de ventes dans cette commune pour un prix au m² fiable (le prix du département fausserait le calcul).</span>`);
    }
    out.innerHTML = morceaux.join("");
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

function remplirProfil() {
  (etat.profil.foyer ??= {}).situation = situationDe(etat.profil);
  if (etat.profil.foyer.actif && etat.profil.foyer.statut === "concubin" && !etat.profil.foyer.vue) etat.profil.foyer.vue = "foyer"; // anciens profils : épargne saisie pour le couple
  document.querySelectorAll("#profil [data-p]").forEach((el) => {
    const v = lire(etat.profil, el.dataset.p);
    if (el.type === "checkbox") el.checked = !!v; else el.value = v ?? "";
  });
  remplirAV();
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

function majVisibiliteProfil() {
  const p = etat.profil;
  majSituation();
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
  $("#ligne-impot-pays").hidden = p.pays !== "AUTRE";
  const accesES = p.abondement?.acces ?? "?";
  $("#bloc-es").hidden = accesES === "non" || accesES === "?";
  $("#ligne-ab-plan").hidden = accesES !== "les2";
  $("#ab-plan").disabled = $("#ab-taux").disabled = $("#ab-plafond").disabled = !p.abondement?.actif;
  $("#ab-placer").disabled = $("#ab-sur-inter").disabled = !(Number(p.abondement?.interessement) > 0);
  $("#p-av-type").disabled = $("#p-av-date").disabled = !p.assuranceVie?.ouverte;
  $("#p-futur-age").disabled = $("#p-futur-cap").disabled = $("#p-futur-sal").disabled = $("#p-futur-ep").disabled = !p.futur?.actif;
  $("#p-rp-h").disabled = !rp || !p.projetRP?.imperatif;
}
function apresSaisieProfil() {
  memo.set("profil-v2", etat.profil);
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
  if (el.id === "av-total" || el.id === "av-euros") { saisieAV(); apresSaisieProfil(); return; }
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
  const exporter = etat.downloads ? `<button type="button" id="cal-export">Exporter pour un agenda (CSV)</button>` : "";
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
  if (e.target.id === "cal-export" && etat.downloads) {
    try {
      await etat.downloads.save({ filename: "echeances-plan-patrimoine.csv", data: new Blob(["﻿" + versCSV(evenementsCalendrier())], { type: "text/csv" }) });
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
const moisEntre = (a, b) => { const [y1, m1] = a.split("-").map(Number), [y2, m2] = b.split("-").map(Number); return (y2 - y1) * 12 + (m2 - m1); };
const ajouterMois = (a, n) => { const [y, m] = a.split("-").map(Number); const t = y * 12 + (m - 1) + n; return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`; };
const libMois = (a) => { const [y, m] = a.split("-").map(Number); return new Date(y, m - 1, 1).toLocaleDateString("fr-FR", { month: "short", year: "numeric" }); };
const totalPlacements = (pl) => Object.values(pl ?? {}).reduce((s, x) => s + (Number(x) || 0), 0);

function prevuA(ref, mois) {
  if (!ref || mois < 0) return null;
  const t = mois / 12, i = Math.floor(t), f = t - i, n = ref.points.length - 1;
  if (i > n) return null;
  const a = ref.points[Math.min(i, n)], b = ref.points[Math.min(i + 1, n)];
  const k = (x) => a[x] + (b[x] - a[x]) * f;
  return { c: k("c"), p10: k("p10"), p50: k("p50"), p90: k("p90") };
}

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
    brouillonReleve = null;
    appliquerPlacements(etat.profil.placements);
    messageSuivi = "Exemple remis à zéro.";
    rendreSuivi(); return;
  }
  if (t.id === "btn-coller") {
    const r = lireReleveColle($("#releve-colle")?.value ?? "");
    brouillonReleve = { ...(brouillonReleve ?? {}), ...r.montants };
    if (Object.keys(r.montants).some((k) => !((Number(etat.profil.placements?.[k]) || 0) > 0))) tousLesComptes = true;
    messageSuivi = Object.keys(r.montants).length
      ? `${Object.keys(r.montants).length} compte(s) rempli(s) : ${Object.entries(r.montants).map(([k, v]) => `${etat.brouillon.enveloppes[k]?.libelle ?? k} ${eur(v)}`).join(", ")}.${r.ignores.length ? ` Lignes non reconnues : ${r.ignores.slice(0, 5).join(" ; ")}${r.ignores.length > 5 ? "…" : ""}.` : ""} Vérifie puis note le relevé.`
      : "Aucune ligne reconnue. Écris une ligne par compte : le nom du compte puis le montant (ex. « Livret A ; 12 345,67 »).";
    rendreSuivi(); return;
  }
  const { suivi: actuel, test, doc: d } = suiviCourant();
  const suivi = clone(actuel ?? { releves: [] });
  try {
    if (t.id === "btn-releve") {
      const date = $("#suivi-mois").value || moisCourant();
      const placements = { ...clone(etat.profil.placements ?? {}), ...(brouillonReleve ?? {}) };
      for (const k of Object.keys(placements)) placements[k] = Math.max(0, Number(placements[k]) || 0);
      const plusRecent = !suivi.releves.some((r) => r.date > date);
      const note = ($("#releve-note")?.value ?? "").trim().slice(0, 140);
      suivi.releves = suivi.releves.filter((r) => r.date !== date).concat([{ date, placements, total: totalPlacements(placements), ...(note ? { note } : {}) }]).sort((a, b) => a.date.localeCompare(b.date));
      if (!suivi.reference) suivi.reference = { date: suivi.releves[0].date, points: referenceDepuis(suivi.releves[0].placements) };
      brouillonReleve = null; moisReleve = null;
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

$("#suivi").addEventListener("change", (e) => { if (e.target.id === "suivi-mois") moisReleve = e.target.value || null; });
$("#suivi").addEventListener("input", (e) => {
  const id = e.target.dataset?.releve; if (!id) return;
  brouillonReleve ??= {};
  brouillonReleve[id] = e.target.value === "" ? 0 : Number(e.target.value);
  const total = totalPlacements({ ...(etat.profil.placements ?? {}), ...brouillonReleve });
  const el = $("#releve-total"); if (el) el.textContent = eur(total);
});

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

// Relevé collé : une ligne par compte, nom puis montant (séparateurs ; , tabulation ou espaces)
const MOTS_COMPTES = [
  ["livretJeune", ["livret jeune"]], ["livretA", ["livret a", "livreta"]], ["ldds", ["ldds", "developpement durable"]], ["lep", ["lep", "epargne populaire"]],
  ["pel", ["pel", "plan epargne logement", "plan d'epargne logement"]], ["livretBancaire", ["super livret", "livret bancaire", "compte sur livret", "csl", "livret+", "livret plus"]],
  ["epargneSalariale", ["pee", "perco", "pereco", "percol", "epargne salariale", "amundi ee", "natixis", "esalia", "epsor"]],
  ["assuranceVieUC", ["unites de compte", "unite de compte", "uc"]], ["assuranceVie", ["assurance vie", "assurance-vie", "fonds euro", "fonds euros", "fonds en euros"]],
  ["pea", ["pea"]], ["cto", ["compte titres", "compte-titres", "cto"]], ["per", ["per"]], ["scpi", ["scpi"]], ["orPhysique", ["or physique", "lingot", "lingots", "napoleon", "pieces d'or", "or"]],
  ["coldWallet", ["ledger", "trezor", "cold wallet", "portefeuille materiel"]], ["plateformeCrypto", ["bitcoin", "crypto", "coinbase", "binance", "kraken", "bitstack", "bitpanda", "btc"]],
];
const echapperRegexp = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
function lireReleveColle(texte) {
  const montants = {}, ignores = [];
  const norm = (t) => " " + t.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/’/g, "'") + " ";
  for (const brut of String(texte).split(/\r?\n/)) {
    const ligne = brut.trim(); if (!ligne) continue;
    // Montant : le dernier nombre de la ligne (12 345,67 · 12345.67 · 1.234,56 · 12 345 €)
    const nombres = ligne.match(/-?\d[\d   .]*(?:,\d+)?/g);
    if (!nombres) { ignores.push(ligne); continue; }
    const brutN = nombres[nombres.length - 1];
    let n = brutN.replace(/[\s  ]/g, "");
    if (/,\d+$/.test(n)) n = n.replace(/\./g, "").replace(",", ".");
    else if (/^\d{1,3}(\.\d{3})+$/.test(n)) n = n.replace(/\./g, "");
    const v = Number(n);
    const t = norm(ligne.slice(0, ligne.lastIndexOf(brutN)));
    const trouve = MOTS_COMPTES.find(([, mots]) => mots.some((m) => new RegExp(`(^|[^a-z0-9+])${echapperRegexp(m)}([^a-z0-9]|$)`).test(t)));
    if (!trouve || !isFinite(v)) { ignores.push(ligne); continue; }
    montants[trouve[0]] = Math.round(((montants[trouve[0]] ?? 0) + Math.max(0, v)) * 100) / 100;
  }
  return { montants, ignores };
}
function rendreSuivi() {
  const plan = etat.brouillon;
  const { suivi, test, exemple, doc } = suiviCourant();
  const nom = exemple ? "Exemple" : doc?.nom ?? "ce profil";
  const releves = suivi?.releves ?? [];
  const ref = suivi?.reference;
  const der = releves[releves.length - 1], avant = releves[releves.length - 2];
  let resAuj = etat.resultat;
  try { if (etat.futur) resAuj = analyser(plan, profilPourMoteur()); } catch (e) { console.error(e); }
  const env = (id) => plan.enveloppes[id]?.libelle ?? id;

  // Comptes proposés dans la saisie : ceux qui ont un montant, ou tous sur demande
  const montants = { ...(etat.profil.placements ?? {}), ...(brouillonReleve ?? {}) };
  const ids = Object.keys(plan.enveloppes).filter((id) => tousLesComptes || (Number(montants[id]) || 0) > 0 || (der?.placements?.[id] ?? 0) > 0);
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
    <p class="note" style="margin:4px 0 10px">Les montants sont pré-remplis avec ceux de ton profil : corrige ceux qui ont changé, puis note le relevé.</p>
    <div class="ligne-actions" style="margin-bottom:8px"><label for="suivi-mois" class="small">Mois du relevé</label><input type="month" id="suivi-mois" value="${moisReleve ?? moisCourant()}" style="width:auto"></div>
    <div class="table-wrap"><table class="saisie-releve"><thead><tr><th>Compte</th><th class="m">${der ? `Relevé de ${libMois(der.date)}` : "Dernier relevé"}</th><th class="m">Solde aujourd'hui</th></tr></thead>
      <tbody>${lignesSaisie || '<tr><td colspan="3" class="muted">Aucun compte avec un montant : affiche tous les comptes.</td></tr>'}</tbody>
      <tfoot><tr><td><b>Total</b></td><td class="m muted">${der ? eur(der.total) : "—"}</td><td class="m"><b class="num" id="releve-total">${eur(totalPlacements(montants))}</b></td></tr></tfoot></table></div>
    <div class="champ" style="margin-top:10px"><label for="releve-note">Note (facultatif) : ce qui explique un saut</label><input id="releve-note" type="text" class="texte" maxlength="140" placeholder="Ex. prime d'intéressement versée, achat d'une voiture 8 000 €, baisse des marchés"></div>
    <details style="margin-top:10px"><summary class="small"><b>Coller un relevé</b> (texte, Excel ou export CSV : une ligne par compte)</summary>
      <textarea id="releve-colle" rows="5" style="width:100%;margin-top:6px" placeholder="Livret A ; 12 345,67&#10;LDDS ; 8 100&#10;PEA Trade Republic ; 31 250,40 €&#10;Assurance vie fonds euros ; 25 000"></textarea>
      <div class="ligne-actions" style="margin-top:6px"><button type="button" id="btn-coller">Remplir les montants</button><span class="small muted">Le nom du compte est reconnu par mots-clés (Livret A, LDDS, PEA, compte-titres, assurance vie, PER, SCPI, bitcoin…).</span></div>
    </details>
    <div class="ligne-actions" style="margin-top:10px">
      <button type="button" class="principal" id="btn-releve">Noter ce relevé</button>
      <button type="button" class="lien" id="releve-tous">${tousLesComptes ? "Masquer les comptes vides" : "Afficher tous les comptes"}</button>
    </div>
    ${messageSuivi ? `<p class="small" style="margin:8px 0 0">${echapper(messageSuivi)}</p>` : ""}
  </section>`;

  if (resAuj && releves.length) {
    const mvts = resAuj.mouvements;
    const libMvt = (m) => m.sens === "arbitrage" ? `${m.transfert ? "Transférer de" : "Arbitrer de"} ${env(m.enveloppe)} vers ${env(m.vers)}` : `${m.sens === "retrait" ? (m.annuel ? "Vendre une fois cette année sur" : "Retirer de") : "Verser sur"} ${env(m.enveloppe)}`;
    html += `<section class="panneau"><h2>Le mois prochain · ${eur(resAuj.profil.epargneMensuelle)} à répartir</h2>
      <p class="note" style="margin:4px 0 8px">D'après ton dernier relevé, voici les virements qui rapprochent chaque compte de sa cible.</p>
      <div class="table-wrap"><table><tbody>${mvts.map((m) => `<tr><td>${texteLie(libMvt(m))}${m.note ? `<div class="note">${texteLie(m.note)}</div>` : ""}</td><td class="m"><span class="${m.sens === "retrait" ? "ecart-moins" : m.sens === "versement" ? "ecart-plus" : "muted"}">${m.sens === "retrait" ? "−" : m.sens === "versement" ? "+" : "⇄ "}${eur(m.montant)}</span></td></tr>`).join("") || '<tr><td class="muted">Aucun mouvement.</td></tr>'}</tbody></table></div>
      <p class="small" style="margin:8px 0 0"><a class="lien-fiche" href="#reequilibrage">Voir le détail et les actions dans « Rééquilibrage » →</a></p></section>`;
  }

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
      if (f.type === "choix") return `<div class="champ champ-texte"><label for="${id}">${f.l}</label><select id="${id}" data-chemin="${f.c}" data-texte="1">${f.options.map(([v, t]) => `<option value="${v}" ${lire(plan, f.c) === v ? "selected" : ""}>${t}</option>`).join("")}</select></div>`;
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
  const effort = 100, mPER = effort / (1 - tmi / 100);
  const capPER = mPER * F, versePER = mPER * 12 * n, netPER = capPER - (versePER * tret) / 100 - (capPER - versePER) * 0.314;
  const cap = effort * F, verse = effort * 12 * n, netPEA = cap - (cap - verse) * 0.186, netCTO = cap - (cap - verse) * 0.314;
  const gain = (100 * (netPER / netPEA - 1));
  const ab = res.abondement;
  const ligneAb = ab?.mensuel > 0.5 ? `<p class="verdict ok" style="margin:0 0 8px"><b>Abondement :</b> en versant ${eur(ab.mensuel)} par mois sur ton ${ab.surPER ? "PER d'entreprise" : "PEE"}, ton employeur ajoute ${eur(ab.abondementAn)} par an. C'est la première chose à faire.</p>` : "";
  return ligneAb + `<p class="small" style="margin:0 0 8px">Ta tranche : <b>${tmi} %</b>. Chaque 100 € versé sur un PER te fait économiser <b>${eur(tmi)}</b> d'impôt.${per.actif ? ` Le plan prévoit ${eur(per.mensuel)} par mois, soit environ <b>${eur(per.economie)} d'impôt en moins par an</b>.` : per.raison === "refus" && per.economiePossible > 0.5 ? ` Tu as refusé le PER : environ ${eur(per.economiePossible)} d'impôt par an laissés de côté.` : ""}</p>
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
    chips: ["1,7 % par an", "0 impôt", "Plafonds 22 950 € + 12 000 €", "Dispo immédiate"],
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
    chips: [`≈ ${pct(H.rendements?.bourse ?? 7)} par an (moyenne)`, "18,6 % sur les gains après 5 ans", "Plafond 150 000 € versés", "Ouvrir tôt pour prendre date"],
    ...(p.pea?.ouvert ? { statut: "fait", texte: `Ouvert${p.pea.dateOuverture ? ` depuis ${new Date(p.pea.dateOuverture + "-01T12:00").toLocaleDateString("fr-FR", { month: "long", year: "numeric" })}` : ""}${(P.pea ?? 0) > 0 ? `, ${eur(P.pea)} dessus` : ""}.` }
      : { statut: "afaire", texte: "À ouvrir maintenant, même avec 10 € : le compteur des 5 ans démarre à l'ouverture." }) });

  // 4. Les cadeaux fiscaux
  const per = res.per;
  const tret = plan.per?.tmiRetraite ?? 11;
  const cmp = tmi != null ? comparerPERPEA(tmi, tret) : null;
  const calcul = cmp ? `100 € versés font baisser l'impôt de ${eur(tmi)}${p.tmiEstimee ? ` (tranche estimée à ${tmi} % d'après tes revenus)` : ""}, mais ces versements seront imposés à la sortie (environ ${tret} % à la retraite). Sur 20 ans, pour 100 € par mois de ta poche : ${eur(cmp.per)} avec le PER contre ${eur(cmp.pea)} avec le PEA, après impôts, soit ${cmp.gain >= 0 ? "+" : "−"}${pct(Math.abs(cmp.gain))}.` : "";
  L.push({ etape: 4, id: "per", nom: "PER (plan d'épargne retraite)", fiche: "per", badge: "Si tu paies assez d'impôt",
    pourquoi: "L'État paie une partie de ton épargne : chaque versement baisse ton impôt de 30 à 45 %, et l'argent est investi en bourse jusqu'à la retraite (ou l'achat de ta résidence principale).",
    chips: ["−30 à −45 % d'impôt", "Investi en ETF", "Bloqué jusqu'à la retraite", "Plafond sur l'avis d'impôt"],
    ...(p.refusPER ? { statut: "non", texte: `Tu l'as écarté${per?.economiePossible > 0.5 ? ` : environ ${eur(per.economiePossible)} d'impôt par an laissés de côté` : ""}.` }
      : tmi == null ? { statut: "verifier", texte: "Indique ta tranche d'imposition dans « Mon profil » pour savoir s'il vaut le coup." }
      : per?.actif ? ((P.per ?? 0) > 0 ? { statut: "fait", texte: `Ouvert. Le plan y verse ${eur(per.mensuel)} par mois : environ ${eur(per.economie)} d'impôt en moins par an.` }
        : { statut: "afaire", texte: `À ouvrir : ${eur(per.mensuel)} par mois, environ ${eur(per.economie)} d'impôt en moins par an.` })
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
      : { statut: "plustard", texte: `Quand ton PEA sera plein (${eur(peaV)} versés sur 150 000 €).` }) });
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
  if (p.eligibleLEP && (P.lep ?? 0) < 9999) out.push(["LEP pas rempli (2,5 % au lieu de 1,7 %)", ((10000 - (P.lep ?? 0)) * 0.8) / 100, "lep"]);
  const inter = Number(A.interessement) || 0;
  if (inter > 0 && A.placer === false && !["non", "?"].includes(A.acces) && tmi > 0) out.push(["Impôt payé sur l'intéressement reçu au lieu d'être placé", (inter * tmi) / 100, "epargne-salariale"]);
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
function rendreFiches() {
  const id = location.hash.startsWith("#fiche-") ? location.hash.slice(7).split("?")[0] : null;
  const f = CONTENU_FICHES.find((x) => x.id === id);
  const verifie = new Date(VERIFIE_LE + "T12:00").toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
  if (!f) {
    $("#fiches").innerHTML = `<p class="note" style="margin:0 0 12px">Un mémo par compte : ce que c'est, où l'ouvrir, comment faire, et ce que ton plan prévoit. Les mots compliqués sont expliqués dans le lexique. Informations vérifiées le ${verifie}.</p>
      <div class="cartes">${CONTENU_FICHES.filter((x) => x.guide || HAUT_FICHES.includes(x.id)).map((x) => `<a class="carte carte-guide" href="#fiche-${x.id}"><span class="etiquette projet">${x.guide ? "À lire en premier" : x.id === "risques" ? "Se protéger" : x.id === "net-impot" ? "Comprendre sa paie" : x.id === "frais" ? "Attention aux frais" : "Les mots expliqués"}</span><h2>${x.titre}</h2><p>${echapper(x.accroche)}</p></a>`).join("")}</div>
      <h3 class="annee" style="margin:20px 0 8px">Une fiche par compte</h3>
      <div class="cartes">${CONTENU_FICHES.filter((x) => !x.guide && !HAUT_FICHES.includes(x.id)).map((x) => `<a class="carte" href="#fiche-${x.id}"><h2>${x.titre}</h2><p>${echapper(x.accroche)}</p></a>`).join("")}</div>`;
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
    ${f.sections.map((sec) => `<section><h3>${sec.titre}</h3>${sec.special === "entreprises" ? blocEntreprises() : sec.special === "top3" ? blocTop3(f) : sec.special === "primes" ? blocPrimes() : ""}${sec.points ? `<${sec.ordonne ? "ol" : "ul"} class="points">${sec.points.map((p) => `<li>${L(p)}</li>`).join("")}</${sec.ordonne ? "ol" : "ul"}>` : ""}${sec.tableau ? `<div class="table-wrap"><table class="tableau-fiche"><thead><tr>${sec.tableau.entetes.map((h) => `<th>${echapper(h)}</th>`).join("")}</tr></thead><tbody>${sec.tableau.lignes.map((l) => `<tr>${l.map((c, i) => `<td${i === 0 ? ' class="fort"' : ""}>${L(c)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>` : ""}</section>`).join("")}
    ${f.videos?.length ? `<section><h3>En vidéo</h3><ul class="points">${f.videos.map(([t, u, n]) => `<li><a class="lien-video" href="${u}" target="_blank" rel="noopener">▶ ${echapper(t)}</a>${n ? ` <span class="muted small">${echapper(n)}</span>` : ""}</li>`).join("")}</ul></section>` : ""}
    ${f.etapes?.length ? `<section><h3>Étapes</h3><ol class="points">${f.etapes.map((p) => `<li>${L(p)}</li>`).join("")}</ol></section>` : ""}
    ${f.attention?.length ? `<section class="vigilance"><h3>Points de vigilance</h3><ul class="points">${f.attention.map((p) => `<li>${L(p)}</li>`).join("")}</ul></section>` : ""}
    <p class="note">${f.guide || f.id === "lexique" ? `Mis à jour le ${verifie}.` : `Informations vérifiées le ${verifie}. Taux, plafonds et fiscalité évoluent : les revérifier avant d'agir. Les plateformes citées sont des exemples, pas des recommandations.`}${f.sources.length ? ` Sources : ${f.sources.map(([t, u]) => `<a href="${u}" target="_blank" rel="noopener">${echapper(t)}</a>`).join(" · ")}.` : ""}</p>
  </article>`;
}

// ---------------------------------------------------------------- onglets
function rendreVue() {
  const vues = { "#epargne-ideale": "ideale", "#mon-profil": "profil", "#simulation": "profil", "#reequilibrage": "reequilibrage", "#trajectoire": "trajectoire", "#retraite": "retraite", "#suivi": "suivi", "#fiches": "fiches", "#mon-plan": "plan" };
  const chemin = location.hash.split("?")[0]; // « #mon-profil?p=… » : seule la partie avant « ? » désigne l'onglet
  const vue = chemin.startsWith("#fiche-") ? "fiches" : vues[chemin] ?? "profil";
  const avant = document.querySelector("section[id^='vue-']:not([hidden])")?.id;
  for (const v of ["profil", "reequilibrage", "trajectoire", "retraite", "ideale", "suivi", "fiches", "plan"]) {
    $(`#vue-${v}`).hidden = v !== vue;
    const lien = $(`#lien-${v}`);
    if (v === vue) lien.setAttribute("aria-current", "page"); else lien.removeAttribute("aria-current");
  }
  if (vue === "trajectoire") rendreTrajectoire();
  if (vue === "retraite") rendreRetraite();
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

// ---------------------------------------------------------------- démarrage
rendreChampsPlacements();
remplirProfil();
rendreReglages();
rendreVue();
apresChangementPlan();
majBandeauScenario(); // lien partagé ouvert au chargement : bandeau « Scénario partagé »
// Assistant : lit le plan, le profil et le dernier résultat à chaque question (aucun état dupliqué)
monterAssistant({
  getContexte: () => ({ plan: etat.brouillon, res: etat.resultat, profil: etat.profil }),
  getCleProfil: cleProfilCourant, // historique du chat : une clé par profil (chat-hist:<col>:<id>)
  appliquerPatch: appliquerSimulation,
  annulerSimulation,
});
brancherStockage();
