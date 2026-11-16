#!/usr/bin/env python3
"""Serveur local de « Plan Patrimoine » : fichiers statiques + relais sécurisé vers OpenAI.

Usage :  python3 serveur.py [port]      (défaut : 8080, ou variable PORT)

Écoute uniquement sur 127.0.0.1 : rien n'est exposé sur le réseau.

Assistant IA
  GET  /api/statut  → {"actif": bool, "modele": "..."}      (sans appeler OpenAI)
  POST /api/chat    → relais vers https://api.openai.com/v1/chat/completions
                      flux SSE normalisé (voir _chat) si le client envoie stream=true,
                      sinon réponse JSON classique {"reponse", "modele", "masques"}

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
import urllib.error
import urllib.request
from collections import deque
from datetime import datetime, timezone
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

RACINE = Path(__file__).resolve().parent
HOTE = "127.0.0.1"
URL_OPENAI = "https://api.openai.com/v1/chat/completions"


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
    return os.environ.get("OPENAI_MODEL_CHAT", "").strip() or "gpt-4.1-mini"


def modele_raisonnement() -> str | None:
    """Modèle de raisonnement (arbitrages complexes), actif seulement si OPENAI_ENABLE_REASONING=1."""
    if os.environ.get("OPENAI_ENABLE_REASONING", "0").strip() != "1":
        return None
    return os.environ.get("OPENAI_MODEL_REASONING", "").strip() or "o4-mini"


def est_raisonnement(modele: str) -> bool:
    """o3/o4… et gpt-5… : max_completion_tokens, pas de temperature, rôle « developer »."""
    return re.match(r"^(o\d|gpt-5)", modele) is not None


def seuil_alerte() -> int:
    try:
        return int(os.environ.get("OPENAI_DAILY_TOKEN_ALERT", "2200000"))
    except ValueError:
        return 2_200_000


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
        "raisonnement": payload.get("raisonnement") is True,
        # Flux SSE seulement si le client le demande (stream: true) ; sinon réponse JSON classique.
        "stream": payload.get("stream") is True,
        "masques": masques,
    }


def corps_openai(d: dict) -> tuple[dict, str]:
    """Construit la requête OpenAI. Règles par famille de modèle (CLAUDE.md)."""
    modele = (modele_raisonnement() if d["raisonnement"] else None) or modele_chat()
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
        try:
            corps["max_completion_tokens"] = int(os.environ.get("OPENAI_MAX_COMPLETION_TOKENS", "2500"))
        except ValueError:
            corps["max_completion_tokens"] = 2500
    else:
        corps["temperature"] = 0.2
        corps["max_tokens"] = 800  # marge pour les balises [[ACTION:…]] et [[SUGGESTION:…]]
    if d["stream"]:
        corps["stream_options"] = {"include_usage": True}
    return corps, modele


# ---------------------------------------------------------------- quota journalier
class Quota:
    """Tokens consommés par jour UTC (prompt + completion, raisonnement inclus). Alerte au seuil."""

    def __init__(self, fichier: Path):
        self.fichier = fichier
        self.verrou = threading.Lock()
        self.jour, self.tokens, self.alerte = self._lire()

    @staticmethod
    def _aujourdhui() -> str:
        return datetime.now(timezone.utc).strftime("%Y-%m-%d")

    def _lire(self):
        try:
            d = json.loads(self.fichier.read_text(encoding="utf-8"))
            if d.get("jour") == self._aujourdhui():
                return d["jour"], int(d.get("tokens", 0)), bool(d.get("alerte", False))
        except (OSError, ValueError, KeyError):
            pass
        return self._aujourdhui(), 0, False

    def ajouter(self, usage: dict | None) -> None:
        if not usage:
            return
        n = int(usage.get("prompt_tokens", 0) or 0) + int(usage.get("completion_tokens", 0) or 0)
        with self.verrou:
            if self.jour != self._aujourdhui():
                self.jour, self.tokens, self.alerte = self._aujourdhui(), 0, False
            self.tokens += n
            if self.tokens >= seuil_alerte() and not self.alerte:
                self.alerte = True
                sys.stderr.write(f"[plan-patrimoine] ALERTE QUOTA : {self.tokens} tokens aujourd'hui (seuil {seuil_alerte()}).\n")
            try:
                self.fichier.write_text(json.dumps({"jour": self.jour, "tokens": self.tokens, "alerte": self.alerte}), encoding="utf-8")
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


# ---------------------------------------------------------------- serveur HTTP
# Les modules ES exigent un type MIME JavaScript valide.
mimetypes.add_type("text/javascript", ".js")
mimetypes.add_type("image/svg+xml", ".svg")

# Fichiers qui ne doivent jamais être servis (secrets, sources serveur, config).
INTERDITS = {"serveur.py", "worker.js", "claude.md", "license"}


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

    def _json(self, statut: int, objet: dict) -> None:
        corps = json.dumps(objet, ensure_ascii=False).encode("utf-8")
        self.send_response(statut)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(corps)))
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

    # -- routes
    def do_GET(self):
        if self._chemin_interdit():
            self.send_error(404, "Introuvable")
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

        corps, modele = corps_openai(donnees)
        requete = urllib.request.Request(
            URL_OPENAI,
            data=json.dumps(corps).encode("utf-8"),
            headers={"Authorization": f"Bearer {cle}", "Content-Type": "application/json"},
            method="POST",
        )
        try:
            reponse = urllib.request.urlopen(requete, timeout=60)
        except urllib.error.HTTPError as e:
            sys.stderr.write(f"[plan-patrimoine] OpenAI a répondu {e.code}\n")
            raise ErreurAPI(502 if e.code in (400, 401, 403, 404) else (429 if e.code == 429 else 502), f"openai_{e.code}")
        except (urllib.error.URLError, TimeoutError, OSError):
            raise ErreurAPI(504, "reseau")

        with reponse:
            if not donnees["stream"]:
                data = json.loads(reponse.read().decode("utf-8"))
                QUOTA.ajouter(data.get("usage"))
                texte = ((data.get("choices") or [{}])[0].get("message") or {}).get("content") or ""
                self._json(200, {"reponse": texte, "modele": modele, "masques": donnees["masques"]})
                return

            # Flux normalisé : {"delta": "..."} … puis {"fin": true, "modele": "...", "masques": n}
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream; charset=utf-8")
            self.send_header("Cache-Control", "no-cache")
            self.send_header("X-Accel-Buffering", "no")
            self.end_headers()
            self._flux_ouvert = True
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
                    choix = morceau.get("choices") or []
                    delta = (choix[0].get("delta") or {}).get("content") if choix else None
                    if delta and not self._evenement({"delta": delta}):
                        break
            except (OSError, http.client.HTTPException):
                # Coupure côté OpenAI en plein flux : on prévient le navigateur proprement.
                QUOTA.ajouter(usage)
                self._evenement({"erreur": "flux"})
                return
            QUOTA.ajouter(usage)
            fin = {"fin": True, "modele": modele, "masques": donnees["masques"]}
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
