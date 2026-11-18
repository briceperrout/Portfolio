/* Plan Patrimoine : service worker (PWA, 100 % hors-ligne pour les simulateurs).
 *
 * Stratégies :
 *  - /api/*              → réseau uniquement (jamais intercepté : le flux SSE de l'assistant et les quotas restent intacts)
 *  - dvf/*.json          → cache d'abord, rempli à la demande (index des communes, puis un fichier par département consulté ; hors pré-cache)
 *  - reste du site local → Stale-While-Revalidate (réponse instantanée depuis le cache, mise à jour silencieuse en arrière-plan)
 *  - navigation          → idem sur index.html, avec repli sur la copie en cache quand le réseau est coupé
 *
 * À CHAQUE DÉPLOIEMENT qui modifie un fichier du shell (ou des données dvf/), lancer « node outils/empreinte-shell.mjs » : il réécrit
 * CACHE_VERSION et CACHE_DONNEES à partir d'une empreinte SHA-256 des fichiers (« --verifier » échoue en CI si elle est périmée).
 * L'ancien cache est alors purgé à l'activation (le SWR garde les modules cohérents d'une visite à l'autre, mais une visite
 * peut mélanger anciennes et nouvelles versions). Les données DVF ont leur propre empreinte : elles ne sont pas re-téléchargées à chaque déploiement de code.
 */
const CACHE_VERSION = "plan-patrimoine-6277f5a78e1a";
const CACHE_SHELL = CACHE_VERSION;
const CACHE_DONNEES = "plan-patrimoine-dvf-6c843166468a";
const PREFIXE = "plan-patrimoine-";

// Shell applicatif : HTML, modules JS (moteur déterministe, fiches, lexique…), manifeste, icônes et polices locales (vendor/fonts/). Le CSS est inline dans index.html.
const SHELL = [
  "./",
  "index.html",
  "app.js", "utilitaires.js", "ui/commun.js", "vues/transmission.js", "vues/suivi.js", "vues/fiches.js", "vues/trajectoire.js", "vues/retraite.js", "vues/projection-commune.js", "assistant.js", "sync.js", "niveaux.js", "discretion.js",
  "plan.js", "devises.js", "moteur.js", "fiscal.js", "fiscalite/2026.js", "succession.js", "pension.js", "projection.js", "historique.js", "evolution-fiscale.js",
  "immobilier.js", "locatif.js", "credits.js", "alternatifs.js", "entreprises.js", "calendrier.js", "recap.js", "alertes.js",
  "fiches.js", "lexique.js",
  "manifest.json", "favicon.svg",
  "icons/icon.svg", "icons/icon-192.png", "icons/icon-512.png", "icons/icon-maskable-512.png", "icons/apple-touch-icon.png",
  "vendor/fonts/inter-latin-wght-normal.woff2", "vendor/fonts/manrope-latin-wght-normal.woff2",
];

const urlRelative = (chemin) => new URL(chemin, self.registration.scope).href;
const URL_ACCUEIL = () => urlRelative("index.html");

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_SHELL);
    // cache: "reload" contourne le cache HTTP : le pré-cache reçoit toujours les fichiers courants du serveur.
    await cache.addAll(SHELL.map((chemin) => new Request(urlRelative(chemin), { cache: "reload" })));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const noms = await caches.keys();
    await Promise.all(noms
      .filter((nom) => nom.startsWith(PREFIXE) && nom !== CACHE_SHELL && nom !== CACHE_DONNEES)
      .map((nom) => caches.delete(nom)));
    await self.clients.claim();
  })());
});

/** Met en cache une réponse valide (200, même origine) sans jamais faire échouer la requête d'origine. */
async function memoriser(nomCache, cle, reponse) {
  if (!reponse || reponse.status !== 200 || reponse.type !== "basic") return;
  try { await (await caches.open(nomCache)).put(cle, reponse.clone()); } catch { /* quota atteint : on ignore */ }
}

/** Stale-While-Revalidate : le cache répond tout de suite, le réseau rafraîchit en arrière-plan. */
async function staleWhileRevalidate(event, requete, cle = requete) {
  const cache = await caches.open(CACHE_SHELL);
  const enCache = await cache.match(cle);
  const reseau = fetch(requete).then(async (reponse) => { await memoriser(CACHE_SHELL, cle, reponse); return reponse; });
  if (enCache) {
    event.waitUntil(reseau.catch(() => { /* hors-ligne : la copie en cache suffit */ }));
    return enCache;
  }
  try { return await reseau; } catch (e) {
    if (requete.mode === "navigate") { const accueil = await cache.match(URL_ACCUEIL()); if (accueil) return accueil; }
    throw e;
  }
}

/** Cache d'abord : un seul téléchargement, ensuite 100 % hors-ligne (fichiers dvf/). */
async function cacheDabord(requete) {
  const cache = await caches.open(CACHE_DONNEES);
  const enCache = await cache.match(requete);
  if (enCache) return enCache;
  const reponse = await fetch(requete);
  await memoriser(CACHE_DONNEES, requete, reponse);
  return reponse;
}

self.addEventListener("fetch", (event) => {
  const requete = event.request;
  if (requete.method !== "GET") return;
  const url = new URL(requete.url);
  if (url.origin !== self.location.origin) return; // autres origines (aucune en production : la CSP les interdit) : laissées au navigateur
  if (url.pathname.includes("/api/")) return;      // réseau uniquement : on n'appelle même pas respondWith
  if (requete.headers.has("range")) return;        // lecture partielle : réponse 206 non cachable

  if (requete.mode === "navigate") {
    // « /?x=1 » ou « /#mon-profil?p=… » : toutes les navigations partagent la même copie d'index.html
    event.respondWith(staleWhileRevalidate(event, requete, URL_ACCUEIL()));
    return;
  }
  if (url.pathname.includes("/dvf/") && url.pathname.endsWith(".json")) {
    event.respondWith(cacheDabord(requete));
    return;
  }
  event.respondWith(staleWhileRevalidate(event, requete));
});
