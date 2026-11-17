#!/usr/bin/env python3
"""Tests du routage multi-modèles de serveur.py (bibliothèque standard uniquement).

    python3 -m unittest test_routage -v

Aucun appel réseau vers OpenAI : un faux serveur local joue le rôle de l'API. Les compteurs de
quota utilisent un fichier temporaire (jamais `.quota-tokens.json`).
"""

import io
import json
import os
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from unittest import mock

import serveur

CLE_FACTICE = "sk-" + "a" * 32
ENV_NEUTRE = {
    "OPENAI_API_KEY": CLE_FACTICE,
    "OPENAI_MODEL_CHAT": "",
    "OPENAI_MODEL_REASONING": "",
    "OPENAI_ENABLE_REASONING": "1",
    "OPENAI_MAX_COMPLETION_TOKENS": "",
    "OPENAI_MAX_COMPLETION_TOKENS_FAST": "",
    "OPENAI_QUOTA_RAPIDE_MAX": "",
    "OPENAI_QUOTA_RAISONNEMENT_MAX": "",
    "OPENAI_DAILY_TOKEN_ALERT": "",
    "OPENAI_DAILY_TOKEN_ALERT_REASONING": "",
}
LIBELLE_REPLI = "gpt-5.4-mini (raisonnement élevé · quota o3 préservé)"
LIBELLE_INDISPO = "gpt-5.4-mini (raisonnement élevé · o3 indisponible)"
ERREUR_404 = json.dumps({"error": {"message": "The model `o3` does not exist or you do not have access to it.", "type": "invalid_request_error", "param": None, "code": "model_not_found"}})


def requete(question="Combien de PEA puis-je ouvrir ?", **extra):
    payload = {
        "systeme": "Tu es un assistant pédagogique.",
        "profil": "- Allocation : 60 % actions",
        "messages": [{"role": "user", "content": question}],
        "stream": True,
    }
    payload.update(extra)
    return serveur.valider_requete(payload)


class RoutageUnitaire(unittest.TestCase):
    def setUp(self):
        patcher = mock.patch.dict(os.environ, ENV_NEUTRE)
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_constantes_par_defaut(self):
        self.assertEqual((serveur.MODEL_FAST, serveur.MODEL_REASONING), ("gpt-5.4-mini", "o3"))
        self.assertEqual((serveur.PLAFOND_RAPIDE, serveur.PLAFOND_RAISONNEMENT), (2_350_000, 225_000))

    def test_question_simple_reste_sur_le_modele_rapide(self):
        choix = serveur.choisir_modele(requete())
        self.assertEqual((choix["modele"], choix["pool"], choix["effort"], choix["max_completion"]), ("gpt-5.4-mini", "rapide", "low", 1500))

    def test_mots_cles_complexes(self):
        for q in ("Une SASU ou une EURL ?", "Quelle holding choisir", "Démembrement de propriété", "Nue-propriété et usufruit",
                  "Comment préparer ma SUCCESSION", "Donations aux enfants", "Suis-je soumis à l'IFI ?", "Stratégie de décumulation",
                  "Fais un audit complet de mon plan"):
            with self.subTest(q=q):
                self.assertTrue(serveur.question_complexe(q))
                self.assertEqual(serveur.choisir_modele(requete(q))["modele"], "o3")

    def test_pas_de_faux_positif_sur_un_fragment_de_mot(self):
        for q in ("Quel bénéfice espérer ?", "Un fichier ifixe", "audit simple du budget"):
            with self.subTest(q=q):
                self.assertFalse(serveur.question_complexe(q))

    def test_mode_approfondi_force_le_raisonnement(self):
        choix = serveur.choisir_modele(requete(modeApprofondi=True))
        self.assertEqual((choix["modele"], choix["pool"], choix["effort"], choix["max_completion"]), ("o3", "raisonnement", "medium", 2500))
        self.assertEqual(serveur.choisir_modele(requete(modeApprofondi=False))["modele"], "gpt-5.4-mini")
        self.assertEqual(serveur.choisir_modele(requete(modeApprofondi="true"))["modele"], "gpt-5.4-mini")  # booléen strict

    def test_coupe_circuit(self):
        with mock.patch.dict(os.environ, {"OPENAI_ENABLE_REASONING": "0"}):
            choix = serveur.choisir_modele(requete("Succession ?", modeApprofondi=True))
        self.assertEqual((choix["modele"], choix["libelle"], choix["effort"]), ("gpt-5.4-mini", "gpt-5.4-mini", "low"))

    def test_modele_de_raisonnement_configurable(self):
        with mock.patch.dict(os.environ, {"OPENAI_MODEL_REASONING": "o3-pro"}):
            self.assertEqual(serveur.choisir_modele(requete(modeApprofondi=True))["modele"], "o3-pro")

    def test_quota_o3_proche_puis_epuise(self):
        d = requete(modeApprofondi=True)
        self.assertEqual(serveur.choisir_modele(d, {"raisonnement": 224_999})["modele"], "o3")
        choix = serveur.choisir_modele(d, {"raisonnement": 225_000})
        self.assertEqual((choix["modele"], choix["pool"], choix["effort"], choix["max_completion"]), ("gpt-5.4-mini", "rapide", "high", 2500))
        self.assertEqual(choix["libelle"], LIBELLE_REPLI)

    def test_question_simple_avec_quota_o3_epuise_garde_le_libelle_normal(self):
        choix = serveur.choisir_modele(requete(), {"raisonnement": 300_000})
        self.assertEqual((choix["libelle"], choix["effort"]), ("gpt-5.4-mini", "low"))

    def test_plafond_du_pool_rapide(self):
        d = requete()
        self.assertEqual(serveur.choisir_modele(d, {"rapide": 2_349_999})["modele"], "gpt-5.4-mini")
        for demande in (requete(), requete(modeApprofondi=True)):  # modèle rapide direct ou en repli « high »
            with self.subTest(approfondi=demande["approfondi"]):
                with self.assertRaises(serveur.ErreurAPI) as c:
                    serveur.choisir_modele(demande, {"rapide": 2_350_000, "raisonnement": 225_000})
                self.assertEqual((c.exception.statut, c.exception.code), (429, "quota_journalier"))

    def test_pools_independants(self):
        """Pool rapide saturé mais o3 disponible : o3 reste utilisable (ses 250 k sont comptés à part)."""
        choix = serveur.choisir_modele(requete(modeApprofondi=True), {"rapide": 2_400_000, "raisonnement": 10})
        self.assertEqual(choix["modele"], "o3")

    def test_plafonds_configurables(self):
        with mock.patch.dict(os.environ, {"OPENAI_QUOTA_RAISONNEMENT_MAX": "1000", "OPENAI_QUOTA_RAPIDE_MAX": "5000"}):
            self.assertEqual(serveur.choisir_modele(requete(modeApprofondi=True), {"raisonnement": 1000})["effort"], "high")
            with self.assertRaises(serveur.ErreurAPI):
                serveur.choisir_modele(requete(), {"rapide": 5000})

    def test_choix_repli_si_le_modele_de_raisonnement_est_refuse(self):
        o3 = serveur.choisir_modele(requete(modeApprofondi=True))
        for statut in (400, 403, 404, 429):
            with self.subTest(statut=statut):
                repli = serveur.choix_repli(o3, statut)
                self.assertEqual((repli["modele"], repli["effort"], repli["max_completion"], repli["pool"]), ("gpt-5.4-mini", "high", 2500, "rapide"))
                self.assertEqual(repli["libelle"], LIBELLE_INDISPO)

    def test_pas_de_repli_dans_les_autres_cas(self):
        o3 = serveur.choisir_modele(requete(modeApprofondi=True))
        self.assertIsNone(serveur.choix_repli(o3, 401))   # clé refusée : le modèle rapide échouerait aussi
        self.assertIsNone(serveur.choix_repli(o3, 500))
        self.assertIsNone(serveur.choix_repli(o3, 404, {"rapide": 2_350_000}))  # plafond du pool rapide atteint
        self.assertIsNone(serveur.choix_repli(serveur.choisir_modele(requete()), 404))  # déjà le modèle rapide

    def test_payload_o3(self):
        d = requete("Succession ?")
        corps, modele = serveur.corps_openai(d, serveur.choisir_modele(d))
        self.assertEqual(modele, "o3")
        self.assertEqual(corps["model"], "o3")
        self.assertEqual(corps["messages"][0]["role"], "developer")
        self.assertNotIn("temperature", corps)
        self.assertNotIn("max_tokens", corps)
        self.assertEqual(corps["reasoning_effort"], "medium")
        self.assertEqual(corps["max_completion_tokens"], 2500)
        self.assertIs(corps["stream"], True)
        self.assertEqual(corps["stream_options"], {"include_usage": True})

    def test_payload_gpt5_rapide_sans_parametres_refuses(self):
        d = requete()
        corps, _ = serveur.corps_openai(d, serveur.choisir_modele(d))
        self.assertEqual(corps["messages"][0]["role"], "developer")
        self.assertNotIn("temperature", corps)
        self.assertNotIn("max_tokens", corps)
        self.assertEqual(corps["max_completion_tokens"], 1500)
        self.assertEqual(corps["reasoning_effort"], "low")

    def test_payload_repli_raisonnement_eleve(self):
        d = requete(modeApprofondi=True)
        corps, modele = serveur.corps_openai(d, serveur.choisir_modele(d, {"raisonnement": 225_000}))
        self.assertEqual(modele, "gpt-5.4-mini")
        self.assertEqual(corps["messages"][0]["role"], "developer")
        self.assertNotIn("temperature", corps)
        self.assertEqual((corps["reasoning_effort"], corps["max_completion_tokens"]), ("high", 2500))

    def test_payload_modele_classique(self):
        with mock.patch.dict(os.environ, {"OPENAI_MODEL_CHAT": "gpt-4.1-mini"}):
            d = requete()
            corps, _ = serveur.corps_openai(d, serveur.choisir_modele(d))
        self.assertEqual(corps["messages"][0]["role"], "system")
        self.assertEqual((corps["temperature"], corps["max_tokens"]), (0.2, 800))
        self.assertNotIn("reasoning_effort", corps)


class CompteursDeQuota(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.fichier = Path(self._tmp.name) / "q.json"
        patcher = mock.patch.dict(os.environ, ENV_NEUTRE)
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_deux_compteurs_distincts_prompt_plus_completion(self):
        q = serveur.Quota(self.fichier)
        q.ajouter({"prompt_tokens": 100, "completion_tokens": 50}, "rapide")
        q.ajouter({"prompt_tokens": 1000, "completion_tokens": 400, "completion_tokens_details": {"reasoning_tokens": 300}}, "raisonnement")
        self.assertEqual(q.tokens_du_jour(), {"rapide": 150, "raisonnement": 1400})
        self.assertEqual((q.tokens_du_jour("rapide"), q.tokens_du_jour("raisonnement")), (150, 1400))

    def test_persistance_et_reinitialisation_a_minuit_utc(self):
        q = serveur.Quota(self.fichier)
        q.ajouter({"prompt_tokens": 10, "completion_tokens": 5}, "raisonnement")
        self.assertEqual(serveur.Quota(self.fichier).tokens_du_jour("raisonnement"), 15)  # relu depuis le fichier
        q.jour = "2000-01-01"
        self.assertEqual(q.tokens_du_jour(), {"rapide": 0, "raisonnement": 0})

    def test_ancien_format_de_fichier(self):
        self.fichier.write_text(json.dumps({"jour": serveur.Quota._aujourdhui(), "tokens": 1234, "alerte": False}), encoding="utf-8")
        self.assertEqual(serveur.Quota(self.fichier).tokens_du_jour(), {"rapide": 1234, "raisonnement": 0})

    def test_alertes_par_pool(self):
        q = serveur.Quota(self.fichier)
        with mock.patch("sys.stderr", io.StringIO()) as err:
            q.ajouter({"prompt_tokens": 199_999, "completion_tokens": 0}, "raisonnement")
            self.assertEqual(err.getvalue(), "")
            q.ajouter({"prompt_tokens": 1, "completion_tokens": 0}, "raisonnement")
            q.ajouter({"prompt_tokens": 5, "completion_tokens": 0}, "raisonnement")  # une seule alerte par pool et par jour
            q.ajouter({"prompt_tokens": 2_200_000, "completion_tokens": 0}, "rapide")
        journal = err.getvalue()
        self.assertEqual(journal.count("ALERTE QUOTA (raisonnement)"), 1)
        self.assertEqual(journal.count("ALERTE QUOTA (rapide)"), 1)


class FauxOpenAI(BaseHTTPRequestHandler):
    """Reçoit la requête de serveur.py, la mémorise, répond comme le ferait OpenAI (flux, JSON ou erreur)."""

    recu = None
    appels = []            # modèles demandés, dans l'ordre
    erreur = None          # (statut, corps JSON) à renvoyer à la place d'une réponse normale, pour tous les modèles
    erreurs_modele = {}    # {modèle: (statut, corps JSON)} : refus propres à un modèle

    def do_POST(self):
        FauxOpenAI.recu = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        FauxOpenAI.appels.append(FauxOpenAI.recu["model"])
        refus = FauxOpenAI.erreur or FauxOpenAI.erreurs_modele.get(FauxOpenAI.recu["model"])
        if refus:
            statut, corps = refus
            octets = corps.encode()
            self.send_response(statut)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(octets)))
            self.end_headers()
            self.wfile.write(octets)
            return
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.end_headers()
        morceaux = [
            {"choices": [{"delta": {"content": "Voici "}}]},
            {"choices": [{"delta": {"content": "{M1} [[SUGGESTION:Et ensuite ?]]"}}]},
            {"choices": [], "usage": {"prompt_tokens": 1000, "completion_tokens": 700,
                                      "completion_tokens_details": {"reasoning_tokens": 500}}},
        ]
        for m in morceaux:
            self.wfile.write(b"data: " + json.dumps(m).encode() + b"\n\n")
        self.wfile.write(b"data: [DONE]\n\n")

    def log_message(self, *a):
        pass


def _faux_json(self):
    FauxOpenAI.recu = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
    corps = json.dumps({"choices": [{"message": {"content": "ok"}}], "usage": {"prompt_tokens": 10, "completion_tokens": 5}}).encode()
    self.send_response(200)
    self.send_header("Content-Type", "application/json")
    self.send_header("Content-Length", str(len(corps)))
    self.end_headers()
    self.wfile.write(corps)


class RoutageDeBoutEnBout(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.faux = ThreadingHTTPServer(("127.0.0.1", 0), FauxOpenAI)
        cls.app = ThreadingHTTPServer(("127.0.0.1", 0), serveur.Handler)
        for s in (cls.faux, cls.app):
            threading.Thread(target=s.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        for s in (cls.faux, cls.app):
            s.shutdown()
            s.server_close()

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        for p in (
            mock.patch.dict(os.environ, ENV_NEUTRE),
            mock.patch.object(serveur, "URL_OPENAI", f"http://127.0.0.1:{self.faux.server_port}/v1/chat/completions"),
            mock.patch.object(serveur, "QUOTA", serveur.Quota(Path(self._tmp.name) / "q.json")),
            mock.patch.object(serveur, "_RECENTES", serveur.deque()),
        ):
            p.start()
            self.addCleanup(p.stop)
        FauxOpenAI.recu = None
        FauxOpenAI.erreur = None
        FauxOpenAI.erreurs_modele = {}
        FauxOpenAI.appels = []

    def poster(self, **charge):
        corps = {"systeme": "Consigne.", "profil": "", "messages": [{"role": "user", "content": "Bonjour"}], "stream": True}
        corps.update(charge)
        r = urllib.request.Request(f"http://127.0.0.1:{self.app.server_port}/api/chat", data=json.dumps(corps).encode(),
                                   headers={"Content-Type": "application/json"}, method="POST")
        with urllib.request.urlopen(r, timeout=10) as rep:
            evenements = [json.loads(b[5:]) for b in rep.read().decode().split("\n\n") if b.startswith("data:")]
            return rep.headers, evenements

    def test_succession_bascule_sur_o3_avec_flux_complet(self):
        entetes, ev = self.poster(messages=[{"role": "user", "content": "Parle-moi de la succession"}])
        self.assertEqual(FauxOpenAI.recu["model"], "o3")
        self.assertEqual(FauxOpenAI.recu["messages"][0]["role"], "developer")
        self.assertNotIn("temperature", FauxOpenAI.recu)
        self.assertEqual(FauxOpenAI.recu["reasoning_effort"], "medium")
        self.assertEqual(FauxOpenAI.recu["max_completion_tokens"], 2500)
        self.assertEqual(FauxOpenAI.recu["stream_options"], {"include_usage": True})
        self.assertEqual(entetes["X-Model-Used"], "o3")
        self.assertEqual(ev[0], {"modele": "o3"})  # premier événement : modèle retenu
        self.assertEqual("".join(e["delta"] for e in ev if "delta" in e), "Voici {M1} [[SUGGESTION:Et ensuite ?]]")  # balises et jetons intacts
        self.assertEqual(ev[-1]["fin"], True)
        self.assertEqual(ev[-1]["modele"], "o3")
        # prompt + completion (raisonnement inclus), crédités au pool « raisonnement » seulement
        self.assertEqual(serveur.QUOTA.tokens_du_jour(), {"rapide": 0, "raisonnement": 1700})

    def test_mode_approfondi_bascule(self):
        _, ev = self.poster(modeApprofondi=True)
        self.assertEqual(FauxOpenAI.recu["model"], "o3")
        self.assertEqual(ev[0], {"modele": "o3"})

    def test_question_simple_reste_rapide_et_credite_le_pool_rapide(self):
        entetes, ev = self.poster()
        self.assertEqual(FauxOpenAI.recu["model"], "gpt-5.4-mini")
        self.assertEqual((FauxOpenAI.recu["reasoning_effort"], FauxOpenAI.recu["max_completion_tokens"]), ("low", 1500))
        self.assertNotIn("temperature", FauxOpenAI.recu)
        self.assertEqual(entetes["X-Model-Used"], "gpt-5.4-mini")
        self.assertEqual(ev[0], {"modele": "gpt-5.4-mini"})
        self.assertEqual(serveur.QUOTA.tokens_du_jour(), {"rapide": 1700, "raisonnement": 0})

    def test_quota_o3_epuise_repli_gpt54_effort_eleve(self):
        serveur.QUOTA.tokens["raisonnement"] = 226_000
        entetes, ev = self.poster(modeApprofondi=True)
        self.assertEqual(FauxOpenAI.recu["model"], "gpt-5.4-mini")
        self.assertEqual((FauxOpenAI.recu["reasoning_effort"], FauxOpenAI.recu["max_completion_tokens"]), ("high", 2500))
        self.assertEqual(entetes["X-Model-Used"], "gpt-5.4-mini")
        self.assertEqual(ev[0], {"modele": LIBELLE_REPLI})
        self.assertEqual(ev[-1]["modele"], LIBELLE_REPLI)
        self.assertEqual(serveur.QUOTA.tokens_du_jour(), {"rapide": 1700, "raisonnement": 226_000})  # le repli consomme le pool rapide

    def test_plafond_rapide_refuse_sans_appeler_openai(self):
        serveur.QUOTA.tokens["rapide"] = 2_350_000
        with self.assertRaises(urllib.error.HTTPError) as c:
            self.poster()
        self.assertEqual(c.exception.code, 429)
        self.assertEqual(json.loads(c.exception.read()), {"erreur": "quota_journalier"})
        self.assertIsNone(FauxOpenAI.recu)

    def test_reponse_json_de_repli_porte_le_modele(self):
        corps = {"systeme": "C.", "profil": "", "messages": [{"role": "user", "content": "IFI ?"}]}  # pas de stream
        with mock.patch.object(FauxOpenAI, "do_POST", _faux_json):
            r = urllib.request.Request(f"http://127.0.0.1:{self.app.server_port}/api/chat", data=json.dumps(corps).encode(),
                                       headers={"Content-Type": "application/json"}, method="POST")
            with urllib.request.urlopen(r, timeout=10) as rep:
                entetes, ev = rep.headers, json.loads(rep.read())
        self.assertEqual(ev["modele"], "o3")
        self.assertEqual(entetes["X-Model-Used"], "o3")
        self.assertEqual(ev["reponse"], "ok")
        self.assertEqual(serveur.QUOTA.tokens_du_jour("raisonnement"), 15)

    def test_o3_introuvable_repli_gpt54_effort_eleve(self):
        FauxOpenAI.erreurs_modele = {"o3": (404, ERREUR_404)}
        with mock.patch("sys.stderr", io.StringIO()) as err:
            entetes, ev = self.poster(modeApprofondi=True)
        self.assertEqual(FauxOpenAI.appels, ["o3", "gpt-5.4-mini"])  # o3 refusé, puis une seule relance
        self.assertEqual(FauxOpenAI.recu["messages"][0]["role"], "developer")
        self.assertNotIn("temperature", FauxOpenAI.recu)
        self.assertEqual((FauxOpenAI.recu["reasoning_effort"], FauxOpenAI.recu["max_completion_tokens"]), ("high", 2500))
        self.assertEqual(entetes["X-Model-Used"], "gpt-5.4-mini")
        self.assertEqual(ev[0], {"modele": LIBELLE_INDISPO})
        self.assertEqual(ev[-1]["modele"], LIBELLE_INDISPO)
        self.assertEqual("".join(e["delta"] for e in ev if "delta" in e), "Voici {M1} [[SUGGESTION:Et ensuite ?]]")
        self.assertEqual(serveur.QUOTA.tokens_du_jour(), {"rapide": 1700, "raisonnement": 0})  # le repli consomme le pool rapide
        self.assertIn("OpenAI a répondu 404 (modèle o3)", err.getvalue())  # le refus d'origine reste diagnostiquable
        self.assertIn("model_not_found", err.getvalue())
        self.assertIn("Repli : gpt-5.4-mini en effort « high »", err.getvalue())

    def test_o3_refuse_403_organisation_non_verifiee_repli(self):
        FauxOpenAI.erreurs_modele = {"o3": (403, json.dumps({"error": {"message": "Your organization must be verified to stream this model.", "code": "unsupported_value"}}))}
        with mock.patch("sys.stderr", io.StringIO()):
            _, ev = self.poster(messages=[{"role": "user", "content": "Ma succession ?"}])
        self.assertEqual(FauxOpenAI.appels, ["o3", "gpt-5.4-mini"])
        self.assertEqual(ev[0], {"modele": LIBELLE_INDISPO})

    def test_pas_de_repli_si_cle_refusee(self):
        FauxOpenAI.erreur = (401, json.dumps({"error": {"message": "Incorrect API key", "code": "invalid_api_key"}}))
        with mock.patch("sys.stderr", io.StringIO()):
            with self.assertRaises(urllib.error.HTTPError) as c:
                self.poster(modeApprofondi=True)
        self.assertEqual(c.exception.code, 502)
        self.assertEqual(FauxOpenAI.appels, ["o3"])  # aucune relance

    def test_repli_qui_echoue_aussi_renvoie_une_erreur(self):
        FauxOpenAI.erreur = (404, ERREUR_404)  # tous les modèles refusés
        with mock.patch("sys.stderr", io.StringIO()):
            with self.assertRaises(urllib.error.HTTPError) as c:
                self.poster(modeApprofondi=True)
        self.assertEqual((c.exception.code, json.loads(c.exception.read())), (502, {"erreur": "openai_404"}))
        self.assertEqual(FauxOpenAI.appels, ["o3", "gpt-5.4-mini"])  # une seule relance, pas de boucle

    def test_pas_de_repli_si_plafond_du_pool_rapide_atteint(self):
        serveur.QUOTA.tokens["rapide"] = 2_350_000
        FauxOpenAI.erreurs_modele = {"o3": (404, ERREUR_404)}
        with mock.patch("sys.stderr", io.StringIO()):
            with self.assertRaises(urllib.error.HTTPError) as c:
                self.poster(modeApprofondi=True)
        self.assertEqual(c.exception.code, 502)
        self.assertEqual(FauxOpenAI.appels, ["o3"])

    def test_modele_rapide_refuse_pas_de_repli(self):
        FauxOpenAI.erreurs_modele = {"gpt-5.4-mini": (404, ERREUR_404)}
        with mock.patch("sys.stderr", io.StringIO()):
            with self.assertRaises(urllib.error.HTTPError):
                self.poster()
        self.assertEqual(FauxOpenAI.appels, ["gpt-5.4-mini"])

    def test_sans_cle_pas_d_appel_et_503(self):
        with mock.patch.dict(os.environ, {"OPENAI_API_KEY": ""}):
            with self.assertRaises(urllib.error.HTTPError) as c:
                self.poster(modeApprofondi=True)
        self.assertEqual(c.exception.code, 503)
        self.assertIsNone(FauxOpenAI.recu)

    def test_erreur_openai_journalisee_avec_son_corps_json_exact(self):
        corps = json.dumps({"error": {"message": "Unsupported parameter: 'temperature' is not supported with this model.",
                                      "type": "invalid_request_error", "param": "temperature", "code": "unsupported_parameter"}})
        FauxOpenAI.erreur = (400, corps)
        with mock.patch("sys.stderr", io.StringIO()) as err:
            with self.assertRaises(urllib.error.HTTPError) as c:
                self.poster(modeApprofondi=True)
        self.assertEqual(c.exception.code, 502)  # le navigateur ne reçoit qu'un code générique…
        self.assertEqual(json.loads(c.exception.read()), {"erreur": "openai_400"})
        journal = err.getvalue()
        self.assertIn("OpenAI a répondu 400 (modèle o3)", journal)  # … le détail exact reste dans la console du serveur
        self.assertIn(corps, journal)

    def test_journal_d_erreur_masque_toute_cle(self):
        FauxOpenAI.erreur = (401, json.dumps({"error": {"message": "Incorrect API key provided: sk-proj-********abcd.", "code": "invalid_api_key"}}))
        with mock.patch("sys.stderr", io.StringIO()) as err:
            with self.assertRaises(urllib.error.HTTPError) as c:
                self.poster()
        self.assertEqual(c.exception.code, 502)
        self.assertIn("OpenAI a répondu 401", err.getvalue())
        self.assertIn("invalid_api_key", err.getvalue())
        self.assertNotIn("sk-proj", err.getvalue())


XML_BCE = """<?xml version="1.0" encoding="UTF-8"?>
<gesmes:Envelope xmlns:gesmes="http://www.gesmes.org/xml/2002-08-01" xmlns="http://www.ecb.int/vocabulary/2002-08-01/eurofxref">
<Cube><Cube time='2026-11-16'>
<Cube currency='USD' rate='1.0821'/><Cube currency='JPY' rate='165.2'/><Cube currency='CAD' rate='1.4912'/>
<Cube currency='CHF' rate='0.9402'/><Cube currency='GBP' rate='0.8431'/>
</Cube></Cube></gesmes:Envelope>"""


class TestTauxBCE(unittest.TestCase):
    def test_xml_valide(self):
        r = serveur.analyser_taux_bce(XML_BCE)
        self.assertEqual(r["date"], "2026-11-16")
        self.assertEqual((r["source"], r["base"]), ("BCE", "EUR"))
        self.assertEqual(set(r["taux"]), {"USD", "CAD", "CHF", "GBP"})
        self.assertAlmostEqual(r["taux"]["USD"], 1.0821)

    def test_sans_date(self):
        self.assertIsNone(serveur.analyser_taux_bce("<Cube currency='USD' rate='1.08'/>"))

    def test_rate_non_numerique_ignore(self):
        r = serveur.analyser_taux_bce("<Cube time='2026-11-16'><Cube currency='USD' rate='abc'/><Cube currency='CHF' rate='0.94'/></Cube>")
        self.assertEqual(r["taux"], {"CHF": 0.94})

    def test_aucune_devise_retenue(self):
        self.assertIsNone(serveur.analyser_taux_bce("<Cube time='2026-11-16'><Cube currency='JPY' rate='165.2'/></Cube>"))

    def test_chaine_vide(self):
        self.assertIsNone(serveur.analyser_taux_bce(""))


if __name__ == "__main__":
    unittest.main()
