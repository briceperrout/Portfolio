// =====================================================================
//  worker.js — relais sécurisé vers OpenAI pour la production (Cloudflare).
//  Équivalent de serveur.py : mêmes routes, mêmes règles d'anonymisation.
//
//    GET  /api/statut  → { actif, modele }
//    POST /api/chat    → flux SSE normalisé { modele } puis { delta } … { fin, modele, masques } si le client envoie stream: true
//                        (sinon JSON { reponse, modele, masques } ; erreur en cours de flux : { erreur })
//                        Routage : gpt-5.4-mini par défaut, o3 si le client envoie modeApprofondi: true ou si la
//                        question contient un mot-clé complexe (sauf quota journalier ≥ 2 350 000 tokens). Le modèle
//                        retenu est annoncé par l'en-tête X-Model-Used et le premier événement SSE { modele }.
//                        Si OpenAI refuse le modèle de raisonnement (404 introuvable/déprécié, 403, 400, 429), la requête est
//                        rejouée une fois sur le modèle rapide en effort « high » (libellé « … · o3 indisponible »).
//    GET | PUT | DELETE /api/sync/:id → synchronisation multi-appareils : enveloppe chiffrée de bout en bout (voir sync.js),
//                        stockée dans Cloudflare KV (liaison SYNC_KV). Le serveur ne peut pas la lire ; PUT exige la révision
//                        courante (verrou optimiste, 409 « conflit » sinon) ; 256 Ko max ; expiration 400 jours sans écriture.
//    GET  /api/taux    → taux de change du jour de la BCE (USD, CAD, CHF, GBP ; 1 EUR = x devise) :
//                        { date, source: "BCE", base: "EUR", taux }. Donnée publique, aucune donnée utilisateur transmise,
//                        pas de Turnstile ; mis en cache 6 h. Échec amont : 502 « taux indisponibles ».
//
//  Secrets (jamais dans le code, jamais côté navigateur) :
//    wrangler secret put OPENAI_API_KEY
//    wrangler secret put TURNSTILE_SECRET_KEY      (optionnel : active la vérification Turnstile)
//  Variables (wrangler.toml → [vars]) :
//    OPENAI_MODEL_CHAT        défaut « gpt-5.4-mini »
//    OPENAI_MODEL_REASONING   défaut « o3 »
//    OPENAI_ENABLE_REASONING  « 0 » coupe le modèle de raisonnement (actif par défaut)
//    OPENAI_QUOTA_RAPIDE_MAX        défaut 2350000 (pool gratuit 2,5 M des modèles mini ; au-delà : 429 quota_journalier)
//    OPENAI_QUOTA_RAISONNEMENT_MAX  défaut 225000 (pool gratuit 250 k d'o3 ; au-delà : gpt-5.4-mini en effort « high »)
//    OPENAI_DAILY_TOKEN_ALERT défaut 2200000
//    ALLOWED_ORIGIN           ex. https://plan-patrimoine.pages.dev (sinon : même origine seulement)
//  Liaisons (optionnelles) : QUOTA_IA (Durable Object QuotaIA) et LIMITE_CHAT (rate limiting) : voir ci-dessous ;
//  ASSETS pour servir aussi les fichiers statiques ; SYNC_KV (namespace KV) pour la synchronisation
//  (absente : /api/sync répond 503 « sync_indisponible » et l'application reste 100 % locale).
//
//  Quota et débit : le quota journalier de tokens est partagé entre tous les isolats par le Durable Object
//  QuotaIA (liaison QUOTA_IA, strict) ; la limite de débit par IP est celle de la liaison Cloudflare Rate Limiting
//  LIMITE_CHAT (30 requêtes par minute). Sans ces liaisons (développement, tests), repli sur des compteurs en
//  mémoire, « au mieux » (par isolat). POST /api/chat exige un en-tête Origin (même origine ou ALLOWED_ORIGIN).
// =====================================================================

import CONFIG_IA from "./config-ia.json" with { type: "json" };

const URL_OPENAI = "https://api.openai.com/v1/chat/completions";

// Routage multi-modèles (miroir exact de serveur.py).
export const MODEL_FAST = CONFIG_IA.modeles.rapide;      // chat général, synthèse, RAG
export const MODEL_REASONING = CONFIG_IA.modeles.raisonnement;        // arbitrages patrimoniaux complexes (modèle phare : pool gratuit de 250 k tokens/jour)
// Mots-clés (normalisés : minuscules, sans accents ni tirets) qui déclenchent MODEL_REASONING.
const MOTS_COMPLEXES = CONFIG_IA.motsComplexes;
// Deux pools gratuits Data Sharing, comptés séparément (prompt + completion, raisonnement inclus) :
//   « rapide »       : modèles mini, 2,5 M tokens/jour → plafond de sécurité 2 350 000 (au-delà : refus 429, repli local côté client)
//   « raisonnement » : modèles phares (o3), 250 k tokens/jour → plafond 225 000 (au-delà : repli sur MODEL_FAST en effort « high »)
const PLAFOND_RAPIDE = CONFIG_IA.plafonds.rapide;
const PLAFOND_RAISONNEMENT = CONFIG_IA.plafonds.raisonnement;
const ALERTE_RAPIDE = CONFIG_IA.alertes.rapide;
const ALERTE_RAISONNEMENT = CONFIG_IA.alertes.raisonnement;
const MAX_COMPLETION_RAISONNEMENT = CONFIG_IA.maxCompletion.raisonnement;      // o3 (et repli « high ») : reasoning_tokens + réponse + balises [[ACTION]] / [[SUGGESTION]]
const MAX_COMPLETION_RAPIDE = CONFIG_IA.maxCompletion.rapide;            // famille gpt-5 rapide (effort « low »)
// Codes HTTP d'OpenAI pour lesquels un modèle de raisonnement refusé est remplacé par MODEL_FAST en effort « high » :
// 400 (paramètre ou streaming refusé), 403 (organisation non vérifiée), 404 (model_not_found, déprécié), 429 (limite du modèle).
// Pas 401 (clé invalide : MODEL_FAST échouerait aussi).
const STATUTS_REPLI = CONFIG_IA.statutsRepli;
const EFFORT_RAPIDE = CONFIG_IA.efforts.rapide;
const EFFORT_RAISONNEMENT = CONFIG_IA.efforts.raisonnement;
const EFFORT_REPLI = CONFIG_IA.efforts.repli;
const MAX_CORPS = 64 * 1024;
const MAX_SYSTEME = 24000;
const MAX_PROFIL = 4000;
const MAX_MESSAGES = 20;
const MAX_TOTAL_MESSAGES = 12000;
const MAX_REQUETES_PAR_MINUTE = 30;

// ---------------------------------------------------------------- anonymisation
const ETABLISSEMENTS = [
  "Trade Republic", "Boursorama", "Boursobank", "Finary", "Fortuneo", "Hello bank", "Revolut", "N26",
  "BNP Paribas", "BNP", "Société Générale", "Crédit Agricole", "Caisse d'Épargne", "Caisse d'Epargne",
  "Crédit Mutuel", "CIC", "LCL", "La Banque Postale", "Banque Populaire", "HSBC", "ING", "Monabanq",
  "Degiro", "Interactive Brokers", "Saxo", "Linxea", "Yomoni", "Nalo", "Bitstack", "Binance",
  "Coinbase", "Kraken", "Ledger", "Bitpanda", "Crypto.com", "Spirica", "Generali", "Boursier",
];
const echapperRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const RE_ETABLISSEMENT = new RegExp(
  "(?<![\\p{L}\\p{N}_])(?:" + [...ETABLISSEMENTS].sort((a, b) => b.length - a.length).map(echapperRegex).join("|") + ")(?![\\p{L}\\p{N}_])",
  "giu"
);
const RE_EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
const RE_IBAN = /\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){3,7}(?: ?[A-Z0-9]{1,3})?\b/g;
const RE_TEL = /(?<!\d)(?:\+33|0033|0)\s?[1-9](?:[\s.-]?\d{2}){4}(?!\d)/g;
const RE_CARTE = /(?<!\d)(?:\d[ -]?){13,19}(?!\d)/g;
const RE_MONTANT = /(?<![\d.,])[-−+]?(?:\d{1,3}(?:[\s  .]\d{3})+|\d+)(?:[.,]\d+)?[\s  ]?(?:k[\s  ]?€|k[\s  ]?euros?|€|euros?)(?![\w])/gi;

function sanitiserTexte(texte, strict = true) {
  let n = 0;
  const remplacer = (motif, repl) => {
    texte = texte.replace(motif, () => { n++; return repl; });
  };
  remplacer(RE_EMAIL, "[e-mail masqué]");
  remplacer(RE_IBAN, "[IBAN masqué]");
  remplacer(RE_TEL, "[téléphone masqué]");
  remplacer(RE_CARTE, "[numéro masqué]");
  if (strict) {
    remplacer(RE_ETABLISSEMENT, "[établissement]");
    remplacer(RE_MONTANT, "[montant]");
  }
  return [texte, n];
}

class ErreurAPI extends Error {
  constructor(statut, code) { super(code); this.statut = statut; this.code = code; }
}

function validerRequete(p) {
  if (!p || typeof p !== "object" || Array.isArray(p)) throw new ErreurAPI(400, "requete_invalide");
  let { systeme = "", profil = "", messages } = p;
  if (typeof systeme !== "string" || typeof profil !== "string" || !Array.isArray(messages)) throw new ErreurAPI(400, "requete_invalide");
  if (systeme.length > MAX_SYSTEME || profil.length > MAX_PROFIL) throw new ErreurAPI(413, "trop_long");
  if (messages.length < 1 || messages.length > MAX_MESSAGES) throw new ErreurAPI(400, "requete_invalide");
  let masques = 0, k;
  [systeme, k] = sanitiserTexte(systeme, false); masques += k;
  [profil, k] = sanitiserTexte(profil, true); masques += k;
  let total = 0;
  const propres = messages.map((m) => {
    if (!m || (m.role !== "user" && m.role !== "assistant") || typeof m.content !== "string") throw new ErreurAPI(400, "requete_invalide");
    total += m.content.length;
    const [texte, n] = sanitiserTexte(m.content, true);
    masques += n;
    return { role: m.role, content: texte };
  });
  if (total > MAX_TOTAL_MESSAGES) throw new ErreurAPI(413, "trop_long");
  if (propres[propres.length - 1].role !== "user") throw new ErreurAPI(400, "requete_invalide");
  // Flux SSE seulement si le client le demande (stream: true) ; sinon réponse JSON classique.
  // « Analyse approfondie » (toggle du chat) ; l'ancien champ `raisonnement` reste accepté comme alias.
  const approfondi = p.modeApprofondi === true || p.raisonnement === true;
  return { systeme, profil, messages: propres, approfondi, question: propres[propres.length - 1].content, stream: p.stream === true, masques };
}

// ---------------------------------------------------------------- OpenAI
const modeleChat = (env) => (env.OPENAI_MODEL_CHAT || "").trim() || MODEL_FAST;
// Actif par défaut ; OPENAI_ENABLE_REASONING=0 sert de coupe-circuit (tout reste sur le modèle rapide).
const modeleRaisonnement = (env) => (String(env.OPENAI_ENABLE_REASONING ?? "1").trim() === "0" ? null : (env.OPENAI_MODEL_REASONING || "").trim() || MODEL_REASONING);
// o3/o4… et gpt-5… : max_completion_tokens, pas de temperature, rôle « developer »
const estRaisonnement = (m) => /^(o\d|gpt-5)/.test(m);
const cleValide = (env) => (/^sk-[A-Za-z0-9_-]{20,}$/.test((env.OPENAI_API_KEY || "").trim()) ? env.OPENAI_API_KEY.trim() : null);
const entierEnv = (v, defaut) => parseInt(v, 10) || defaut;

/** Minuscules, sans accents, ponctuation et tirets remplacés par des espaces (« Nue-propriété » → « nue propriete »). */
export const normaliser = (t) => String(t).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
const RE_COMPLEXE = new RegExp("(?<![a-z0-9])(?:" + MOTS_COMPLEXES.map((m) => echapperRegex(normaliser(m))).join("|") + ")s?(?![a-z0-9])");
/** Le dernier message utilisateur contient-il un mot-clé d'arbitrage complexe (mot entier, pluriel toléré) ? */
export const questionComplexe = (texte) => RE_COMPLEXE.test(normaliser(texte));

/**
 * Routage selon la demande et les deux compteurs journaliers `tokens` = { rapide, raisonnement } :
 *  - question simple (ou coupe-circuit)               → MODEL_FAST, effort « low »          (pool rapide)
 *  - approfondi / mot-clé, pool raisonnement < 225 k  → MODEL_REASONING, effort « medium »  (pool raisonnement)
 *  - approfondi / mot-clé, pool raisonnement ≥ 225 k  → MODEL_FAST, effort « high » (libellé « quota … préservé »)
 *  - dès que le pool rapide atteint son plafond (2,35 M), tout appel au modèle rapide est refusé (429 quota_journalier) :
 *    au-delà des 2,5 M gratuits, OpenAI facturerait ; le client retombe sur le repli local.
 * `libelle` est annoncé au client, `modele` part chez OpenAI.
 */
export function choisirModele(d, env, tokens = {}) {
  const rapide = modeleChat(env);
  const demande = d.approfondi === true || questionComplexe(d.question || "");
  const lourd = modeleRaisonnement(env);
  if (demande && lourd && (tokens.raisonnement || 0) < entierEnv(env.OPENAI_QUOTA_RAISONNEMENT_MAX, PLAFOND_RAISONNEMENT)) {
    return { modele: lourd, libelle: lourd, pool: "raisonnement", effort: EFFORT_RAISONNEMENT, maxCompletion: entierEnv(env.OPENAI_MAX_COMPLETION_TOKENS, MAX_COMPLETION_RAISONNEMENT) };
  }
  if ((tokens.rapide || 0) >= entierEnv(env.OPENAI_QUOTA_RAPIDE_MAX, PLAFOND_RAPIDE)) throw new ErreurAPI(429, "quota_journalier");
  if (demande && lourd) { // quota du modèle phare épuisé : le modèle rapide prend le relais en effort élevé
    return { modele: rapide, libelle: `${rapide} (raisonnement élevé · quota ${lourd} préservé)`, pool: "rapide", effort: EFFORT_REPLI, maxCompletion: entierEnv(env.OPENAI_MAX_COMPLETION_TOKENS, MAX_COMPLETION_RAISONNEMENT) };
  }
  return { modele: rapide, libelle: rapide, pool: "rapide", effort: EFFORT_RAPIDE, maxCompletion: entierEnv(env.OPENAI_MAX_COMPLETION_TOKENS_FAST, MAX_COMPLETION_RAPIDE) };
}

/**
 * Le modèle de raisonnement vient d'être refusé par OpenAI (`statut`) : MODEL_FAST en effort « high » prend le relais
 * plutôt que d'abandonner en réponse locale. Aucun repli pour un modèle rapide, pour une clé refusée (401) ou si le
 * plafond du pool rapide est atteint (le refus d'origine est alors renvoyé tel quel). Retourne null s'il n'y a pas de repli.
 */
export function choixRepli(choix, statut, env, tokens = {}) {
  if (choix.pool !== "raisonnement" || !STATUTS_REPLI.includes(statut)) return null;
  if ((tokens.rapide || 0) >= entierEnv(env.OPENAI_QUOTA_RAPIDE_MAX, PLAFOND_RAPIDE)) return null;
  const rapide = modeleChat(env);
  return { modele: rapide, libelle: `${rapide} (raisonnement élevé · ${choix.modele} indisponible)`, pool: "rapide", effort: EFFORT_REPLI, maxCompletion: entierEnv(env.OPENAI_MAX_COMPLETION_TOKENS, MAX_COMPLETION_RAISONNEMENT) };
}

/**
 * Corps de la requête OpenAI, par famille de modèle (CLAUDE.md) :
 *  - o3/o4… (MODEL_REASONING) : rôle « developer », pas de temperature, reasoning_effort « medium », max_completion_tokens 2500 ;
 *  - gpt-5… rapide : mêmes règles de paramètres (temperature et max_tokens y sont refusés), effort « low » et 1500 tokens,
 *    ou « high » et 2500 quand il remplace o3 (quota phare épuisé) ;
 *  - modèles classiques (gpt-4…) : rôle « system », temperature 0.2, max_tokens 800.
 */
export function corpsOpenAI(d, env, choix = choisirModele(d, env)) {
  const modele = choix.modele;
  const raisonne = estRaisonnement(modele);
  let consigne = d.systeme;
  if (d.profil) consigne += "\n\nPROFIL DE L'UTILISATEUR (anonymisé) :\n" + d.profil;
  const corps = {
    model: modele,
    messages: [{ role: raisonne ? "developer" : "system", content: consigne }, ...d.messages],
    stream: d.stream,
  };
  if (raisonne) { corps.reasoning_effort = choix.effort; corps.max_completion_tokens = choix.maxCompletion; } // jamais de temperature ; les jetons de raisonnement comptent dans le plafond
  else { corps.temperature = 0.2; corps.max_tokens = 800; } // marge pour les balises [[ACTION:…]] et [[SUGGESTION:…]]
  if (d.stream) corps.stream_options = { include_usage: true };
  return [corps, modele];
}

// ---------------------------------------------------------------- quota et débit (par isolat)
const suivi = { jour: "", tokens: { rapide: 0, raisonnement: 0 }, alertes: { rapide: false, raisonnement: false }, recentes: [] };
function roulement() { // minuit UTC passé : les compteurs repartent de zéro
  const jour = new Date().toISOString().slice(0, 10);
  if (suivi.jour !== jour) Object.assign(suivi, { jour, tokens: { rapide: 0, raisonnement: 0 }, alertes: { rapide: false, raisonnement: false } });
}
const seuilAlerte = (env, pool) => (pool === "raisonnement" ? entierEnv(env.OPENAI_DAILY_TOKEN_ALERT_REASONING, ALERTE_RAISONNEMENT) : entierEnv(env.OPENAI_DAILY_TOKEN_ALERT, ALERTE_RAPIDE));
function compterMemoire(n, env, pool) {
  roulement();
  suivi.tokens[pool] += n;
  const seuil = seuilAlerte(env, pool);
  if (suivi.tokens[pool] >= seuil && !suivi.alertes[pool]) {
    suivi.alertes[pool] = true;
    console.warn(`ALERTE QUOTA (${pool}) : ${suivi.tokens[pool]} tokens aujourd'hui sur cet isolat (seuil ${seuil}).`);
  }
}
/** Tokens consommés aujourd'hui (UTC) sur cet isolat : { rapide, raisonnement } ; avec `pool`, le seul compteur demandé. */
export function tokensDuJour(pool) {
  roulement();
  return pool ? suivi.tokens[pool] : { ...suivi.tokens };
}

// ---------------------------------------------------------------- Durable Object : quota journalier partagé
/**
 * Compteur de tokens du jour (UTC) partagé par tous les isolats. Les requêtes d'un même Durable Object sont
 * sérialisées par Cloudflare : aucun verrou nécessaire. Routes internes : POST /lire, POST /ajouter.
 */
export class QuotaIA {
  constructor(state, env) {
    this.storage = state.storage;
    this.env = env || {};
    this.maintenant = () => Date.now();
  }
  async charger() {
    const jour = new Date(this.maintenant()).toISOString().slice(0, 10);
    let etat = await this.storage.get("etat");
    if (!etat || etat.jour !== jour) {
      etat = { jour, tokens: { rapide: 0, raisonnement: 0 }, alertes: { rapide: false, raisonnement: false } };
    }
    return etat;
  }
  async fetch(request) {
    const chemin = new URL(request.url).pathname;
    if (request.method !== "POST" || (chemin !== "/lire" && chemin !== "/ajouter")) return json(404, { erreur: "introuvable" });
    const etat = await this.charger();
    if (chemin === "/lire") return json(200, { jour: etat.jour, tokens: etat.tokens });
    let corps; try { corps = await request.json(); } catch { return json(400, { erreur: "requete_invalide" }); }
    const pool = corps?.pool, n = corps?.tokens;
    if ((pool !== "rapide" && pool !== "raisonnement") || !Number.isInteger(n) || n < 0) return json(400, { erreur: "requete_invalide" });
    etat.tokens[pool] += Math.min(n, 1e7);
    let alerte = null;
    const seuil = seuilAlerte(this.env, pool);
    if (etat.tokens[pool] >= seuil && !etat.alertes[pool]) { etat.alertes[pool] = true; alerte = pool; }
    await this.storage.put("etat", etat);
    return json(200, { jour: etat.jour, tokens: etat.tokens, alerte });
  }
}

const souche = (env) => (env.QUOTA_IA ? env.QUOTA_IA.get(env.QUOTA_IA.idFromName("global")) : null);
/** Tokens du jour { rapide, raisonnement } : Durable Object si présent, sinon (ou en cas d'erreur) compteurs mémoire. */
async function lireQuota(env) {
  const s = souche(env);
  if (s) {
    try { return (await (await s.fetch("https://quota/lire", { method: "POST" })).json()).tokens; } catch { /* repli mémoire */ }
  }
  return tokensDuJour();
}
/** Crédite `n` tokens au pool : toujours en mémoire, et dans le Durable Object s'il est lié. */
async function ajouterQuota(env, pool, n) {
  compterMemoire(n, env, pool);
  const s = souche(env);
  if (!s) return;
  try {
    const r = await (await s.fetch("https://quota/ajouter", { method: "POST", body: JSON.stringify({ pool, tokens: n }) })).json();
    if (r.alerte) console.warn(`ALERTE QUOTA (${r.alerte}) : ${r.tokens?.[r.alerte]} tokens aujourd'hui (seuil ${seuilAlerte(env, r.alerte)}).`);
  } catch { /* le compteur mémoire a déjà été mis à jour */ }
}
/** Compte l'usage OpenAI (prompt + completion, raisonnement inclus) ; hors flux, `ctx.waitUntil` évite d'allonger la réponse. */
function compterTokens(usage, env, pool, ctx) {
  if (!usage) return undefined;
  const p = ajouterQuota(env, pool, (usage.prompt_tokens || 0) + (usage.completion_tokens || 0));
  if (ctx?.waitUntil) { ctx.waitUntil(p); return undefined; }
  return p;
}
function limiteAtteinte() {
  const t = Date.now();
  suivi.recentes = suivi.recentes.filter((x) => t - x < 60000);
  if (suivi.recentes.length >= MAX_REQUETES_PAR_MINUTE) return true;
  suivi.recentes.push(t);
  return false;
}

// ---------------------------------------------------------------- réponses
const ENTETES = { "X-Content-Type-Options": "nosniff", "Cache-Control": "no-store" };
const json = (statut, objet, extra = {}) => new Response(JSON.stringify(objet), { status: statut, headers: { ...ENTETES, ...extra, "Content-Type": "application/json; charset=utf-8" } });

function origineOk(request, env, { exiger = false } = {}) {
  const origine = request.headers.get("Origin");
  if (!origine) return !exiger;
  return origine === new URL(request.url).origin || (!!env.ALLOWED_ORIGIN && origine === env.ALLOWED_ORIGIN);
}

async function turnstileOk(request, env) {
  if (!env.TURNSTILE_SECRET_KEY) return true;
  const jeton = request.headers.get("X-Turnstile-Token");
  if (!jeton) return false;
  const f = new FormData();
  f.append("secret", env.TURNSTILE_SECRET_KEY);
  f.append("response", jeton);
  const ip = request.headers.get("CF-Connecting-IP");
  if (ip) f.append("remoteip", ip);
  try {
    const r = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: f });
    const rep = await r.json();
    if (rep.success !== true) return false;
    if (rep.hostname) {
      const attendus = [new URL(request.url).hostname];
      try { if (env.ALLOWED_ORIGIN) attendus.push(new URL(env.ALLOWED_ORIGIN).hostname); } catch { /* ALLOWED_ORIGIN invalide */ }
      return attendus.includes(rep.hostname);
    }
    return true;
  } catch { return false; }
}

/** Limite de débit par IP : liaison Cloudflare Rate Limiting si présente, sinon compteur mémoire par isolat. */
async function debitDepasse(request, env) {
  if (env.LIMITE_CHAT?.limit) {
    try {
      const { success } = await env.LIMITE_CHAT.limit({ key: request.headers.get("CF-Connecting-IP") || "inconnu" });
      return !success;
    } catch { /* liaison défaillante : repli mémoire */ }
  }
  return limiteAtteinte();
}

// Flux OpenAI → flux normalisé { modele } puis { delta } … puis { fin, modele, masques }
function fluxNormalise(amont, modele, masques, env, pool, ctx) {
  const enc = new TextEncoder(), dec = new TextDecoder();
  let tampon = "", usage = null, termine = false; // « [DONE] » manquant : réponse tronquée
  const evenement = (o) => enc.encode(`data: ${JSON.stringify(o)}\n\n`);
  const traiter = (ligne, controleur) => {
    ligne = ligne.trim();
    if (!ligne.startsWith("data:")) return;
    const contenu = ligne.slice(5).trim();
    if (contenu === "[DONE]") { termine = true; return; }
    let m; try { m = JSON.parse(contenu); } catch { return; }
    usage = m.usage || usage;
    const delta = m.choices?.[0]?.delta?.content;
    if (delta) controleur.enqueue(evenement({ delta }));
  };
  const lecteur = amont.pipeThrough(new TransformStream({
    start(controleur) { controleur.enqueue(evenement({ modele })); }, // `modele` = libellé annoncé au client
    transform(morceau, controleur) {
      tampon += dec.decode(morceau, { stream: true });
      const lignes = tampon.split("\n");
      tampon = lignes.pop();
      for (const l of lignes) traiter(l, controleur);
    },
    async flush(controleur) {
      if (tampon) traiter(tampon, controleur);
      const p = compterTokens(usage, env, pool, ctx);
      controleur.enqueue(evenement(termine ? { fin: true, modele, masques } : { fin: true, modele, masques, interrompu: true }));
      if (p) await p;
    },
  })).getReader();
  // Coupure côté OpenAI en plein flux : on prévient le navigateur par un événement d'erreur au lieu d'un flux tronqué.
  return new ReadableStream({
    async pull(controleur) {
      try {
        const { done, value } = await lecteur.read();
        if (done) controleur.close(); else controleur.enqueue(value);
      } catch {
        await compterTokens(usage, env, pool, ctx);
        controleur.enqueue(evenement({ erreur: "flux" }));
        controleur.close();
      }
    },
    cancel(raison) { return lecteur.cancel(raison); },
  });
}

async function chat(request, env, ctx) {
  if (!origineOk(request, env, { exiger: true })) throw new ErreurAPI(403, "origine_refusee");
  if (!(request.headers.get("Content-Type") || "").toLowerCase().startsWith("application/json")) throw new ErreurAPI(415, "json_attendu");
  const brut = await request.text();
  if (!brut || brut.length > MAX_CORPS) throw new ErreurAPI(413, "trop_long");
  let payload; try { payload = JSON.parse(brut); } catch { throw new ErreurAPI(400, "requete_invalide"); }

  const cle = cleValide(env);
  if (!cle) throw new ErreurAPI(503, "no_key");
  if (await debitDepasse(request, env)) throw new ErreurAPI(429, "trop_de_requetes");
  if (!(await turnstileOk(request, env))) throw new ErreurAPI(403, "turnstile");
  const donnees = validerRequete(payload);

  const quota = await lireQuota(env); // lu une seule fois : le repli réutilise la même lecture
  let choix = choisirModele(donnees, env, quota);
  let amont, corps, modele, libelle, pool;
  for (let tentative = 1; ; tentative++) { // 2e tentative seulement si le modèle de raisonnement est refusé (voir choixRepli)
    [corps, modele] = corpsOpenAI(donnees, env, choix);
    libelle = choix.libelle; // affiché au client (peut préciser « quota o3 préservé » ou « o3 indisponible »)
    pool = choix.pool;       // compteur de quota à créditer
    try {
      amont = await fetch(URL_OPENAI, {
        method: "POST",
        headers: { Authorization: `Bearer ${cle}`, "Content-Type": "application/json" },
        body: JSON.stringify(corps),
      });
    } catch { throw new ErreurAPI(504, "reseau"); }
    if (amont.ok) break;
    console.warn(`OpenAI a répondu ${amont.status} (modèle ${modele})`);
    const repli = tentative === 1 ? choixRepli(choix, amont.status, env, quota) : null;
    if (!repli) throw new ErreurAPI(amont.status === 429 ? 429 : 502, `openai_${amont.status}`);
    console.warn(`Repli : ${repli.modele} en effort « ${repli.effort} » à la place de ${modele}.`);
    choix = repli;
  }
  if (!donnees.stream) {
    const data = await amont.json();
    await compterTokens(data.usage, env, pool, ctx);
    return json(200, { reponse: data.choices?.[0]?.message?.content || "", modele: libelle, masques: donnees.masques }, { "X-Model-Used": modele });
  }
  return new Response(fluxNormalise(amont.body, libelle, donnees.masques, env, pool, ctx), {
    status: 200,
    headers: { ...ENTETES, "Content-Type": "text/event-stream; charset=utf-8", "X-Accel-Buffering": "no", "X-Model-Used": modele },
  });
}

// ---------------------------------------------------------------- synchronisation chiffrée (Cloudflare KV)
// Le serveur ne voit qu'une enveloppe opaque { v, rev, kdf, iter, sel, iv, ct } chiffrée dans le navigateur (voir sync.js) :
// aucun montant, aucun nom. L'identifiant est un hash du code de synchronisation (256 bits : impossible à deviner).
const RE_ID_SYNC = /^[A-Za-z0-9_-]{43}$/;
const RE_B64URL = /^[A-Za-z0-9_-]+$/;
const MAX_SYNC = 256 * 1024;                  // taille maximale de l'enveloppe (octets)
const TTL_SYNC = 400 * 24 * 3600;             // expiration : 400 jours sans écriture (renouvelée à chaque envoi)
const MAX_SYNC_PAR_MINUTE = 60;
const recentesSync = [];
function limiteSync() {
  const t = Date.now();
  while (recentesSync.length && t - recentesSync[0] > 60000) recentesSync.shift();
  if (recentesSync.length >= MAX_SYNC_PAR_MINUTE) return true;
  recentesSync.push(t);
  return false;
}

/** Valide et normalise l'enveloppe reçue : seuls les champs attendus sont conservés. Retourne { enveloppe, base }. */
export function validerEnveloppeSync(brut) {
  const e = brut;
  const ok = e && typeof e === "object" && !Array.isArray(e)
    && e.v === 1 && e.kdf === "PBKDF2-SHA256"
    && Number.isInteger(e.iter) && e.iter >= 100000 && e.iter <= 1000000
    && Number.isInteger(e.rev) && e.rev >= 1 && e.rev < 1e9
    && Number.isInteger(e.base) && e.base === e.rev - 1
    && [["sel", 16, 64], ["iv", 16, 16], ["ct", 22, MAX_SYNC]].every(([k, min, max]) => typeof e[k] === "string" && e[k].length >= min && e[k].length <= max && RE_B64URL.test(e[k]));
  if (!ok) throw new ErreurAPI(400, "enveloppe_invalide");
  return { enveloppe: { v: 1, rev: e.rev, kdf: e.kdf, iter: e.iter, sel: e.sel, iv: e.iv, ct: e.ct }, base: e.base };
}

async function sync(request, env, id) {
  if (!origineOk(request, env)) throw new ErreurAPI(403, "origine_refusee");
  if (!env.SYNC_KV) throw new ErreurAPI(503, "sync_indisponible");
  if (!RE_ID_SYNC.test(id)) throw new ErreurAPI(400, "identifiant_invalide");
  if (!["GET", "PUT", "DELETE"].includes(request.method)) throw new ErreurAPI(405, "methode_refusee");
  if (limiteSync()) throw new ErreurAPI(429, "trop_de_requetes");
  const cle = `sync:${id}`;
  if (request.method === "GET") {
    const brut = await env.SYNC_KV.get(cle);
    if (brut === null) throw new ErreurAPI(404, "introuvable");
    return new Response(brut, { status: 200, headers: { ...ENTETES, "Content-Type": "application/json; charset=utf-8" } });
  }
  if (!(await turnstileOk(request, env))) throw new ErreurAPI(403, "verification_refusee");
  if (request.method === "DELETE") {
    await env.SYNC_KV.delete(cle);
    return json(200, { ok: true });
  }
  const annonce = Number(request.headers.get("Content-Length"));
  if (annonce > MAX_SYNC + 1024) throw new ErreurAPI(413, "taille_excessive");
  const texte = await request.text();
  if (texte.length > MAX_SYNC + 1024) throw new ErreurAPI(413, "taille_excessive");
  let corps;
  try { corps = JSON.parse(texte); } catch { throw new ErreurAPI(400, "json_invalide"); }
  const { enveloppe, base } = validerEnveloppeSync(corps);
  // Verrou optimiste : l'écriture n'est acceptée que si elle part de la révision actuelle (KV n'a pas de transaction :
  // la protection est « au mieux » entre deux écritures simultanées ; la fusion côté client rattrape le reste).
  const actuel = await env.SYNC_KV.get(cle);
  let revActuelle = 0;
  if (actuel !== null) { try { revActuelle = Number(JSON.parse(actuel).rev) || 0; } catch { revActuelle = 0; } }
  if (revActuelle !== base) return json(409, { erreur: "conflit", rev: revActuelle });
  await env.SYNC_KV.put(cle, JSON.stringify(enveloppe), { expirationTtl: TTL_SYNC });
  return json(200, { ok: true, rev: enveloppe.rev });
}

const URL_BCE = "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml";
const DEVISES_BCE = ["USD", "CAD", "CHF", "GBP"];

// Extrait date et taux (1 EUR = x devise) du XML quotidien de la BCE ; null si invalide.
export function analyserTauxBCE(xml) {
  if (typeof xml !== "string") return null;
  const d = /\btime\s*=\s*['"](\d{4})-(\d{2})-(\d{2})['"]/.exec(xml);
  if (!d) return null;
  const [, a, m, j] = d;
  const t = new Date(Date.UTC(+a, +m - 1, +j));
  if (t.getUTCFullYear() !== +a || t.getUTCMonth() !== +m - 1 || t.getUTCDate() !== +j) return null;
  const taux = {};
  for (const c of xml.matchAll(/<Cube\s+currency\s*=\s*['"]([A-Z]{3})['"]\s+rate\s*=\s*['"]([^'"]*)['"]\s*\/?>/g)) {
    const v = Number(c[2]);
    if (DEVISES_BCE.includes(c[1]) && Number.isFinite(v) && v > 0) taux[c[1]] = v;
  }
  if (!Object.keys(taux).length) return null;
  return { date: `${a}-${m}-${j}`, source: "BCE", base: "EUR", taux };
}

async function tauxBCE() {
  const ctrl = new AbortController();
  const minuteur = setTimeout(() => ctrl.abort(), 5000);
  try {
    const rep = await fetch(URL_BCE, { signal: ctrl.signal, headers: { "User-Agent": "PlanPatrimoine/1.0" }, cf: { cacheTtl: 21600, cacheEverything: true } });
    if (!rep.ok) return json(502, { erreur: "taux indisponibles" });
    const donnees = analyserTauxBCE(await rep.text());
    if (!donnees) return json(502, { erreur: "taux indisponibles" });
    return json(200, donnees, { "Cache-Control": "public, max-age=21600" });
  } catch {
    return json(502, { erreur: "taux indisponibles" });
  } finally {
    clearTimeout(minuteur);
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    try {
      if (url.pathname.startsWith("/api/sync/")) return await sync(request, env, url.pathname.slice("/api/sync/".length));
      if (url.pathname === "/api/statut" && request.method === "GET") {
        if (!origineOk(request, env)) throw new ErreurAPI(403, "origine_refusee");
        return json(200, { actif: cleValide(env) !== null, modele: modeleChat(env) });
      }
      if (url.pathname === "/api/chat" && request.method === "POST") return await chat(request, env, ctx);
      if (url.pathname === "/api/taux") {
        if (request.method !== "GET") return json(405, { erreur: "methode_non_autorisee" }, { Allow: "GET" });
        return await tauxBCE();
      }
      if (url.pathname.startsWith("/api/")) return json(404, { erreur: "introuvable" });
      if (env.ASSETS) return env.ASSETS.fetch(request);
      return json(404, { erreur: "introuvable" });
    } catch (e) {
      if (e instanceof ErreurAPI) return json(e.statut, { erreur: e.code });
      console.error("erreur inattendue :", e?.name);
      return json(500, { erreur: "interne" });
    }
  },
};
