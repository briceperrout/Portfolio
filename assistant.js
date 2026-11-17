// =====================================================================
//  ASSISTANT — questions/réponses sur les placements, le plan et la fiscalité.
//
//  Deux moteurs, même interface :
//    • OpenAI via le relais /api/chat (serveur.py en local, worker.js en production) ;
//    • repli local déterministe : calculs de l'appli + extraits de fiches, sans réseau.
//
//  Vie privée : rien n'est envoyé au cloud sans accord explicite (bandeau au premier
//  usage), et seulement un profil anonymisé (pourcentages et ratios, jamais de montants
//  en euros, de noms ni de comptes) + la question dont les montants sont masqués.
//  Aucune clé API ne transite par le navigateur : elle vit dans serveur.py / le Worker.
//
//  Copilote : réponse affichée mot à mot (SSE) pendant que la saisie est verrouillée, historique
//  gardé par profil (localStorage), simulations « What-If » proposées par des balises
//  [[ACTION:{…}]] (boutons appliqués en mémoire seulement) et questions de suivi
//  [[SUGGESTION:…]]. Les montants en euros de l'utilisateur ne partent jamais au cloud :
//  ils sont remplacés par des jetons {M1}… résolus en local.
//
//  Mode vocal hybride : dictée via SpeechRecognition (fr-FR, transcription en direct puis envoi
//  automatique) et lecture via speechSynthesis (voix française, texte nettoyé du Markdown). Une question
//  dictée ajoute CONSIGNE_VOCALE au prompt (3 à 4 phrases orales) ; la lecture est muette en mode discret.
//
//  Fonctions pures (testables) : texteParle, decouperPhrases, choisirVoixFr, rechercherSections, resumerProfilPourLLM,
//  construireRequeteCloud, repondreLocal, extraireBalises, validerPatch, detecterWhatIf,
//  tokeniserMontants, serialiserHistorique. Le DOM n'est touché que par monterAssistant.
// =====================================================================

import { FICHES, VERIFIE_LE } from "./fiches.js";
import { LEXIQUE, lierTermes } from "./lexique.js";
import { eur, pct, endettementBancaire, seuilAchatBitcoin } from "./moteur.js";

// ---------------------------------------------------------------- outils texte
const echapper = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const sansHtml = (s) => String(s).replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/[ \t]+/g, " ").trim();
const norm = (s) => String(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[’']/g, " ").replace(/[^a-z0-9%]+/g, " ").trim();
const IDS_FICHES = new Set(FICHES.map((f) => f.id));
const TITRE_FICHE = Object.fromEntries(FICHES.map((f) => [f.id, f.titre]));
const lien = (id) => (IDS_FICHES.has(id) ? `[${TITRE_FICHE[id]}](#fiche-${id})` : "");
function coupe(s, n) {
  s = sansHtml(s);
  if (s.length <= n) return s;
  const bout = s.slice(0, n);
  const fin = Math.max(bout.lastIndexOf(". "), bout.lastIndexOf("; "));
  return (fin > n * 0.5 ? bout.slice(0, fin + 1) : bout.replace(/\s+\S*$/, "")) + "…";
}

// ---------------------------------------------------------------- RAG léger
// Pas d'embeddings : recherche lexicale (BM25) sur des sections de fiches, avec détection
// des placements cités pour qu'une comparaison (« PEL ou or ») rapporte les deux sujets.
const MOTS_VIDES = new Set(("le la les un une des de du d l au aux et ou a à en y est sont ce cet cette ces se sa son ses mon ma mes ton ta tes " +
  "que qui quoi dont par pour sur sous dans avec sans plus moins pas ne n ni je j tu il elle on nous vous ils elles me m te t s c qu mais donc car si " +
  "comme quel quelle quels quelles faire fait dois doit peut peux puis vaut mieux entre vers chez tout tous toute toutes etre avoir ai as avons avez ont " +
  "suis es sommes etes veux voudrais souhaite comment combien quand pourquoi").split(" "));
const racine = (t) => (t.length > 4 ? t.replace(/(?:s|x)$/, "") : t);
// Formes voisines ramenées à un même jeton (vendre/vente, casser/fermer, taxe/impôt) pour que la question retrouve le vocabulaire des fiches.
const canon = (t) => (/^(vend|vent[ea]?$)/.test(t) ? "vente" : /^(cass|ferm|clotur)/.test(t) ? "ferme" : /^(tax|impot|imposi|impose|fiscal|prelev)/.test(t) ? "impot" : t);
const jetons = (s) => norm(s).split(" ").filter((t) => t && !MOTS_VIDES.has(t) && (t.length > 1 || /\d/.test(t))).map((t) => canon(racine(t)));

// Formes cherchées dans la question pour repérer un placement (complétées par le lexique).
const ALIAS = {
  "livret-a": ["livret a"], ldds: ["ldds", "livret developpement durable"], lep: ["lep"], "livret-jeune": ["livret jeune"],
  "livret-bancaire": ["livret bancaire", "livret fiscalise", "super livret"], pel: ["pel", "plan epargne logement"],
  pea: ["pea", "plan epargne en actions", "pea pme"], cto: ["cto", "compte titres", "compte titre"],
  "assurance-vie": ["assurance vie", "assurances vie", "fonds euro", "fonds euros", "av"],
  per: ["per", "plan epargne retraite", "perin"], "epargne-salariale": ["pee", "perco", "per entreprise", "interessement", "participation", "abondement"],
  or: ["or physique", "lingot", "lingots", "napoleon", "napoleons", "mon or", "l or", "de l or", "vendre or", "vendre mon or", "acheter de l or", "pieces d or"],
  bitcoin: ["bitcoin", "btc", "crypto", "cryptos", "cryptomonnaie", "cold wallet"], scpi: ["scpi", "pierre papier"],
  residence: ["residence principale", "apport", "achat immobilier", "ptz", "acheter un appartement", "acheter une maison"],
  "credit-immobilier": ["credit immobilier", "taux de credit", "pret immobilier", "emprunt", "emprunter", "endettement", "capacite d emprunt"],
  "regimes-locatifs": ["lmnp", "micro foncier", "micro bic", "location meublee", "investissement locatif", "locatif"],
  heritage: ["heritage", "succession", "donation"], "retraite-publique": ["retraite", "pension", "agirc", "trimestres"],
  "net-impot": ["net avant impot", "net apres impot", "prelevement a la source", "tmi", "tranche marginale"], frais: ["frais"],
  etranger: ["expatrie", "expatriation", "hors de france", "etranger"],
};
const GENERIQUES = new Set(["residence", "credit-immobilier", "regimes-locatifs", "heritage", "retraite-publique", "net-impot", "frais", "etranger"]);

let ENTITES = null;
function entites() {
  if (ENTITES) return ENTITES;
  ENTITES = new Map();
  const ajouter = (id, forme) => {
    const n = norm(forme);
    if (n.length < 2 || !IDS_FICHES.has(id)) return;
    if (!ENTITES.has(id)) ENTITES.set(id, new Set());
    ENTITES.get(id).add(n);
  };
  for (const [id, formes] of Object.entries(ALIAS)) formes.forEach((f) => ajouter(id, f));
  for (const e of LEXIQUE) if (e.fiche) for (const m of e.motifs ?? []) if (norm(m).length >= 4) ajouter(e.fiche, m);
  for (const f of FICHES) if (!f.guide && f.id !== "lexique" && norm(f.titre).split(" ").length <= 3) ajouter(f.id, f.titre);
  return ENTITES;
}
/** Ids de fiches des placements/sujets cités, les plus précis d'abord puis par ordre d'apparition. */
export function detecterSujets(texte) {
  const q = ` ${norm(texte)} `;
  const trouves = [];
  for (const [id, formes] of entites()) {
    let pos = -1;
    for (const f of formes) { const i = q.indexOf(` ${f} `); if (i >= 0 && (pos < 0 || i < pos)) pos = i; }
    if (pos >= 0) trouves.push({ id, pos, generique: GENERIQUES.has(id) ? 1 : 0 });
  }
  trouves.sort((a, b) => a.generique - b.generique || a.pos - b.pos);
  return trouves.map((t) => t.id);
}

let INDEX = null;
const K1 = 1.4, B = 0.75;
function texteSection(sec) {
  const l = [];
  for (const [k, v] of Object.entries(sec)) {
    if (k === "titre" || k === "special" || k === "ordonne") continue;
    if (k === "tableau" && v?.lignes) {
      if (v.entetes) l.push(v.entetes.join(" | "));
      for (const r of v.lignes) l.push(Array.isArray(r) ? r.join(" | ") : String(r));
    } else if (Array.isArray(v)) for (const p of v) l.push(Array.isArray(p) ? p.join(" : ") : String(p));
    else if (typeof v === "string") l.push(v);
  }
  return l.map(sansHtml).filter(Boolean).join("\n");
}
function construireIndex() {
  const chunks = [];
  for (const f of FICHES) {
    if (f.id === "lexique") continue; // les mots du lexique sont indexés un par un ci-dessous
    const base = { fiche: f.id, ficheTitre: f.titre };
    const essentiel = [f.accroche, f.role, ...(f.essentiel ?? []).map(([k, v]) => `${k} : ${v}`)].filter(Boolean).map(sansHtml).join("\n");
    if (essentiel) chunks.push({ ...base, titre: "L'essentiel", texte: essentiel });
    for (const s of f.sections ?? []) { const t = texteSection(s); if (t) chunks.push({ ...base, titre: s.titre, texte: t }); }
    if (f.frais?.length) chunks.push({ ...base, titre: "Frais", texte: f.frais.map((r) => (Array.isArray(r) ? r.join(" : ") : String(r))).map(sansHtml).join("\n") });
    const pratique = [...(f.etapes ?? []).map((e, i) => `${i + 1}. ${e}`), ...(f.attention ?? []).map((a) => `Attention : ${a}`)];
    if (pratique.length) chunks.push({ ...base, titre: "Étapes et vigilance", texte: pratique.map(sansHtml).join("\n") });
  }
  for (const e of LEXIQUE) {
    const id = e.fiche && IDS_FICHES.has(e.fiche) ? e.fiche : "lexique";
    chunks.push({ fiche: id, ficheTitre: TITRE_FICHE[id] ?? "Lexique", titre: e.mot, texte: sansHtml(e.def), lexique: true });
  }
  const df = new Map();
  let total = 0;
  for (const c of chunks) {
    const t = [...jetons(c.texte), ...Array(3).fill(jetons(`${c.ficheTitre} ${c.titre}`)).flat()];
    c.tf = new Map();
    for (const j of t) c.tf.set(j, (c.tf.get(j) ?? 0) + 1);
    c.len = t.length;
    total += t.length;
    for (const j of c.tf.keys()) df.set(j, (df.get(j) ?? 0) + 1);
  }
  return { chunks, df, N: chunks.length, avg: total / Math.max(1, chunks.length) };
}
function score(qt, c, I) {
  let s = 0;
  for (const t of new Set(qt)) {
    const f = c.tf.get(t);
    if (!f) continue;
    const n = I.df.get(t);
    s += Math.log(1 + (I.N - n + 0.5) / (n + 0.5)) * ((f * (K1 + 1)) / (f + K1 * (1 - B + (B * c.len) / I.avg)));
  }
  return s;
}
/**
 * Les `max` sections les plus pertinentes (2 par défaut) pour la question.
 * – chaque placement cité (« PEL ou or ») obtient sa meilleure section avant tout classement brut ;
 * – une question courte (« et après 8 ans ? ») est complétée par la question précédente ;
 * – en dessous d'un score minimal, on n'injecte rien plutôt que du bruit ;
 * – budget de caractères plafonné pour garder la réponse rapide.
 */
export function rechercherSections(question, historique = [], { max = 2, budget = 4200 } = {}) {
  INDEX ??= construireIndex();
  const precedente = [...historique].reverse().find((m) => m.role === "user" && m.texte !== question)?.texte ?? "";
  const courte = jetons(question).length < 3;
  const requete = courte && precedente ? `${precedente} ${question}` : question;
  const qt = jetons(requete);
  let sujets = detecterSujets(question);
  if (!sujets.length && courte && precedente) sujets = detecterSujets(precedente).slice(0, 1);
  // « L'essentiel » résume la fiche : léger avantage à score voisin
  const notes = INDEX.chunks.map((c) => ({ c, s: score(qt, c, INDEX) * (c.titre === "L'essentiel" ? 1.15 : 1) }));
  const choix = [];
  const prendre = (x) => { if (x && !choix.includes(x)) choix.push(x); };
  for (const id of sujets.slice(0, max)) {
    const de = notes.filter((n) => n.c.fiche === id && !n.c.lexique).sort((a, b) => b.s - a.s);
    prendre(de[0]?.s > 0 ? de[0] : de.find((n) => n.c.titre === "L'essentiel") ?? de[0]);
  }
  // Un seul placement cité : la 2e section vient de la même fiche (ou rien) ; sinon, d'abord des fiches différentes.
  const unique = sujets.length === 1 && choix.length === 1 ? choix[0].c.fiche : null;
  const classes = notes.filter((n) => n.s > 0 && (!unique || (n.c.fiche === unique && !n.c.lexique))).sort((a, b) => b.s - a.s);
  const seuil = Math.max(1.2, (classes[0]?.s ?? 0) * 0.35);
  for (const passe of [0, 1]) {
    for (const n of classes) {
      if (choix.length >= max) break;
      if (n.s < seuil || choix.includes(n)) continue;
      if (passe === 0 && !unique && choix.some((x) => x.c.fiche === n.c.fiche)) continue;
      choix.push(n);
    }
  }
  const sorties = [];
  let reste = budget;
  for (const n of choix.slice(0, max)) {
    const texte = coupe(n.c.texte, Math.min(1500, Math.max(300, reste)));
    reste -= texte.length;
    sorties.push({ fiche: n.c.fiche, ficheTitre: n.c.ficheTitre, titre: n.c.titre, texte, score: n.s });
  }
  return sorties;
}

// ---------------------------------------------------------------- profil anonymisé pour le LLM
// Libellé sans parenthèses, sauf quand deux comptes auraient le même (assurance-vie fonds euros / unités de compte)
function libelleCourt(plan, id) {
  const complet = String(plan?.enveloppes?.[id]?.libelle ?? id);
  const court = complet.replace(/\s*\(.*$/, "").trim();
  const doublon = Object.entries(plan?.enveloppes ?? {}).some(([k, e]) => k !== id && String(e.libelle ?? k).replace(/\s*\(.*$/, "").trim() === court);
  return doublon ? complet : court;
}
const somme = (o, ids) => ids.reduce((s, k) => s + (Number(o?.[k]) || 0), 0);
const arrondi = (v, d = 0) => { const k = 10 ** d; return Math.round(v * k) / k; };
const fr = (v, d = 0) => String(arrondi(v, d)).replace(".", ",");

export function contexteVide(ctx) { return !(ctx?.res?.profil ?? ctx?.profil); }

/** Résumé chiffré en pourcentages et ratios : aucun montant en euros, aucun nom, aucun compte. */
export function resumerProfilPourLLM(ctx) {
  const { plan, res } = ctx ?? {};
  const P = res?.profil ?? ctx?.profil;
  if (!P) return "";
  const L = [];
  const sal = Number(P.salaireNetMensuel) || 0, ep = Number(P.epargneMensuelle) || 0, dep = Number(P.depensesMensuelles) || 0, cred = Number(P.creditsMensuels) || 0;
  const cap = Number(res?.capital) || 0;
  const pl = P.placements ?? {};
  const couple = !!P.couple || !!P.foyer?.actif;
  L.push(`- Âge : ${P.agePrincipal ?? P.age} ans. Foyer : ${couple ? `en couple (${P.marie === false ? "concubinage" : "marié ou pacsé"})` : "seul"}. Enfants à charge : ${Number(P.enfants) || 0}. Propriétaire de sa résidence principale : ${P.proprietaire ? "oui" : "non"}.`);
  L.push(`- Pays de résidence fiscale : ${P.pays || "FR"}. Statut professionnel : ${P.statutPro || "non précisé"}. Profil de risque : ${P.profilRisque || "par défaut"}. Tranche marginale d'impôt : ${P.tmi === "" || P.tmi == null ? "inconnue" : `${P.tmi} %${P.tmiEstimee ? " (estimée)" : ""}`}.`);
  if (sal > 0) L.push(`- Budget (en % du salaire net) : épargne mensuelle ${fr((100 * ep) / sal)} %, dépenses ${fr((100 * dep) / sal)} %, crédits en cours ${fr((100 * cred) / sal)} %.`);
  if (sal > 0 && cap > 0) L.push(`- Capital total ≈ ${fr(cap / (sal * 12), 1)} fois le salaire net annuel.`);
  const liquide = somme(pl, ["livretA", "ldds", "livretBancaire", "lep", "livretJeune"]);
  if (dep > 0) L.push(`- Épargne de précaution (livrets) ≈ ${fr(liquide / dep, 1)} mois de dépenses.`);
  if (plan?.enveloppes) {
    const ids = Object.keys(plan.enveloppes);
    const detenus = ids.filter((id) => (Number(pl[id]) || 0) > 0).sort((a, b) => pl[b] - pl[a]);
    const absents = ids.filter((id) => !((Number(pl[id]) || 0) > 0));
    L.push(`- Placements détenus (part du capital) : ${detenus.length && cap > 0 ? detenus.map((id) => `${libelleCourt(plan, id)} ${fr((100 * pl[id]) / cap)} %`).join(" ; ") : "aucun"}.`);
    L.push(`- Comptes à zéro, NON détenus (ne pas raisonner dessus comme s'ils existaient) : ${absents.map((id) => libelleCourt(plan, id)).join(", ") || "aucun"}.`);
  }
  const comptes = (res?.reeq?.comptes ?? []).filter((c) => cap > 0 && ((c.actuel ?? 0) > 0 || (c.cible ?? 0) > 0));
  if (comptes.length) L.push(`- Allocation actuelle → cible du plan (% du capital) : ${comptes.slice(0, 9).map((c) => `${libelleCourt(plan, c.enveloppe)} ${fr((100 * c.actuel) / cap)} → ${fr((100 * c.cible) / cap)}`).join(" ; ")}.`);
  const RP = P.projetRP;
  if (RP?.actif) {
    const ideal = res?.achat?.ideal;
    const couvert = ideal?.apportRequis > 0 && ideal?.apport != null ? `apport disponible = ${fr((100 * ideal.apport) / ideal.apportRequis)} % de l'apport requis` : "apport non évalué";
    let dette = "";
    try { const e = endettementBancaire(plan, P); const t = e.lignes?.[0]?.taux; if (t != null) dette = ` Taux d'endettement actuel ${fr(t, 1)} % (limite des banques ${e.max} %).`; } catch { /* sans objet */ }
    L.push(`- Projet d'achat de la résidence principale : oui (${RP.type === "neuf" ? "neuf" : "ancien"}${RP.horizonAnnees > 0 ? `, dans ${RP.horizonAnnees} ans` : ""}${RP.imperatif ? ", date impérative" : ""}) ; ${couvert}${ideal?.age ? `, âge d'achat idéal ${ideal.age} ans` : ""}.${dette}`);
  } else L.push("- Projet d'achat de la résidence principale : non.");
  if (P.projetLocatif?.actif) L.push("- Projet d'investissement locatif : oui.");
  L.push(`- Retraite : départ visé à ${P.retraite?.ageDepart ?? plan?.hypotheses?.ageRetraite ?? 64} ans.`);
  const per = res?.per;
  L.push(`- PER : ${P.refusPER ? "refusé par l'utilisateur" : per?.actif ? `conseillé (≈ ${fr((100 * (per.mensuel ?? 0)) / Math.max(1, ep))} % de l'épargne mensuelle)` : `non conseillé${per?.raison ? ` (${per.raison})` : ""}`}.`);
  const ab = P.abondement;
  if (ab?.acces && ab.acces !== "?") L.push(`- Épargne salariale : accès ${ab.acces}${ab.actif ? ", abondement de l'employeur" : ""}.`);
  const mv = res?.mouvements ?? [];
  const vers = mv.filter((m) => m.sens === "versement" && m.montant > 0);
  const totalVers = vers.reduce((s, m) => s + m.montant, 0);
  if (vers.length && totalVers > 0) L.push(`- Épargne du mois à répartir (selon le plan) : ${vers.slice(0, 6).map((m) => `${libelleCourt(plan, m.enveloppe)} ${fr((100 * m.montant) / totalVers)} %`).join(" ; ")}.`);
  const ret = mv.filter((m) => m.sens === "retrait" && m.montant > 0);
  if (ret.length) L.push(`- Ventes/transferts prévus ce mois : ${ret.slice(0, 4).map((m) => libelleCourt(plan, m.enveloppe)).join(", ")}.`);
  return L.join("\n");
}

// ---------------------------------------------------------------- montants, actions What-If, suggestions
// Montants en euros → jetons {M1}, {M2}… avant tout envoi au cloud ; le modèle les recopie tels quels
// dans ses balises et le navigateur les résout en local. Aucun montant ne quitte le navigateur.
const RE_MONTANT = /(?<![\d.,])(?:\d{1,3}(?:[\s  .]\d{3})+|\d+)(?:[.,]\d+)?[\s  ]?(?:k[\s  ]?€|k[\s  ]?euros?|€|euros?)(?![\p{L}\d_])/giu;

/** « 1 500 € », « 1,5 k€ », « 380.000 euros » → nombre (null si illisible). */
export function parserMontant(s) {
  const k = /k/i.test(s);
  let t = String(s).replace(/[^\d.,]/g, "");
  if (t.includes(",")) t = t.replace(/\./g, "").replace(",", ".");
  else if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, "");
  const n = Number(t);
  return Number.isFinite(n) ? (k ? n * 1000 : n) : null;
}
/** Remplace chaque montant en euros par un jeton {Mn} ; `table` (jeton → valeur) reste dans le navigateur. */
export function tokeniserMontants(texte, table = {}) {
  return String(texte).replace(RE_MONTANT, (m) => {
    const v = parserMontant(m);
    if (v == null) return m;
    let id = Object.keys(table).find((k) => table[k] === v);
    if (!id) { id = `M${Object.keys(table).length + 1}`; table[id] = v; }
    return `{${id}}`;
  });
}
export function resoudreJetons(texte, table = {}) {
  return String(texte).replace(/\{(M\d+)\}/g, (m, id) => (Object.hasOwn(table, id) ? eur(table[id]) : "un montant"));
}

// Seuls ces champs du profil peuvent être modifiés par une simulation (chemins pointés, bornes strictes).
export const PATCH_AUTORISES = {
  epargneMensuelle: { libelle: "épargne mensuelle", type: "eur", parMois: true, min: 0, max: 20000 },
  depensesMensuelles: { libelle: "dépenses mensuelles", type: "eur", parMois: true, min: 0, max: 20000 },
  salaireNetMensuel: { libelle: "salaire net mensuel", type: "eur", parMois: true, min: 0, max: 50000 },
  creditsMensuels: { libelle: "crédits mensuels", type: "eur", parMois: true, min: 0, max: 20000 },
  "projetRP.actif": { libelle: "projet d'achat de la résidence principale", type: "bool" },
  "projetRP.prix": { libelle: "prix du bien", type: "eur", min: 20000, max: 5000000 },
  "projetRP.type": { libelle: "type de bien", type: "enum", valeurs: ["ancien", "neuf"] },
  "projetRP.horizonAnnees": { libelle: "achat dans", type: "annees", min: 0, max: 30 },
  "retraite.ageDepart": { libelle: "arrêt de l'activité à", type: "age", min: 50, max: 75 },
};
function descriptionPatchs() {
  return Object.entries(PATCH_AUTORISES).map(([c, r]) => {
    const forme = r.type === "bool" ? "true/false" : r.type === "enum" ? r.valeurs.map((v) => `"${v}"`).join(" ou ") : `nombre entre ${r.min} et ${r.max}${r.type === "eur" ? " (euros)" : r.type === "age" ? " (âge)" : " (années)"}`;
    return `  • ${c} : ${r.libelle}, ${forme}`;
  }).join("\n");
}
function aplatir(o, prefixe = "", sortie = {}, profondeur = 0) {
  if (o === null || typeof o !== "object" || Array.isArray(o) || profondeur > 3) return null;
  for (const [k, v] of Object.entries(o)) {
    const chemin = prefixe ? `${prefixe}.${k}` : k;
    if (v !== null && typeof v === "object" && !Array.isArray(v)) { if (aplatir(v, chemin, sortie, profondeur + 1) === null) return null; }
    else sortie[chemin] = v;
  }
  return sortie;
}
/** Patch imbriqué ou à clés pointées → patch plat validé (liste blanche + bornes), ou null si un seul champ est refusé. */
export function validerPatch(patch) {
  const plat = aplatir(patch);
  if (!plat || !Object.keys(plat).length || Object.keys(plat).length > 6) return null;
  const sortie = {};
  for (const [chemin, v] of Object.entries(plat)) {
    const r = Object.hasOwn(PATCH_AUTORISES, chemin) ? PATCH_AUTORISES[chemin] : null;
    if (!r) return null;
    if (r.type === "bool") { if (typeof v !== "boolean") return null; sortie[chemin] = v; continue; }
    if (r.type === "enum") { if (!r.valeurs.includes(v)) return null; sortie[chemin] = v; continue; }
    const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
    if (!Number.isFinite(n) || n < r.min || n > r.max) return null;
    sortie[chemin] = Math.round(n);
  }
  if ("projetRP.prix" in sortie && !("projetRP.actif" in sortie)) sortie["projetRP.actif"] = true;
  return sortie;
}
/** Phrase lisible d'un patch validé (confirmation dans le chat). */
export function decrirePatch(patch) {
  return Object.entries(patch).filter(([c, v]) => !(c === "projetRP.actif" && v === true && "projetRP.prix" in patch)).map(([c, v]) => {
    const r = PATCH_AUTORISES[c];
    if (!r) return c;
    if (r.type === "eur") return `${r.libelle} ${eur(v)}${r.parMois ? "/mois" : ""}`;
    if (r.type === "bool") return `${r.libelle} : ${v ? "oui" : "non"}`;
    if (r.type === "age") return `${r.libelle} ${v} ans`;
    if (r.type === "annees") return `${r.libelle} ${v} an${v > 1 ? "s" : ""}`;
    return `${r.libelle} : ${v}`;
  }).join(" ; ");
}

const RE_BALISE = /\[\[(ACTION|SUGGESTION):([\s\S]*?)\]\]/g;
function lireAction(corps, montants) {
  let o;
  try { o = JSON.parse(String(corps).trim()); } catch { return null; }
  if (!o || typeof o !== "object" || typeof o.label !== "string") return null;
  const resoudre = (v) => {
    if (typeof v === "string") { const m = v.match(/^\{(M\d+)\}$/); return m ? (Object.hasOwn(montants, m[1]) ? montants[m[1]] : NaN) : v; }
    if (v && typeof v === "object" && !Array.isArray(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, resoudre(x)]));
    return v;
  };
  const patch = validerPatch(resoudre(o.patch));
  const label = resoudreJetons(o.label, montants).replace(/\s+/g, " ").trim().slice(0, 90);
  return patch && label ? { label, patch, etat: "libre" } : null;
}
/**
 * Sépare le texte affiché des balises [[ACTION:{…}]] (2 au plus, validées) et [[SUGGESTION:…]] (2 au plus).
 * Tolère un flux en cours : une balise encore ouverte ou un jeton partiel en fin de texte est masqué.
 */
export function extraireBalises(brut, montants = {}) {
  const actions = [], suggestions = [];
  const sans = String(brut).replace(RE_BALISE, (m, type, corps) => {
    if (type === "SUGGESTION") {
      const t = resoudreJetons(corps, montants).replace(/\s+/g, " ").trim();
      if (t.length >= 3 && t.length <= 120 && suggestions.length < 2 && !suggestions.includes(t)) suggestions.push(t);
    } else {
      const a = lireAction(corps, montants);
      if (a && actions.length < 2 && !actions.some((x) => JSON.stringify(x.patch) === JSON.stringify(a.patch))) actions.push(a);
    }
    return "";
  });
  const texte = resoudreJetons(sans.replace(/\[\[[\s\S]*$/, "").replace(/\[$/, "").replace(/\{M?\d*$/, ""), montants)
    .replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  return { texte, actions, suggestions };
}

// Repli déterministe : détecte les trois questions prospectives types (épargne, achat, arrêt d'activité).
const RE_HYPOTHESE = /(?:^| )(?:et si|si je|si j|si on|imagine|imaginons|supposons|simule|simuler|simulation)(?: |$)/;
export function detecterWhatIf(question) {
  const n = ` ${norm(question)} `;
  if (!RE_HYPOTHESE.test(n.trim())) return [];
  const brut = String(question).toLowerCase();
  const montants = [...brut.matchAll(RE_MONTANT)].map((m) => parserMontant(m[0])).filter((v) => v != null);
  const sortie = [];
  const ajouter = (label, patch) => { const p = validerPatch(patch); if (p && sortie.length < 2) sortie.push({ label, patch: p, etat: "libre" }); };
  if (/ (?:achet|acquer|acquis|achat|acquisition)\w* /.test(n)) {
    const prix = montants.find((v) => v >= 20000);
    if (prix) ajouter(`Simuler un achat à ${eur(prix)}`, { projetRP: { actif: true, prix } });
  }
  if (/ (?:arret|stopp|quitt|cess|part)\w* /.test(n) && /(?:travail|retraite|activite|boulot|bosser|carriere|metier)/.test(n)) {
    const age = [...n.matchAll(/ (\d{2}) ans /g)].map((m) => Number(m[1])).find((a) => a >= 50 && a <= 75);
    if (age) ajouter(`Simuler un arrêt à ${age} ans`, { retraite: { ageDepart: age } });
  }
  if (/ (?:epargn|plac|vers|mett|invest)\w* /.test(n) && /(?:mois|mensuel)/.test(n)) {
    let v = montants.find((x) => x <= 20000);
    if (v == null) { const b = brut.match(/(\d[\d\s .]*\d|\d)\s*(?:\/\s*mois|par\s+mois|mensuels?)/); v = b ? parserMontant(`${b[1]} €`) : null; }
    if (v != null && v >= 0 && v <= 20000) ajouter(`Simuler ${eur(v)}/mois d'épargne`, { epargneMensuelle: v });
  }
  return sortie;
}

// ---------------------------------------------------------------- historique persistant (par profil)
const MAX_MESSAGES_HIST = 30, MAX_OCTETS_HIST = 40000;
/** Messages du fil → objets simples (sans nœuds DOM ni fonctions), bornés en nombre et en taille. */
export function serialiserHistorique(fil) {
  const sortie = (fil ?? []).filter((m) => m && typeof m.texte === "string" && m.texte && (m.role === "user" || (m.role === "ia" && m.source && !m.enCours)))
    .slice(-MAX_MESSAGES_HIST).map((m) => {
      const o = { role: m.role, texte: m.texte.slice(0, 6000) };
      if (m.role === "ia") {
        o.source = m.source;
        if (m.modele) o.modele = String(m.modele);
        if (m.note) o.note = String(m.note);
        if (m.actions?.length) o.actions = m.actions.map((a) => ({ label: a.label, patch: a.patch, etat: a.etat === "appliquee" ? "appliquee" : "libre" }));
        if (m.suggestions?.length) o.suggestions = m.suggestions.slice(0, 2);
      }
      return o;
    });
  while (sortie.length > 1 && JSON.stringify(sortie).length > MAX_OCTETS_HIST) sortie.shift();
  return sortie;
}
/** Relit un historique stocké (donnée non fiable) : forme vérifiée, patchs revalidés. */
export function lireHistorique(brut) {
  let a;
  try { a = JSON.parse(brut); } catch { return []; }
  if (!Array.isArray(a)) return [];
  return a.slice(-MAX_MESSAGES_HIST).flatMap((m) => {
    if (!m || (m.role !== "user" && m.role !== "ia") || typeof m.texte !== "string" || !m.texte) return [];
    const o = { role: m.role, texte: m.texte.slice(0, 6000) };
    if (m.role === "ia") {
      o.source = ["openai", "local", "action"].includes(m.source) ? m.source : "local";
      if (typeof m.modele === "string") o.modele = m.modele.slice(0, 60);
      if (typeof m.note === "string") o.note = m.note.slice(0, 200);
      o.actions = (Array.isArray(m.actions) ? m.actions : []).flatMap((x) => {
        const patch = validerPatch(x?.patch);
        return patch && typeof x.label === "string" ? [{ label: x.label.slice(0, 90), patch, etat: x.etat === "appliquee" ? "appliquee" : "libre" }] : [];
      }).slice(0, 2);
      o.suggestions = (Array.isArray(m.suggestions) ? m.suggestions : []).filter((s) => typeof s === "string" && s.length >= 3 && s.length <= 120).slice(0, 2);
    }
    return [o];
  });
}

// ---------------------------------------------------------------- prompt et requête cloud
export function memoFiscal(plan) {
  const seuil = seuilAchatBitcoin(plan);
  const rec = plan?.bitcoin?.recordDollars ?? 126000;
  const baisse = plan?.bitcoin?.baisseMinPourAcheter ?? 30;
  const fmt = (v) => Math.round(v).toLocaleString("fr-FR").replace(/ /g, " ");
  return [
    "- CTO : PFU 31,4 %.",
    "- PEA : au-delà de 5 ans, 18,6 % de prélèvements sociaux sur les gains ; avant 5 ans, un retrait clôture le plan et les gains sont taxés au PFU 31,4 %.",
    "- Assurance-vie : prélèvements sociaux 17,2 % (fonds euros) ; au rachat, PFU 30 % avant 8 ans, 24,7 % après 8 ans, au-delà de l'abattement annuel de 4 600 € (seul) / 9 200 € (couple).",
    "- Or physique : aucun intérêt ; à la vente, taxe forfaitaire de 11,5 % du prix total, ou 37,6 % sur la plus-value (option).",
    `- Bitcoin : achat uniquement si le cours est au moins ${baisse} % sous le record de ${fmt(rec)} $ (soit ≤ ${fmt(seuil ?? rec * (1 - baisse / 100))} $) ; 5 000 € maximum sur une plateforme.`,
    "- Pinel : dispositif fermé depuis fin 2024.",
  ].join("\n");
}

const INSTRUCTIONS = `Tu es l'assistant pédagogique de l'application « Plan Patrimoine », un simulateur patrimonial français. Tu expliques ; tu ne vends rien et tu ne remplaces pas un conseiller (aucun conseil en investissement personnalisé).

RÈGLES STRICTES
1. Avant de parler d'un placement, regarde le PROFIL : un compte listé « NON détenu » n'existe pas pour l'utilisateur. Dis-le (« Tu n'as pas d'or ») au lieu de raisonner comme s'il l'avait.
2. N'invente jamais un taux, un plafond ou une règle fiscale. Appuie-toi uniquement sur le MÉMO FISCAL 2026, les EXTRAITS DE FICHES et le PROFIL. Si l'information manque, dis-le et renvoie vers la fiche la plus proche.
3. Cite tes sources avec des liens Markdown exacts [Titre exact](#fiche-id), pris uniquement dans l'INDEX DES FICHES. Aucun autre lien.
4. Le profil est anonymisé : tu connais des pourcentages et des ratios, pas de montants en euros. N'invente aucun montant personnel ; raisonne en % ou renvoie l'utilisateur lire ses chiffres dans l'application.
5. Style : français, tutoiement, direct, 120 à 200 mots maximum, puces courtes, chiffres clés en **gras**. Pas d'introduction ni de conclusion creuses.
6. Ajoute une phrase de vigilance seulement si une action est irréversible ou risquée (ex. clôture d'un PEA, vente d'or).
7. Hors sujet (autre chose que patrimoine, fiscalité française, immobilier, retraite) : dis-le en une phrase.
8. Question prospective (« et si… ») : après ta réponse, ajoute 1 ou 2 balises d'action, chacune sur sa propre ligne, au format exact
[[ACTION:{"label":"Simuler {M1}/mois d'épargne","patch":{"epargneMensuelle":"{M1}"}}]]
Champs autorisés dans "patch" (aucun autre) :
${descriptionPatchs()}
Les montants en euros écrits par l'utilisateur sont remplacés par des jetons {M1}, {M2}… : recopie-les tels quels, entre guillemets, dans "patch" et "label". Si la valeur à simuler n'est pas donnée par l'utilisateur, n'ajoute aucune action. Sans question prospective, aucune action.
9. Termine toujours par exactement 2 balises de questions de suivi, chacune sur sa propre ligne, après les actions : [[SUGGESTION:question courte]] (tutoiement, 80 caractères maximum, sans montant ni jeton). Les balises ne comptent pas dans les 200 mots.`;

/** Ajoutée en fin de prompt quand la question a été dictée : elle prime sur la règle 5 (longueur et mise en forme). */
export const CONSIGNE_VOCALE = `MODE VOCAL (prioritaire sur la règle 5 : longueur et mise en forme). La question a été dictée et ta réponse sera lue à voix haute.
- Réponds en 3 à 4 phrases au maximum, dans un français naturel à l'oral, au tutoiement.
- Aucun tableau, aucune puce, aucun titre, aucun astérisque ni gras, aucun emoji : uniquement des phrases enchaînées.
- Écris les chiffres normalement, avec leurs symboles (par exemple 18,6 % ou 150 000 €) : la lecture à voix haute les convertit elle-même.
- Garde toute ta rigueur fiscale et les règles 1 à 4 : mémo fiscal, profil, pas d'invention.
- Cite au plus une fiche avec un lien Markdown exact [Titre](#fiche-id) : c'est la seule mise en forme autorisée.
- Conserve les balises [[ACTION:{…}]] si la question est prospective.
- OBLIGATOIRE, comme à l'écrit (règle 9) : termine par exactement 2 balises [[SUGGESTION:question courte]], chacune sur sa propre ligne, après les phrases. Elles s'affichent en boutons, ne comptent pas dans les 3 à 4 phrases et ne sont pas lues.`;

/**
 * Consigne de ton selon le niveau de lecture (le niveau ne change que la forme de la réponse, jamais les règles 1 à 4 ni les calculs).
 * Texte fixe : aucune donnée personnelle. Intermédiaire = comportement historique, donc aucune consigne ajoutée.
 */
export const CONSIGNES_NIVEAU = {
  debutant: `NIVEAU DÉBUTANT (la question vient d'une personne qui découvre la finance ; le mode vocal, s'il est actif, reste prioritaire sur la longueur).
- Vocabulaire simple : aucun sigle ni terme technique sans l'expliquer en quelques mots.
- 120 mots maximum, hors balises.
- Propose une seule action concrète, la plus utile.
- Renvoie vers la fiche la plus utile avec un lien Markdown exact [Titre](#fiche-id).
- Garde toute ta rigueur : règles 1 à 4, mémo fiscal, pas d'invention.`,
  avance: `NIVEAU AVANCÉ (la personne maîtrise les bases) : tu peux être plus technique, citer les articles du CGI utiles, détailler les chiffres et les hypothèses du calcul, et employer le vocabulaire fiscal sans le définir. Garde toute ta rigueur : règles 1 à 4, mémo fiscal, pas d'invention.`,
};
const REGLE_STYLE_DEBUTANT = "5. Style (niveau débutant) : français, tutoiement, direct, 120 mots maximum, vocabulaire simple, une seule action concrète. Pas d'introduction ni de conclusion creuses.";

/** Silence complet (ms) après la dernière parole avant de clore la dictée et d'envoyer la question. */
export const DELAI_SILENCE_MS = 2500;
const REGLE_STYLE_VOCALE = "5. Style (mode vocal) : français oral, tutoiement, 3 à 4 phrases maximum, sans liste, sans titre, sans gras. Pas d'introduction ni de conclusion creuses.";
/** Rappel ajouté à la fin de la question dictée (dernier message du fil) : c'est ce que le modèle lit en dernier. */
const RAPPEL_VOCAL = "\n\n(Réponse à lire à voix haute : 3 à 4 phrases fluides, sans liste ni titre ni gras, chiffres avec leurs symboles % et € ; termine par exactement 2 balises [[SUGGESTION:question courte]] sur leurs propres lignes, et garde les balises [[ACTION]] si pertinent.)";

export function construirePromptSysteme(plan, sections, { estVocal = false, niveau } = {}) {
  const index = FICHES.map((f) => `- ${lien(f.id)}`).join("\n");
  const extraits = sections.length
    ? sections.map((s) => `### ${s.ficheTitre} — ${s.titre}  (source : ${lien(s.fiche)})\n${s.texte}`).join("\n\n")
    : "(aucun extrait pertinent : réponds avec le mémo et le profil, ou dis que l'information manque)";
  const vocal = estVocal ? `\n\n${CONSIGNE_VOCALE}` : "";
  const consigneNiveau = Object.hasOwn(CONSIGNES_NIVEAU, niveau) ? `\n\n${CONSIGNES_NIVEAU[niveau]}` : ""; // niveau absent ou inconnu : comportement historique
  // En mode vocal (ou débutant), la règle 5 (120-200 mots, puces) est remplacée plutôt que contredite : un modèle rapide suit mal deux consignes opposées.
  const base = estVocal ? INSTRUCTIONS.replace(/^5\. .*$/m, REGLE_STYLE_VOCALE) : niveau === "debutant" ? INSTRUCTIONS.replace(/^5\. .*$/m, REGLE_STYLE_DEBUTANT) : INSTRUCTIONS;
  return `${base}\n\nMÉMO FISCAL 2026 (prioritaire sur tes connaissances) :\n${memoFiscal(plan)}\n\nINDEX DES FICHES (seules citations autorisées) :\n${index}\n\nEXTRAITS DE FICHES :\n${extraits}\n\n(Fiches vérifiées le ${VERIFIE_LE}.)${consigneNiveau}${vocal}`;
}

// ---------------------------------------------------------------- synthèse vocale (fonctions pures)
/** Texte Markdown d'une réponse → texte à lire : liens réduits au titre, balises et mise en forme retirées, symboles prononçables. */
export function texteParle(md) {
  return String(md)
    .replace(/\[\[[\s\S]*?\]\]/g, " ")
    .replace(/\[\[[\s\S]*$/, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/`+/g, "")
    .replace(/^\s{0,3}#{1,6}\s*/gm, "")
    .replace(/^\s*[-*•]\s+/gm, "")
    .replace(/^\s*\d+[.)]\s+/gm, "")
    .replace(/^\s*\|?[\s:|-]{3,}\|?\s*$/gm, " ")
    .replace(/\|/g, ", ")
    .replace(/[*_~]+/g, "")
    .replace(/\s*%/g, " pour cent")
    .replace(/\s*€/g, " euros")
    .replace(/\s*\n+\s*/g, ". ")
    .replace(/([.!?:;])\s*\.(\s|$)/g, "$1$2")
    .replace(/[ \t]+/g, " ")
    .trim();
}

/** Découpe un texte en phrases d'au plus `max` caractères (la synthèse de Chrome coupe les longs énoncés). */
export function decouperPhrases(texte, max = 220) {
  const brut = String(texte).match(/[^.!?;:]+[.!?;:]*\s*/g) ?? [];
  const sortie = [];
  for (let p of brut) {
    p = p.trim();
    while (p.length > max) {
      const coupe = p.lastIndexOf(" ", max);
      const i = coupe > 40 ? coupe : max;
      sortie.push(p.slice(0, i).trim());
      p = p.slice(i).trim();
    }
    if (p) sortie.push(p);
  }
  return sortie;
}

/** Meilleure voix française : fr-FR avant fr-*, voix naturelles/premium avant les autres, voix locales (hors réseau) favorisées. */
export function choisirVoixFr(voix) {
  const note = (v) => {
    const lang = String(v.lang ?? "").replace("_", "-").toLowerCase();
    if (!lang.startsWith("fr")) return -1;
    let s = lang === "fr-fr" ? 10 : 4;
    if (/premium|enhanced|natural|neural|siri|am[ée]lie|thomas|audrey/i.test(v.name ?? "")) s += 6;
    if (v.localService) s += 3;
    return s;
  };
  let meilleure = null, max = -1;
  for (const v of voix ?? []) { const s = note(v); if (s > max) { max = s; meilleure = v; } }
  return meilleure;
}

/**
 * Corps de la requête POST /api/chat. Les réponses locales (qui citent de vrais montants) n'en font jamais partie.
 * `approfondi` (toggle « 🧠 Analyse approfondie ») est transmis tel quel : le routage vers le modèle de raisonnement
 * (toggle ou mot-clé complexe, quota journalier) est décidé côté serveur.
 */
export function preparerRequeteCloud(question, historique, ctx, { approfondi = false, estVocal = false } = {}) {
  const sections = rechercherSections(question, historique);
  const avant = historique.filter((m) => m.texte && m.source !== "accueil" && m.source !== "local" && m.source !== "action" && m !== historique[historique.length - 1]).slice(-6);
  const montants = {}; // jeton → valeur : reste dans le navigateur, jamais envoyé
  const jeton = (t) => tokeniserMontants(t, montants);
  const requete = {
    systeme: construirePromptSysteme(ctx?.plan, sections, { estVocal: estVocal === true, niveau: ctx?.niveau }),
    profil: resumerProfilPourLLM(ctx) || "(profil non disponible)",
    messages: [...avant.map((m) => ({ role: m.role === "ia" ? "assistant" : "user", content: jeton(m.texte) })), { role: "user", content: jeton(question) + (estVocal === true ? RAPPEL_VOCAL : "") }],
    modeApprofondi: approfondi === true,
    stream: true,
  };
  return { requete, montants };
}
export const construireRequeteCloud = (question, historique, ctx, options) => preparerRequeteCloud(question, historique, ctx, options).requete;

/** Libellé affiché du modèle actif : « o3 · raisonnement » pour la famille o (o3, o4-mini…), sinon l'identifiant tel que renvoyé
 *  (y compris « gpt-5.4-mini (raisonnement élevé · quota o3 préservé) »). */
export function libelleModele(modele) {
  const m = String(modele ?? "").trim().slice(0, 80);
  return /^o\d/.test(m) && !m.includes("·") ? `${m} · raisonnement` : m;
}

/** Remplace les liens vers des fiches inconnues par du texte et rétablit le titre exact des fiches connues. */
export function nettoyerCitations(texte) {
  return String(texte).replace(/\[([^\]]*)\]\(#fiche-([a-z0-9-]+)\)/g, (m, titre, id) => (IDS_FICHES.has(id) ? `[${TITRE_FICHE[id]}](#fiche-${id})` : titre));
}

// ---------------------------------------------------------------- repli local déterministe
const sansMarqueurs = (t) => coupe(t, 260);
function lignesApport(ctx) {
  const A = ctx.res?.achat;
  if (!A) return ["Aucun projet d'achat de résidence principale n'est actif dans ton profil (« Mon profil » → Projet d'achat)."];
  const L = [`Projet : bien à **${eur(A.prix)}** (${A.type === "neuf" ? "neuf" : "ancien"}).`];
  const I = A.ideal;
  if (I?.age) {
    L.push(`Âge d'achat idéal : **${I.age} ans**${I.apportRequis != null ? `, apport requis **${eur(I.apportRequis)}**` : ""}${I.apport != null ? `, apport réuni **${eur(I.apport)}**` : ""}.`);
    if (I.apportRequis > 0 && I.apport != null) L.push(I.apport >= I.apportRequis ? "L'apport est couvert à cette date." : `Il manque environ **${eur(I.apportRequis - I.apport)}**.`);
  } else L.push("Aucun âge d'achat réaliste avec les paramètres actuels : voir l'onglet « Trajectoire ».");
  return L;
}
function lignesEndettement(ctx) {
  const P = ctx.res?.profil ?? ctx.profil;
  const E = endettementBancaire(ctx.plan, P);
  const L = [];
  for (const l of E.lignes) {
    if (l.introuvable || l.taux == null) continue;
    L.push(`${l.libelle} : **${pct(l.taux)}**${l.taux > E.max ? ` (au-dessus de la limite de ${E.max} %)` : ""}.`);
  }
  L.push(`Les banques plafonnent le taux d'endettement à **${E.max} %** des revenus.`);
  return L;
}
function lignesPER(ctx) {
  const P = ctx.res?.profil ?? ctx.profil, per = ctx.res?.per;
  if (P?.refusPER) return ["Tu as indiqué renoncer au PER : le plan n'en prévoit pas."];
  if (!per) return ["Le plan ne contient pas de règle PER."];
  if (per.actif) return [`Le plan te conseille de verser **${eur(per.mensuel)} par mois** sur un PER, soit **${eur(per.economie)}** d'impôt en moins par an (tranche ${P.tmi} %).`, "L'argent est bloqué jusqu'à la retraite, sauf achat de la résidence principale."];
  const raisons = { "non-resident": "tu n'es pas résident fiscal français", "tmi-inconnue": "ta tranche d'impôt n'est pas renseignée", "tmi-faible": `ta tranche (${P.tmi} %) est trop basse pour que la déduction compense le blocage`, age: "tu as plus de 70 ans", "pas-de-flux-bourse": "aucune épargne n'est prévue pour la bourse ce mois-ci" };
  return [`Le plan ne prévoit pas de PER pour toi : ${raisons[per.raison] ?? "conditions non remplies"}.`];
}
function lignesMois(ctx) {
  const plan = ctx.plan, res = ctx.res;
  if (!res) return ["Ton plan n'est pas encore calculé : complète « Mon profil »."];
  const L = [];
  const actions = (res.consignes ?? []).filter((c) => c.niveau === "action").slice(0, 3);
  for (const c of actions) L.push(`${sansMarqueurs(c.texte)}${c.fiche ? ` → ${lien(c.fiche)}` : ""}`);
  const versements = (res.mouvements ?? []).filter((m) => m.sens === "versement" && m.montant > 0).slice(0, 5);
  if (versements.length) L.push(`Épargne du mois : ${versements.map((m) => `**${eur(m.montant)}** sur ${libelleCourt(plan, m.enveloppe)}`).join(", ")}.`);
  const retraits = (res.mouvements ?? []).filter((m) => m.sens === "retrait" && m.montant > 0).slice(0, 3);
  if (retraits.length) L.push(`À déplacer : ${retraits.map((m) => `**${eur(m.montant)}** depuis ${libelleCourt(plan, m.enveloppe)}`).join(", ")}.`);
  return L.length ? L : ["Rien d'urgent ce mois-ci : continue ton épargne selon le plan."];
}
function lignesPelOr(ctx) {
  const P = ctx.res?.profil ?? ctx.profil, pl = P?.placements ?? {};
  const pel = Number(pl.pel) || 0, or = Number(pl.orPhysique) || 0;
  const L = [];
  if (!pel && !or) return ["Dans ton profil, ton PEL et ton or sont à **0 €** : il n'y a ni PEL à casser, ni or à vendre pour ton apport."];
  if (!pel) L.push("Ton PEL est à **0 €** : il n'existe pas dans ton profil.");
  else L.push(`**PEL (${eur(pel)})** : fait pour l'achat immobilier, il se ferme au moment d'acheter et compte dans l'apport. Fermé avant 2 ans, il perd son taux ; ses intérêts sont taxés à 31,4 %.`);
  if (!or) L.push("Ton or est à **0 €** : tu n'en as pas dans ton profil.");
  else L.push(`**Or (${eur(or)})** : à la vente, **11,5 %** du prix (≈ ${eur(or * 0.115)}) ou **37,6 %** de la plus-value, avec abattement de 5 % par an après 2 ans. Dans le plan, l'or n'est jamais vendu pour rééquilibrer.`);
  if (pel && or) L.push("**Ordre logique** : commence par le PEL (prévu pour ça, sans taxe de vente), garde l'or comme dernière réserve.");
  return L;
}
const RE_MOIS = /(ce mois|que dois je faire|a faire|prochaine etape|par quoi commencer|priorite|et maintenant|concretement)/;

/** Réponse locale Markdown : bloc personnalisé éventuel + extraits de fiches avec liens de citation. */
export function repondreLocal(question, historique, ctx) {
  const q = ` ${norm(question)} `;
  const sujets = detecterSujets(question);
  const mois = RE_MOIS.test(norm(question)) && !contexteVide(ctx);
  const sections = mois ? [] : rechercherSections(question, historique); // « ce mois-ci » : le plan répond seul, les fiches feraient du bruit
  const sortie = [];
  try {
    if (!contexteVide(ctx)) {
      if (mois) sortie.push({ t: "Ce mois-ci", l: lignesMois(ctx) });
      else if (sujets.includes("pel") && sujets.includes("or")) sortie.push({ t: "PEL ou or pour ton apport", l: lignesPelOr(ctx) });
      else if (/ endettement | emprunter | capacite d emprunt /.test(q)) sortie.push({ t: "Ton endettement", l: lignesEndettement(ctx) });
      else if (/ apport /.test(q)) sortie.push({ t: "Ton apport", l: lignesApport(ctx) });
      else if (sujets[0] === "per") sortie.push({ t: "Ton PER", l: lignesPER(ctx) });
    }
  } catch (e) { console.error("assistant (repli local)", e); }
  const parts = [];
  for (const b of sortie) parts.push(`**${b.t}**\n${b.l.map((x) => `- ${x}`).join("\n")}`);
  if (sections.length) {
    const qt = new Set(jetons(question));
    // Les 2 lignes de la section qui recoupent le plus la question (dans l'ordre d'origine), sinon les premières
    const extrait = (texte) => {
      const lignes = texte.split("\n");
      const notes = lignes.map((l, i) => ({ l, i, n: jetons(l).filter((t) => qt.has(t)).length }));
      const gardees = notes.some((x) => x.n > 0) ? [...notes].sort((a, b) => b.n - a.n || a.i - b.i).slice(0, 2).sort((a, b) => a.i - b.i) : notes.slice(0, 2);
      return coupe(gardees.map((x) => x.l).join(" "), 230);
    };
    parts.push(`**Dans les fiches**\n${sections.map((s) => `- **${lien(s.fiche)}** (${s.titre}) : ${extrait(s.texte)}`).join("\n")}`);
  }
  if (!parts.length) {
    parts.push("Je n'ai rien trouvé de précis sur ce sujet dans les fiches. Essaie avec le nom d'un placement (PEA, PER, livret A, assurance-vie, or…) ou ouvre le " + lien("mode-emploi") + ".");
  }
  return parts.join("\n\n");
}

/** Pastilles de suggestion adaptées au profil actif (4 au plus). */
export function suggestions(ctx) {
  const P = ctx?.res?.profil ?? ctx?.profil;
  const S = ["Que dois-je faire ce mois-ci ?"];
  if (!P) return S.concat(["Comment est taxé un PEA ?", "À quoi sert le PER ?"]);
  const pl = P.placements ?? {};
  const a = (k) => (Number(pl[k]) || 0) > 0;
  if (P.projetRP?.actif) S.push(a("pel") && a("orPhysique") ? "Vaut-il mieux casser mon PEL ou vendre mon or pour mon apport ?" : "Où en est mon apport ?", "Quel est mon taux d'endettement ?");
  if (ctxPERpossible(ctx)) S.push("Le PER vaut-il le coup pour moi ?");
  if (a("cto")) S.push("Comment est taxé mon compte-titres ?");
  if (a("assuranceVie") || a("assuranceVieUC")) S.push("Quel est l'avantage fiscal de mon assurance-vie après 8 ans ?");
  if (a("plateformeCrypto") || a("coldWallet")) S.push("Puis-je acheter du bitcoin maintenant ?");
  if (S.length < 4) S.push("Comment est taxé un PEA ?");
  return [...new Set(S)].slice(0, 4);
}
const ctxPERpossible = (ctx) => !!ctx?.res?.per?.actif || Number(ctx?.res?.profil?.tmi) >= 30;

// ---------------------------------------------------------------- transport cloud
class ErreurAssistant extends Error { constructor(code) { super(code); this.code = code; } }

/**
 * POST /api/chat. Lit le flux SSE { delta } … { fin } et rappelle `surTexte(texteCumulé)` à chaque morceau.
 * Repli : réponse JSON { reponse } (serveur sans flux) ou navigateur sans lecture en continu.
 */
async function appelerCloud(requete, surTexte, signal, surModele = () => {}) {
  let rep;
  try {
    rep = await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(requete), signal });
  } catch (e) { throw e?.name === "AbortError" ? e : new ErreurAssistant("reseau"); }
  const json = (rep.headers.get("Content-Type") || "").toLowerCase().includes("application/json");
  if (!rep.ok) {
    let code = `http_${rep.status}`;
    try { code = (await rep.json()).erreur || code; } catch { /* corps non JSON */ }
    throw new ErreurAssistant(code);
  }
  const entete = rep.headers.get("X-Model-Used"); // identifiant technique ; l'événement { modele } / { fin } porte le libellé complet
  if (entete) surModele(entete);
  if (json) { // mode JSON classique : tout le texte d'un coup
    let j;
    try { j = await rep.json(); } catch (e) { throw e?.name === "AbortError" ? e : new ErreurAssistant("flux"); }
    if (j?.erreur) throw new ErreurAssistant(j.erreur);
    const texte = String(j?.reponse ?? "");
    if (!texte.trim()) throw new ErreurAssistant("vide");
    surTexte(texte);
    return { texte, modele: j.modele, masques: j.masques ?? 0, interrompu: false };
  }
  const flux = { texte: "", fin: null, modele: entete || undefined };
  const traiter = (bloc) => {
    const l = bloc.trim();
    if (!l.startsWith("data:")) return;
    let ev; try { ev = JSON.parse(l.slice(5)); } catch { return; }
    if (ev.erreur) throw new ErreurAssistant(ev.erreur);
    if (ev.delta) { flux.texte += ev.delta; surTexte(flux.texte); } else if (ev.fin) flux.fin = ev; else if (typeof ev.modele === "string") { flux.modele = ev.modele; surModele(ev.modele); }
  };
  try {
    if (rep.body?.getReader) {
      const lecteur = rep.body.getReader(), dec = new TextDecoder();
      let tampon = "";
      for (;;) {
        const { done, value } = await lecteur.read();
        if (done) break;
        tampon += dec.decode(value, { stream: true });
        const blocs = tampon.split("\n\n");
        tampon = blocs.pop();
        blocs.forEach(traiter);
      }
      traiter(tampon);
    } else (await rep.text()).split("\n\n").forEach(traiter); // pas de lecture en continu : réponse affichée d'un coup
  } catch (e) { throw e instanceof ErreurAssistant || e?.name === "AbortError" ? e : new ErreurAssistant("flux"); }
  if (!flux.texte.trim()) throw new ErreurAssistant("vide");
  return { texte: flux.texte, modele: flux.fin?.modele ?? flux.modele, masques: flux.fin?.masques ?? 0, interrompu: !flux.fin || flux.fin.interrompu === true };
}

// ---------------------------------------------------------------- Markdown minimal et sûr
/**
 * Markdown → HTML sûr (échappé). `termes: true` ajoute les infobulles du lexique (lierTermes) sur le texte
 * courant, jamais à l'intérieur des liens de citation.
 */
export function rendreMarkdown(src, { termes = false } = {}) {
  const inline = (t) => {
    const gardes = [];
    let s = echapper(t).replace(/[\u0001-\u0004]/g, "");
    s = s.replace(/\[([^\]]+)\]\(#fiche-([a-z0-9-]+)\)/g, (m, titre, id) => (IDS_FICHES.has(id) ? `\u0001${gardes.push(`<a class="lien-fiche" href="#fiche-${id}" data-citation>${titre}</a>`) - 1}\u0002` : titre));
    s = s.replace(/\*\*([^*]+)\*\*/g, "\u0003$1\u0004");
    s = s.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
    if (termes) s = lierTermes(s);
    return s.replace(/\u0003/g, "<b>").replace(/\u0004/g, "</b>").replace(/\u0001(\d+)\u0002/g, (m, i) => gardes[Number(i)] ?? "");
  };
  let html = "", liste = false;
  for (const l of String(src).split("\n")) {
    const m = l.match(/^\s*(?:[-*•]|\d+\.)\s+(.*)$/);
    if (m) { if (!liste) { html += "<ul>"; liste = true; } html += `<li>${inline(m[1])}</li>`; }
    else { if (liste) { html += "</ul>"; liste = false; } if (l.trim()) html += `<p>${inline(l)}</p>`; }
  }
  return liste ? html + "</ul>" : html;
}

// ---------------------------------------------------------------- widget
const CLE_REGLAGES = "assistant-v1";
const lireReglages = () => { try { return { mode: null, ...JSON.parse(localStorage.getItem(CLE_REGLAGES) ?? "{}") }; } catch { return { mode: null }; } };
const ecrireReglages = (r) => { try { localStorage.setItem(CLE_REGLAGES, JSON.stringify(r)); } catch { /* stockage indisponible */ } };

const MESSAGES_ERREUR = {
  no_key: "clé OpenAI absente côté serveur", reseau: "serveur injoignable", origine_refusee: "origine refusée", trop_de_requetes: "trop de requêtes, patiente une minute",
  openai_401: "clé OpenAI refusée", openai_429: "quota OpenAI atteint", quota_journalier: "quota gratuit du jour préservé", vide: "réponse vide", flux: "flux interrompu", delai: "délai dépassé",
};
const TEXTE_WHATIF = "**Simulation What-If**\n- Voici le scénario que je peux appliquer à ton profil : un clic recalcule tes résultats et ta trajectoire.\n- Rien n'est enregistré, tu peux annuler à tout moment.";

/**
 * Branche le widget sur le balisage de index.html.
 * @param {object} deps
 * @param {() => ({plan: object, res: object|undefined, profil: object})} deps.getContexte
 * @param {() => string} [deps.getCleProfil]       clé « col:id » du profil actif (historique par profil)
 * @param {(patch: object) => ({ok: boolean, resume?: string, erreur?: string})} [deps.appliquerPatch]  applique une simulation en mémoire
 * @param {() => boolean} [deps.annulerSimulation]  annule la simulation en cours
 *
 * Événements écoutés sur `document` : « profil:change » (autre profil chargé) et « simulation:change » ({detail:{active}}).
 */
export function monterAssistant({ getContexte, getCleProfil = () => "exemple:exemple", appliquerPatch = null, annulerSimulation = null }) {
  const $ = (id) => document.getElementById(id);
  const racine = $("assistant");
  if (!racine) return;
  const el = { bouton: $("assistant-bouton"), panneau: $("assistant-panneau"), badge: $("assistant-badge"), fil: $("assistant-fil"), suggestions: $("assistant-suggestions"),
    form: $("assistant-form"), saisie: $("assistant-saisie"), reglagesBtn: $("assistant-reglages-btn"), reglages: $("assistant-reglages"), consentement: $("assistant-consentement"),
    fermer: $("assistant-fermer"), copier: $("assistant-copier"), effacer: $("assistant-effacer"), envoyer: $("assistant-envoyer"), horsLigne: $("assistant-horsligne"), approfondi: $("assistant-approfondi"),
    micro: $("assistant-micro"), voix: $("assistant-voix") };

  // `epoque` change quand le fil est effacé ou qu'un autre profil est chargé : une réponse en retard est alors abandonnée.
  const etat = { reglages: lireReglages(), serveur: { connu: false, joignable: false, actif: false, modele: "" }, fil: [], occupe: false, controleur: null, epoque: 0, approfondi: false, modeleActif: "", voix: false };
  const accueil = { role: "ia", source: "accueil", texte: `Bonjour ! Pose-moi une question sur tes placements, ton plan ou la fiscalité. Je cite les fiches du site (par exemple ${lien("mode-emploi")}).` };

  const ctx = () => { try { return getContexte(); } catch { return {}; } };
  const cloudAutorise = () => etat.reglages.mode === "auto";
  /** Hors-ligne (PWA) : l'envoi vers /api/chat est suspendu, le moteur local continue de répondre. */
  const horsLigne = () => navigator.onLine === false;

  // -- historique persistant : une clé par profil actif (chat-hist:<col>:<id>)
  const cleHistorique = () => { let c = "exemple:exemple"; try { c = String(getCleProfil()); } catch { /* clé par défaut */ } return `chat-hist:${c}`; };
  function sauverHistorique() {
    try {
      const s = serialiserHistorique(etat.fil);
      if (s.length) localStorage.setItem(cleHistorique(), JSON.stringify(s)); else localStorage.removeItem(cleHistorique());
    } catch { /* stockage indisponible ou plein */ }
  }
  function chargerHistorique() {
    try { etat.fil = lireHistorique(localStorage.getItem(cleHistorique())); } catch { etat.fil = []; }
  }

  // -- état du moteur
  function majBadge(detail = "") {
    let texte = "Mode local", titre = "Réponses calculées dans ton navigateur, sans réseau.";
    if (horsLigne()) { titre = "Hors ligne : l'IA en ligne est suspendue, les réponses sont calculées dans ton navigateur."; detail = "hors ligne"; }
    else if (cloudAutorise() && etat.serveur.joignable && etat.serveur.actif) { texte = `OpenAI ${etat.modeleActif || etat.serveur.modele}`; titre = "Profil anonymisé + question envoyés à OpenAI via ton serveur."; }
    else if (cloudAutorise() && etat.serveur.connu && !etat.serveur.joignable) titre = "Serveur injoignable : repli local.";
    else if (cloudAutorise() && etat.serveur.joignable && !etat.serveur.actif) titre = "Clé OpenAI absente côté serveur (fichier .env) : repli local.";
    el.badge.textContent = detail ? `${texte} · ${detail}` : texte;
    el.badge.title = titre;
    el.badge.dataset.moteur = texte.startsWith("OpenAI") ? "openai" : "local";
  }
  async function verifierServeur() {
    try {
      const r = await fetch("/api/statut", { cache: "no-store" });
      if (!r.ok) throw new Error(String(r.status));
      const j = await r.json();
      Object.assign(etat.serveur, { connu: true, joignable: true, actif: !!j.actif, modele: j.modele ?? "" });
    } catch { Object.assign(etat.serveur, { connu: true, joignable: false, actif: false }); }
    majBadge();
    majConsentement();
  }
  function majConsentement() {
    el.consentement.hidden = !(etat.reglages.mode === null && etat.serveur.joignable && etat.serveur.actif);
    for (const r of el.reglages.querySelectorAll("input[name=assistant-mode]")) r.checked = r.value === (etat.reglages.mode ?? "local");
  }
  function choisirMode(mode) {
    etat.reglages.mode = mode;
    ecrireReglages(etat.reglages);
    majBadge();
    majConsentement();
  }

  /** Bandeau « hors ligne » du chat et badge ; au retour du réseau, on revérifie le serveur. */
  function majReseauChat() {
    if (el.horsLigne) el.horsLigne.hidden = !horsLigne();
    majBadge();
    if (!horsLigne() && cloudAutorise() && !el.panneau.hidden) verifierServeur();
  }

  // -- rendu
  const bas = () => { el.fil.scrollTop = el.fil.scrollHeight; };
  /** Texte brut affiché pendant le flux : balises et jetons retirés, sans mise en forme. */
  const texteFlux = (m) => extraireBalises(m.texte, m.montants ?? {}).texte || "…";
  function rendreMessage(m) {
    const d = document.createElement("div");
    d.className = `assistant-msg assistant-msg-${m.role}`;
    const corps = document.createElement("div");
    corps.className = "assistant-corps";
    if (m.enCours) { corps.classList.add("assistant-flux"); corps.textContent = texteFlux(m); }
    else corps.innerHTML = m.role === "ia" ? rendreMarkdown(m.texte, { termes: true }) : `<p>${echapper(m.texte)}</p>`;
    d.appendChild(corps);
    if (m.role === "ia" && m.source && m.source !== "accueil" && !m.enCours) {
      const p = document.createElement("div");
      p.className = "assistant-source";
      const base = m.source === "local" ? "Réponse locale" : m.source === "action" ? "Simulation (non enregistrée)" : `OpenAI ${libelleModele(m.modele)}`.trim();
      p.textContent = base + (m.note ? ` · ${m.note}` : "");
      d.appendChild(p);
    }
    if (m.actions?.length && !m.enCours) {
      const z = document.createElement("div");
      z.className = "assistant-actions";
      for (const a of m.actions) {
        const b = document.createElement("button");
        const fait = a.etat === "appliquee";
        b.type = "button"; b.className = "assistant-action"; b.disabled = fait;
        b.textContent = `${fait ? "✓" : "▶"} ${a.label}`;
        b.title = `Applique cette simulation à ton profil, sans l'enregistrer : ${decrirePatch(a.patch)}`;
        b.addEventListener("click", () => appliquer(m, a));
        z.appendChild(b);
      }
      d.appendChild(z);
    }
    if (m.annulable) {
      const z = document.createElement("div");
      z.className = "assistant-actions";
      const b = document.createElement("button");
      b.type = "button"; b.className = "assistant-action assistant-action-annuler"; b.textContent = "↩ Annuler la simulation";
      b.addEventListener("click", annuler);
      z.appendChild(b);
      d.appendChild(z);
    }
    // Questions de suivi : seulement sous la dernière réponse
    if (m.suggestions?.length && !m.enCours && m === etat.fil[etat.fil.length - 1]) {
      const z = document.createElement("div");
      z.className = "assistant-suivi";
      for (const t of m.suggestions) {
        const b = document.createElement("button");
        b.type = "button"; b.className = "assistant-puce"; b.textContent = t; b.disabled = etat.occupe;
        b.addEventListener("click", () => poser(t));
        z.appendChild(b);
      }
      d.appendChild(z);
    }
    m.el = d;
    return d;
  }
  function rendreFil() {
    el.fil.replaceChildren(...[accueil, ...etat.fil].map(rendreMessage));
    bas();
  }
  /** Mise à jour pendant le flux : texte brut seulement (pas de reparsing Markdown à chaque morceau). */
  function majFlux(m) {
    const corps = m.el?.querySelector(".assistant-corps");
    if (!corps) return;
    corps.classList.add("assistant-flux");
    corps.textContent = texteFlux(m);
    bas();
  }
  function rendreSuggestions() {
    el.suggestions.replaceChildren(...suggestions(ctx()).map((t) => {
      const b = document.createElement("button");
      b.type = "button"; b.className = "assistant-puce"; b.textContent = t; b.disabled = etat.occupe;
      b.addEventListener("click", () => poser(t));
      return b;
    }));
  }
  /** Verrouille saisie, bouton, puces et suivis pendant une requête (anti double-clic). */
  function verrouiller(on) {
    el.envoyer.disabled = on;
    el.saisie.disabled = on;
    racine.dataset.occupe = String(on);
    el.fil.setAttribute("aria-busy", String(on));
    if (el.approfondi) el.approfondi.disabled = on;
    if (el.micro) el.micro.disabled = on;
    for (const b of racine.querySelectorAll(".assistant-puce")) b.disabled = on;
  }
  /** Toggle « 🧠 Analyse approfondie » : état purement local (jamais persisté), transmis à chaque requête cloud. */
  function majApprofondi() {
    if (el.approfondi) el.approfondi.setAttribute("aria-pressed", String(etat.approfondi));
  }

  // -- simulations What-If
  function appliquer(m, a) {
    if (a.etat === "appliquee" || typeof appliquerPatch !== "function") return;
    let r;
    try { r = appliquerPatch(a.patch); } catch (e) { console.error("assistant (simulation)", e); r = { ok: false, erreur: "erreur interne" }; }
    if (r?.ok) {
      a.etat = "appliquee";
      etat.fil.push({ role: "ia", source: "action", annulable: true, texte: `✓ **Simulation appliquée** : ${decrirePatch(a.patch)}.\n- ${r.resume ?? "Résultats et trajectoire recalculés."}\n- Rien n'est enregistré dans ton profil tant que tu ne gardes pas ces valeurs.` });
    } else etat.fil.push({ role: "ia", source: "action", texte: `La simulation n'a pas pu être appliquée${r?.erreur ? ` (${r.erreur})` : ""}.` });
    rendreFil();
    sauverHistorique();
  }
  function annuler() {
    let ok = false;
    try { ok = !!annulerSimulation?.(); } catch (e) { console.error("assistant (annulation)", e); }
    etat.fil.push({ role: "ia", source: "action", texte: ok ? "↩ **Simulation annulée** : ton profil est revenu à son état d'avant." : "Aucune simulation en cours." });
    rendreFil();
    sauverHistorique();
  }
  /** La simulation est terminée (annulée, gardée ou profil changé) : les boutons redeviennent utilisables. */
  function simulationTerminee() {
    for (const m of etat.fil) { m.annulable = false; for (const a of m.actions ?? []) a.etat = "libre"; }
    rendreFil();
    sauverHistorique();
  }

  // -- mode vocal : dictée (SpeechRecognition) et lecture (speechSynthesis), API natives du navigateur
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition || null;
  const synth = "speechSynthesis" in window && typeof window.SpeechSynthesisUtterance === "function" ? window.speechSynthesis : null;
  const dictee = { reco: null, active: false, texte: "", envoyer: true, erreur: "", minuteur: null };
  /** Silence complet après la dernière parole : la dictée s'arrête et la question part (une respiration plus courte ne coupe rien). */
  const annulerSilence = () => { clearTimeout(dictee.minuteur); dictee.minuteur = null; };
  function armerSilence() {
    annulerSilence();
    dictee.minuteur = setTimeout(() => { dictee.minuteur = null; arreterDictee(true); }, DELAI_SILENCE_MS);
  }
  const MESSAGES_DICTEE = {
    "no-speech": "Je n'ai rien entendu, réessaie.",
    "not-allowed": "Accès au micro refusé : autorise-le dans ton navigateur.",
    "service-not-allowed": "Accès au micro refusé : autorise-le dans ton navigateur.",
    "audio-capture": "Aucun micro détecté.",
    network: "Dictée indisponible : le service de reconnaissance est injoignable.",
  };
  let voixFr = null;
  const discretActif = () => document.documentElement.classList.contains("discret");
  const arreterVoix = () => { try { synth?.cancel(); } catch { /* synthèse indisponible */ } };

  function majVoix() {
    if (!el.voix) return;
    el.voix.textContent = etat.voix ? "🔊" : "🔇";
    el.voix.setAttribute("aria-pressed", String(etat.voix));
    el.voix.title = etat.voix
      ? `Lecture vocale activée : clique pour couper${discretActif() ? " (muette tant que les montants sont masqués)" : ""}`
      : "Lecture à voix haute des réponses (désactivée)";
  }
  function activerVoix(oui) {
    etat.voix = oui;
    if (!oui) arreterVoix();
    majVoix();
  }
  /** Lit une réponse à voix haute si la lecture est activée (muette en mode discret : la réponse peut citer des chiffres). */
  function parler(texte) {
    if (!synth || !etat.voix || discretActif() || el.panneau.hidden) return;
    if (!voixFr) voixFr = choisirVoixFr(synth.getVoices());
    for (const phrase of decouperPhrases(texteParle(texte))) {
      const u = new window.SpeechSynthesisUtterance(phrase);
      u.lang = voixFr?.lang || "fr-FR";
      if (voixFr) u.voice = voixFr;
      synth.speak(u);
    }
  }

  function majMicro() {
    if (!el.micro) return;
    el.micro.setAttribute("aria-pressed", String(dictee.active));
    el.micro.title = dictee.active ? "Arrêter et envoyer" : "Poser ta question à voix haute";
    el.form.dataset.ecoute = String(dictee.active);
  }
  /** Message bref dans le champ de saisie (placeholder), puis retour au texte d'origine. */
  function avisDictee(message) {
    const ancien = el.saisie.dataset.invite ?? el.saisie.placeholder;
    el.saisie.dataset.invite = ancien;
    el.saisie.placeholder = message;
    setTimeout(() => { el.saisie.placeholder = ancien; delete el.saisie.dataset.invite; }, 4000);
  }
  /** `envoyer` : true = on envoie ce qui a été capté ; false = on abandonne (fermeture, Échap, autre envoi). */
  function arreterDictee(envoyer) {
    annulerSilence();
    if (!dictee.reco) return;
    dictee.envoyer = envoyer;
    try { if (envoyer) dictee.reco.stop(); else dictee.reco.abort(); } catch { /* déjà arrêtée */ }
  }
  function demarrerDictee() {
    if (!SR || etat.occupe || dictee.active) return;
    if (!etat.reglages.micInfo) { // premier usage : l'audio part vers le service de reconnaissance du navigateur
      if (!window.confirm("La dictée utilise le service de reconnaissance vocale de ton navigateur (Google, Microsoft ou Apple selon le cas), qui peut recevoir l'audio de ta voix. Continuer ?")) return;
      etat.reglages.micInfo = true;
      ecrireReglages(etat.reglages);
    }
    arreterVoix();
    activerVoix(true); // le mode vocal active la lecture ; l'utilisateur peut la couper ensuite
    let reco;
    try { reco = new SR(); } catch { avisDictee(MESSAGES_DICTEE["audio-capture"]); return; }
    reco.lang = "fr-FR";
    reco.interimResults = true;
    reco.continuous = true; // ne se coupe plus à la première pause : c'est le minuteur de silence qui décide de la fin
    reco.maxAlternatives = 1;
    Object.assign(dictee, { reco, active: true, texte: "", envoyer: true, erreur: "" });
    el.saisie.value = "";
    reco.onresult = (e) => {
      if (dictee.reco !== reco) return;
      dictee.texte = Array.from(e.results).map((r) => r[0]?.transcript ?? "").join(" ").replace(/\s+/g, " ").trim();
      el.saisie.value = dictee.texte.slice(0, el.saisie.maxLength > 0 ? el.saisie.maxLength : 500);
      if (dictee.texte) armerSilence(); // chaque nouveau morceau (provisoire ou final) repousse la fin de 2,5 s
    };
    reco.onerror = (e) => {
      if (dictee.reco !== reco || e.error === "aborted") return;
      annulerSilence();
      dictee.erreur = e.error || "erreur";
      avisDictee(MESSAGES_DICTEE[dictee.erreur] ?? "La dictée a échoué, réessaie ou écris ta question.");
    };
    reco.onend = () => {
      if (dictee.reco !== reco) return;
      annulerSilence();
      const { envoyer, erreur } = dictee;
      const texte = dictee.texte.slice(0, el.saisie.maxLength > 0 ? el.saisie.maxLength : 500).trim();
      Object.assign(dictee, { reco: null, active: false });
      majMicro();
      if (envoyer && !erreur && texte) poser(texte, { estVocal: true });
    };
    majMicro();
    try { reco.start(); } catch { Object.assign(dictee, { reco: null, active: false }); majMicro(); avisDictee(MESSAGES_DICTEE["audio-capture"]); }
  }
  if (el.micro) el.micro.hidden = !SR; // navigateur sans reconnaissance vocale (Firefox…) : bouton masqué
  if (el.voix) el.voix.hidden = !synth;
  majVoix();

  // -- conversation
  /** `estVocal` : la question vient de la dictée → consigne « réponse brève et orale » ajoutée côté prompt. */
  async function poser(question, { estVocal = false } = {}) {
    question = question.trim();
    if (!question || etat.occupe) return; // ignore tout envoi tant qu'une requête est en cours
    arreterVoix();
    if (dictee.active) arreterDictee(false);
    etat.occupe = true;
    verrouiller(true);
    el.saisie.value = "";
    const epoque = etat.epoque;
    const perime = () => epoque !== etat.epoque;
    const historique = [...etat.fil];
    const utilisateur = { role: "user", texte: question };
    const reponse = { role: "ia", texte: "…", source: null, enCours: true, montants: {} };
    etat.fil.push(utilisateur, reponse);
    rendreFil();
    const contexte = ctx();
    let note = "";
    try {
      if (cloudAutorise() && horsLigne()) {
        note = "hors ligne : l'IA en ligne reprendra avec la connexion"; // aucun appel /api/chat : repli local direct
      } else if (cloudAutorise() && !(etat.serveur.connu && etat.serveur.joignable && !etat.serveur.actif)) {
        const controleur = new AbortController();
        etat.controleur = controleur;
        const delai = setTimeout(() => controleur.abort(), 45000);
        try {
          const { requete, montants } = preparerRequeteCloud(question, [...historique, utilisateur], contexte, { approfondi: etat.approfondi, estVocal });
          reponse.montants = montants;
          const r = await appelerCloud(requete, (t) => { if (perime()) return; reponse.texte = t; reponse.source = "openai"; majFlux(reponse); }, controleur.signal,
            (m) => { if (!perime()) { etat.modeleActif = libelleModele(m); majBadge(); } }); // modèle réellement retenu par le serveur, affiché dès l'ouverture du flux
          if (perime()) return;
          const b = extraireBalises(r.texte, montants);
          const secours = b.actions.length ? [] : detecterWhatIf(question); // filet de sécurité si le modèle oublie la balise
          Object.assign(reponse, {
            texte: nettoyerCitations(b.texte) || "Voici ce que je peux simuler pour toi.", source: "openai", modele: r.modele, enCours: false,
            actions: [...b.actions, ...secours], suggestions: b.suggestions,
            note: [r.interrompu ? "réponse interrompue" : "", r.masques > 0 ? `${r.masques} donnée(s) personnelle(s) masquée(s) avant l'envoi` : ""].filter(Boolean).join(" · "),
          });
          rendreFil();
          sauverHistorique();
          parler(reponse.texte);
          etat.serveur.connu = true; etat.serveur.joignable = true; majBadge();
          return;
        } catch (e) {
          if (perime()) return;
          const code = e.name === "AbortError" ? "delai" : e.code ?? "reseau";
          note = `repli local : ${MESSAGES_ERREUR[code] ?? code}`;
          if (code === "no_key") etat.serveur.actif = false;
          if (code === "reseau") etat.serveur.joignable = false;
          etat.serveur.connu = true;
          majBadge(code === "reseau" ? "hors ligne" : "");
        } finally { clearTimeout(delai); if (etat.controleur === controleur) etat.controleur = null; }
      }
      if (perime()) return;
      if (etat.approfondi) note = [note, "analyse approfondie indisponible en local"].filter(Boolean).join(" · ");
      const wi = detecterWhatIf(question);
      Object.assign(reponse, {
        texte: wi.length ? TEXTE_WHATIF : repondreLocal(question, [...historique, utilisateur], contexte),
        source: "local", note, enCours: false, montants: {}, actions: wi, suggestions: [],
      });
      rendreFil();
      sauverHistorique();
      parler(reponse.texte);
    } finally {
      etat.occupe = false;
      if (etat.modeleActif) { etat.modeleActif = ""; majBadge(); } // fin de requête : le badge retrouve le modèle par défaut du serveur
      verrouiller(false);
      rendreSuggestions();
      if (!el.panneau.hidden) el.saisie.focus();
    }
  }

  // -- copie du contexte pour un LLM externe
  async function copierContexte() {
    const derniere = [...etat.fil].reverse().find((m) => m.role === "user")?.texte;
    const question = el.saisie.value.trim() || derniere || "[ma question]";
    const c = ctx();
    const texte = `Contexte : je t'interroge sur « Plan Patrimoine », un simulateur patrimonial français (fiscalité 2026). N'invente aucun taux ni règle ; signale ce que tu ne sais pas.\n\nMÉMO FISCAL 2026 :\n${memoFiscal(c.plan)}\n\nMON PROFIL (anonymisé) :\n${resumerProfilPourLLM(c) || "(non disponible)"}\n\nMA QUESTION :\n${question}`;
    let ok = false;
    try { await navigator.clipboard.writeText(texte); ok = true; } catch {
      const t = document.createElement("textarea");
      t.value = texte; t.style.position = "fixed"; t.style.opacity = "0";
      document.body.appendChild(t); t.select();
      try { ok = document.execCommand("copy"); } catch { ok = false; }
      t.remove();
    }
    const ancien = el.copier.textContent;
    el.copier.textContent = ok ? "✓ Copié (profil anonymisé)" : "Copie impossible";
    setTimeout(() => { el.copier.textContent = ancien; }, 2200);
  }

  // -- ouverture / fermeture
  function ouvrir(oui) {
    if (!oui) { arreterVoix(); arreterDictee(false); } // fermeture : on coupe la lecture et la dictée en cours
    el.panneau.hidden = !oui;
    el.bouton.setAttribute("aria-expanded", String(oui));
    racine.dataset.ouvert = String(oui);
    if (oui) {
      etat.approfondi = false; // désactivé par défaut à chaque ouverture : le raisonnement consomme beaucoup de quota
      majApprofondi();
      if (!etat.serveur.connu) verifierServeur(); else { majBadge(); majConsentement(); }
      rendreSuggestions();
      rendreFil();
      el.saisie.focus();
    } else el.bouton.focus();
  }

  el.bouton.addEventListener("click", () => ouvrir(el.panneau.hidden));
  el.fermer.addEventListener("click", () => ouvrir(false));
  racine.addEventListener("keydown", (e) => { if (e.key === "Escape" && !el.panneau.hidden) { e.preventDefault(); ouvrir(false); } });
  // Un appui en dehors du widget ferme le panneau (composedPath : fiable même si le nœud cliqué est retiré du DOM entre-temps)
  document.addEventListener("pointerdown", (e) => {
    if (el.panneau.hidden || e.composedPath().includes(racine)) return;
    ouvrir(false);
  });
  /** « Envoyer » / Entrée : pendant une dictée, on stoppe l'écoute et la question dictée part tout de suite (sans attendre le silence). */
  const envoyerSaisie = () => { if (dictee.active) arreterDictee(true); else poser(el.saisie.value); };
  el.form.addEventListener("submit", (e) => { e.preventDefault(); envoyerSaisie(); });
  el.saisie.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); envoyerSaisie(); } });
  // Frappe au clavier pendant la dictée : l'écoute est abandonnée, le texte tapé est conservé.
  el.saisie.addEventListener("input", () => { if (dictee.active) arreterDictee(false); });
  el.copier.addEventListener("click", copierContexte);
  el.micro?.addEventListener("click", () => { if (dictee.active) arreterDictee(true); else demarrerDictee(); });
  el.voix?.addEventListener("click", () => activerVoix(!etat.voix));
  window.addEventListener("pagehide", () => { arreterVoix(); arreterDictee(false); });
  el.approfondi?.addEventListener("click", () => { if (etat.occupe) return; etat.approfondi = !etat.approfondi; majApprofondi(); });
  el.reglagesBtn.addEventListener("click", () => {
    const ouvert = el.reglages.hidden;
    el.reglages.hidden = !ouvert;
    el.reglagesBtn.setAttribute("aria-expanded", String(ouvert));
  });
  el.reglages.addEventListener("change", (e) => { if (e.target.name === "assistant-mode") choisirMode(e.target.value); });
  // « Effacer » : vide l'écran ET la clé localStorage du profil courant
  el.effacer.addEventListener("click", () => {
    etat.epoque++;
    etat.controleur?.abort();
    arreterVoix();
    etat.fil = [];
    try { localStorage.removeItem(cleHistorique()); } catch { /* stockage indisponible */ }
    rendreFil();
    rendreSuggestions();
  });
  $("assistant-activer").addEventListener("click", () => choisirMode("auto"));
  $("assistant-refuser").addEventListener("click", () => choisirMode("local"));
  // Autre profil chargé (sélecteur, lien partagé) : on abandonne la requête en cours et on recharge l'historique de ce profil.
  document.addEventListener("profil:change", () => {
    etat.epoque++;
    etat.controleur?.abort();
    arreterVoix();
    arreterDictee(false);
    chargerHistorique();
    rendreFil();
    rendreSuggestions();
  });
  document.addEventListener("simulation:change", (e) => { if (!e.detail?.active) simulationTerminee(); });
  // Citation cliquable : sur téléphone, on referme le panneau pour laisser voir la fiche.
  el.fil.addEventListener("click", (e) => { if (e.target.closest?.("a[data-citation]") && window.matchMedia("(max-width: 640px)").matches) ouvrir(false); });
  // Mode discret : l'appli masque les montants des nœuds ajoutés ; à la réaffichage, on redessine depuis le texte brut.
  let discret = document.documentElement.classList.contains("discret");
  new MutationObserver(() => {
    const maintenant = document.documentElement.classList.contains("discret");
    if (maintenant !== discret) { discret = maintenant; if (maintenant) arreterVoix(); majVoix(); if (!maintenant) rendreFil(); }
  }).observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });

  window.addEventListener("online", majReseauChat);
  window.addEventListener("offline", majReseauChat);

  chargerHistorique();
  majBadge();
  majConsentement();
  majReseauChat();
}
