"""Tokenisation lexicale du Brain : accents et flexions françaises (conv-1030, 2026-10-20).

Avant ce changement, l'axe BM25 tokenisait avec les réglages par défaut de bm25s : minuscules
seulement. « activite » ne trouvait donc pas « activités », ni « depot » « dépôt » — seul l'axe
dense rattrapait ces formes.
"""
import os
import sys
import threading
import unittest
from pathlib import Path

TOOLING = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(TOOLING))
# Identite NEUTRE forcee (brain_identite) : la suite rend le meme resultat avec ou sans dossier
# `entreprise/` a la racine du depot. Posee AVANT tout import du tooling.
os.environ["AUTOWIN_IDENTITE_ENTREPRISE"] = "{}"

from brain_retrieval import bm25_tokenize, fold_accents


class Bm25FrenchTokenizationTests(unittest.TestCase):
    def test_accented_and_plain_spellings_share_the_same_tokens(self):
        accented = bm25_tokenize(["Activités indexées du dépôt"])
        plain = bm25_tokenize(["activites indexees du depot"])

        self.assertEqual(set(accented.vocab), set(plain.vocab))

    def test_singular_plain_query_shares_the_root_of_the_accented_plural(self):
        # Accents retirés AVANT la racine : « activités » et « activite » -> même racine. L'ordre
        # inverse donnait « activ » contre « activit » ; mesuré sur rag-heldout, il faisait aussi
        # tomber le MRR de 0,950 à 0,900 (conv-1030).
        self.assertEqual(
            set(bm25_tokenize(["activités"]).vocab), set(bm25_tokenize(["activite"]).vocab),
        )

    def test_plain_query_finds_the_inflected_accented_body(self):
        import bm25s

        corpus = [
            "Le chat dort au soleil",
            "Les activités indexées du dépôt partagé",
            "Rien à voir avec la question",
        ]
        model = bm25s.BM25()
        model.index(bm25_tokenize(corpus))

        rows, scores = model.retrieve(bm25_tokenize(["activite depot"]), k=1)

        self.assertEqual(int(rows[0][0]), 1)
        self.assertGreater(float(scores[0][0]), 0.0)

    def test_fold_accents_keeps_letters_and_drops_marks_only(self):
        self.assertEqual(fold_accents("Système créé à Noël, déjà indexé"), "Systeme cree a Noel, deja indexe")

    def test_concurrent_tokenization_gives_identical_tokens(self):
        # PyStemmer : « must not be called concurrently » — les requêtes du serveur tournent hors
        # verrou (brain_retrieval.query), chaque thread doit donc avoir son propre raciniseur.
        text = ["Les réindexations successives des activités créées " * 50]
        expected = sorted(bm25_tokenize(text).vocab)
        results, errors = [], []

        def worker():
            try:
                for _ in range(20):
                    results.append(sorted(bm25_tokenize(text).vocab))
            except Exception as exc:  # remonté par l'assertion ci-dessous
                errors.append(exc)

        threads = [threading.Thread(target=worker) for _ in range(8)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()

        self.assertEqual(errors, [])
        self.assertTrue(all(result == expected for result in results))


if __name__ == "__main__":
    unittest.main()
