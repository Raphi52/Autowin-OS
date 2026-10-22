"""Liste de candidates du mode `candidates` : mêmes contrôles, vérifications disque en parallèle.

conv-1053 (2026-10-22) : le chat demande cette liste à chaque tour avec un délai de 1,5 s, et un tour
sur trois rendait « unavailable ». Décrire 30 notes du partage réseau, une par une, coûtait 1,3 s.
"""
import sys
import tempfile
import threading
import time
import unittest
from pathlib import Path
from unittest.mock import patch

TOOLING = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(TOOLING))
import brain_context  # noqa: E402


class DescribeCandidatesTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.brain = Path(self._tmp.name) / "brain"
        knowledge = self.brain / "knowledge"
        (knowledge / "lessons").mkdir(parents=True)
        # Des octets, pas du texte : sous Windows, `write_text` écrit `\r\n` et fausse la taille.
        (knowledge / "lessons" / "a.md").write_bytes(b"# A\n")
        (knowledge / "lessons" / "b.md").write_bytes(b"# B plus long\n")
        (knowledge / "lessons" / "dossier.md").mkdir()
        (Path(self._tmp.name) / "dehors.md").write_bytes(b"# Dehors\n")
        self.knowledge = knowledge

    def tearDown(self):
        self._tmp.cleanup()

    def _decrire(self, hits):
        return brain_context.describe_candidates(hits, self.knowledge, base=self.brain)

    def test_garde_l_ordre_du_classement_et_les_memes_refus(self):
        hits = [
            {"rank": 1, "path": "knowledge/lessons/b.md", "title": "B", "type": "lesson"},
            {"rank": 2, "path": "knowledge/lessons/absente.md", "title": "Absente"},
            {"rank": 3, "path": "knowledge/lessons/dossier.md", "title": "Dossier"},
            {"rank": 4, "path": "../dehors.md", "title": "Hors racine"},
            {"rank": 5, "path": "", "title": "Sans chemin"},
            "pas un dict",
            {"rank": 6, "path": "knowledge/lessons/a.md", "title": "A", "type": "lesson"},
        ]
        decrites = self._decrire(hits)
        self.assertEqual(
            [item["path"] for item in decrites],
            ["knowledge/lessons/b.md", "knowledge/lessons/a.md"],
        )
        tailles = {item["path"]: item["sizeBytes"] for item in decrites}
        self.assertEqual(tailles["knowledge/lessons/a.md"], len(b"# A\n"))
        self.assertEqual(tailles["knowledge/lessons/b.md"], len(b"# B plus long\n"))
        self.assertTrue(decrites[0]["content"].startswith("### Candidate 1 — B\n"))
        self.assertTrue(decrites[1]["content"].startswith("### Candidate 6 — A\n"))

    def test_une_liste_vide_rend_une_liste_vide(self):
        self.assertEqual(self._decrire([]), [])

    def test_les_verifications_disque_partent_ensemble(self):
        # Une vérification de confinement lente, comme sur le partage réseau : elles doivent se
        # chevaucher, sinon 30 candidates coûtent 30 fois la latence du partage.
        en_cours = 0
        pic = 0
        verrou = threading.Lock()
        confined = brain_context._confined

        def confinement_lent(note, roots):
            nonlocal en_cours, pic
            with verrou:
                en_cours += 1
                pic = max(pic, en_cours)
            time.sleep(0.05)
            with verrou:
                en_cours -= 1
            return confined(note, roots)

        hits = [
            {"rank": rang, "path": "knowledge/lessons/a.md", "title": f"A{rang}"}
            for rang in range(1, 21)
        ]
        with patch.object(brain_context, "_confined", side_effect=confinement_lent):
            debut = time.perf_counter()
            decrites = self._decrire(hits)
            duree = time.perf_counter() - debut
        self.assertEqual(len(decrites), 20)
        self.assertGreater(pic, 1, "les vérifications disque sont faites une par une")
        # 20 × 50 ms en série = 1 s ; en parallèle, une petite fraction.
        self.assertLess(duree, 0.6)


if __name__ == "__main__":
    unittest.main()
