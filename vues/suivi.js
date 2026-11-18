// Règle d'architecture : une vue exporte rendre<Nom>() et monter<Nom>() (écouteurs, appelée une seule fois par app.js
// au démarrage) et n'a aucun effet de bord au niveau module. Elle importe ui/commun.js et les modules métier, et des
// fonctions (jamais de const/let) d'app.js : import circulaire sûr car ces fonctions sont hissées.
import { $, clone, fusion, memo, etat, echapper, keur, proches, cle, docCourant, GEOM, PROFIL_VIDE, PROFIL_EXEMPLE } from "../ui/commun.js";
import { referenceSuivi, moisEntre, prevuA } from "../projection.js";
import { releveDepuisImport, lireReleveColle, eur, pct, COMPTES_PRU, TAILLE_MAX_FICHIER, lireFichierReleve, analyser, comparerReleve, etatReleve, calculerPRU } from "../moteur.js";
import { nomVue } from "../niveaux.js";
import { lierTermes } from "../lexique.js";
import { versCSV, echeancesProfil, echeancesGenerales } from "../calendrier.js";
import { normaliserProfil, profilPourMoteur, lienFiche, ecrireDoc, remplirProfil, rendreResultats, texteLie, niveauCourant, telechargerFichier, echelle, colonnesSurvol } from "../app.js";
import { planifierTrajectoire } from "./trajectoire.js";

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
export const suivisTest = new Map();
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

export function suiviCourant() {
  const k = cle(proches.courant);
  if (proches.courant.col === "exemple") {
    if (!suivisTest.has(k)) suivisTest.set(k, genererSuiviExemple());
    return { suivi: suivisTest.get(k), test: true, exemple: true, doc: null };
  }
  const d = docCourant();
  if (d && proches.mode !== "lecture") return { suivi: d.suivi ?? null, test: false, exemple: false, doc: d };
  return { suivi: suivisTest.get(k) ?? null, test: true, exemple: false, doc: d };
}

export async function ecrireSuivi(d, suivi) {
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
const zoneDepot = (e) => e.target.closest?.("#depot-releve");

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

export function rendreSuivi() {
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

// Appelées par app.js : le brouillon de relevé est de l'état de module, jamais écrit depuis l'extérieur.
export function reinitialiserBrouillonReleve() { brouillonReleve = null; moisReleve = null; }
export function ouvrirSuivi() { messageSuivi = ""; rendreSuivi(); }

// Écouteurs de l'onglet Suivi (relevés, fichier déposé, calendrier), attachés une seule fois au démarrage par app.js
export function monterSuivi() {
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
  $("#suivi").addEventListener("change", (e) => { if (e.target.id === "suivi-mois") { moisReleve = e.target.value || null; planifierApercuSuivi(); } });
  $("#suivi").addEventListener("change", (e) => {
    if (e.target.id !== "releve-fichier") return;
    const fichier = e.target.files?.[0];
    e.target.value = "";
    lireFichierDepose(fichier);
  });
  $("#suivi").addEventListener("dragover", (e) => { const z = zoneDepot(e); if (z) { e.preventDefault(); z.classList.add("survol"); } });
  $("#suivi").addEventListener("dragleave", (e) => zoneDepot(e)?.classList.remove("survol"));
  $("#suivi").addEventListener("drop", (e) => {
    const z = zoneDepot(e); if (!z) return;
    e.preventDefault(); z.classList.remove("survol");
    lireFichierDepose(e.dataTransfer?.files?.[0]);
  });
  // Un fichier lâché à côté de la zone ferait quitter l'appli : on l'ignore sur l'onglet Suivi
  for (const ev of ["dragover", "drop"]) window.addEventListener(ev, (e) => { if (!$("#vue-suivi").hidden && e.dataTransfer?.types?.includes("Files") && !zoneDepot(e)) e.preventDefault(); });
  $("#suivi").addEventListener("input", (e) => {
    const id = e.target.dataset?.releve; if (!id) return;
    brouillonReleve ??= {};
    brouillonReleve[id] = e.target.value === "" ? 0 : Number(e.target.value);
    const total = totalPlacements({ ...(etat.profil.placements ?? {}), ...brouillonReleve });
    const el = $("#releve-total"); if (el) el.textContent = eur(total);
    planifierApercuSuivi();
  });
  $("#suivi").addEventListener("click", actionSuivi);
}
