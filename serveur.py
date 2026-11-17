#!/usr/bin/env python3
"""Serveur local de « Plan Patrimoine » : fichiers statiques + relais sécurisé vers OpenAI.

Usage :  python3 serveur.py [port]      (défaut : 8080, ou variable PORT)

Écoute uniquement sur 127.0.0.1 : rien n'est exposé sur le réseau.

Assistant IA
  GET  /api/statut  → {"actif": bool, "modele": "..."}      (sans appeler OpenAI)
  POST /api/chat    → relais vers https://api.openai.com/v1/chat/completions
                      flux SSE normalisé (voir _chat) si le client envoie stream=true,
                      sinon réponse JSON classique {"reponse", "modele", "masques"}
                      Routage : gpt-5.4-mini par défaut, o3 si le client envoie
                      modeApprofondi=true ou si la question contient un mot-clé complexe.
                      Deux quotas gratuits Data Sharing, comptés séparément : modèles mini
                      (plafond 2 350 000 tokens/jour, au-delà : 429 quota_journalier → repli local)
                      et o3 (plafond 225 000/jour, au-delà : gpt-5.4-mini en effort « high »).
                      Même repli si OpenAI refuse o3 (404 modèle introuvable/déprécié, 403, 400, 429).
                      Le modèle retenu est annoncé par l'en-tête X-Model-Used et le premier
                      événement SSE {"modele": "..."}. Toute erreur OpenAI (HTTP ≥ 400) est
                      journalisée avec son corps JSON exact sur la console du serveur.

Synchronisation multi-appareils (chiffrée de bout en bout dans le navigateur, voir sync.js)
  GET | PUT | DELETE /api/sync/<id>  → enveloppe opaque stockée dans .sync_local/ (ignoré par Git) ;
                      en production, worker.js la range dans Cloudflare KV. PUT exige la révision courante (409 « conflit » sinon).

La clé OPENAI_API_KEY est lue dans l'environnement ou dans le fichier `.env`
(ignoré par Git). Elle ne quitte jamais ce processus : le navigateur n'en
voit pas la couleur, et rien n'est loggé. Voir .env.example.

Vie privée (CLAUDE.md) : avant tout appel au cloud, `sanitiser_texte` masque
e-mails, IBAN, téléphones, numéros de carte, noms d'établissements et montants
en euros. Le navigateur envoie déjà un profil anonymisé (pourcentages, ratios) ;
ce filtre est une seconde ligne de défense.
"""

import http.client
import json
import mimetypes
import os
import re
import sys
import threading
import time
import unicodedata
import urllib.error
import urllib.request
from collections import deque
from datetime import datetime, timezone
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

RACINE = Path(__file__).resolve().parent
HOTE = "127.0.0.1"
URL_OPENAI = "https://api.openai.com/v1/chat/completions"

# Routage multi-modèles (miroir exact de worker.js).
MODEL_FAST = "gpt-5.4-mini"      # chat général, synthèse, RAG
MODEL_REASONING = "o3"           # arbitrages patrimoniaux complexes (modèle phare : pool gratuit de 250 k tokens/jour)
# Mots-clés (normalisés : minuscules, sans accents ni tirets) qui déclenchent MODEL_REASONING.
MOTS_COMPLEXES = (
    "sasu", "eurl", "holding", "demembrement", "usufruit", "nue-propriete",
    "succession", "donation", "ifi", "decumulation", "audit complet",
)
# Deux pools gratuits Data Sharing, comptés séparément (prompt + completion, raisonnement inclus) :
#   « rapide »      : modèles mini, 2,5 M tokens/jour → plafond de sécurité 2 350 000 (au-delà : refus 429, repli local côté client)
#   « raisonnement » : modèles phares (o3), 250 k tokens/jour → plafond 225 000 (au-delà : repli sur MODEL_FAST en effort « high »)
PLAFOND_RAPIDE = 2_350_000
PLAFOND_RAISONNEMENT = 225_000
ALERTE_RAISONNEMENT = 200_000        # alerte de log du pool raisonnement (l'alerte du pool rapide : OPENAI_DAILY_TOKEN_ALERT, 2,2 M)
MAX_COMPLETION_RAISONNEMENT = 2500   # o3 (et repli « high ») : reasoning_tokens + réponse + balises [[ACTION]] / [[SUGGESTION]]
MAX_COMPLETION_RAPIDE = 1500         # famille gpt-5 rapide (effort « low ») : même contrainte, plafond plus bas
LIBELLE_REPLI_ELEVE = "{} (raisonnement élevé · quota {} préservé)"
LIBELLE_REPLI_INDISPONIBLE = "{} (raisonnement élevé · {} indisponible)"
# Codes HTTP d'OpenAI pour lesquels un modèle de raisonnement refusé est remplacé par MODEL_FAST en effort « high » :
# 400 (paramètre ou streaming refusé), 403 (organisation non vérifiée), 404 (model_not_found, déprécié), 429 (limite du modèle).
# Pas 401 (clé invalide : MODEL_FAST échouerait aussi).
STATUTS_REPLI = (400, 403, 404, 429)


# ---------------------------------------------------------------- configuration
def charger_env(chemin: Path) -> None:
    """Charge un fichier .env minimal (CLE=valeur) sans écraser l'environnement existant."""
    try:
        lignes = chemin.read_text(encoding="utf-8").splitlines()
    except OSError:
        return
    for ligne in lignes:
        ligne = ligne.strip()
        if not ligne or ligne.startswith("#") or "=" not in ligne:
            continue
        cle, valeur = ligne.split("=", 1)
        cle, valeur = cle.strip(), valeur.strip()
        if len(valeur) >= 2 and valeur[0] == valeur[-1] and valeur[0] in "\"'":
            valeur = valeur[1:-1]
        if cle and cle not in os.environ:
            os.environ[cle] = valeur


charger_env(RACINE / ".env")

CLE_VALIDE = re.compile(r"^sk-[A-Za-z0-9_\-]{20,}$")


def cle_openai() -> str | None:
    """Clé API valide, sinon None (le modèle `sk-...` de .env.example est refusé)."""
    cle = os.environ.get("OPENAI_API_KEY", "").strip()
    return cle if CLE_VALIDE.match(cle) else None


def modele_chat() -> str:
    return os.environ.get("OPENAI_MODEL_CHAT", "").strip() or MODEL_FAST


def modele_raisonnement() -> str | None:
    """Modèle de raisonnement (arbitrages complexes). Actif par défaut ;
    OPENAI_ENABLE_REASONING=0 sert de coupe-circuit (tout reste sur le modèle rapide)."""
    if os.environ.get("OPENAI_ENABLE_REASONING", "1").strip() == "0":
        return None
    return os.environ.get("OPENAI_MODEL_REASONING", "").strip() or MODEL_REASONING


def est_raisonnement(modele: str) -> bool:
    """o3/o4… et gpt-5… : max_completion_tokens, pas de temperature, rôle « developer »."""
    return re.match(r"^(o\d|gpt-5)", modele) is not None


def _entier_env(nom: str, defaut: int) -> int:
    try:
        return int(os.environ.get(nom, "").strip() or defaut)
    except ValueError:
        return defaut


def seuil_alerte() -> int:
    return _entier_env("OPENAI_DAILY_TOKEN_ALERT", 2_200_000)


def plafond_quota(pool: str) -> int:
    """Plafond de sécurité journalier (tokens) du pool « rapide » (2,5 M gratuits) ou « raisonnement » (250 k gratuits)."""
    if pool == "raisonnement":
        return _entier_env("OPENAI_QUOTA_RAISONNEMENT_MAX", PLAFOND_RAISONNEMENT)
    return _entier_env("OPENAI_QUOTA_RAPIDE_MAX", PLAFOND_RAPIDE)


def seuil_alerte_pool(pool: str) -> int:
    return _entier_env("OPENAI_DAILY_TOKEN_ALERT_REASONING", ALERTE_RAISONNEMENT) if pool == "raisonnement" else seuil_alerte()


def normaliser(texte: str) -> str:
    """Minuscules, sans accents, ponctuation et tirets remplacés par des espaces (« Nue-propriété » → « nue propriete »)."""
    sans_accents = "".join(c for c in unicodedata.normalize("NFD", texte.lower()) if unicodedata.category(c) != "Mn")
    return re.sub(r"[^a-z0-9]+", " ", sans_accents).strip()


RE_COMPLEXE = re.compile(
    r"(?<![a-z0-9])(?:" + "|".join(re.escape(normaliser(m)) for m in MOTS_COMPLEXES) + r")s?(?![a-z0-9])"
)


def question_complexe(texte: str) -> bool:
    """Le dernier message utilisateur contient-il un mot-clé d'arbitrage complexe (mot entier, pluriel toléré) ?"""
    return RE_COMPLEXE.search(normaliser(texte)) is not None


def choisir_modele(d: dict, tokens: dict | None = None) -> dict:
    """Routage selon la demande et les deux compteurs journaliers `tokens` = {"rapide": n, "raisonnement": m}.

      - question simple (ou coupe-circuit)                → MODEL_FAST, effort « low »          (pool rapide)
      - approfondi / mot-clé, pool raisonnement < 225 k   → MODEL_REASONING, effort « medium »  (pool raisonnement)
      - approfondi / mot-clé, pool raisonnement ≥ 225 k   → MODEL_FAST, effort « high » (libellé « quota … préservé »)
      - dès que le pool rapide atteint son plafond (2,35 M), tout appel au modèle rapide est refusé (429 quota_journalier) :
        au-delà des 2,5 M gratuits, OpenAI facturerait ; le client retombe sur le repli local.
    Retourne {"modele", "libelle", "pool", "effort", "max_completion"} ; `libelle` est affiché au client,
    `modele` part chez OpenAI."""
    tokens = tokens or {}
    rapide = modele_chat()
    demande = d.get("approfondi") is True or question_complexe(d.get("question", ""))
    lourd = modele_raisonnement()
    if demande and lourd and tokens.get("raisonnement", 0) < plafond_quota("raisonnement"):
        return {"modele": lourd, "libelle": lourd, "pool": "raisonnement", "effort": "medium",
                "max_completion": _entier_env("OPENAI_MAX_COMPLETION_TOKENS", MAX_COMPLETION_RAISONNEMENT)}
    if tokens.get("rapide", 0) >= plafond_quota("rapide"):
        raise ErreurAPI(429, "quota_journalier")
    if demande and lourd:  # quota du modèle phare épuisé : le modèle rapide prend le relais en effort élevé
        return {"modele": rapide, "libelle": LIBELLE_REPLI_ELEVE.format(rapide, lourd), "pool": "rapide", "effort": "high",
                "max_completion": _entier_env("OPENAI_MAX_COMPLETION_TOKENS", MAX_COMPLETION_RAISONNEMENT)}
    return {"modele": rapide, "libelle": rapide, "pool": "rapide", "effort": "low",
            "max_completion": _entier_env("OPENAI_MAX_COMPLETION_TOKENS_FAST", MAX_COMPLETION_RAPIDE)}


def choix_repli(choix: dict, statut: int, tokens: dict | None = None) -> dict | None:
    """Le modèle de raisonnement vient d'être refusé par OpenAI (`statut`) : MODEL_FAST en effort « high » prend le relais
    plutôt que d'abandonner en réponse locale. Aucun repli pour un modèle rapide, pour une clé refusée (401) ou si le
    plafond du pool rapide est atteint (le refus d'origine est alors renvoyé tel quel)."""
    if choix["pool"] != "raisonnement" or statut not in STATUTS_REPLI:
        return None
    if (tokens or {}).get("rapide", 0) >= plafond_quota("rapide"):
        return None
    rapide = modele_chat()
    return {"modele": rapide, "libelle": LIBELLE_REPLI_INDISPONIBLE.format(rapide, choix["modele"]), "pool": "rapide", "effort": "high",
            "max_completion": _entier_env("OPENAI_MAX_COMPLETION_TOKENS", MAX_COMPLETION_RAISONNEMENT)}


# Limites de taille (le navigateur n'envoie jamais rien de proche)
MAX_CORPS = 64 * 1024
MAX_SYSTEME = 24_000
MAX_PROFIL = 4_000
MAX_MESSAGES = 20
MAX_TOTAL_MESSAGES = 12_000
MAX_REQUETES_PAR_MINUTE = 30


# ---------------------------------------------------------------- anonymisation
ETABLISSEMENTS = [
    "Trade Republic", "Boursorama", "Boursobank", "Finary", "Fortuneo", "Hello bank", "Revolut", "N26",
    "BNP Paribas", "BNP", "Société Générale", "Crédit Agricole", "Caisse d'Épargne", "Caisse d'Epargne",
    "Crédit Mutuel", "CIC", "LCL", "La Banque Postale", "Banque Populaire", "HSBC", "ING", "Monabanq",
    "Degiro", "Interactive Brokers", "Saxo", "Linxea", "Yomoni", "Nalo", "Bitstack", "Binance",
    "Coinbase", "Kraken", "Ledger", "Bitpanda", "Crypto.com", "Spirica", "Generali", "Boursier",
]
RE_ETABLISSEMENT = re.compile(
    r"(?<![\w])(?:" + "|".join(re.escape(e) for e in sorted(ETABLISSEMENTS, key=len, reverse=True)) + r")(?![\w])",
    re.IGNORECASE,
)
RE_EMAIL = re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+")
RE_IBAN = re.compile(r"\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){3,7}(?: ?[A-Z0-9]{1,3})?\b")
RE_TEL = re.compile(r"(?<!\d)(?:\+33|0033|0)\s?[1-9](?:[\s.-]?\d{2}){4}(?!\d)")
RE_CARTE = re.compile(r"(?<!\d)(?:\d[ -]?){13,19}(?!\d)")
RE_MONTANT = re.compile(
    r"(?<![\d.,])[-−+]?(?:\d{1,3}(?:[\s  .]\d{3})+|\d+)(?:[.,]\d+)?[\s  ]?(?:k[\s  ]?€|k[\s  ]?euros?|€|euros?)(?![\w])",
    re.IGNORECASE,
)


def sanitiser_texte(texte: str, strict: bool = True) -> tuple[str, int]:
    """Masque les données personnelles. `strict` ajoute établissements et montants en euros
    (contenu saisi par l'utilisateur ou profil) ; le prompt système public reste lisible."""
    n = 0

    def remplacer(motif: re.Pattern, repl: str, t: str) -> str:
        nonlocal n
        t, k = motif.subn(repl, t)
        n += k
        return t

    texte = remplacer(RE_EMAIL, "[e-mail masqué]", texte)
    texte = remplacer(RE_IBAN, "[IBAN masqué]", texte)
    texte = remplacer(RE_TEL, "[téléphone masqué]", texte)
    texte = remplacer(RE_CARTE, "[numéro masqué]", texte)
    if strict:
        texte = remplacer(RE_ETABLISSEMENT, "[établissement]", texte)
        texte = remplacer(RE_MONTANT, "[montant]", texte)
    return texte, n


def corps_erreur_openai(e: urllib.error.HTTPError, limite: int = 2000) -> str:
    """Corps JSON exact de l'erreur OpenAI (diagnostic 400/401/404/429…), sur une ligne, tronqué, clés masquées.
    N'est écrit que dans la console du serveur local, jamais renvoyé au navigateur."""
    try:
        brut = e.read(4 * limite).decode("utf-8", "replace")
    except (OSError, http.client.HTTPException):
        return "(corps illisible)"
    brut = re.sub(r"sk-[A-Za-z0-9*_\-.]{4,}", "sk-…", re.sub(r"\s+", " ", brut).strip())  # OpenAI masque déjà la clé ; ceinture et bretelles
    return (brut[:limite] + "…") if len(brut) > limite else (brut or "(corps vide)")


class ErreurAPI(Exception):
    def __init__(self, statut: int, code: str):
        super().__init__(code)
        self.statut = statut
        self.code = code


def valider_requete(payload) -> dict:
    """Ne garde que les champs attendus, borne les tailles, anonymise."""
    if not isinstance(payload, dict):
        raise ErreurAPI(400, "requete_invalide")
    systeme = payload.get("systeme", "")
    profil = payload.get("profil", "")
    messages = payload.get("messages")
    if not isinstance(systeme, str) or not isinstance(profil, str) or not isinstance(messages, list):
        raise ErreurAPI(400, "requete_invalide")
    if len(systeme) > MAX_SYSTEME or len(profil) > MAX_PROFIL:
        raise ErreurAPI(413, "trop_long")
    if not 1 <= len(messages) <= MAX_MESSAGES:
        raise ErreurAPI(400, "requete_invalide")

    masques = 0
    systeme, k = sanitiser_texte(systeme, strict=False)
    masques += k
    profil, k = sanitiser_texte(profil, strict=True)
    masques += k

    propres, total = [], 0
    for m in messages:
        if not isinstance(m, dict) or m.get("role") not in ("user", "assistant") or not isinstance(m.get("content"), str):
            raise ErreurAPI(400, "requete_invalide")
        total += len(m["content"])
        texte, k = sanitiser_texte(m["content"], strict=True)
        masques += k
        propres.append({"role": m["role"], "content": texte})
    if total > MAX_TOTAL_MESSAGES:
        raise ErreurAPI(413, "trop_long")
    if propres[-1]["role"] != "user":
        raise ErreurAPI(400, "requete_invalide")
    return {
        "systeme": systeme,
        "profil": profil,
        "messages": propres,
        # « Analyse approfondie » (toggle du chat) ; l'ancien champ `raisonnement` reste accepté comme alias.
        "approfondi": payload.get("modeApprofondi") is True or payload.get("raisonnement") is True,
        "question": propres[-1]["content"],
        # Flux SSE seulement si le client le demande (stream: true) ; sinon réponse JSON classique.
        "stream": payload.get("stream") is True,
        "masques": masques,
    }


def corps_openai(d: dict, choix: dict | None = None) -> tuple[dict, str]:
    """Construit la requête OpenAI. Règles par famille de modèle (CLAUDE.md) :
      - o3/o4… (MODEL_REASONING) : rôle « developer », pas de temperature, reasoning_effort « medium »,
        max_completion_tokens 2500 (reasoning_tokens + réponse finale + balises) ;
      - gpt-5… rapide : mêmes règles de paramètres (temperature et max_tokens y sont refusés), effort « low »
        et 1500 tokens — ou « high » et 2500 quand il remplace o3 (quota phare épuisé) ;
      - modèles classiques (gpt-4…) : rôle « system », temperature 0.2, max_tokens 800."""
    choix = choix or choisir_modele(d)
    modele = choix["modele"]
    raisonne = est_raisonnement(modele)
    consigne = d["systeme"]
    if d["profil"]:
        consigne += "\n\nPROFIL DE L'UTILISATEUR (anonymisé) :\n" + d["profil"]
    corps = {
        "model": modele,
        "messages": [{"role": "developer" if raisonne else "system", "content": consigne}] + d["messages"],
        "stream": d["stream"],
    }
    if raisonne:
        # Les jetons de raisonnement comptent dans ce plafond : marge nécessaire. Jamais de temperature.
        corps["reasoning_effort"] = choix["effort"]
        corps["max_completion_tokens"] = choix["max_completion"]
    else:
        corps["temperature"] = 0.2
        corps["max_tokens"] = 800  # marge pour les balises [[ACTION:…]] et [[SUGGESTION:…]]
    if d["stream"]:
        corps["stream_options"] = {"include_usage": True}
    return corps, modele


# ---------------------------------------------------------------- quota journalier
POOLS = ("rapide", "raisonnement")


class Quota:
    """Tokens consommés par jour UTC (prompt + completion, raisonnement inclus), un compteur par pool gratuit
    (« rapide » : modèles mini ; « raisonnement » : modèles phares). Alerte de log au seuil de chaque pool."""

    def __init__(self, fichier: Path):
        self.fichier = fichier
        self.verrou = threading.Lock()
        self.jour, self.tokens, self.alertes = self._lire()

    @staticmethod
    def _aujourdhui() -> str:
        return datetime.now(timezone.utc).strftime("%Y-%m-%d")

    def _vide(self):
        return self._aujourdhui(), {p: 0 for p in POOLS}, {p: False for p in POOLS}

    def _lire(self):
        jour, tokens, alertes = self._vide()
        try:
            d = json.loads(self.fichier.read_text(encoding="utf-8"))
            if d.get("jour") == jour:
                brut = d.get("tokens", 0)
                if isinstance(brut, dict):
                    for p in POOLS:
                        tokens[p] = int(brut.get(p, 0) or 0)
                        alertes[p] = bool((d.get("alertes") or {}).get(p, False))
                else:  # ancien format : un seul compteur, attribué au pool rapide
                    tokens["rapide"], alertes["rapide"] = int(brut or 0), bool(d.get("alerte", False))
        except (OSError, ValueError, TypeError):
            pass
        return jour, tokens, alertes

    def _roulement(self) -> None:
        if self.jour != self._aujourdhui():  # minuit UTC passé : les compteurs repartent de zéro
            self.jour, self.tokens, self.alertes = self._vide()

    def tokens_du_jour(self, pool: str | None = None):
        """Tokens du pool demandé aujourd'hui (UTC) ; sans argument : {"rapide": n, "raisonnement": m}."""
        with self.verrou:
            self._roulement()
            return dict(self.tokens) if pool is None else self.tokens.get(pool, 0)

    def ajouter(self, usage: dict | None, pool: str = "rapide") -> None:
        if not usage:
            return
        n = int(usage.get("prompt_tokens", 0) or 0) + int(usage.get("completion_tokens", 0) or 0)
        with self.verrou:
            self._roulement()
            self.tokens[pool] = self.tokens.get(pool, 0) + n
            seuil = seuil_alerte_pool(pool)
            if self.tokens[pool] >= seuil and not self.alertes.get(pool):
                self.alertes[pool] = True
                sys.stderr.write(f"[plan-patrimoine] ALERTE QUOTA ({pool}) : {self.tokens[pool]} tokens aujourd'hui (seuil {seuil}).\n")
            try:
                self.fichier.write_text(json.dumps({"jour": self.jour, "tokens": self.tokens, "alertes": self.alertes}), encoding="utf-8")
            except OSError:
                pass


QUOTA = Quota(RACINE / ".quota-tokens.json")
_RECENTES: deque = deque()
_VERROU_RATE = threading.Lock()


def limite_atteinte() -> bool:
    maintenant = time.monotonic()
    with _VERROU_RATE:
        while _RECENTES and maintenant - _RECENTES[0] > 60:
            _RECENTES.popleft()
        if len(_RECENTES) >= MAX_REQUETES_PAR_MINUTE:
            return True
        _RECENTES.append(maintenant)
        return False


# ---------------------------------------------------------------- synchronisation chiffrée (stockage de développement)
# Le serveur ne voit qu'une enveloppe opaque chiffrée dans le navigateur (voir sync.js) : il ne peut pas la lire.
# En production, c'est worker.js + Cloudflare KV qui joue ce rôle ; ici, un fichier par identifiant dans .sync_local/
# (dossier caché : jamais servi par ce serveur, ignoré par Git).
DOSSIER_SYNC = RACINE / ".sync_local"
RE_ID_SYNC = re.compile(r"^[A-Za-z0-9_-]{43}$")
RE_B64URL = re.compile(r"^[A-Za-z0-9_-]+$")
MAX_SYNC = 256 * 1024
_VERROU_SYNC = threading.Lock()


def valider_enveloppe_sync(e) -> tuple[dict, int]:
    """Valide l'enveloppe reçue ; ne conserve que les champs attendus. Retourne (enveloppe, révision de départ)."""
    def entier(x) -> bool:
        return isinstance(x, int) and not isinstance(x, bool)
    ok = (
        isinstance(e, dict) and e.get("v") == 1 and e.get("kdf") == "PBKDF2-SHA256"
        and entier(e.get("iter")) and 100_000 <= e["iter"] <= 1_000_000
        and entier(e.get("rev")) and 1 <= e["rev"] < 10**9
        and entier(e.get("base")) and e["base"] == e["rev"] - 1
    )
    if ok:
        for cle, mini, maxi in (("sel", 16, 64), ("iv", 16, 16), ("ct", 22, MAX_SYNC)):
            v = e.get(cle)
            if not (isinstance(v, str) and mini <= len(v) <= maxi and RE_B64URL.match(v)):
                ok = False
    if not ok:
        raise ErreurAPI(400, "enveloppe_invalide")
    return {k: e[k] for k in ("v", "rev", "kdf", "iter", "sel", "iv", "ct")}, e["base"]


def _fichier_sync(id_sync: str) -> Path:
    if not RE_ID_SYNC.match(id_sync):  # empêche toute traversée de dossier
        raise ErreurAPI(400, "identifiant_invalide")
    return DOSSIER_SYNC / f"{id_sync}.json"


def lire_sync(id_sync: str) -> str | None:
    try:
        return _fichier_sync(id_sync).read_text(encoding="utf-8")
    except FileNotFoundError:
        return None


def ecrire_sync(id_sync: str, enveloppe: dict, base: int) -> tuple[bool, int]:
    """Écriture avec verrou optimiste. Retourne (acceptée, révision courante)."""
    fichier = _fichier_sync(id_sync)
    with _VERROU_SYNC:
        actuel = lire_sync(id_sync)
        rev = 0
        if actuel is not None:
            try:
                rev = int(json.loads(actuel).get("rev") or 0)
            except (ValueError, AttributeError):
                rev = 0
        if rev != base:
            return False, rev
        DOSSIER_SYNC.mkdir(mode=0o700, exist_ok=True)
        tmp = fichier.with_suffix(".tmp")
        tmp.write_text(json.dumps(enveloppe), encoding="utf-8")
        os.replace(tmp, fichier)  # écriture atomique
        return True, enveloppe["rev"]


def effacer_sync(id_sync: str) -> None:
    with _VERROU_SYNC:
        try:
            _fichier_sync(id_sync).unlink()
        except FileNotFoundError:
            pass


# ---------------------------------------------------------------- serveur HTTP
# Les modules ES exigent un type MIME JavaScript valide.
mimetypes.add_type("text/javascript", ".js")
mimetypes.add_type("image/svg+xml", ".svg")

# Fichiers qui ne doivent jamais être servis (secrets, sources serveur, config).
INTERDITS = {"serveur.py", "worker.js", "claude.md", "license", "wrangler.toml"}


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(RACINE), **kwargs)

    # -- utilitaires
    def _chemin(self) -> str:
        return self.path.split("?", 1)[0]

    def _chemin_interdit(self) -> bool:
        parties = [p for p in self._chemin().split("/") if p]
        for p in parties:
            bas = p.lower()
            if bas.startswith(".") or bas in INTERDITS or bas == "prompt":
                return True
        return False

    def _json(self, statut: int, objet: dict, modele: str | None = None) -> None:
        corps = json.dumps(objet, ensure_ascii=False).encode("utf-8")
        self.send_response(statut)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(corps)))
        if modele:
            self.send_header("X-Model-Used", modele)
        self.end_headers()
        self.wfile.write(corps)

    def _origine_ok(self) -> bool:
        """Refuse tout appel venant d'un autre site (la clé ne doit servir qu'à cette page)."""
        hote = self.headers.get("Host", "").rsplit(":", 1)[0].lower()
        if hote not in ("localhost", "127.0.0.1"):
            return False
        origine = self.headers.get("Origin")
        return origine is None or re.match(r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$", origine) is not None

    def _evenement(self, objet: dict) -> bool:
        try:
            self.wfile.write(b"data: " + json.dumps(objet, ensure_ascii=False).encode("utf-8") + b"\n\n")
            self.wfile.flush()
            return True
        except (BrokenPipeError, ConnectionResetError):
            return False

    # -- synchronisation chiffrée : GET / PUT / DELETE /api/sync/<id>
    def _sync(self, methode: str) -> None:
        try:
            if not self._origine_ok():
                raise ErreurAPI(403, "origine_refusee")
            id_sync = self._chemin()[len("/api/sync/"):]
            _fichier_sync(id_sync)  # valide l'identifiant (400 sinon)
            if methode == "GET":
                brut = lire_sync(id_sync)
                if brut is None:
                    raise ErreurAPI(404, "introuvable")
                corps = brut.encode("utf-8")
                self.send_response(200)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Content-Length", str(len(corps)))
                self.end_headers()
                self.wfile.write(corps)
            elif methode == "DELETE":
                effacer_sync(id_sync)
                self._json(200, {"ok": True})
            else:
                try:
                    longueur = int(self.headers.get("Content-Length", "0"))
                except ValueError:
                    longueur = -1
                if longueur < 0:
                    raise ErreurAPI(400, "requete_invalide")
                if longueur > MAX_SYNC + 1024:
                    raise ErreurAPI(413, "taille_excessive")
                try:
                    corps = json.loads(self.rfile.read(longueur).decode("utf-8"))
                except (ValueError, UnicodeDecodeError):
                    raise ErreurAPI(400, "json_invalide")
                enveloppe, base = valider_enveloppe_sync(corps)
                acceptee, rev = ecrire_sync(id_sync, enveloppe, base)
                if not acceptee:
                    self._json(409, {"erreur": "conflit", "rev": rev})
                else:
                    self._json(200, {"ok": True, "rev": rev})
        except ErreurAPI as e:
            self._json(e.statut, {"erreur": e.code})
        except (BrokenPipeError, ConnectionResetError):
            pass
        except OSError as e:  # disque : jamais de détail (chemin) vers le navigateur
            sys.stderr.write(f"[plan-patrimoine] erreur de stockage sync : {type(e).__name__}\n")
            self._json(500, {"erreur": "interne"})

    def do_PUT(self):
        if self._chemin().startswith("/api/sync/"):
            self._sync("PUT")
        else:
            self.send_error(404, "Introuvable")

    def do_DELETE(self):
        if self._chemin().startswith("/api/sync/"):
            self._sync("DELETE")
        else:
            self.send_error(404, "Introuvable")

    # -- routes
    def do_GET(self):
        if self._chemin_interdit():
            self.send_error(404, "Introuvable")
            return
        if self._chemin().startswith("/api/sync/"):
            self._sync("GET")
            return
        if self._chemin() == "/api/statut":
            if not self._origine_ok():
                self._json(403, {"erreur": "origine_refusee"})
                return
            self._json(200, {"actif": cle_openai() is not None, "modele": modele_chat()})
            return
        if self._chemin().startswith("/api/"):
            self.send_error(404, "Introuvable")
            return
        super().do_GET()

    def do_HEAD(self):
        if self._chemin_interdit() or self._chemin().startswith("/api/"):
            self.send_error(404, "Introuvable")
            return
        super().do_HEAD()

    def do_POST(self):
        if self._chemin() != "/api/chat":
            self.send_error(404, "Introuvable")
            return
        self._flux_ouvert = False  # vrai dès que les en-têtes SSE sont partis : plus de réponse JSON possible
        try:
            self._chat()
        except ErreurAPI as e:
            if self._flux_ouvert:
                self._evenement({"erreur": e.code})
            else:
                self._json(e.statut, {"erreur": e.code})
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception as e:  # ne jamais laisser fuiter de détails (ni la clé) au navigateur
            sys.stderr.write(f"[plan-patrimoine] erreur inattendue : {type(e).__name__}\n")
            try:
                if self._flux_ouvert:
                    self._evenement({"erreur": "flux"})
                else:
                    self._json(500, {"erreur": "interne"})
            except OSError:
                pass

    def _chat(self) -> None:
        if not self._origine_ok():
            raise ErreurAPI(403, "origine_refusee")
        if not self.headers.get("Content-Type", "").lower().startswith("application/json"):
            raise ErreurAPI(415, "json_attendu")
        try:
            longueur = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            raise ErreurAPI(400, "requete_invalide")
        if longueur <= 0 or longueur > MAX_CORPS:
            raise ErreurAPI(413, "trop_long")
        try:
            payload = json.loads(self.rfile.read(longueur).decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            raise ErreurAPI(400, "requete_invalide")

        cle = cle_openai()
        if cle is None:
            raise ErreurAPI(503, "no_key")
        donnees = valider_requete(payload)
        if limite_atteinte():
            raise ErreurAPI(429, "trop_de_requetes")

        choix = choisir_modele(donnees, QUOTA.tokens_du_jour())  # peut refuser (429 quota_journalier) : plafond du pool rapide
        entetes = {"Authorization": f"Bearer {cle}", "Content-Type": "application/json"}
        for tentative in (1, 2):  # 2e tentative seulement si le modèle de raisonnement est refusé (voir choix_repli)
            corps, modele = corps_openai(donnees, choix)
            libelle = choix["libelle"]  # affiché au client (peut préciser « quota o3 préservé » ou « o3 indisponible »)
            pool = choix["pool"]        # compteur de quota à créditer
            requete = urllib.request.Request(URL_OPENAI, data=json.dumps(corps).encode("utf-8"), headers=entetes, method="POST")
            try:
                reponse = urllib.request.urlopen(requete, timeout=60)
                break
            except urllib.error.HTTPError as e:
                sys.stderr.write(f"[plan-patrimoine] OpenAI a répondu {e.code} (modèle {modele}) : {corps_erreur_openai(e)}\n")
                repli = choix_repli(choix, e.code, QUOTA.tokens_du_jour()) if tentative == 1 else None
                if repli is None:
                    raise ErreurAPI(502 if e.code in (400, 401, 403, 404) else (429 if e.code == 429 else 502), f"openai_{e.code}")
                sys.stderr.write(f"[plan-patrimoine] Repli : {repli['modele']} en effort « {repli['effort']} » à la place de {modele}.\n")
                choix = repli
            except (urllib.error.URLError, TimeoutError, OSError):
                raise ErreurAPI(504, "reseau")

        with reponse:
            if not donnees["stream"]:
                data = json.loads(reponse.read().decode("utf-8"))
                QUOTA.ajouter(data.get("usage"), pool)
                texte = ((data.get("choices") or [{}])[0].get("message") or {}).get("content") or ""
                self._json(200, {"reponse": texte, "modele": libelle, "masques": donnees["masques"]}, modele)
                return

            # Flux normalisé : {"modele": "..."} puis {"delta": "..."} … puis {"fin": true, "modele": "...", "masques": n}
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream; charset=utf-8")
            self.send_header("Cache-Control", "no-cache")
            self.send_header("X-Accel-Buffering", "no")
            self.send_header("X-Model-Used", modele)  # identifiant technique, ASCII
            self.end_headers()
            self._flux_ouvert = True
            self._evenement({"modele": libelle})
            usage = None
            termine = False  # OpenAI clôt toujours son flux par « [DONE] » ; sinon la réponse est tronquée
            try:
                for brut in reponse:
                    ligne = brut.decode("utf-8", "replace").strip()
                    if not ligne.startswith("data:"):
                        continue
                    contenu = ligne[5:].strip()
                    if contenu == "[DONE]":
                        termine = True
                        break
                    try:
                        morceau = json.loads(contenu)
                    except ValueError:
                        continue
                    usage = morceau.get("usage") or usage
                    options = morceau.get("choices") or []
                    delta = (options[0].get("delta") or {}).get("content") if options else None
                    if delta and not self._evenement({"delta": delta}):
                        break
            except (OSError, http.client.HTTPException):
                # Coupure côté OpenAI en plein flux : on prévient le navigateur proprement.
                QUOTA.ajouter(usage, pool)
                self._evenement({"erreur": "flux"})
                return
            QUOTA.ajouter(usage, pool)
            fin = {"fin": True, "modele": libelle, "masques": donnees["masques"]}
            if not termine:
                fin["interrompu"] = True
            self._evenement(fin)

    def end_headers(self):
        # Pas de cache en développement : les modifications sont visibles au rechargement.
        self.send_header("Cache-Control", "no-cache")
        self.send_header("X-Content-Type-Options", "nosniff")
        super().end_headers()

    def log_message(self, fmt, *args):
        sys.stderr.write("[plan-patrimoine] " + (fmt % args) + "\n")


def main() -> None:
    try:
        port = int(sys.argv[1]) if len(sys.argv) > 1 else int(os.environ.get("PORT", 8080))
    except ValueError:
        sys.exit("Port invalide. Usage : python3 serveur.py [port]")
    with ThreadingHTTPServer((HOTE, port), Handler) as httpd:
        print(f"Plan Patrimoine → http://localhost:{port}  (Ctrl+C pour arrêter)")
        if cle_openai():
            print(f"Assistant : OpenAI ({modele_chat()}) actif.")
        else:
            print("Assistant : clé OPENAI_API_KEY absente ou invalide → mode local uniquement (voir .env.example).")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nArrêt du serveur.")


if __name__ == "__main__":
    main()
