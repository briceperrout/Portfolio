// Tests de la synchronisation chiffrée (sync.js + route /api/sync de worker.js) et du déploiement — `node test_sync.mjs` (Node ≥ 18).
// Aucun réseau : un faux KV en mémoire joue Cloudflare KV, et le Worker est appelé directement (fetch → worker.fetch).
import { readFileSync } from "node:fs";
import {
  ErreurSync, assainirInstantane, chiffrer, creerLien, dechiffrer, effacerDistant, enveloppeValide, estCleSynchronisable, extraireCode,
  extraireInstantane, formaterCode, fusionnerInstantanes, genererCode, identifiant, lireDistant, normaliserCode, synchroniser, appliquerInstantane,
} from "./sync.js";
import worker, { validerEnveloppeSync } from "./worker.js";

export const resultats = { ok: 0, echecs: [] };
const verifier = (condition, message) => { if (condition) resultats.ok++; else resultats.echecs.push(message); };
const egal = (a, b, message) => verifier(JSON.stringify(a) === JSON.stringify(b), `${message} — obtenu ${JSON.stringify(a)}, attendu ${JSON.stringify(b)}`);
const refuse = async (promesse, code, message) => {
  try { await promesse; verifier(false, `${message} : aucune erreur levée`); } catch (e) { verifier(e.code === code, `${message} : code « ${e.code ?? e.message} », attendu « ${code} »`); }
};

// ---------------------------------------------------------------- stockage et serveur simulés
class Stockage { // interface localStorage
  constructor(init = {}) { this.m = new Map(Object.entries(init).map(([k, v]) => [k, typeof v === "string" ? v : JSON.stringify(v)])); }
  get length() { return this.m.size; }
  key(i) { return [...this.m.keys()][i] ?? null; }
  getItem(k) { return this.m.has(k) ? this.m.get(k) : null; }
  setItem(k, v) { this.m.set(k, String(v)); }
}
const faireKV = () => {
  const m = new Map();
  return { m, get: async (k) => m.get(k) ?? null, put: async (k, v) => { m.set(k, v); }, delete: async (k) => { m.delete(k); } };
};
const env = { SYNC_KV: faireKV() };
// fetch du navigateur → Worker (même contrat que la production)
const vers = (e) => async (u, o = {}) => worker.fetch(new Request(`https://plan.test${u}`, o), e);
const options = { fetch: vers(env) };

// ---------------------------------------------------------------- code, lien, identifiant
const code = genererCode();
verifier(/^[0-9A-HJKMNP-TV-Z]{26}$/.test(code), `code de 26 caractères Crockford (${code})`);
verifier(new Set(Array.from({ length: 20 }, genererCode)).size === 20, "codes tous différents");
egal(normaliserCode(formaterCode(code).toLowerCase()), code, "saisie en minuscules avec tirets");
egal(normaliserCode(code.replace(/0/g, "o").replace(/1/g, "l")), code, "O→0, I/L→1");
egal(normaliserCode("trop-court"), null, "code trop court");
egal(normaliserCode(`${code.slice(0, 25)}U`), null, "caractère hors alphabet");
const lien = creerLien(code, "https://plan.test/index.html?x=1#mon-profil");
egal(lien, `https://plan.test/index.html?x=1#sync=${code}`, "lien : le code est dans le fragment");
egal(extraireCode(lien), code, "code extrait d'un lien complet");
egal(extraireCode(`#sync=${code}`), code, "code extrait d'un fragment");
egal(extraireCode(formaterCode(code)), code, "code saisi à la main");
egal(extraireCode("#mon-profil?p=abc"), null, "lien de partage de profil : pas un code");
egal(extraireCode("#sync=%E0%A4%A"), null, "fragment mal encodé");
const id = await identifiant(code);
verifier(/^[A-Za-z0-9_-]{43}$/.test(id), "identifiant de 43 caractères base64url");
verifier(!id.includes(code), "l'identifiant ne contient pas le code");
egal(await identifiant(code), id, "identifiant déterministe");
verifier((await identifiant(genererCode())) !== id, "codes différents → identifiants différents");

// ---------------------------------------------------------------- chiffrement
const secret = { nom: "Alice Martin", patrimoine: 123456 };
const env1 = await chiffrer(secret, code, "4321");
verifier(enveloppeValide(env1), "enveloppe valide");
verifier(!JSON.stringify(env1).includes("Alice") && !JSON.stringify(env1).includes("123456"), "l'enveloppe ne contient aucune donnée en clair");
egal(await dechiffrer(env1, code, "4321"), secret, "aller-retour chiffrement");
await refuse(dechiffrer(env1, code, "0000"), "code_ou_pin_incorrect", "mauvais PIN");
await refuse(dechiffrer(env1, code, ""), "code_ou_pin_incorrect", "PIN manquant");
await refuse(dechiffrer(env1, genererCode(), "4321"), "code_ou_pin_incorrect", "mauvais code");
await refuse(dechiffrer({ ...env1, ct: env1.ct.slice(0, -4) + (env1.ct.endsWith("AAAA") ? "BBBB" : "AAAA") }, code, "4321"), "code_ou_pin_incorrect", "données altérées (GCM)");
await refuse(dechiffrer({ ...env1, iter: 10 }, code, "4321"), "enveloppe_invalide", "itérations trop faibles refusées");
await refuse(dechiffrer({ ...env1, v: 2 }, code, "4321"), "enveloppe_invalide", "version inconnue");
await refuse(dechiffrer(null, code), "enveloppe_invalide", "enveloppe nulle");
const env2 = await chiffrer(secret, code, "4321", { sel: env1.sel, iterations: env1.iter });
verifier(env2.sel === env1.sel && env2.iv !== env1.iv && env2.ct !== env1.ct, "même sel réutilisé, vecteur d'initialisation toujours neuf");

// ---------------------------------------------------------------- instantané et fusion
verifier(estCleSynchronisable("local-profils") && estCleSynchronisable("local-situations") && estCleSynchronisable("scenarios:local-profils:p1"), "clés synchronisables");
verifier(!["profil-v2", "profil-v2-de", "theme", "discret", "sync-config", "chat-hist:exemple:exemple", "profil-courant"].some(estCleSynchronisable), "brouillon, thème, réglages d'appareil et config de sync exclus");
const A = new Stockage({
  "local-profils": { p1: { nom: "Alice", profil: { age: 30 }, suivi: { releves: [1] }, majLe: "2026-01-02T10:00:00Z" } },
  "scenarios:local-profils:p1": [{ nom: "s1" }],
  theme: "sombre", "sync-config": { code: "SECRET" }, "profil-v2": { age: 99 },
});
const inst = extraireInstantane(A, "2026-01-02T10:00:00Z");
egal(Object.keys(inst.donnees).sort(), ["local-profils", "scenarios:local-profils:p1"], "l'instantané ne contient que les clés autorisées");
verifier(!JSON.stringify(inst).includes("SECRET"), "la config de sync (code) ne part jamais");

const L = { format: 1, majLe: "2026-02-01", donnees: { "local-profils": { a: { nom: "A-local", majLe: "2026-02-01" }, b: { nom: "B-vieux", majLe: "2026-01-01" } }, "scenarios:x": [{ n: "local" }] } };
const D = { format: 1, majLe: "2026-01-15", donnees: { "local-profils": { b: { nom: "B-récent", majLe: "2026-01-10" }, c: { nom: "C-distant", majLe: "2026-01-05" } }, "scenarios:x": [{ n: "distant" }], "scenarios:y": [{ n: "y" }] } };
const F = fusionnerInstantanes(L, D);
egal(Object.keys(F.instantane.donnees["local-profils"]).sort(), ["a", "b", "c"], "union des fiches");
egal(F.instantane.donnees["local-profils"].b.nom, "B-récent", "la fiche la plus récente l'emporte");
egal(F.instantane.donnees["local-profils"].b.majLe, "2026-01-10", "…même quand l'autre appareil a un instantané plus récent");
egal(F.instantane.donnees["scenarios:x"], [{ n: "local" }], "scénarios : l'instantané le plus récent l'emporte");
egal(F.instantane.donnees["scenarios:y"], [{ n: "y" }], "scénarios présents d'un seul côté conservés");
verifier(F.changeLocal && F.changeDistant, "changements détectés des deux côtés");
const F2 = fusionnerInstantanes(F.instantane, F.instantane);
verifier(!F2.changeLocal && !F2.changeDistant, "fusion idempotente : aucun changement");
const hostile = assainirInstantane(JSON.parse('{"format":1,"majLe":"x","donnees":{"local-profils":{"__proto__":{"nom":"x"},"constructor":{"a":1},"ok":{"nom":"ok"},"liste":[1],"nul":null},"theme":{"a":1},"scenarios:z":{"pas":"un tableau"},"local-situations":[1]}}'));
egal(Object.keys(hostile.donnees), ["local-profils"], "clés non autorisées et types incorrects écartés");
egal(Object.keys(hostile.donnees["local-profils"]), ["ok"], "ids dangereux (__proto__, constructor) et fiches invalides écartés");
verifier(({}).nom === undefined, "aucune pollution de prototype");
try { assainirInstantane({ format: 9, donnees: {} }); verifier(false, "format inconnu refusé"); } catch (e) { verifier(e.code === "instantane_invalide", "format inconnu refusé"); }
const S = new Stockage();
egal(appliquerInstantane(S, F.instantane).sort(), ["local-profils", "scenarios:x", "scenarios:y"], "application : clés modifiées");
egal(appliquerInstantane(S, F.instantane), [], "application idempotente");

// ---------------------------------------------------------------- deux appareils via le Worker
const appareilA = new Stockage({ "local-profils": { p1: { nom: "Alice Martin", profil: { age: 30, salaireNetMensuel: 3200 }, suivi: { releves: [{ date: "2026-01", total: 51000 }] }, majLe: "2026-03-01T08:00:00Z" } } });
const appareilB = new Stockage({ theme: "sombre" });
const cfgA = { code, pin: "2468", modifieLe: "2026-03-01T08:00:00Z" };
const r1 = await synchroniser(cfgA, appareilA, options);
verifier(r1.publie && r1.rev === 1 && !r1.changeLocal, "A : première synchronisation (publie, rév. 1)");
const brut = [...env.SYNC_KV.m.entries()];
egal(brut.length, 1, "un seul blob dans KV");
verifier(brut[0][0] === `sync:${id}`, "KV : clé = hash du code");
verifier(!brut[0][1].includes("Alice") && !brut[0][1].includes("3200") && !brut[0][1].includes(code), "KV : aucune donnée ni code en clair");
egal(Object.keys(JSON.parse(brut[0][1])).sort(), ["ct", "iter", "iv", "kdf", "rev", "sel", "v"], "KV : seuls les champs de l'enveloppe");

await refuse(synchroniser({ code: genererCode(), pin: "", modifieLe: "" }, appareilB, { ...options, sansCreation: true }), "introuvable", "rejoindre un code inconnu (sans création)");
await refuse(synchroniser({ code, pin: "0000", modifieLe: "" }, appareilB, { ...options, sansCreation: true }), "code_ou_pin_incorrect", "B : mauvais PIN");
verifier(appareilB.getItem("local-profils") === null, "B : rien écrit après un échec");
const r2 = await synchroniser({ code, pin: "2468", modifieLe: "" }, appareilB, { ...options, sansCreation: true });
verifier(r2.changeLocal && !r2.publie && r2.rev === 1, "B : rejoint le groupe et reçoit les données");
egal(JSON.parse(appareilB.getItem("local-profils")).p1.nom, "Alice Martin", "B : profil reçu");
egal(appareilB.getItem("theme"), "sombre", "B : réglages locaux intacts");

const pb = JSON.parse(appareilB.getItem("local-profils"));
pb.p1.profil.salaireNetMensuel = 3500; pb.p1.majLe = "2026-03-02T09:00:00Z";
pb.p2 = { nom: "Proche", profil: { age: 25 }, majLe: "2026-03-02T09:05:00Z" };
appareilB.setItem("local-profils", JSON.stringify(pb));
const r3 = await synchroniser({ code, pin: "2468", modifieLe: "2026-03-02T09:05:00Z" }, appareilB, options);
verifier(r3.publie && r3.rev === 2, "B : publie sa modification (rév. 2)");
const r4 = await synchroniser(cfgA, appareilA, options);
verifier(r4.changeLocal && !r4.publie && r4.rev === 2, "A : reçoit la modification de B");
egal(JSON.parse(appareilA.getItem("local-profils")).p1.profil.salaireNetMensuel, 3500, "A : valeur la plus récente");
verifier(!!JSON.parse(appareilA.getItem("local-profils")).p2, "A : nouveau profil reçu");
const r5 = await synchroniser(cfgA, appareilA, options);
verifier(!r5.publie && !r5.changeLocal && r5.rev === 2, "synchronisation sans changement : aucune écriture");

// Conflit : un autre appareil écrit entre la lecture et l'écriture de A → relecture, fusion, nouvel essai
{
  const pa = JSON.parse(appareilA.getItem("local-profils")); pa.p3 = { nom: "Local A", majLe: "2026-03-03T10:00:00Z" };
  appareilA.setItem("local-profils", JSON.stringify(pa));
  let injecte = false;
  const fetchConflit = async (u, o = {}) => {
    if (o.method === "PUT" && !injecte) {
      injecte = true;
      const pb2 = JSON.parse(appareilB.getItem("local-profils")); pb2.p4 = { nom: "Local B", majLe: "2026-03-03T10:01:00Z" };
      appareilB.setItem("local-profils", JSON.stringify(pb2));
      await synchroniser({ code, pin: "2468", modifieLe: "2026-03-03T10:01:00Z" }, appareilB, options); // B passe devant (rév. 3)
    }
    return vers(env)(u, o);
  };
  const r6 = await synchroniser({ ...cfgA, modifieLe: "2026-03-03T10:00:00Z" }, appareilA, { fetch: fetchConflit });
  verifier(r6.publie && r6.rev === 4 && injecte, `conflit résolu par relecture et fusion (rév. ${r6.rev})`);
  const noms = Object.values(JSON.parse(appareilA.getItem("local-profils"))).map((d) => d.nom).sort();
  egal(noms, ["Alice Martin", "Local A", "Local B", "Proche"], "aucune fiche perdue après conflit");
}

// Effacement
await effacerDistant(code, options);
egal(await lireDistant(code, options), null, "données effacées du serveur");
await effacerDistant(code, options); // idempotent
verifier(true, "effacement idempotent");

// ---------------------------------------------------------------- validation côté Worker
const pour = (e) => (u, o) => worker.fetch(new Request(`https://plan.test${u}`, o), e);
const ID = await identifiant(genererCode());
const bonne = { ...(await chiffrer({ x: 1 }, code)), rev: 1, base: 0 };
const put = (corps, e = env, extra = {}) => pour(e)(`/api/sync/${ID}`, { method: "PUT", headers: { "Content-Type": "application/json", ...extra }, body: typeof corps === "string" ? corps : JSON.stringify(corps) });
egal((await put(bonne)).status, 200, "PUT valide");
egal((await put(bonne)).status, 409, "PUT rejoué : conflit (base obsolète)");
const corpsConflit = await (await put(bonne)).json();
egal(corpsConflit, { erreur: "conflit", rev: 1 }, "409 indique la révision courante");
egal((await put({ ...bonne, rev: 5, base: 4 })).status, 409, "PUT avec base fausse refusé");
egal((await put({ ...bonne, rev: 2, base: 0 })).status, 400, "rev ≠ base + 1 refusé");
egal((await put({ ...bonne, kdf: "MD5", rev: 2, base: 1 })).status, 400, "KDF inconnu refusé");
egal((await put({ ...bonne, iter: 5, rev: 2, base: 1 })).status, 400, "itérations trop faibles refusées");
egal((await put({ ...bonne, ct: "pas du base64!", rev: 2, base: 1 })).status, 400, "ciphertext non base64url refusé");
egal((await put("{pas du json")).status, 400, "JSON invalide refusé");
egal((await put({ ...bonne, rev: 2, base: 1, ct: "A".repeat(300 * 1024) })).status, 413, "enveloppe trop grosse refusée (413)");
egal((await put({ ...bonne, rev: 2, base: 1, secret: "x".repeat(100) })).status, 200, "champs inconnus ignorés");
verifier(!(await env.SYNC_KV.get(`sync:${ID}`)).includes("secret"), "champs inconnus non stockés");
const lu = await pour(env)(`/api/sync/${ID}`);
egal(lu.status, 200, "GET");
verifier(lu.headers.get("Cache-Control") === "no-store" && lu.headers.get("X-Content-Type-Options") === "nosniff", "GET : en-têtes no-store / nosniff");
egal((await pour(env)(`/api/sync/${await identifiant(genererCode())}`)).status, 404, "GET inconnu : 404");
egal((await pour(env)("/api/sync/trop-court")).status, 400, "identifiant invalide : 400");
egal((await pour(env)("/api/sync/..%2F..%2Fetc%2Fpasswd")).status, 400, "traversée de chemin encodée : 400");
egal((await pour(env)(`/api/sync/${ID}`, { method: "POST", body: "{}" })).status, 405, "POST refusé (405)");
egal((await pour(env)(`/api/sync/${ID}`, { headers: { Origin: "https://pirate.test" } })).status, 403, "autre origine refusée");
egal((await pour({})(`/api/sync/${ID}`)).status, 503, "sans liaison KV : 503 sync_indisponible");
egal((await pour(env)(`/api/sync/${ID}`, { method: "DELETE" })).status, 200, "DELETE");
egal((await pour(env)(`/api/sync/${ID}`)).status, 404, "GET après DELETE : 404");
egal((await put(bonne, { ...env, TURNSTILE_SECRET_KEY: "x" })).status, 403, "Turnstile actif : écriture refusée sans jeton");
try { validerEnveloppeSync(null); verifier(false, "enveloppe nulle refusée"); } catch (e) { verifier(e.statut === 400, "enveloppe nulle refusée"); }
// limite de débit
{
  const e2 = { SYNC_KV: faireKV() };
  let dernier = 0;
  for (let i = 0; i < 70; i++) dernier = (await pour(e2)(`/api/sync/${ID}`)).status;
  egal(dernier, 429, "limite de débit : 429 au-delà de 60 requêtes/minute");
}

// ---------------------------------------------------------------- déploiement et non-régression
const lireFichier = (f) => readFileSync(new URL(f, import.meta.url), "utf8");
const ignore = lireFichier(".assetsignore").split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
for (const sensible of [".env", ".env.*", ".dev.vars", ".quota-tokens.json", ".sync_local", "worker.js", "serveur.py", "wrangler.toml", ".git", "CLAUDE.md", "Prompt", "test_*.mjs", "test_*.py"]) {
  verifier(ignore.includes(sensible), `.assetsignore exclut « ${sensible} »`);
}
const gitignore = lireFichier(".gitignore");
verifier(gitignore.includes(".sync_local/"), ".gitignore : .sync_local/");
const headers = lireFichier("_headers");
const csp = /Content-Security-Policy: (.+)/.exec(headers)?.[1] ?? "";
verifier(csp.includes("default-src 'self'") && csp.includes("script-src 'self'") && !csp.includes("unsafe-eval") && !/script-src[^;]*unsafe-inline/.test(csp), "CSP : scripts locaux uniquement");
verifier(/style-src[^;]*https:\/\/fonts\.googleapis\.com/.test(csp) && /font-src[^;]*https:\/\/fonts\.gstatic\.com/.test(csp), "CSP : Google Fonts autorisé (style-src + font-src)");
verifier(/connect-src 'self'(;|$)/.test(csp) && csp.includes("object-src 'none'") && csp.includes("frame-ancestors 'none'"), "CSP : connect-src 'self', pas d'objet ni de cadre");
const html = lireFichier("index.html");
const scripts = [...html.matchAll(/<script\b[^>]*>/g)].map((m) => m[0]);
verifier(scripts.length > 0 && scripts.every((s) => /\bsrc="[^"h][^"]*"/.test(s)), "index.html : aucun script inline ni tiers");
const hotes = new Set([...html.matchAll(/(?:href|src)="(https?:\/\/[^"/]+)/g)].map((m) => m[1]));
verifier([...hotes].every((h) => ["https://fonts.googleapis.com", "https://fonts.gstatic.com"].includes(h)), `index.html : seules les polices Google sont chargées à l'extérieur (${[...hotes].join(", ")})`);
const sw = lireFichier("service-worker.js");
const shell = sw.match(/const SHELL = \[([\s\S]*?)\];/)[1];
const importes = [...lireFichier("app.js").matchAll(/from "\.\/([\w-]+\.js)"/g)].map((m) => m[1]);
verifier(importes.includes("sync.js") && importes.every((f) => shell.includes(`"${f}"`)), `service worker : tous les modules importés par app.js sont pré-cachés (${importes.filter((f) => !shell.includes(`"${f}"`)).join(", ") || "ok"})`);
verifier(/CACHE_VERSION = "plan-patrimoine-v(\d+)"/.test(sw) && Number(sw.match(/-v(\d+)"/)[1]) >= 8, "service worker : CACHE_VERSION incrémentée");
const wr = lireFichier("wrangler.toml");
verifier(/main = "worker\.js"/.test(wr) && /run_worker_first = \["\/api\/\*"\]/.test(wr), "wrangler.toml : Worker + assets, /api/* d'abord");
verifier(!/sk-[A-Za-z0-9]{20,}/.test(wr + lireFichier("worker.js") + lireFichier("sync.js")), "aucune clé OpenAI dans les fichiers déployés");

export function terminer() {
  console.log(resultats.echecs.length ? `ÉCHECS (${resultats.echecs.length}) :\n- ${resultats.echecs.join("\n- ")}\n${resultats.ok} vérifications réussies.` : `OK : ${resultats.ok} vérifications réussies.`);
  return resultats;
}
if (typeof process !== "undefined" && process.argv?.[1]?.endsWith("test_sync.mjs")) { terminer(); if (resultats.echecs.length) process.exitCode = 1; }
