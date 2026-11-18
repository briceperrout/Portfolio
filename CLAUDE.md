# CLAUDE.md — Règles et Architecture de « Plan Patrimoine »

Ce fichier définit le cadre technique, métier et méthodologique obligatoire pour toute intervention sur ce dépôt (`~/Documents/Portfolio_Project`).

---

## 1. Vision & Architecture Générale

**Plan Patrimoine** est une application web progressive (PWA) de simulation patrimoniale, fiscale, immobilière et retraite conçue pour les épargnants français, selon une approche **Local-First & Privacy-by-Design**.

- **Stack Frontend :** HTML5 sémantique, CSS inline dans un `<style>` de `index.html` (pas de `style.css`), JavaScript Vanilla **ES6 Modules** (`type="module"`), **sans framework ni bundler** (zéro dépendance React/Vue/Webpack). L'application doit pouvoir tourner en statique pur (Cloudflare Pages) ou via le serveur Python local.
- **Stack Backend / Edge :** `serveur.py` (serveur de développement local + proxy API sécurisé) et `worker.js` (Cloudflare Worker pour la production).
- **Données locales :** `prix-m2.json` contient les références DVF et loyers de ~35 000 communes françaises.

---

## 2. Règles Critiques d'Économie de Contexte (À RESPECTER STRICTEMENT)

1. **INTERDICTION DE LIRE `prix-m2.json` EN ENTIER :** Ce fichier contient des dizaines de milliers de lignes et sature immédiatement la fenêtre de contexte. Pour inspecter sa structure, utilise uniquement une commande ciblée (`head -n 30 prix-m2.json` ou un one-liner Python).
2. **Lectures chirurgicales :** N'inspecte que les fichiers directement concernés par la tâche en cours. Ne scanne jamais l'intégralité du dépôt sans nécessité absolue.
3. **Modifications complètes et propres :** Lors de l'édition d'un fichier, ne tronque jamais le code existant avec des commentaires de type `// ... reste du code inchangé`. Applique des diffs précis ou réécris la section complète proprement.
4. **Ne crée pas de doublons :** Enrichis systématiquement les modules existants au lieu de créer des fichiers parallèles redondants.

---

## 3. Cartographie des Modules Existants

Avant d'ajouter une fonction, vérifie si son domaine est déjà couvert par l'un de ces fichiers :

- `index.html` (CSS inline inclus) : Structure de l'interface, onglets, modales et thèmes (clair/sombre).
- `app.js` : Point d'entrée UI, gestion de l'état global (`etat`), écouteurs d'événements, exports et mode discrétion (`Alt+H`).
- `plan.js` : Allocation d'actifs dynamique par paliers de patrimoine et profil de risque.
- `moteur.js` : Cœur des calculs déterministes, capacité d'épargne, prêts, PTZ et enveloppes, conséquences d'un départ de France par compte (`consequencesDepart`).
- `fiscal.js` : Fiscalité française 2026 (barème progressif IR, décote, plafonnement du quotient familial, PFU/Flat Tax, IFI, plus-values, arbitrages rémunération/dividendes, exit tax art. 167 bis via `exitTax`).
- `pension.js` : Estimation des droits à la retraite (régime de base + complémentaire Agirc-Arrco) et stratégie de décumulation.
- `projection.js` : Simulations long terme, tirages Monte-Carlo, Coast FIRE / règle des 4 %, backtesting sur crises historiques (`CRISES` : 2000, 2008, 2022), backtest sur fenêtres glissantes (`backtesterHistorique`), corrélations dynamiques par régime (`hypotheses.correlations`) et scénario d'inflation persistante (`scenarioInflation`), net transmis après droits de succession (via `succession.js`).
- `historique.js` : séries annuelles 1970–2025 (rendements par classe d'actifs et inflation) avec leurs sources, utilisées par `backtesterHistorique` et le bloc « Rejouer l'histoire réelle ». Données pures, aucun DOM.
- `immobilier.js` & `locatif.js` : Recherche DVF (`prix-m2.json`), cash-flow locatif, échéancier d'emprunt, régimes micro-foncier / réel / LMNP et comparaison TRI vs PEA.
- `devises.js` : devises, taux BCE de référence, conversion, comptes étrangers (401(k), 3a, CELI…) et exposition au change. Pur, aucun DOM ; le solde en euros des comptes étrangers est dérivé au calcul, jamais stocké dans `placements`.
- `entreprises.js` : Barèmes d'abondement salarial (PEE / PERECO) des grandes entreprises.
- `succession.js` : droits de succession et de donation 2026, dévolution selon le régime matrimonial, assurance-vie (articles 990 I et 757 B), valeur de l'usufruit (art. 669), rappel fiscal de 15 ans, comparaison des options du conjoint survivant sur deux décès, adaptateur `entreeDepuisProfil`. Constantes `DMTG`, `AV_DECES` et `BAREME_USUFRUIT` dans `fiscal.js`. Aucun DOM.
- `calendrier.js` : Échéancier patrimonial et export `.csv`.
- `recap.js` : Génération du bilan patrimonial imprimable/exportable.
- `fiches.js` & `lexique.js` : Fiches pédagogiques et infobulles automatiques du lexique financier.
- `serveur.py` / `worker.js` / `assistant.js` : Couche assistant IA, streaming SSE, OCR/Vision et mode vocal ; route `/api/taux` (proxy des taux de change BCE, cache 6 h, aucune donnée utilisateur).
- `niveaux.js` : niveaux de lecture Débutant / Intermédiaire / Avancé (matrice « élément → niveau minimal », table unique des libellés d'onglets `LIBELLES_VUES`, règles pures, détection des réglages avancés actifs). Aucun DOM, aucun calcul métier : le niveau ne change que l'affichage, jamais `etat.profil` ni les résultats. Niveau mémorisé par appareil (clé `niveau`), jamais synchronisé.
- `sync.js` : synchronisation multi-appareils chiffrée de bout en bout (WebCrypto AES-GCM + PBKDF2, fusion par fiche, client `/api/sync`) ; routes serveur dans `worker.js` (Cloudflare KV, liaison `SYNC_KV`) et `serveur.py` (stockage dev `.sync_local/`, ignoré par Git). Le serveur ne doit jamais voir de données en clair.
- `wrangler.toml` / `_headers` / `.assetsignore` : déploiement Cloudflare (Worker + assets), CSP stricte et liste des fichiers jamais publiés (secrets, sources serveur, tests) : tout fichier absent de `.assetsignore` est public.

---

## 4. Conventions Techniques & Règles Métier

### Frontend & Expérience Utilisateur
- **Séparation Calculs / DOM :** Garde les fonctions financières et fiscales pures (entrée → sortie déterministe) dans les modules métier (`moteur.js`, `fiscal.js`, `projection.js`, etc.). Réserve la manipulation du DOM à `app.js` et aux composants UI dédiés.
- **Indépendance vis-à-vis de `window.claude` :** L'application doit fonctionner à 100 % sur `localhost` et Cloudflare Pages. Tout export de fichier (`.json`, `.csv`, bilan HTML) doit impérativement implémenter un téléchargement navigateur standard (`Blob` + `URL.createObjectURL` + `<a download>`).
- **Niveaux de lecture :** tout nouveau bloc d'interface (fieldset, champ, panneau, onglet) doit déclarer son niveau minimal avec `data-min="intermediaire"` ou `data-min="avance"` (sans attribut = visible à tous les niveaux) et, s'il est listé, figurer dans `MATRICE` de `niveaux.js`. Les versions simplifiées réservées aux débutants utilisent `data-seul="debutant"`.
- **Mode Discrétion (`Alt+H`) :** Tout nouvel composant affichant des montants en euros, des soldes ou des réponses de l'assistant IA doit respecter la classe CSS de masquage déclenchée par `Alt+H`.
- **Domaine Fiscal Français (Référentiel 2026) :** Respecte strictement les règles françaises : PEA (exonération d'IR après 5 ans, prélèvements sociaux 18,6 % depuis la LFSS 2026 ; 17,2 % pour l'assurance-vie et les revenus fonciers — taux centralisés dans `PRELEVEMENTS` de `fiscal.js`), Assurance-Vie (abattement 4 600 € / 9 200 € après 8 ans, articles 990 I et 757 B du CGI pour la succession), PER (déductibilité à l'entrée dans la limite du plafond épargne retraite), LMNP (amortissements au réel vs abattement micro-BIC).

### Backend IA, Routage & Privacy-by-Design (`serveur.py` / `worker.js`)
- **Routage des modèles OpenAI (optimisation quota Data Sharing 2,5M tokens/jour) :**
  - *Chat général, synthèse et RAG :* `gpt-5.4-mini` (ou `gpt-5-mini`), pool « rapide » de 2,5 M tokens/jour, effort `low`.
  - *Raisonnement complexe, arbitrages fiscaux et simulations :* `o3` (`MODEL_REASONING`), pool « raisonnement » distinct de 250 k tokens/jour (modèle phare), effort `medium`. Déclenché par `modeApprofondi: true` ou par un mot-clé de `MOTS_COMPLEXES`.
  - *Repli :* au-delà du plafond de 225 000 tokens du pool raisonnement, ou si OpenAI refuse `o3` (statuts 400, 403, 404, 429), la requête est rejouée sur `gpt-5.4-mini` en effort `high`. `OPENAI_ENABLE_REASONING=0` est le coupe-circuit (tout reste sur le modèle rapide).
  - *Paramètres obligatoires pour `o3` et la famille `gpt-5` :* utilise `max_completion_tokens` (jamais `max_tokens`), n'envoie **jamais** `temperature`, et utilise le rôle `developer` à la place de `system`.
  - *Source de vérité :* les constantes de `worker.js` (`MODEL_FAST`, `MODEL_REASONING`, plafonds, alertes) ; `serveur.py` les reproduit à l'identique et `test_routage.py` les vérifie. Toute modification de modèle ou de plafond se fait des deux côtés, puis dans ce paragraphe.
- **Anonymisation stricte avant appel Cloud (`sanitize_payload_for_cloud`) :**
  - Aucune donnée personnelle (nom, email, IBAN, numéro de compte, nom d'établissement bancaire ou agrégateur comme Trade Republic, Boursorama, Finary) ne doit quitter le serveur.
  - Ne transmets jamais de soldes bruts en euros : convertis systématiquement le portefeuille en **pourcentages d'allocation**, **plus/moins-values latentes en %**, **tickers** et **types d'enveloppes** (`PEA`, `CTO`, `AV`, `PER`, `Livret`).
  - Si un document brut non anonymisable doit être analysé (ex. PDF de relevé), route exclusivement vers l'instance locale **Ollama**.
- **Suivi des quotas :** Maintiens un compteur journalier réinitialisé à 00:00 UTC cumulant `prompt_tokens + completion_tokens` (incluant les `reasoning_tokens`) et journalise une alerte dès **2 200 000 tokens** atteints sur le pool rapide (plafond 2 350 000, au-delà : refus 429 et repli local côté client) et dès **200 000 tokens** sur le pool raisonnement (plafond 225 000).

### Sécurité & PWA
- **Zéro CDN tiers en production :** Toutes les bibliothèques externes (graphiques, compression LZ-String, chiffrement) doivent être hébergées localement dans `/vendor/` pour respecter une Content Security Policy (`_headers`) stricte (`default-src 'self'`). Aujourd'hui `vendor/` ne contient que les polices Inter et Manrope (`vendor/fonts/*.woff2` + licences OFL, déclarées par `@font-face` dans `index.html` et pré-cachées dans `SHELL`) : aucune bibliothèque JS n'est utilisée (le chiffrement passe par WebCrypto natif). `test_niveaux.mjs` échoue si la CSP ou `index.html` référencent un hôte externe. Tout nouveau fichier de `vendor/` doit être ajouté à `SHELL` (et `CACHE_VERSION` incrémentée).
- **Aucune clé API côté client :** Les clés OpenAI ou Turnstile restent strictement dans les variables d'environnement de `serveur.py` / Cloudflare Secrets.
- **Service Worker (`service-worker.js`) :** Pré-cache les assets légers de l'application, mais gère `prix-m2.json` en stratégie **Cache-First à la demande** (au premier accès immobilier) pour ne pas bloquer l'installation de la PWA.

---

## 5. Protocole de Travail & Validation Avant Clôture

1. **Planification :** Pour toute tâche touchant plus de 2 fichiers ou introduisant une logique fiscale/financière complexe, expose d'abord ton plan d'action concis et attends validation avant d'écrire du code.
2. **Contrôles obligatoires avant de rendre la main :**
   - Vérifie la syntaxe JavaScript (`node --check` sur les fichiers modifiés) et Python (`python3 -m py_compile serveur.py` le cas échéant).
   - Lance les tests : `node test_niveaux.mjs` (cohérence `data-min` ↔ `MATRICE`, invariance des calculs, shell du service worker), `node test_js.mjs`, `test_fiscal.mjs`, `test_succession.mjs`, `test_immobilier.mjs`, `test_releves.mjs`, `test_sync.mjs` et `python3 test_routage.py` : tout doit passer. `node --test test_*.mjs` lance d'un coup toutes les suites JS (échec si l'une échoue) ; la CI `.github/workflows/tests.yml` les rejoue à chaque push.
   - Vérifie qu'aucun import ES6 n'est cassé et qu'aucun lien mort (ex. `favicon.svg`, `manifest.json`) ne génère d'erreur 404.
   - Vérifie avec `git diff` qu'aucune clé secrète, donnée personnelle ou régression n'a été introduite.
3. **Granularité Git :** Termine chaque étape validée en proposant un message de commit clair et atomique (ex. `feat(fiscal): ajoute simulateur de réforme fiscale dynamique`).