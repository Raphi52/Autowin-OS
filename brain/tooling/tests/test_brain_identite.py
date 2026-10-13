"""Identite d'entreprise du Brain : neutre sans profil, anciens noms seulement avec un profil.

Le code du depot ne nomme aucune entreprise. Un profil `entreprise/<nom>/identite.json` fournit les
noms deja poses sur les postes ; sans lui, un ancien nom n'est JAMAIS lu (jumeau refuse).
"""
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

TOOLING = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(TOOLING))
os.environ["AUTOWIN_IDENTITE_ENTREPRISE"] = "{}"
import brain_identite  # noqa: E402

PROFIL = json.dumps({
    "brain": {
        "service": "acme-brain",
        "dossierLocal": "AcmeBrain",
        "dossierMaison": ".acme-brain",
        "variables": {"AUTOWIN_BRAIN_ROOT": "ACME_BRAIN_ROOT", "AUTOWIN_BRAIN_PORT": "ACME_BRAIN_PORT"},
    }
})


class BrainIdentiteTests(unittest.TestCase):
    def test_neutre_sans_profil(self):
        with patch.dict(os.environ, {"AUTOWIN_IDENTITE_ENTREPRISE": "{}", "ACME_BRAIN_ROOT": "D:/ancien"}):
            self.assertEqual(brain_identite.service(), "autowin-brain")
            self.assertEqual(brain_identite.dossier_local(), "AutowinBrain")
            self.assertEqual(brain_identite.schema("v1"), "autowin-brain/v1")
            # Jumeau refuse : sans profil, l'ancien nom n'est pas lu.
            self.assertIsNone(brain_identite.lire("AUTOWIN_BRAIN_ROOT"))

    def test_profil_fournit_service_dossier_et_anciens_noms(self):
        with patch.dict(os.environ, {"AUTOWIN_IDENTITE_ENTREPRISE": PROFIL, "ACME_BRAIN_ROOT": "D:/ancien"}):
            self.assertEqual(brain_identite.service(), "acme-brain")
            self.assertEqual(brain_identite.dossier_local(), "AcmeBrain")
            self.assertEqual(brain_identite.schema("candidate-v1"), "acme-brain/candidate-v1")
            self.assertEqual(brain_identite.lire("AUTOWIN_BRAIN_ROOT"), "D:/ancien")
            with patch.dict(os.environ, {"AUTOWIN_BRAIN_ROOT": "D:/neuf"}):
                self.assertEqual(brain_identite.lire("AUTOWIN_BRAIN_ROOT"), "D:/neuf")
            env = {}
            brain_identite.exporter(env, "AUTOWIN_BRAIN_PORT", "8766")
            self.assertEqual(env, {"AUTOWIN_BRAIN_PORT": "8766", "ACME_BRAIN_PORT": "8766"})

    def test_profil_invalide_retombe_sur_le_neutre(self):
        hostile = json.dumps({"brain": {"service": "../x", "dossierLocal": "..\\..", "variables": {"A": "path"}}})
        with patch.dict(os.environ, {"AUTOWIN_IDENTITE_ENTREPRISE": hostile}):
            self.assertEqual(brain_identite.service(), "autowin-brain")
            self.assertEqual(brain_identite.dossier_local(), "AutowinBrain")
            self.assertEqual(brain_identite.identite()["variables"], {})

    def test_copie_installee_lit_le_profil_pose_a_cote_d_elle(self):
        # install.ps1 copie le tooling dans <etat>/tooling et le profil dans <etat>/identite.json.
        with tempfile.TemporaryDirectory() as td:
            etat = Path(td) / "etat"
            (etat / "tooling").mkdir(parents=True)
            (etat / "tooling" / "brain_identite.py").write_bytes((TOOLING / "brain_identite.py").read_bytes())
            (etat / "identite.json").write_text(PROFIL, encoding="utf-8")
            env = {k: v for k, v in os.environ.items() if k != "AUTOWIN_IDENTITE_ENTREPRISE"}
            code = (
                "import sys\n"
                f"sys.path.insert(0, {str(etat / 'tooling')!r})\n"
                "import brain_identite\n"
                "print(brain_identite.service())\n"
            )
            result = subprocess.run(
                [sys.executable, "-c", code],
                cwd=td, env=env, text=True, capture_output=True, timeout=30,
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(result.stdout.strip(), "acme-brain")

    def test_signature_d_echange_suit_le_service_du_profil(self):
        # Un serveur deja installe ne connait que le service de son entreprise : client et serveur
        # du depot doivent signer avec CE nom-la quand le profil est present.
        code = (
            "import brain_auth, json\n"
            "p = brain_auth.signed_context_payload('CTX', 'x' * 40)\n"
            "print(json.dumps([p['service'], brain_auth.REQUEST_AAD.decode()]))\n"
        )
        for profil, attendu in (("{}", ["autowin-brain", "autowin-brain/request-v1"]),
                                (PROFIL, ["acme-brain", "acme-brain/request-v1"])):
            env = {**os.environ, "AUTOWIN_IDENTITE_ENTREPRISE": profil}
            result = subprocess.run(
                [sys.executable, "-c", code], cwd=TOOLING, env=env,
                text=True, capture_output=True, timeout=30,
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(json.loads(result.stdout), attendu)


if __name__ == "__main__":
    unittest.main()
