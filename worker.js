// =====================================================================
//  worker.js — relais sécurisé vers OpenAI pour la production (Cloudflare).
//  Équivalent de serveur.py : mêmes routes, mêmes règles d'anonymisation.
//
//    GET  /api/statut  → { actif, modele }
//    POST /api/chat    → flux SSE normalisé { delta } … { fin, modele, masques } si le client envoie stream: true
//                        (sinon JSON { reponse, modele, masques } ; erreur en cours de flux : { erreur })
//
//  Secrets (jamais dans le code, jamais côté navigateur) :
//    wrangler secret put OPENAI_API_KEY
//    wrangler secret put TURNSTILE_SECRET_KEY      (optionnel : active la vérification Turnstile)
//  Variables (wrangler.toml → [vars]) :
//    OPENAI_MODEL_CHAT        défaut « gpt-4.1-mini »
//    OPENAI_MODEL_REASONING   défaut « o4-mini »
//    OPENAI_ENABLE_REASONING  « 1 » pour autoriser le modèle de raisonnement
//    OPENAI_DAILY_TOKEN_ALERT défaut 2200000
//    ALLOWED_ORIGIN           ex. https://plan-patrimoine.pages.dev (sinon : même origine seulement)
//  Liaison (optionnelle) : ASSETS (Pages) pour servir aussi les fichiers statiques.
//
//  Limites assumées : un Worker n'a pas de mémoire partagée entre isolats. Le compteur
//  de tokens et la limite de débit ci-dessous sont donc « au mieux » (par isolat) ;
//  pour un plafond strict, ajouter une règle de rate limiting Cloudflare ou un KV.
// =====================================================================

const URL_OPENAI = "https://api.openai.com/v1/chat/completions";
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
  return { systeme, profil, messages: propres, raisonnement: p.raisonnement === true, stream: p.stream === true, masques };
}

// ---------------------------------------------------------------- OpenAI
const modeleChat = (env) => (env.OPENAI_MODEL_CHAT || "").trim() || "gpt-4.1-mini";
const modeleRaisonnement = (env) => (env.OPENAI_ENABLE_REASONING === "1" ? (env.OPENAI_MODEL_REASONING || "").trim() || "o4-mini" : null);
// o3/o4… et gpt-5… : max_completion_tokens, pas de temperature, rôle « developer »
const estRaisonnement = (m) => /^(o\d|gpt-5)/.test(m);
const cleValide = (env) => (/^sk-[A-Za-z0-9_-]{20,}$/.test((env.OPENAI_API_KEY || "").trim()) ? env.OPENAI_API_KEY.trim() : null);

function corpsOpenAI(d, env) {
  const modele = (d.raisonnement ? modeleRaisonnement(env) : null) || modeleChat(env);
  const raisonne = estRaisonnement(modele);
  let consigne = d.systeme;
  if (d.profil) consigne += "\n\nPROFIL DE L'UTILISATEUR (anonymisé) :\n" + d.profil;
  const corps = {
    model: modele,
    messages: [{ role: raisonne ? "developer" : "system", content: consigne }, ...d.messages],
    stream: d.stream,
  };
  if (raisonne) corps.max_completion_tokens = parseInt(env.OPENAI_MAX_COMPLETION_TOKENS, 10) || 2500;
  else { corps.temperature = 0.2; corps.max_tokens = 800; } // marge pour les balises [[ACTION:…]] et [[SUGGESTION:…]]
  if (d.stream) corps.stream_options = { include_usage: true };
  return [corps, modele];
}

// ---------------------------------------------------------------- quota et débit (par isolat)
const suivi = { jour: "", tokens: 0, alerte: false, recentes: [] };
function compterTokens(usage, env) {
  if (!usage) return;
  const jour = new Date().toISOString().slice(0, 10);
  if (suivi.jour !== jour) Object.assign(suivi, { jour, tokens: 0, alerte: false });
  suivi.tokens += (usage.prompt_tokens || 0) + (usage.completion_tokens || 0);
  const seuil = parseInt(env.OPENAI_DAILY_TOKEN_ALERT, 10) || 2200000;
  if (suivi.tokens >= seuil && !suivi.alerte) {
    suivi.alerte = true;
    console.warn(`ALERTE QUOTA : ${suivi.tokens} tokens aujourd'hui sur cet isolat (seuil ${seuil}).`);
  }
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
const json = (statut, objet) => new Response(JSON.stringify(objet), { status: statut, headers: { ...ENTETES, "Content-Type": "application/json; charset=utf-8" } });

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

// Flux OpenAI → flux normalisé { delta } / { fin, modele, masques }
function fluxNormalise(amont, modele, masques, env) {
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
    transform(morceau, controleur) {
      tampon += dec.decode(morceau, { stream: true });
      const lignes = tampon.split("\n");
      tampon = lignes.pop();
      for (const l of lignes) traiter(l, controleur);
    },
    flush(controleur) {
      if (tampon) traiter(tampon, controleur);
      compterTokens(usage, env);
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
        compterTokens(usage, env);
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

  const [corps, modele] = corpsOpenAI(donnees, env);
  let amont;
  try {
    amont = await fetch(URL_OPENAI, {
      method: "POST",
      headers: { Authorization: `Bearer ${cle}`, "Content-Type": "application/json" },
      body: JSON.stringify(corps),
    });
  } catch { throw new ErreurAPI(504, "reseau"); }
  if (!amont.ok) {
    console.warn(`OpenAI a répondu ${amont.status}`);
    throw new ErreurAPI(amont.status === 429 ? 429 : 502, `openai_${amont.status}`);
  }
  if (!donnees.stream) {
    const data = await amont.json();
    compterTokens(data.usage, env);
    return json(200, { reponse: data.choices?.[0]?.message?.content || "", modele, masques: donnees.masques });
  }
  return new Response(fluxNormalise(amont.body, modele, donnees.masques, env), {
    status: 200,
    headers: { ...ENTETES, "Content-Type": "text/event-stream; charset=utf-8", "X-Accel-Buffering": "no" },
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
