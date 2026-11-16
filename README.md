<div align="center">

<img src="favicon.svg" alt="Logo Plan Patrimoine" width="72" height="72">

# Plan Patrimoine

**Simulateur patrimonial, fiscal, immobilier et retraite pour les épargnants français.**
*Local-first · Privacy-by-design · Zéro dépendance.*

![Version](https://img.shields.io/badge/version-0.1.0-1d5c48)
![Licence MIT](https://img.shields.io/badge/licence-MIT-blue)
![JavaScript ES Modules](https://img.shields.io/badge/JavaScript-ES%20Modules-f7df1e?logo=javascript&logoColor=black)
![Python 3](https://img.shields.io/badge/Python-3-3776ab?logo=python&logoColor=white)
![Zéro dépendance](https://img.shields.io/badge/d%C3%A9pendances-0-success)
![Fiscalité](https://img.shields.io/badge/fiscalit%C3%A9-France%202026-e63946)

</div>

---

## Présentation & vision

**Plan Patrimoine** aide un épargnant français à répondre, chiffres à l'appui, à des questions concrètes :
*Comment répartir mon capital entre PEA, assurance-vie, PER, livrets et immobilier ? Que change l'impôt sur mes arbitrages ? Puis-je acheter ma résidence principale ou investir en locatif ? À quel âge et avec quel revenu pourrai-je partir à la retraite ?*

L'application est pensée selon trois principes :

- **Local-first** : tous les calculs s'exécutent dans votre navigateur. Aucune donnée patrimoniale n'est envoyée à un serveur.
- **Privacy-by-design** : un *mode discrétion* masque les montants d'un raccourci clavier, utile en partage d'écran.
- **Transparence** : calculs déterministes et lisibles, sources et dates de vérification affichées dans les fiches.

> ⚠️ Plan Patrimoine est un outil pédagogique de simulation. Il ne constitue ni un conseil en investissement, ni un conseil fiscal personnalisé.

## Fonctionnalités principales

| Domaine | Ce que l'application fait | Module |
|---|---|---|
| **Allocation d'actifs** | Répartition cible par paliers de patrimoine et profil de risque, rééquilibrage entre enveloppes (PEA, CTO, AV, PER, livrets) | `plan.js`, `moteur.js` |
| **Fiscalité France 2026** | Barème progressif de l'IR, décote, quotient familial, décomposition du salaire, taux marginal, plus-values immobilières | `fiscal.js` |
| **Évolution fiscale** | Scénarios de réforme (prélèvements sociaux, PEA, assurance-vie, PER…) comparés au régime actuel | `evolution-fiscale.js` |
| **Résidence principale** | Capacité d'emprunt, endettement, diagnostic d'achat, PTZ | `moteur.js` |
| **Immobilier locatif** | Prix et loyers au m² (DVF, ~35 000 communes), cash-flow, échéancier d'emprunt, micro-foncier / réel, plus-value | `immobilier.js`, `locatif.js` |
| **Trajectoire Monte-Carlo** | Projection long terme probabiliste, backtest sur les crises de 2000, 2008 et 2022, suivi vs trajectoire de référence | `projection.js` |
| **Retraite publique** | Estimation des droits (régime de base + complémentaire), âge de départ, trimestres, décote/surcote | `pension.js` |
| **Épargne salariale** | Barèmes d'abondement PEE / PERECO des grandes entreprises, offres d'actions, primes | `entreprises.js` |
| **Calendrier patrimonial** | Échéancier des rendez-vous financiers et fiscaux, export `.csv` | `calendrier.js` |
| **Bilan** | Bilan patrimonial imprimable / exportable en HTML | `recap.js` |
| **Base pédagogique** | Fiches thématiques sourcées et datées + infobulles automatiques du lexique financier | `fiches.js`, `lexique.js` |
| **Confort** | Thème clair / sombre, mode discrétion (`Alt+H`, `⌥+H` sur Mac), export / import de vos données (`.json`) | `app.js`, `index.html` |

## Architecture technique

```text
Portfolio_Project/
├── index.html            # Structure, onglets, styles (clair/sombre) et point d'entrée
├── favicon.svg           # Icône de l'application
├── app.js                # UI : état global, événements, rendu DOM, exports, mode discrétion
│
├── moteur.js             # Cœur de calcul : capacité d'épargne, prêts, PTZ, enveloppes
├── fiscal.js             # IR 2026, décote, quotient familial, décomposition salariale
├── evolution-fiscale.js  # Scénarios de réforme fiscale
├── plan.js               # Paramètres du plan : paliers et allocation cible
├── projection.js         # Monte-Carlo, crises historiques, trajectoire
├── pension.js            # Droits à la retraite (base + complémentaire)
├── locatif.js            # Cash-flow locatif, emprunt, régimes fiscaux
├── immobilier.js         # Recherche de communes et estimation DVF
├── entreprises.js        # Abondement PEE / PERECO
├── calendrier.js         # Échéancier et export CSV
├── recap.js              # Génération du bilan
├── fiches.js · lexique.js# Contenu pédagogique et infobulles
│
├── prix-m2.json          # Références DVF et loyers (~35 000 communes)
├── serveur.py            # Serveur statique local (stdlib Python, sans dépendance)
├── .env.example          # Variables d'environnement documentées (aucun secret)
├── LICENSE               # MIT
└── CLAUDE.md             # Conventions techniques du dépôt
```

**Pourquoi « zéro dépendance / Vanilla JS ES Modules » ?**

- **Performance** : pas de bundle, pas de framework à hydrater. Le navigateur charge uniquement les modules nécessaires, nativement.
- **Maintenabilité** : aucun `node_modules`, aucune chaîne de build qui vieillit. Le projet s'ouvre et se lit tel quel, dans cinq ans comme aujourd'hui.
- **Confiance** : pour une application qui manipule des données patrimoniales, une surface de code réduite et auditable (aucune bibliothèque tierce dans les calculs) est un atout.
- **Séparation nette** : les modules métier (`moteur.js`, `fiscal.js`, `projection.js`…) sont des fonctions pures *entrée → sortie*, testables isolément. Seul `app.js` touche au DOM.
- **Déploiement trivial** : l'application tourne en site statique pur (par exemple Cloudflare Pages) ou via le petit serveur Python fourni.

## Installation & lancement en local

Prérequis : **Git** et **Python 3** (aucun autre outil, aucune installation de paquet).

```bash
git clone https://github.com/briceperrout/Portfolio.git && cd Portfolio
python3 serveur.py 8080
```

Ouvrez ensuite **<http://localhost:8080>** dans votre navigateur.

> Les modules ES et le chargement de `prix-m2.json` nécessitent un serveur HTTP : l'ouverture directe de `index.html` (`file://`) ne fonctionne pas. Le serveur écoute uniquement sur `127.0.0.1`.

Variables d'environnement : copiez `.env.example` vers `.env` si vous activez plus tard des fonctions nécessitant une clé. La v0.1 n'en requiert aucune.

## Confidentialité

- Vos saisies restent dans le navigateur (`localStorage`) ; vos exports `.json` sont à vous et ignorés par Git (voir `.gitignore`).
- Aucune clé API n'est présente dans le code. Les clés futures resteront strictement côté serveur.

## Feuille de route

| Version | Objectif |
|---|---|
| **v0.1.0** *(actuelle)* | Simulateur complet : allocation, fiscalité 2026, immobilier, Monte-Carlo, retraite, fiches |
| **v0.2** | **Assistant IA contextuel** : questions en langage naturel sur votre plan, avec anonymisation stricte avant tout appel cloud (pourcentages, tickers et types d'enveloppes uniquement) |
| **v0.3** | **Partage de scénarios par URL** : un scénario encodé et compressé dans le lien, sans serveur |
| **v0.4** | **Déploiement Cloudflare** : Pages + Worker, PWA installable, Content Security Policy stricte et bibliothèques hébergées localement |

## Licence

Distribué sous licence [MIT](LICENSE).
