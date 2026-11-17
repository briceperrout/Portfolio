// =====================================================================
//  sync.js — synchronisation multi-appareils chiffrée de bout en bout.
//
//  Principe (Privacy-by-Design) : le navigateur chiffre ses données AVANT l'envoi ; le serveur
//  (worker.js / serveur.py) ne stocke qu'un blob opaque, qu'il ne peut pas lire.
//
//    code de synchronisation  : 130 bits aléatoires (Crockford base 32, 26 caractères), jamais envoyé tel quel
//    identifiant serveur      : SHA-256("plan-patrimoine/sync/id/v1:" + code) → 43 caractères base64url
//    clé de chiffrement       : PBKDF2-SHA-256 (600 000 itérations, sel aléatoire) sur « code:PIN » → AES-GCM 256 bits
//    lien                     : https://…/#sync=<code> (le fragment n'est jamais transmis au serveur)
//
//  Ce module ne touche pas au DOM : il reçoit un « stockage » (interface localStorage) et un `fetch`,
//  ce qui le rend testable sous Node (test_sync.mjs). Aucune dépendance, aucune bibliothèque tierce.
// =====================================================================

export const FORMAT = 1;
export const ITERATIONS = 600000;
export const LONGUEUR_CODE = 26;
const KDF = "PBKDF2-SHA256";
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"; // Crockford : sans I, L, O, U
const ENC = new TextEncoder();
const DEC = new TextDecoder();
const AAD = ENC.encode("plan-patrimoine/sync/v1");

export class ErreurSync extends Error {
  constructor(code, statut = 0, extra = {}) { super(code); this.code = code; this.statut = statut; Object.assign(this, extra); }
}

// ---------------------------------------------------------------- encodage
const versB64 = (octets) => {
  let s = "";
  for (const o of octets) s += String.fromCharCode(o);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const depuisB64 = (t) => {
  const s = atob(String(t).replace(/-/g, "+").replace(/_/g, "/"));
  const o = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) o[i] = s.charCodeAt(i);
  return o;
};
const RE_B64 = /^[A-Za-z0-9_-]+$/;

// ---------------------------------------------------------------- code et lien
/** Nouveau code de synchronisation : 26 caractères Crockford (130 bits, tirage uniforme car 256 est multiple de 32). */
export function genererCode() {
  const o = crypto.getRandomValues(new Uint8Array(LONGUEUR_CODE));
  return Array.from(o, (x) => ALPHABET[x & 31]).join("");
}

/** Normalise une saisie (minuscules, tirets, espaces, O→0, I/L→1) ; null si ce n'est pas un code valide. */
export function normaliserCode(texte) {
  const c = String(texte ?? "").toUpperCase().replace(/[^0-9A-Z]/g, "").replace(/O/g, "0").replace(/[IL]/g, "1");
  return c.length === LONGUEUR_CODE && [...c].every((x) => ALPHABET.includes(x)) ? c : null;
}

/** Code affiché par groupes de 4 : « ABCD-EFGH-… ». */
export const formaterCode = (code) => String(code).match(/.{1,4}/g)?.join("-") ?? "";

/** Lien de synchronisation copiable : le code est dans le fragment, que le navigateur n'envoie jamais au serveur. */
export const creerLien = (code, base) => `${String(base).split("#")[0]}#sync=${code}`;

/** Extrait un code d'un lien complet, d'un fragment « #sync=… » ou d'un code saisi à la main ; null si invalide. */
export function extraireCode(texte) {
  const m = /[#?&]sync=([^&\s]+)/i.exec(String(texte ?? ""));
  let brut = m ? m[1] : texte;
  if (m) { try { brut = decodeURIComponent(brut); } catch { return null; } }
  return normaliserCode(brut);
}

/** Identifiant opaque côté serveur : ne permet pas de remonter au code (SHA-256 à sens unique). */
export async function identifiant(code) {
  const h = await crypto.subtle.digest("SHA-256", ENC.encode(`plan-patrimoine/sync/id/v1:${code}`));
  return versB64(new Uint8Array(h));
}

// ---------------------------------------------------------------- chiffrement
const cles = new Map(); // dérivation PBKDF2 coûteuse (~0,3 s) : clés gardées en mémoire pour la session seulement
export const oublierCles = () => cles.clear();

async function cleAES(code, pin, sel, iterations) {
  const ref = `${iterations}|${versB64(sel)}|${code}|${pin}`;
  if (cles.has(ref)) return cles.get(ref);
  const base = await crypto.subtle.importKey("raw", ENC.encode(`${code}:${pin}`), "PBKDF2", false, ["deriveKey"]);
  const cle = await crypto.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt: sel, iterations }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  cles.set(ref, cle);
  return cle;
}

/**
 * Chiffre un objet JSON. `sel` et `iterations` peuvent être repris d'une enveloppe existante : la même clé
 * sert alors à tous les appareils du groupe (le vecteur d'initialisation, lui, est toujours neuf).
 * Retourne l'enveloppe { v, kdf, iter, sel, iv, ct } — seule chose que le serveur voit.
 */
export async function chiffrer(valeur, code, pin = "", { sel, iterations = ITERATIONS } = {}) {
  const selOctets = sel ? depuisB64(sel) : crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cle = await cleAES(code, pin, selOctets, iterations);
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: AAD }, cle, ENC.encode(JSON.stringify(valeur)));
  return { v: FORMAT, kdf: KDF, iter: iterations, sel: versB64(selOctets), iv: versB64(iv), ct: versB64(new Uint8Array(ct)) };
}

/** Vérifie la forme d'une enveloppe (reçue du serveur, donc non fiable) avant tout déchiffrement. */
export function enveloppeValide(e) {
  return !!e && typeof e === "object" && e.v === FORMAT && e.kdf === KDF
    && Number.isInteger(e.iter) && e.iter >= 100000 && e.iter <= 1000000
    && ["sel", "iv", "ct"].every((k) => typeof e[k] === "string" && RE_B64.test(e[k]) && e[k].length <= 400000)
    && e.sel.length >= 16 && e.sel.length <= 64 && e.iv.length === 16 && e.ct.length >= 22;
}

export async function dechiffrer(enveloppe, code, pin = "") {
  if (!enveloppeValide(enveloppe)) throw new ErreurSync("enveloppe_invalide");
  try {
    const cle = await cleAES(code, pin, depuisB64(enveloppe.sel), enveloppe.iter);
    const clair = await crypto.subtle.decrypt({ name: "AES-GCM", iv: depuisB64(enveloppe.iv), additionalData: AAD }, cle, depuisB64(enveloppe.ct));
    return JSON.parse(DEC.decode(clair));
  } catch (e) {
    if (e instanceof ErreurSync) throw e;
    throw new ErreurSync("code_ou_pin_incorrect"); // l'authentification GCM échoue : mauvais PIN ou données altérées
  }
}

// ---------------------------------------------------------------- instantané des données locales
/** Seules ces clés partent sur le serveur : profils et situations enregistrés (relevés de suivi inclus) et scénarios. Jamais le thème, le brouillon, ni les réglages d'un appareil. */
export const estCleSynchronisable = (k) => k === "local-profils" || k === "local-situations" || /^scenarios:/.test(k);

const lireJSON = (stockage, k) => { try { return JSON.parse(stockage.getItem(k)); } catch { return null; } };
const IDS_INTERDITS = new Set(["__proto__", "constructor", "prototype"]);

/** Instantané { format, majLe, donnees: { clé: valeur } } des clés synchronisables d'un stockage de type localStorage. */
export function extraireInstantane(stockage, majLe = "") {
  const donnees = {};
  for (let i = 0; i < stockage.length; i++) {
    const k = stockage.key(i);
    if (!estCleSynchronisable(k)) continue;
    const v = lireJSON(stockage, k);
    if (v !== null && typeof v === "object") donnees[k] = v;
  }
  return { format: FORMAT, majLe, donnees };
}

/** Instantané reçu (non fiable) → instantané propre : clés autorisées seulement, types vérifiés, ids dangereux écartés. */
export function assainirInstantane(inst) {
  if (!inst || typeof inst !== "object" || inst.format !== FORMAT || !inst.donnees || typeof inst.donnees !== "object") throw new ErreurSync("instantane_invalide");
  const donnees = {};
  for (const [k, v] of Object.entries(inst.donnees)) {
    if (!estCleSynchronisable(k) || v === null || typeof v !== "object") continue;
    if (k.startsWith("local-")) {
      if (Array.isArray(v)) continue;
      donnees[k] = Object.fromEntries(Object.entries(v).filter(([id, d]) => !IDS_INTERDITS.has(id) && d && typeof d === "object" && !Array.isArray(d)));
    } else if (Array.isArray(v)) donnees[k] = v;
  }
  return { format: FORMAT, majLe: typeof inst.majLe === "string" ? inst.majLe : "", donnees };
}

const stable = (x) => JSON.stringify(x, (_, v) => (v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : v));

/**
 * Fusion de deux instantanés (aucune donnée n'est perdue, sauf conflit sur une même fiche) :
 *  - profils / situations : union par identifiant ; sur une même fiche, la plus récente (`majLe`) l'emporte ;
 *  - scénarios (listes sans date) : l'instantané le plus récent l'emporte, l'autre côté sert de repli.
 * Limite assumée : une suppression n'est pas propagée (la fiche supprimée sur un appareil revient depuis l'autre).
 */
export function fusionnerInstantanes(local, distant) {
  const L = assainirInstantane(local), D = assainirInstantane(distant);
  const donnees = {};
  for (const k of new Set([...Object.keys(L.donnees), ...Object.keys(D.donnees)])) {
    const a = L.donnees[k], b = D.donnees[k];
    if (a === undefined || b === undefined) { donnees[k] = a ?? b; continue; }
    if (k.startsWith("local-")) {
      const r = {};
      for (const id of new Set([...Object.keys(a), ...Object.keys(b)])) {
        const x = a[id], y = b[id];
        r[id] = x === undefined ? y : y === undefined ? x : String(y.majLe ?? "") > String(x.majLe ?? "") ? y : x;
      }
      donnees[k] = r;
    } else donnees[k] = D.majLe > L.majLe ? b : a;
  }
  const instantane = { format: FORMAT, majLe: D.majLe > L.majLe ? D.majLe : L.majLe, donnees };
  return {
    instantane,
    changeLocal: stable(instantane.donnees) !== stable(L.donnees),
    changeDistant: stable(instantane.donnees) !== stable(D.donnees),
  };
}

/** Écrit dans le stockage les clés de l'instantané ; retourne la liste des clés réellement modifiées. */
export function appliquerInstantane(stockage, inst) {
  const modifiees = [];
  for (const [k, v] of Object.entries(assainirInstantane(inst).donnees)) {
    if (stable(lireJSON(stockage, k)) === stable(v)) continue;
    stockage.setItem(k, JSON.stringify(v));
    modifiees.push(k);
  }
  return modifiees;
}

// ---------------------------------------------------------------- réseau
const url = (id, base = "") => `${base}/api/sync/${id}`;
async function appel(fetchFn, id, base, options = {}) {
  let r;
  try { r = await fetchFn(url(id, base), { cache: "no-store", ...options }); }
  catch { throw new ErreurSync("reseau"); }
  return r;
}
const erreurHTTP = async (r) => {
  let corps = {};
  try { corps = await r.json(); } catch { /* corps vide */ }
  return new ErreurSync(corps.erreur ?? `http_${r.status}`, r.status, { revDistante: corps.rev });
};

/** Enveloppe distante, ou null si ce code n'existe pas encore sur le serveur. */
export async function lireDistant(code, { fetch: f = globalThis.fetch, base = "" } = {}) {
  const r = await appel(f, await identifiant(code), base);
  if (r.status === 404) return null;
  if (!r.ok) throw await erreurHTTP(r);
  return r.json();
}

/** Dépose l'enveloppe (révision attendue : `rev - 1`) ; 409 « conflit » si un autre appareil a écrit entre-temps. */
export async function ecrireDistant(code, enveloppe, { fetch: f = globalThis.fetch, base = "", jetonTurnstile } = {}) {
  const corps = { ...enveloppe, base: enveloppe.rev - 1 };
  const r = await appel(f, await identifiant(code), base, { method: "PUT", headers: { "Content-Type": "application/json", ...(jetonTurnstile ? { "X-Turnstile-Token": jetonTurnstile } : {}) }, body: JSON.stringify(corps) });
  if (!r.ok) throw await erreurHTTP(r);
  return r.json();
}

/** Supprime définitivement les données chiffrées de ce code sur le serveur. */
export async function effacerDistant(code, { fetch: f = globalThis.fetch, base = "" } = {}) {
  const r = await appel(f, await identifiant(code), base, { method: "DELETE" });
  if (!r.ok && r.status !== 404) throw await erreurHTTP(r);
}

/**
 * Un cycle complet : lire le distant, fusionner avec le local, appliquer en local, republier si besoin.
 * `config` : { code, pin, modifieLe } — modifieLe = date de la dernière modification locale (départage les scénarios).
 * `options` : { fetch, base, sansCreation } — sansCreation (rejoindre) lève « introuvable » plutôt que de créer le groupe.
 * Retourne { rev, changeLocal, publie, cles, majLe } ; lève ErreurSync (reseau, code_ou_pin_incorrect, conflit, taille_excessive…).
 */
export async function synchroniser({ code, pin = "", modifieLe = "" }, stockage, options = {}) {
  for (let tentative = 0; tentative < 3; tentative++) {
    const env = await lireDistant(code, options);
    const local = extraireInstantane(stockage, modifieLe);
    let fusion, revDistante = 0, sel, iterations;
    if (env) {
      const distant = await dechiffrer(env, code, pin);
      fusion = fusionnerInstantanes(local, distant);
      revDistante = Number.isInteger(env.rev) ? env.rev : 0;
      sel = env.sel; iterations = env.iter;
    } else if (options.sansCreation) throw new ErreurSync("introuvable", 404); // rejoindre un groupe : jamais de création implicite
    else fusion = { instantane: local, changeLocal: false, changeDistant: Object.keys(local.donnees).length > 0 };
    const cles = fusion.changeLocal ? appliquerInstantane(stockage, fusion.instantane) : [];
    if (!fusion.changeDistant) return { rev: revDistante, changeLocal: cles.length > 0, publie: false, cles, majLe: fusion.instantane.majLe };
    const nouvelle = { ...(await chiffrer(fusion.instantane, code, pin, { sel, iterations })), rev: revDistante + 1 };
    try {
      await ecrireDistant(code, nouvelle, options);
      return { rev: nouvelle.rev, changeLocal: cles.length > 0, publie: true, cles, majLe: fusion.instantane.majLe };
    } catch (e) {
      if (e.code !== "conflit") throw e; // un autre appareil a écrit entre la lecture et l'écriture : on relit et on fusionne
    }
  }
  throw new ErreurSync("conflit", 409);
}
