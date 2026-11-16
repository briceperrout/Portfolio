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
//  Fonctions pures (testables) : rechercherSections, resumerProfilPourLLM,
//  construireRequeteCloud, repondreLocal. Le DOM n'est touché que par monterAssistant.
// =====================================================================

import { FICHES, VERIFIE_LE } from "./fiches.js";
import { LEXIQUE } from "./lexique.js";
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
7. Hors sujet (autre chose que patrimoine, fiscalité française, immobilier, retraite) : dis-le en une phrase.`;

export function construirePromptSysteme(plan, sections) {
  const index = FICHES.map((f) => `- ${lien(f.id)}`).join("\n");
  const extraits = sections.length
    ? sections.map((s) => `### ${s.ficheTitre} — ${s.titre}  (source : ${lien(s.fiche)})\n${s.texte}`).join("\n\n")
    : "(aucun extrait pertinent : réponds avec le mémo et le profil, ou dis que l'information manque)";
  return `${INSTRUCTIONS}\n\nMÉMO FISCAL 2026 (prioritaire sur tes connaissances) :\n${memoFiscal(plan)}\n\nINDEX DES FICHES (seules citations autorisées) :\n${index}\n\nEXTRAITS DE FICHES :\n${extraits}\n\n(Fiches vérifiées le ${VERIFIE_LE}.)`;
}

const RE_COMPLEXE = /compar|arbitr|vaut.il mieux|plutot que|ou vendre|ou casser|simul/;
/** Corps de la requête POST /api/chat. Les réponses locales (qui citent de vrais montants) n'en font jamais partie. */
export function construireRequeteCloud(question, historique, ctx) {
  const sections = rechercherSections(question, historique);
  const avant = historique.filter((m) => m.texte && m.source !== "accueil" && m.source !== "local" && m !== historique[historique.length - 1]).slice(-6);
  return {
    systeme: construirePromptSysteme(ctx?.plan, sections),
    profil: resumerProfilPourLLM(ctx) || "(profil non disponible)",
    messages: [...avant.map((m) => ({ role: m.role === "ia" ? "assistant" : "user", content: m.texte })), { role: "user", content: question }],
    raisonnement: RE_COMPLEXE.test(norm(question)),
    stream: true,
  };
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

async function appelerCloud(requete, surTexte, signal) {
  let rep;
  try {
    rep = await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(requete), signal });
  } catch { throw new ErreurAssistant("reseau"); }
  if (!rep.ok) {
    let code = `http_${rep.status}`;
    try { code = (await rep.json()).erreur || code; } catch { /* corps non JSON */ }
    throw new ErreurAssistant(code);
  }
  const lecteur = rep.body.getReader(), dec = new TextDecoder();
  let tampon = "", texte = "", fin = null;
  try {
    for (;;) {
      const { done, value } = await lecteur.read();
      if (done) break;
      tampon += dec.decode(value, { stream: true });
      const blocs = tampon.split("\n\n");
      tampon = blocs.pop();
      for (const b of blocs) {
        const l = b.trim();
        if (!l.startsWith("data:")) continue;
        let ev; try { ev = JSON.parse(l.slice(5)); } catch { continue; }
        if (ev.erreur) throw new ErreurAssistant(ev.erreur);
        if (ev.delta) { texte += ev.delta; surTexte(texte); } else if (ev.fin) fin = ev;
      }
    }
  } catch (e) { throw e instanceof ErreurAssistant ? e : new ErreurAssistant("flux"); }
  if (!texte.trim()) throw new ErreurAssistant("vide");
  return { texte, modele: fin?.modele, masques: fin?.masques ?? 0 };
}

// ---------------------------------------------------------------- Markdown minimal et sûr
export function rendreMarkdown(src) {
  const inline = (t) => {
    let s = echapper(t);
    s = s.replace(/\[([^\]]+)\]\(#fiche-([a-z0-9-]+)\)/g, (m, titre, id) => (IDS_FICHES.has(id) ? `<a class="lien-fiche" href="#fiche-${id}" data-citation>${titre}</a>` : titre));
    s = s.replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>");
    return s.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
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
  openai_401: "clé OpenAI refusée", openai_429: "quota OpenAI atteint", vide: "réponse vide", flux: "flux interrompu", delai: "délai dépassé",
};

/**
 * Branche le widget sur le balisage de index.html.
 * @param {{getContexte: () => ({plan: object, res: object|undefined, profil: object})}} deps
 */
export function monterAssistant({ getContexte }) {
  const $ = (id) => document.getElementById(id);
  const racine = $("assistant");
  if (!racine) return;
  const el = { bouton: $("assistant-bouton"), panneau: $("assistant-panneau"), badge: $("assistant-badge"), fil: $("assistant-fil"), suggestions: $("assistant-suggestions"),
    form: $("assistant-form"), saisie: $("assistant-saisie"), reglagesBtn: $("assistant-reglages-btn"), reglages: $("assistant-reglages"), consentement: $("assistant-consentement"),
    fermer: $("assistant-fermer"), copier: $("assistant-copier"), effacer: $("assistant-effacer"), envoyer: $("assistant-envoyer") };

  const etat = { reglages: lireReglages(), serveur: { connu: false, joignable: false, actif: false, modele: "" }, fil: [], occupe: false, controleur: null };
  const accueil = { role: "ia", source: "accueil", texte: `Bonjour ! Pose-moi une question sur tes placements, ton plan ou la fiscalité. Je cite les fiches du site (par exemple ${lien("mode-emploi")}).` };

  const ctx = () => { try { return getContexte(); } catch { return {}; } };
  const cloudAutorise = () => etat.reglages.mode === "auto";

  // -- état du moteur
  function majBadge(detail = "") {
    let texte = "Mode local", titre = "Réponses calculées dans ton navigateur, sans réseau.";
    if (cloudAutorise() && etat.serveur.joignable && etat.serveur.actif) { texte = `OpenAI ${etat.serveur.modele}`; titre = "Profil anonymisé + question envoyés à OpenAI via ton serveur."; }
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

  // -- rendu
  function rendreMessage(m) {
    const d = document.createElement("div");
    d.className = `assistant-msg assistant-msg-${m.role}`;
    const corps = document.createElement("div");
    corps.className = "assistant-corps";
    corps.innerHTML = m.role === "ia" ? rendreMarkdown(m.texte) : `<p>${echapper(m.texte)}</p>`;
    d.appendChild(corps);
    if (m.role === "ia" && m.source && m.source !== "accueil") {
      const p = document.createElement("div");
      p.className = "assistant-source";
      p.textContent = (m.source === "local" ? "Réponse locale" : `OpenAI ${m.modele ?? ""}`.trim()) + (m.note ? ` · ${m.note}` : "");
      d.appendChild(p);
    }
    m.el = d;
    return d;
  }
  function rendreFil() {
    el.fil.replaceChildren(...[accueil, ...etat.fil].map(rendreMessage));
    el.fil.scrollTop = el.fil.scrollHeight;
  }
  function majMessage(m) {
    const corps = m.el?.querySelector(".assistant-corps");
    if (corps) corps.innerHTML = m.role === "ia" ? rendreMarkdown(m.texte) : `<p>${echapper(m.texte)}</p>`;
    el.fil.scrollTop = el.fil.scrollHeight;
  }
  function rendreSuggestions() {
    el.suggestions.replaceChildren(...suggestions(ctx()).map((t) => {
      const b = document.createElement("button");
      b.type = "button"; b.className = "assistant-puce"; b.textContent = t;
      b.addEventListener("click", () => poser(t));
      return b;
    }));
  }

  // -- conversation
  async function poser(question) {
    question = question.trim();
    if (!question || etat.occupe) return;
    etat.occupe = true;
    el.envoyer.disabled = true;
    el.saisie.value = "";
    const historique = [...etat.fil];
    const utilisateur = { role: "user", texte: question };
    const reponse = { role: "ia", texte: "…", source: null };
    etat.fil.push(utilisateur, reponse);
    rendreFil();
    const contexte = ctx();
    let note = "";
    try {
      if (cloudAutorise() && !(etat.serveur.connu && etat.serveur.joignable && !etat.serveur.actif)) {
        etat.controleur = new AbortController();
        const delai = setTimeout(() => etat.controleur.abort(), 45000);
        try {
          const r = await appelerCloud(construireRequeteCloud(question, [...historique, utilisateur], contexte), (t) => { reponse.texte = t; reponse.source = "openai"; majMessage(reponse); }, etat.controleur.signal);
          reponse.texte = nettoyerCitations(r.texte);
          Object.assign(reponse, { source: "openai", modele: r.modele, note: r.masques > 0 ? `${r.masques} donnée(s) personnelle(s) masquée(s) avant l'envoi` : "" });
          majMessage(reponse);
          rendreFil();
          etat.serveur.connu = true; etat.serveur.joignable = true; majBadge();
          return;
        } catch (e) {
          const code = e.name === "AbortError" ? "delai" : e.code ?? "reseau";
          note = `repli local : ${MESSAGES_ERREUR[code] ?? code}`;
          if (code === "no_key") etat.serveur.actif = false;
          if (code === "reseau") etat.serveur.joignable = false;
          etat.serveur.connu = true;
          majBadge(code === "reseau" ? "hors ligne" : "");
        } finally { clearTimeout(delai); etat.controleur = null; }
      }
      reponse.texte = repondreLocal(question, [...historique, utilisateur], contexte);
      Object.assign(reponse, { source: "local", note });
      rendreFil();
    } finally {
      etat.occupe = false;
      el.envoyer.disabled = false;
      rendreSuggestions();
      el.saisie.focus();
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
    el.panneau.hidden = !oui;
    el.bouton.setAttribute("aria-expanded", String(oui));
    racine.dataset.ouvert = String(oui);
    if (oui) {
      if (!etat.serveur.connu) verifierServeur(); else { majBadge(); majConsentement(); }
      rendreSuggestions();
      rendreFil();
      el.saisie.focus();
    } else el.bouton.focus();
  }

  el.bouton.addEventListener("click", () => ouvrir(el.panneau.hidden));
  el.fermer.addEventListener("click", () => ouvrir(false));
  racine.addEventListener("keydown", (e) => { if (e.key === "Escape" && !el.panneau.hidden) { e.preventDefault(); ouvrir(false); } });
  el.form.addEventListener("submit", (e) => { e.preventDefault(); poser(el.saisie.value); });
  el.saisie.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); poser(el.saisie.value); } });
  el.copier.addEventListener("click", copierContexte);
  el.reglagesBtn.addEventListener("click", () => {
    const ouvert = el.reglages.hidden;
    el.reglages.hidden = !ouvert;
    el.reglagesBtn.setAttribute("aria-expanded", String(ouvert));
  });
  el.reglages.addEventListener("change", (e) => { if (e.target.name === "assistant-mode") choisirMode(e.target.value); });
  el.effacer.addEventListener("click", () => { etat.controleur?.abort(); etat.fil = []; rendreFil(); rendreSuggestions(); });
  $("assistant-activer").addEventListener("click", () => choisirMode("auto"));
  $("assistant-refuser").addEventListener("click", () => choisirMode("local"));
  // Citation cliquable : sur téléphone, on referme le panneau pour laisser voir la fiche.
  el.fil.addEventListener("click", (e) => { if (e.target.closest?.("a[data-citation]") && window.matchMedia("(max-width: 640px)").matches) ouvrir(false); });
  // Mode discret : l'appli masque les montants des nœuds ajoutés ; à la réaffichage, on redessine depuis le texte brut.
  let discret = document.documentElement.classList.contains("discret");
  new MutationObserver(() => {
    const maintenant = document.documentElement.classList.contains("discret");
    if (maintenant !== discret) { discret = maintenant; if (!maintenant) rendreFil(); }
  }).observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });

  majBadge();
  majConsentement();
}
