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
//  Liaison (optionnelle) : ASSETS (Pages) pour servir aussi les fichiers statiques.
//
//  Limites assumées : un Worker n'a pas de mémoire partagée entre isolats. Le compteur
//  de tokens et la limite de débit ci-dessous sont donc « au mieux » (par isolat) ;
//  pour un plafond strict, ajouter une règle de rate limiting Cloudflare ou un KV.
// =====================================================================

const URL_OPENAI = "https://api.openai.com/v1/chat/completions";

// Routage multi-modèles (miroir exact de serveur.py).
export const MODEL_FAST = "gpt-5.4-mini";      // chat général, synthèse, RAG
export const MODEL_REASONING = "o3";           // arbitrages patrimoniaux complexes (modèle phare : pool gratuit de 250 k tokens/jour)
// Mots-clés (normalisés : minuscules, sans accents ni tirets) qui déclenchent MODEL_REASONING.
const MOTS_COMPLEXES = ["sasu", "eurl", "holding", "demembrement", "usufruit", "nue-propriete", "succession", "donation", "ifi", "decumulation", "audit complet"];
// Deux pools gratuits Data Sharing, comptés séparément (prompt + completion, raisonnement inclus) :
//   « rapide »       : modèles mini, 2,5 M tokens/jour → plafond de sécurité 2 350 000 (au-delà : refus 429, repli local côté client)
//   « raisonnement » : modèles phares (o3), 250 k tokens/jour → plafond 225 000 (au-delà : repli sur MODEL_FAST en effort « high »)
const PLAFOND_RAPIDE = 2350000;
const PLAFOND_RAISONNEMENT = 225000;
const ALERTE_RAPIDE = 2200000;
const ALERTE_RAISONNEMENT = 200000;
const MAX_COMPLETION_RAISONNEMENT = 2500;      // o3 (et repli « high ») : reasoning_tokens + réponse + balises [[ACTION]] / [[SUGGESTION]]
const MAX_COMPLETION_RAPIDE = 1500;            // famille gpt-5 rapide (effort « low »)
// Codes HTTP d'OpenAI pour lesquels un modèle de raisonnement refusé est remplacé par MODEL_FAST en effort « high » :
// 400 (paramètre ou streaming refusé), 403 (organisation non vérifiée), 404 (model_not_found, déprécié), 429 (limite du modèle).
// Pas 401 (clé invalide : MODEL_FAST échouerait aussi).
const STATUTS_REPLI = [400, 403, 404, 429];
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
    return { modele: lourd, libelle: lourd, pool: "raisonnement", effort: "medium", maxCompletion: entierEnv(env.OPENAI_MAX_COMPLETION_TOKENS, MAX_COMPLETION_RAISONNEMENT) };
  }
  if ((tokens.rapide || 0) >= entierEnv(env.OPENAI_QUOTA_RAPIDE_MAX, PLAFOND_RAPIDE)) throw new ErreurAPI(429, "quota_journalier");
  if (demande && lourd) { // quota du modèle phare épuisé : le modèle rapide prend le relais en effort élevé
    return { modele: rapide, libelle: `${rapide} (raisonnement élevé · quota ${lourd} préservé)`, pool: "rapide", effort: "high", maxCompletion: entierEnv(env.OPENAI_MAX_COMPLETION_TOKENS, MAX_COMPLETION_RAISONNEMENT) };
  }
  return { modele: rapide, libelle: rapide, pool: "rapide", effort: "low", maxCompletion: entierEnv(env.OPENAI_MAX_COMPLETION_TOKENS_FAST, MAX_COMPLETION_RAPIDE) };
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
  return { modele: rapide, libelle: `${rapide} (raisonnement élevé · ${choix.modele} indisponible)`, pool: "rapide", effort: "high", maxCompletion: entierEnv(env.OPENAI_MAX_COMPLETION_TOKENS, MAX_COMPLETION_RAISONNEMENT) };
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
function compterTokens(usage, env, pool = "rapide") {
  if (!usage) return;
  roulement();
  suivi.tokens[pool] += (usage.prompt_tokens || 0) + (usage.completion_tokens || 0);
  const seuil = pool === "raisonnement" ? entierEnv(env.OPENAI_DAILY_TOKEN_ALERT_REASONING, ALERTE_RAISONNEMENT) : entierEnv(env.OPENAI_DAILY_TOKEN_ALERT, ALERTE_RAPIDE);
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

function origineOk(request, env) {
  const origine = request.headers.get("Origin");
  if (!origine) return true;
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
    return (await r.json()).success === true;
  } catch { return false; }
}

// Flux OpenAI → flux normalisé { modele } puis { delta } … puis { fin, modele, masques }
function fluxNormalise(amont, modele, masques, env, pool) {
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
    flush(controleur) {
      if (tampon) traiter(tampon, controleur);
      compterTokens(usage, env, pool);
      controleur.enqueue(evenement(termine ? { fin: true, modele, masques } : { fin: true, modele, masques, interrompu: true }));
    },
  })).getReader();
  // Coupure côté OpenAI en plein flux : on prévient le navigateur par un événement d'erreur au lieu d'un flux tronqué.
  return new ReadableStream({
    async pull(controleur) {
      try {
        const { done, value } = await lecteur.read();
        if (done) controleur.close(); else controleur.enqueue(value);
      } catch {
        compterTokens(usage, env, pool);
        controleur.enqueue(evenement({ erreur: "flux" }));
        controleur.close();
      }
    },
    cancel(raison) { return lecteur.cancel(raison); },
  });
}

async function chat(request, env) {
  if (!origineOk(request, env)) throw new ErreurAPI(403, "origine_refusee");
  if (!(request.headers.get("Content-Type") || "").toLowerCase().startsWith("application/json")) throw new ErreurAPI(415, "json_attendu");
  const brut = await request.text();
  if (!brut || brut.length > MAX_CORPS) throw new ErreurAPI(413, "trop_long");
  let payload; try { payload = JSON.parse(brut); } catch { throw new ErreurAPI(400, "requete_invalide"); }

  const cle = cleValide(env);
  if (!cle) throw new ErreurAPI(503, "no_key");
  if (!(await turnstileOk(request, env))) throw new ErreurAPI(403, "turnstile");
  const donnees = validerRequete(payload);
  if (limiteAtteinte()) throw new ErreurAPI(429, "trop_de_requetes");

  let choix = choisirModele(donnees, env, tokensDuJour());
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
    const repli = tentative === 1 ? choixRepli(choix, amont.status, env, tokensDuJour()) : null;
    if (!repli) throw new ErreurAPI(amont.status === 429 ? 429 : 502, `openai_${amont.status}`);
    console.warn(`Repli : ${repli.modele} en effort « ${repli.effort} » à la place de ${modele}.`);
    choix = repli;
  }
  if (!donnees.stream) {
    const data = await amont.json();
    compterTokens(data.usage, env, pool);
    return json(200, { reponse: data.choices?.[0]?.message?.content || "", modele: libelle, masques: donnees.masques }, { "X-Model-Used": modele });
  }
  return new Response(fluxNormalise(amont.body, libelle, donnees.masques, env, pool), {
    status: 200,
    headers: { ...ENTETES, "Content-Type": "text/event-stream; charset=utf-8", "X-Accel-Buffering": "no", "X-Model-Used": modele },
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (url.pathname === "/api/statut" && request.method === "GET") {
        if (!origineOk(request, env)) throw new ErreurAPI(403, "origine_refusee");
        return json(200, { actif: cleValide(env) !== null, modele: modeleChat(env) });
      }
      if (url.pathname === "/api/chat" && request.method === "POST") return await chat(request, env);
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
