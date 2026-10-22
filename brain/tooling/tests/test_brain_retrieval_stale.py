"""Servir l'index précédent pendant une revérification, sans jamais servir une note retirée.

conv-1053 (2026-10-22) : du 13 au 22/10, 57 tours de chat sur 344 n'ont reçu AUCUNE note parce que
le serveur Brain refusait (503) toute recherche dès qu'une note bougeait — le temps de rehacher le
partage réseau, puis jusqu'à la reconstruction de l'index. Les salves tombaient pendant les tris de
notes. Le contrat voulu : l'ancien instantané continue de répondre, chaque note proposée est relue
sur le disque juste avant d'être rendue, et une note retirée (supprimée, déplacée, `superseded`) ou
vidée ne sort jamais. Les refus restent pour ce qui rend l'index douteux en lui-même : version de
code de l'index, racines, surveillance du corpus en panne.
"""
import sys
import tempfile
import threading
import time
import unittest
from pathlib import Path

import numpy as np

TOOLING = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(TOOLING))
from brain_index import _parse_note_source, write_index_snapshot  # noqa: E402
from brain_retrieval import BrainRetriever  # noqa: E402
import brain_server  # noqa: E402

FRESH = {
    "fresh": True, "content_fresh": True, "format_fresh": True, "roots_fresh": True, "reasons": [],
}
CONTENT_CHANGED = {
    "fresh": False, "content_fresh": False, "format_fresh": True, "roots_fresh": True,
    "reasons": ["knowledge notes changed since the index was built"],
}
FORMAT_CHANGED = {
    "fresh": False, "content_fresh": True, "format_fresh": False, "roots_fresh": True,
    "reasons": ["index built by another version of the code"],
}


class FakeWatcher:
    """Surveillance du corpus sans le système de fichiers : le test déclenche les événements."""

    def __init__(self, _root, _roots, callback):
        self.callback = callback
        self.healthy = True

    def reconcile_roots(self, _roots):
        pass

    def add_discovery_roots(self, _roots):
        pass

    def close(self):
        pass


class FakeEmbedder:
    def embed(self, _texts):
        return iter([np.array([1.0, 0.0], dtype=np.float32)])


class ScriptedRetriever(BrainRetriever):
    """Le hachage du partage est remplacé par un verdict choisi, qu'une porte peut retenir."""

    def __init__(self, *args, **kwargs):
        self.gate = threading.Event()
        self.gate.set()
        self.verdict = dict(FRESH)
        # Pour chaque preuve : la génération qu'elle juge et celle que le serveur servait alors.
        self.proofs = []
        super().__init__(*args, **kwargs)

    def _evaluate_freshness(self, manifest):
        self.proofs.append((manifest.get("generation"), self.generation))
        self.gate.wait(10)
        return dict(self.verdict)


def wait_until(condition, timeout=10.0):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if condition():
            return True
        time.sleep(0.02)
    return False


class StaleServingTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.brain = Path(self._tmp.name) / "brain"
        (self.brain / "knowledge").mkdir(parents=True)
        self.index = self.brain / "index"
        self.retriever = None

    def tearDown(self):
        if self.retriever is not None:
            self.retriever.gate.set()
            self.retriever.close()
        self._tmp.cleanup()

    def note(self, name, text):
        path = self.brain / "knowledge" / name
        # Des octets : sous Windows, `write_text` écrirait `\r\n` et décalerait les octets indexés.
        path.write_bytes(text.encode("utf-8"))
        return path

    def publish(self, names, generation, scores=None):
        """Indexe les notes comme `brain_index.build_note_rows` (un passage par note)."""
        meta, bodies = [], []
        for name in names:
            fm, body, body_start, source = _parse_note_source(self.brain / "knowledge" / name)
            start = len(source[:body_start].encode("utf-8"))
            meta.append({
                "path": f"knowledge/{name}", "type": fm.get("type", ""), "title": name,
                "status": fm.get("status", "active"), "preview": body[:200],
                "chunk_byte_start": start, "chunk_byte_end": start + len(body.encode("utf-8")),
            })
            bodies.append(body)
        # Le premier nom est le plus proche de la requête, puis dans l'ordre donné.
        scores = scores or [1.0 - 0.1 * rank for rank in range(len(names))]
        vecs = np.array([[score, (1 - score * score) ** 0.5] for score in scores], dtype=np.float32)
        write_index_snapshot(
            self.index, meta, bodies, vecs, generation_id=generation,
            knowledge_fingerprint="empreinte", source_roots=["knowledge"],
        )

    def start(self):
        self.retriever = ScriptedRetriever(
            self.index, embedder=FakeEmbedder(), enable_bm25=False, allow_unavailable=True,
            brain_root=self.brain, freshness_interval=300.0, watcher_factory=FakeWatcher,
        )
        self.assertTrue(wait_until(lambda: self.retriever.freshness is not None))
        return self.retriever

    def corpus_changes(self, verdict):
        """Une note bouge : la preuve repart et reste retenue tant que le test ne la libère pas."""
        retriever = self.retriever
        retriever.gate.clear()
        retriever.verdict = dict(verdict)
        retriever._on_corpus_change()
        # Sur le vrai serveur, c'est /health ou la recherche suivante qui relance la preuve.
        retriever.status()

    # ── Le cas mesuré : une note bouge, la revérification tourne ──────────────────────────────

    def test_sert_l_instantane_precedent_pendant_la_reverification(self):
        self.note("alpha.md", "---\ntype: lesson\n---\n# Alpha\n\nalpha\n")
        self.note("beta.md", "---\ntype: lesson\n---\n# Beta\n\nbeta\n")
        self.publish(["alpha.md", "beta.md"], "gen-1")
        retriever = self.start()
        self.assertNotIn("stale", retriever.query("alpha", k=2))

        self.corpus_changes(FRESH)
        result = retriever.query("alpha", k=2)

        self.assertEqual([hit["path"] for hit in result["hits"]], ["knowledge/alpha.md", "knowledge/beta.md"])
        self.assertEqual(result["stale"], "freshness-check")
        self.assertEqual(result["generation"], "gen-1")
        # /health reste honnête : il dit toujours que la preuve n'est pas faite.
        self.assertEqual(retriever.status()["state"], "unavailable")

    def test_notes_modifiees_mais_index_pas_encore_reconstruit(self):
        self.note("alpha.md", "# Alpha\n\nalpha\n")
        self.publish(["alpha.md"], "gen-1")
        retriever = self.start()

        self.corpus_changes(CONTENT_CHANGED)
        retriever.gate.set()
        self.assertTrue(wait_until(lambda: retriever.freshness is not None))
        result = retriever.query("alpha", k=1)

        self.assertEqual(result["stale"], "content-changed")
        self.assertEqual(result["hits"][0]["path"], "knowledge/alpha.md")
        self.assertEqual(retriever.status()["state"], "degraded")

        # Un tri de notes = des modifications en rafale : le verdict précédent, devenu caduc,
        # ne doit pas refaire refuser la recherche pendant la preuve suivante.
        self.corpus_changes(CONTENT_CHANGED)
        self.assertEqual(retriever.query("alpha", k=1)["stale"], "freshness-check")

    # ── Jamais une note retirée ───────────────────────────────────────────────────────────────

    def test_jamais_une_note_retiree_et_la_liste_reste_pleine(self):
        names = ["remplacee.md", "supprimee.md", "videe.md", "gardee.md", "suivante.md", "derniere.md"]
        for name in names:
            self.note(name, f"---\ntype: lesson\n---\n# {name}\n\ncorps de {name}\n")
        self.publish(names, "gen-1")
        retriever = self.start()

        self.corpus_changes(FRESH)
        self.note("remplacee.md", "---\ntype: lesson\nstatus: superseded\n---\n# remplacee\n\nancien\n")
        (self.brain / "knowledge" / "supprimee.md").unlink()
        self.note("videe.md", "---\ntype: lesson\n---\n\n")
        result = retriever.query("q", k=3)

        self.assertEqual(
            [hit["path"] for hit in result["hits"]],
            ["knowledge/gardee.md", "knowledge/suivante.md", "knowledge/derniere.md"],
        )
        self.assertEqual([hit["rank"] for hit in result["hits"]], [1, 2, 3])

    def test_note_modifiee_metadonnees_du_disque_et_passage_non_decale(self):
        self.note("alpha.md", "---\ntype: lesson\n---\n# Alpha\n\nancien passage\n")
        self.note("beta.md", "---\ntype: lesson\n---\n# Beta\n\nbeta\n")
        self.publish(["alpha.md", "beta.md"], "gen-1")
        retriever = self.start()

        self.corpus_changes(FRESH)
        self.note("alpha.md", "---\ntype: decision\n---\n# Alpha renommée\n\nnouveau texte plus long\n")
        hits = {hit["path"]: hit for hit in retriever.query("q", k=2)["hits"]}

        alpha, beta = hits["knowledge/alpha.md"], hits["knowledge/beta.md"]
        self.assertEqual((alpha["title"], alpha["type"]), ("Alpha renommée", "decision"))
        # Les octets indexés ne correspondent plus : on sert la note depuis son début, pas un
        # morceau décalé du nouveau texte.
        self.assertNotIn("chunk_byte_start", alpha)
        self.assertNotIn("chunk_byte_end", alpha)
        # Une note inchangée garde exactement son passage.
        self.assertIn("chunk_byte_start", beta)

    def test_chemin_hors_du_brain_jamais_relu(self):
        dehors = Path(self._tmp.name) / "dehors.md"
        dehors.write_bytes(b"# Dehors\n\nsecret\n")
        self.note("alpha.md", "# Alpha\n\nalpha\n")
        self.publish(["alpha.md"], "gen-1")
        retriever = self.start()
        self.corpus_changes(FRESH)

        for forged in ("../dehors.md", str(dehors)):
            hit = retriever._note_as_indexed_now({"path": forged}, "secret")
            self.assertIsNone(hit, forged)

    # ── Ce qui rend l'index douteux en lui-même : on refuse toujours ──────────────────────────

    def test_refuse_toujours_un_index_d_une_autre_version_du_code(self):
        self.note("alpha.md", "# Alpha\n\nalpha\n")
        self.publish(["alpha.md"], "gen-1")
        retriever = self.start()

        self.corpus_changes(FORMAT_CHANGED)
        retriever.gate.set()
        self.assertTrue(wait_until(lambda: retriever.freshness is not None))
        with self.assertRaisesRegex(RuntimeError, "format_fresh=false"):
            retriever.query("alpha", k=1)
        # Plus prouvé : une nouvelle modification ne rouvre pas le service sur cet index.
        self.corpus_changes(FRESH)
        with self.assertRaises(RuntimeError):
            retriever.query("alpha", k=1)

    def test_refuse_toujours_si_la_surveillance_du_corpus_est_en_panne(self):
        self.note("alpha.md", "# Alpha\n\nalpha\n")
        self.publish(["alpha.md"], "gen-1")
        retriever = self.start()

        retriever.gate.clear()
        retriever._watcher.healthy = False
        retriever._on_corpus_change("handle lost")
        with self.assertRaisesRegex(RuntimeError, "watcher"):
            retriever.query("alpha", k=1)

    def test_refuse_tant_que_le_premier_index_n_a_jamais_ete_prouve(self):
        self.note("alpha.md", "# Alpha\n\nalpha\n")
        self.publish(["alpha.md"], "gen-1")
        self.retriever = ScriptedRetriever.__new__(ScriptedRetriever)
        self.retriever.gate = threading.Event()  # la toute première preuve reste retenue
        self.retriever.verdict = dict(FRESH)
        self.retriever.proofs = []
        BrainRetriever.__init__(
            self.retriever, self.index, embedder=FakeEmbedder(), enable_bm25=False,
            allow_unavailable=True, brain_root=self.brain, freshness_interval=300.0,
            watcher_factory=FakeWatcher,
        )
        with self.assertRaisesRegex(RuntimeError, "in progress"):
            self.retriever.query("alpha", k=1)

    # ── Nouvelle génération publiée : prouvée AVANT d'être adoptée ────────────────────────────

    def test_republication_aucun_refus_et_nouvel_index_prouve_avant_adoption(self):
        self.note("alpha.md", "# Alpha\n\nalpha\n")
        self.note("beta.md", "# Beta\n\nbeta\n")
        self.publish(["alpha.md"], "gen-1")
        retriever = self.start()
        retriever.gate.clear()

        refusals, served = [], []
        stop = threading.Event()

        def hammer():
            while not stop.is_set():
                try:
                    result = retriever.query("q", k=2)
                    served.append((result["generation"], result.get("stale")))
                except RuntimeError as exc:
                    refusals.append(str(exc))
                time.sleep(0.005)

        worker = threading.Thread(target=hammer)
        worker.start()
        try:
            self.publish(["alpha.md", "beta.md"], "gen-2", scores=[1.0, 0.9])
            self.assertTrue(wait_until(lambda: ("gen-1", "reload") in served))
            retriever.gate.set()
            self.assertTrue(wait_until(lambda: served and served[-1] == ("gen-2", None)))
            time.sleep(0.2)
        finally:
            stop.set()
            worker.join()

        self.assertEqual(refusals, [])
        self.assertIn(("gen-2", "gen-1"), retriever.proofs)
        self.assertNotIn(("gen-2", "gen-2"), retriever.proofs)


class ServerNavigationTests(unittest.TestCase):
    def test_la_navigation_signee_dit_que_l_index_est_en_mise_a_jour(self):
        class Stale:
            def query(self, _text, k=5):
                return {"hits": [], "axes": 1, "generation": "g", "source_roots": ["knowledge"],
                        "stale": "content-changed"}

        class Fresh(Stale):
            def query(self, text, k=5):
                result = super().query(text, k)
                del result["stale"]
                return result

        with tempfile.TemporaryDirectory() as td:
            for build in (brain_server.build_candidates_result, brain_server.build_context_result):
                stale = build(Stale(), "q", Path(td))
                fresh = build(Fresh(), "q", Path(td))
                self.assertEqual(stale["navigation"]["stale"], "content-changed", build.__name__)
                self.assertNotIn("stale", fresh["navigation"], build.__name__)


if __name__ == "__main__":
    unittest.main()
