#!/usr/bin/env python3
"""Découpe prix-m2.json (3 Mo) en fichiers chargés à la demande par l'application.

Sortie dans dvf/ (vidé des anciens *.json avant écriture) :
  meta.json   : periode, source, loyers, format, departements, horsDvf
  index.json  : [nom, codeINSEE, dep, codesPostaux] trié par nom normalisé (recherche et libellés)
  <dep>.json  : { codeINSEE: ligne complète } (format de ligne identique à prix-m2.json)

horsDvf = départements dont aucune commune n'a de prix (appartement ni maison) et absents de
« departements » : Alsace-Moselle, Mayotte, collectivités d'outre-mer (livre foncier, hors DVF).
À relancer après toute modification de prix-m2.json : test_immobilier.mjs échoue sinon.
Usage : python3 outils/decouper-dvf.py
"""
import json
import re
import unicodedata
from pathlib import Path

RACINE = Path(__file__).resolve().parent.parent
SOURCE = RACINE / "prix-m2.json"
SORTIE = RACINE / "dvf"


def normaliser(texte):
    """Équivalent de `normaliser` d'immobilier.js (minuscules, sans accents, tirets/apostrophes en espaces, st/ste)."""
    t = unicodedata.normalize("NFD", str(texte or "").lower())
    t = "".join(ch for ch in t if not 0x300 <= ord(ch) <= 0x36F)
    t = re.sub(r"[-'’]", " ", t)
    t = re.sub(r"\bst\b", "saint", t)
    t = re.sub(r"\bste\b", "sainte", t)
    return re.sub(r"\s+", " ", t).strip()


def ecrire(chemin, objet):
    chemin.write_text(json.dumps(objet, separators=(",", ":"), ensure_ascii=False, sort_keys=True), encoding="utf-8")


def main():
    src = json.loads(SOURCE.read_text(encoding="utf-8"))
    communes, departements = src["communes"], src["departements"]

    SORTIE.mkdir(exist_ok=True)
    for ancien in SORTIE.glob("*.json"):
        ancien.unlink()

    par_dep, avec_prix = {}, {}
    for code, ligne in communes.items():
        dep = ligne[1]
        par_dep.setdefault(dep, {})[code] = ligne
        avec_prix[dep] = avec_prix.get(dep, False) or bool(ligne[2] or ligne[3])
    hors_dvf = sorted(d for d in par_dep if not avec_prix[d] and d not in departements)

    meta = {k: src[k] for k in ("periode", "source", "loyers", "format")}
    meta["departements"] = departements
    meta["horsDvf"] = hors_dvf
    ecrire(SORTIE / "meta.json", meta)

    index = sorted(([l[0], code, l[1], l[4]] for code, l in communes.items()),
                   key=lambda e: (normaliser(e[0]), e[1]))
    ecrire(SORTIE / "index.json", index)

    for dep, lignes in par_dep.items():
        ecrire(SORTIE / f"{dep}.json", lignes)

    taille = lambda p: p.stat().st_size
    deps = [SORTIE / f"{d}.json" for d in par_dep]
    gros = max(deps, key=taille)
    print(f"{len(list(SORTIE.glob('*.json')))} fichiers dans dvf/ ({len(communes)} communes, {len(par_dep)} départements)")
    print(f"index.json {taille(SORTIE / 'index.json')} o, meta.json {taille(SORTIE / 'meta.json')} o, "
          f"plus gros département {gros.name} {taille(gros)} o")
    print("horsDvf :", ", ".join(hors_dvf))


if __name__ == "__main__":
    main()
