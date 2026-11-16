#!/usr/bin/env python3
"""Serveur de développement local de « Plan Patrimoine ».

Sert les fichiers statiques du dossier courant (aucune dépendance externe).
Usage :  python3 serveur.py [port]      (défaut : 8080, ou variable PORT)

Écoute uniquement sur 127.0.0.1 : rien n'est exposé sur le réseau.
Le proxy IA (v0.2) viendra enrichir ce fichier ; aucune clé API ne doit
jamais être codée en dur ici (voir .env.example).
"""

import mimetypes
import os
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

RACINE = Path(__file__).resolve().parent
HOTE = "127.0.0.1"

# Les modules ES exigent un type MIME JavaScript valide.
mimetypes.add_type("text/javascript", ".js")
mimetypes.add_type("image/svg+xml", ".svg")

# Fichiers qui ne doivent jamais être servis (secrets, sources serveur, config).
INTERDITS = {"serveur.py", "worker.js", "claude.md", "license"}


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(RACINE), **kwargs)

    def _chemin_interdit(self) -> bool:
        parties = [p for p in self.path.split("?", 1)[0].split("/") if p]
        for p in parties:
            bas = p.lower()
            if bas.startswith(".") or bas in INTERDITS or bas == "prompt":
                return True
        return False

    def do_GET(self):
        if self._chemin_interdit():
            self.send_error(404, "Introuvable")
            return
        super().do_GET()

    def do_HEAD(self):
        if self._chemin_interdit():
            self.send_error(404, "Introuvable")
            return
        super().do_HEAD()

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
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nArrêt du serveur.")


if __name__ == "__main__":
    main()
