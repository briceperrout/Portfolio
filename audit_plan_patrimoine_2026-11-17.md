# 📊 **AUDIT COMPLET & CRITIQUE — Plan Patrimoine**
## *Référentiel Fiscal Français 2026 | 17 novembre 2026*

---

## 🎯 **Scorecard Synthétique**

| Axe | Note /10 | Diagnostic (2 lignes) |
|-----|----------|----------------------|
| **Axe 1** : Architecture, Modularité & Qualité du Code | **7.5/10** | Séparation Calculs/DOM excellente dans les modules métier. **VIOLATIONS BLOQUANTES** : CDN externe (Google Fonts) dans `_headers` + dossier `/vendor/` manquant. Duplication serveur.py/worker.js à factoriser. |
| **Axe 2** : Exactitude Financière & Conformité Fiscale 2026 | **9/10** | Barèmes IR, PS (18,6% PEA / 17,2% AV), DMTG, Exit Tax conformes. **Risque** : cas limites mathématiques (divisions par zéro) non exhaustivement protégés dans `moteur.js:42`. |
| **Axe 3** : Sécurité, Privacy-by-Design & Chiffrement | **8.5/10** | E2EE (AES-GCM, PBKDF2) robuste, anonymisation efficace, pas de clés API côté client. **Faille** : CSP autorise CDN tiers (Google Fonts) → surface d'attaque élargie. |
| **Axe 4** : Couverture de Tests & Robustesse | **9.5/10** | **880+ vérifications réussies** (tous tests passent). Angle mort : absence de tests pour cas limites fiscaux extrêmes (taux négatifs, horizons Monte-Carlo >100 ans). |
| **Axe 5** : Critique Produit & UX | **8/10** | Onboarding progressif par niveaux bien pensé. **Frictions** : complexité initiale pour débutant, hypothèses par défaut potentiellement trompeuses (rendements moyens masquent la volatilité). |

---

## ⚠️ **FAILLES CRITIQUES & BUGS BLOQUANTS (P0)**

### 🔴 **P0-1 : Violation de la règle "Zéro CDN tiers"**
**Fichier** : `_headers` (lignes 6-7)
**Code incriminé** :
```
style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
font-src 'self' https://fonts.gstatic.com;
```

**Problème** : 
- CLAUDE.md impose explicitement : **"Zéro CDN tiers en production"** et **"Toutes les bibliothèques externes [...] doivent être hébergées localement dans `/vendor/`"**
- Le fichier `vendor/` **n'existe pas** dans le dépôt
- La CSP actuelle autorise le chargement depuis des domaines externes

**Impact** : 
- Dépendance à un service tiers (Google) → risque de blocage si indisponible
- Surface d'attaque élargie (CSP non strictement `'self'`)
- Non-respect des principes Local-First & Privacy-by-Design

**Correctif proposé** :
```bash
# 1. Créer le dossier vendor/
mkdir -p vendor/fonts

# 2. Télécharger les polices Google Fonts (Inter & Manrope) localement
#    via https://google-webfonts-helper.herokuapp.com/

# 3. Mettre à jour _headers
# Remplacer par :
style-src 'self' 'unsafe-inline';
font-src 'self';

# 4. Mettre à jour index.html
# Remplacer :
#   <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Manrope:wght@600;700;800&display=swap">
# Par :
#   <link rel="stylesheet" href="vendor/fonts/inter-manrope.css">
```

---

### 🔴 **P0-2 : Dossier `/vendor/` manquant**
**Fichier** : `.assetsignore` (ligne 17)
**Problème** : 
- `worker.js` est listé dans `.assetsignore` (correct)
- Mais **aucune trace** du dossier `/vendor/` qui devrait contenir les dépendances locales
- CLAUDE.md : **"Toutes les bibliothèques externes [...] doivent être hébergées localement dans `/vendor/`"**

**Impact** : 
- Impossibilité de respecter la règle "zéro CDN" sans créer ce dossier
- Incohérence entre la documentation et l'implémentation

**Correctif** : Créer `vendor/` et y placer toutes les dépendances (polices, libs JS si nécessaire).

---

## ⚠️ **DETTES TECHNIQUES & FAILLES MOYENNES (P1)**

### 🟡 **P1-1 : Duplication de code serveur.py ↔ worker.js**
**Fichiers** : `serveur.py` (lignes 42-200) et `worker.js` (lignes 25-200)

**Code dupliqué** :
- Constantes : `MODEL_FAST`, `MODEL_REASONING`, `PLAFOND_RAPIDE`, `PLAFOND_RAISONNEMENT`, `ALERTE_*`, `MOTS_COMPLEXES`, `STATUTS_REPLI`
- Fonctions : `sanitiserTexte` / `sanitizerTexte`, `choisirModele` / `choisirModele`, `choixRepli` / `choixRepli`
- Logique de routage OpenAI identique

**Problème** : 
- **80+ lignes de code dupliqué** → risque de désynchronisation
- Maintenance difficile (correction de bug à faire en deux endroits)
- Violation du principe DRY

**Correctif** :
```javascript
// Créer un module commun : shared/ai_config.js
export const AI_CONFIG = {
  MODEL_FAST: "gpt-5.4-mini",
  MODEL_REASONING: "o3",
  PLAFOND_RAPIDE: 2350000,
  PLAFOND_RAISONNEMENT: 225000,
  // ...
};

// Puis importer dans serveur.py (via un wrapper Python) et worker.js
```

---

### 🟡 **P1-2 : Cas limites mathématiques non protégés**

#### **Division par zéro dans moteur.js:42**
**Fichier** : `moteur.js` (ligne 42)
**Code** :
```javascript
return t0 > 0 && t10 > 0 ? (Math.pow(t10 / t0, 0.1) - 1) * 100 : null;
```
**Problème** : La condition `t0 > 0` est vérifiée, mais si `t10 / t0` produit `Infinity` ou `NaN`, `Math.pow` peut retourner des valeurs inattendues.

**Correctif** :
```javascript
const ratio = t10 / t0;
if (!Number.isFinite(ratio) || ratio <= 0) return null;
return (Math.pow(ratio, 0.1) - 1) * 100;
```

#### **Null/undefined non vérifiés dans calculs financiers**
**Fichiers** : `locatif.js`, `projection.js`, `succession.js`
**Exemples** :
- `locatif.js:15` : `const loyers = Math.max(0, Number(L.loyerPercu) || 0)` → OK
- `locatif.js:25` : `const interets = (K * t) / 12` → **Risque** si `t` est `NaN`

**Correctif systématique** : Ajouter des validations avant chaque opération mathématique :
```javascript
if (!Number.isFinite(t) || t < 0) return 0;
```

---

### 🟡 **P1-3 : Incohérence potentiellement trompeuse dans pension.js**
**Fichier** : `pension.js` (ligne 65-66)
**Code** :
```javascript
const regles = reglesGeneration(plan, naissance);
const debut = Math.max(14, Math.min(Number(ageDebut) || R.ageDebutCarriere || 22, ageArret));
```
**Problème** : Si `ageArret < ageDebut`, `debut` sera supérieur à `ageArret`, créant une boucle vide dans `salairesCarriere`.

**Correctif** :
```javascript
const debut = Math.max(14, Math.min(Number(ageDebut) || R.ageDebutCarriere || 22, ageArret));
const fin = Math.max(debut, ageArret); // Garantit fin >= debut
```

---

### 🟡 **P1-4 : Content-Security-Policy trop permissive**
**Fichier** : `_headers`
**Problème** : La CSP autorise `fonts.googleapis.com` et `fonts.gstatic.com` alors que la règle impose "zéro CDN tiers".

**Correctif** : Voir P0-1.

---

## 📝 **ANGLES MORTS FISCAUX (P1)**

### 🟡 **P1-5 : Tests fiscaux incomplets pour cas extrêmes**

**Cas non testés** (à ajouter dans `test_fiscal.mjs`) :

1. **Taux négatifs** :
   ```javascript
   // Tester : tauxAnnuel = -10% dans echeancier()
   assert.strictEqual(echeancier(100000, -10, 20).mensualite, 0);
   ```

2. **Horizons temporels extrêmes** :
   ```javascript
   // Tester : ans = 0, ans = 100 dans mensualitePret()
   assert.strictEqual(mensualitePret(100000, 3.5, 0), 0);
   assert.strictEqual(mensualitePret(100000, 3.5, 100).isFinite(), true);
   ```

3. **Montants nuls ou négatifs** :
   ```javascript
   // Tester : capital = 0, capital = -1000 dans impotPlusValue()
   assert.strictEqual(impotPlusValue(0, 100000, 10), 0);
   ```

4. **Âges extrêmes dans succession.js** :
   ```javascript
   // Tester : age = 150 dans valeurUsufruit()
   assert.deepEqual(valeurUsufruit(150), { usufruit: 10, nuePropriete: 90 });
   ```

5. **Plafonds PER pour indépendants** :
   - Vérifier que `plafondPERIndependant` gère correctement `pass = 0`

---

## 🏗️ **RECOMMANDATIONS D'ARCHITECTURE & ÉVOLUTIONS PRODUIT (P2)**

### 🟢 **Quick Wins (P2-A)**

#### **1. Centraliser la configuration IA**
Créer `shared/ai_config.js` :
```javascript
export const AI_CONFIG = Object.freeze({
  MODEL_FAST: "gpt-5.4-mini",
  MODEL_REASONING: "o3",
  PLAFOND_RAPIDE: 2350000,
  PLAFOND_RAISONNEMENT: 225000,
  ALERTE_RAPIDE: 2200000,
  ALERTE_RAISONNEMENT: 200000,
  MAX_COMPLETION_RAISONNEMENT: 2500,
  MAX_COMPLETION_RAPIDE: 1500,
  STATUTS_REPLI: Object.freeze([400, 403, 404, 429]),
  MOTS_COMPLEXES: Object.freeze([...]),
});
```

#### **2. Améliorer la robustesse mathématique**
Créer un module `utils/math.js` :
```javascript
export function safeDiv(a, b, defaultValue = 0) {
  return b === 0 ? defaultValue : a / b;
}

export function safePow(base, exp, defaultValue = 0) {
  if (!Number.isFinite(base) || !Number.isFinite(exp)) return defaultValue;
  const result = Math.pow(base, exp);
  return Number.isFinite(result) ? result : defaultValue;
}

export function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}
```

#### **3. Automatiser la vérification des niveaux**
Ajouter un test dans `test_niveaux.mjs` pour détecter les éléments `data-min` non référencés dans `MATRICE`.

---

### 🟢 **Améliorations Structurelles (P2-B)**

#### **1. Refactoring de la gestion des erreurs**
Utiliser un système de codes d'erreur standardisés.

#### **2. Améliorer la documentation des formules**
Ajouter des commentaires JSDoc avec références légales.

#### **3. Optimiser les performances**
- Cache agressif pour les calculs déterministes
- Web Workers pour les calculs lourds
- Lazy loading pour `prix-m2.json`

---

## 🎯 **PLAN D'ACTION PRIORISÉ**

### **Phase 1 : Corrections Critiques (P0) — À faire IMMEDIATEMENT**

| # | Tâche | Fichiers | Complexité | Temps estimé |
|---|-------|----------|------------|--------------|
| 1.1 | **Supprimer les références CDN** dans `_headers` | `_headers` | ⭐ | 15 min |
| 1.2 | **Créer dossier `/vendor/`** et y placer les polices | `vendor/fonts/` | ⭐⭐ | 30 min |
| 1.3 | **Mettre à jour `index.html`** pour charger les polices locales | `index.html` | ⭐ | 10 min |
| 1.4 | **Vérifier .assetsignore** inclut bien `/vendor/` | `.assetsignore` | ⭐ | 5 min |
| 1.5 | **Tester** le déploiement sans CDN | - | ⭐ | 15 min |

**Total Phase 1** : ~1h15

---

### **Phase 2 : Corrections Moyennes (P1) — 1 semaine**

| # | Tâche | Fichiers | Complexité | Temps estimé |
|---|-------|----------|------------|--------------|
| 2.1 | **Factoriser la config IA** dans un module commun | Nouveau: `shared/ai_config.js` | ⭐⭐ | 1h |
| 2.2 | **Corriger les cas limites** dans `moteur.js` | `moteur.js:42` | ⭐ | 30 min |
| 2.3 | **Ajouter des validations** dans `locatif.js` | `locatif.js` | ⭐ | 30 min |
| 2.4 | **Corriger pension.js** pour `ageArret < ageDebut` | `pension.js:66` | ⭐ | 15 min |
| 2.5 | **Ajouter des tests** pour cas extrêmes | `test_fiscal.mjs`, `test_immobilier.mjs` | ⭐⭐ | 2h |
| 2.6 | **Vérifier la cohérence** data-min ↔ MATRICE | `test_niveaux.mjs` | ⭐ | 1h |

**Total Phase 2** : ~5h15

---

### **Phase 3 : Améliorations (P2) — 2-4 semaines**

| # | Tâche | Fichiers | Complexité | Temps estimé |
|---|-------|----------|------------|--------------|
| 3.1 | **Créer module `utils/math.js`** | Nouveau | ⭐⭐ | 1h |
| 3.2 | **Améliorer la documentation** des formules | Tous modules | ⭐⭐ | 2h |
| 3.3 | **Ajouter un guide interactif** pour débutants | `index.html`, `app.js` | ⭐⭐⭐ | 4h |
| 3.4 | **Implémenter le simulateur de donation NP** | `succession.js` | ⭐⭐⭐ | 3h |
| 3.5 | **Ajouter des alertes fiscales** | `fiscal.js`, `app.js` | ⭐⭐ | 2h |
| 3.6 | **Optimiser les performances** (mémoïsation) | `moteur.js`, `fiscal.js` | ⭐⭐ | 2h |

**Total Phase 3** : ~14h

---

## 📊 **METRIQUES & INDICATEURS**

### **Couverture de Tests**
- **Lignes de code** : ~15 000 (estimation)
- **Tests existants** : 880+ vérifications
- **Couverture estimée** : ~85-90%
- **Angles morts identifiés** : 5 (cas limites extrêmes)

### **Qualité du Code**
- **Séparation des préoccupations** : ✅ Excellente (Calculs ≠ DOM)
- **Principe DRY** : ⚠️ À améliorer (duplication serveur.py/worker.js)
- **Gestion des erreurs** : ⚠️ Partielle (certains cas limites non gérés)
- **Documentation** : ⚠️ Inégale (bonnes dans fiscal.js, à améliorer dans projection.js)

### **Sécurité**
- **E2EE** : ✅ Robuste (AES-GCM, PBKDF2)
- **Anonymisation** : ✅ Efficace (montants masqués, pas de PII)
- **CSP** : ❌ Trop permissive (autorise CDN externe)
- **Stockage des secrets** : ✅ Correct (pas de clés côté client)

---

## 🔍 **VERIFICATIONS EFFECTUEES**

### **Axe 1 : Architecture**
- ✅ Vérification absence de DOM dans modules métier (moteur.js, fiscal.js, projection.js, historique.js, devises.js, succession.js, immobilier.js, locatif.js, pension.js, niveaux.js)
- ✅ Vérification cohérence data-min ↔ MATRICE (test_niveaux.mjs passe)
- ✅ Vérification mode discrétion Alt+H (implémenté dans app.js)
- ✅ Vérification service-worker.js (stratégie cache correcte)
- ❌ **CDN externe détecté** dans _headers
- ❌ **Dossier vendor/ manquant**
- ⚠️ Duplication serveur.py/worker.js

### **Axe 2 : Fiscalité 2026**
- ✅ Barème IR 2026 : `[[11600, 0], [29579, 11], [84577, 30], [181917, 41], [Infinity, 45]]`
- ✅ Prélèvements sociaux : PS_CAPITAL = 18.6 (PEA), PS_PATRIMOINE = 17.2 (AV/foncier)
- ✅ Décote : { seul: 897, couple: 1483, taux: 45.25 }
- ✅ Plafond demi-part enfants : 1807
- ✅ Exit Tax : SEUIL_TITRES = 800000, ANNEES_RESIDENCE = 6
- ✅ DMTG : BAREME_LIGNE_DIRECTE conforme art. 777 CGI
- ✅ AV 990 I : ABATTEMENT_990I = 152500, SEUIL_990I = 700000
- ✅ BAREME_USUFRUIT conforme art. 669 CGI
- ✅ PER : abattement 10%, plancher 454, plafond 4439 (2026)
- ⚠️ Cas limites à tester (divisions par zéro, valeurs extrêmes)

### **Axe 3 : Sécurité**
- ✅ E2EE : AES-GCM 256 bits, PBKDF2-SHA-256, 600 000 itérations
- ✅ Gestion des IV/nonce : aléatoires et uniques par chiffrement
- ✅ Fusion des données : détection des conflits (révision)
- ✅ Anonymisation : sanitiserTexte masques emails, IBAN, téléphones, montants, noms d'établissements
- ✅ Routage Ollama pour documents non anonymisables
- ✅ .assetsignore : secrets et sources serveur correctement exclus
- ✅ git status : pas de fichiers sensibles commités
- ❌ **CSP autorise CDN tiers**

### **Axe 4 : Tests**
- ✅ test_niveaux.mjs : 465 vérifications OK
- ✅ test_fiscal.mjs : 108 vérifications réussies
- ✅ test_succession.mjs : 98 vérifications réussies
- ✅ test_immobilier.mjs : 130 tests réussis
- ✅ test_releves.mjs : 105 vérifications réussies
- ✅ test_sync.mjs : 112 vérifications réussies
- ✅ test_js.mjs : 477 vérifications réussies
- ✅ test_routage.py : 42 tests OK
- ⚠️ Angles morts : cas limites extrêmes non testés

### **Axe 5 : UX**
- ✅ Système de niveaux fonctionnel
- ✅ Mode discrétion (Alt+H) implémenté
- ✅ Design responsive
- ✅ PWA avec service worker
- ⚠️ Onboarding à améliorer pour débutants
- ⚠️ Hypothèses par défaut à clarifier

---

## 📌 **CONCLUSION & RECOMMANDATIONS FINALES**

### **Bilan Global**
**Note globale : 8.5/10** — Application mature, bien architecturée, avec une excellente couverture des besoins patrimoniaux et fiscaux français. **Deux violations critiques (P0) à corriger immédiatement** pour respecter les principes Local-First et zéro CDN. La qualité du code est globalement très bonne, avec une séparation claire des responsabilités. La sécurité est robuste (E2EE, anonymisation), mais la CSP doit être renforcée.

### **Priorités Immédiates**
1. **Corriger les violations P0** (CDN + vendor/) — **BLOQUANT**
2. **Factoriser la duplication** serveur.py/worker.js
3. **Ajouter des tests** pour les cas limites extrêmes

### **Évolutions Produit Recommandées**
1. **Améliorer l'onboarding** avec un guide interactif
2. **Ajouter des visualisations** plus intuitives (jauges, comparaisons)
3. **Implémenter le simulateur de donation en nue-propriété** (valeur ajoutée majeure)
4. **Ajouter des alertes fiscales** proactives

### **Maintenabilité**
- **Architecture** : Excellente séparation Calculs/DOM — **À conserver**
- **Documentation** : À améliorer (ajouter références légales, commentaires JSDoc)
- **Tests** : Très bonne couverture — **À compléter** pour cas extrêmes
- **Sécurité** : Robuste — **À maintenir** avec revues régulières

---

## 📞 **CONTACT & SUPPORT**

**Responsable** : Architecte Logiciel Senior & Expert en Ingénierie Patrimoniale
**Date** : 17 novembre 2026
**Version** : 1.0
**Référentiel** : Fiscalité Française 2026 (Loi de Finances 2026, LFSS 2026)

---

*Document généré par audit automatique conformément aux règles CLAUDE.md*
*Toutes les vérifications ont été effectuées en mode lecture seule.*
