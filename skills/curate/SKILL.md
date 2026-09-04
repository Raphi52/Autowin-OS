---
name: curate
description: >-
  Vide la file des CANDIDATS Brain (`inbox/*.md` déposés par `remember`) jusqu'à zéro en attente.
  Déclencher sur « les candidats s'accumulent », « traite la file du Brain », « /curate »,
  ou dès qu'un état d'app signale des candidats en attente. Trois verdicts : `promote` (mécanique,
  appliqué par le script), `merge` (une note existante couvre le thème → la session IA écrit UNE
  note consolidée qui remplace les deux), `reject` (contrôle dur échoué → corriger ou supprimer).
  Se termine par réindexation + `brain_validate.py` vert + commit. Ne promeut jamais une fusion
  à l'aveugle et ne supprime jamais un candidat sans avoir lu son contenu.
---

# curate — vider la file des candidats Brain

## Pré-requis (mesuré le 2026-09-04)
- Interpréteur : le venv par machine, PAS le `python` du PATH (`numpy` absent ailleurs) —
  `%LOCALAPPDATA%\AmitelBrain\.venv\Scripts\python.exe`, ou `AMITEL_BRAIN_PYTHON`.
- Outillage : `<brainRoot>/tooling`. Racine par défaut : `\ged2\rig\Projets IA\Amitel Brain`.
- **Toujours** `PYTHONIOENCODING=utf-8` : sans lui, l'impression du rapport plante en cp1252
  (`UnicodeEncodeError` sur `≠`) APRÈS les promotions — l'exit code ment.
- `brain_curate.py` n'a PAS d'option `--report` : sans `--apply`, il rapporte déjà.

## Procédure
1. Compter la file : `ls <brainRoot>/inbox/*.md` (README exclu).
2. Rapport : `python tooling/brain_curate.py` → JSON `{candidates:[{verdict, reason, merge_with}]}`.
   Redirige vers un fichier, le modèle d'embedding pollue stderr de barres de progression.
3. Promotions mécaniques : `python tooling/brain_curate.py --apply --reviewer autowin-app-curation`.
   Le relecteur DOIT être d'une famille distincte de l'auteur, sinon la promotion est refusée.
4. `merge` — un par un, jamais en lot : lire le candidat ET la note visée (`merge_with`), écrire UNE
   note consolidée dans `knowledge/<type>/`, marquer les deux sources `status: superseded`, puis
   retirer le candidat de `inbox/`. Si la note existante dit déjà tout : supprimer le candidat en
   citant la note qui le couvre.
5. `reject` — lire la raison. « source locator is not verifiable » se corrige (`git:<chemin>@<sha>`,
   `session:<id>`) ; un secret ou une donnée personnelle détecté se SUPPRIME.
6. Réindexer : `python tooling/brain_index.py --knowledge <brainRoot>/knowledge --out <index>`
   (les deux arguments sont obligatoires).
7. `python tooling/brain_validate.py` doit rendre `status: ok`. Pièges connus : un candidat déposé
   à la RACINE de `knowledge/` (interdit — il doit vivre dans `inbox/` ou dans `knowledge/<type>/`),
   et l'index Obsidian généré devenu périmé après promotion.
8. Commit dans le dépôt Brain, message `curation: <n> promus, <m> fusionnés, <k> rejetés`.

## Ce que la skill ne fait pas
Elle ne décide pas à la place du protocole : les fusions et les rejets sont des ÉCRITURES de
connaissance, elles se lisent avant d'être faites. Un candidat non lu ne se supprime pas.
