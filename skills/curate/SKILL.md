---
name: curate
description: >-
  Vide la file des CANDIDATS Brain (`inbox/*.md` déposés par `remember`) jusqu'à zéro en attente.
  Déclencher sur « les candidats s'accumulent », « traite la file du Brain », « /curate »,
  ou dès qu'un état d'app signale des candidats en attente. Trois verdicts : `promote` (mécanique,
  appliqué par le script), `merge` (une note existante couvre le thème → la session IA écrit UNE
  note consolidée qui remplace les deux), `reject` (contrôle dur échoué → corriger ou supprimer).
  Ne promeut QUE ce qui sert le travail (métier, code, décisions techniques, contraintes, préférences
  de l'utilisateur) : un candidat hors de ce périmètre est rejeté même s'il est vrai.
  Commence par prendre le verrou `inbox/.curation.lock` et s'arrête si une autre passe le tient.
  Se termine par réindexation + `brain_validate.py` vert + commit, puis rend le verrou. Ne promeut jamais une fusion
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
0. **Verrou — AVANT toute lecture de la file.** Deux passes peuvent viser la même `inbox/` en même temps
   (la tâche quotidienne de 08:30 et une passe lancée à la main). Mesuré le 2026-09-26 : la seconde passe
   a trouvé 9 candidats sur 10 déjà déplacés entre son rapport et son application. Le 2026-09-23, deux
   indexations simultanées ont fait planter l'une d'elles sur un fichier disparu. Prendre le verrou :
   `mkdir "<brainRoot>/inbox/.curation.lock"` — atomique, y compris sur le partage réseau : une seule
   passe réussit (vérifié le 2026-09-26 : le second `mkdir` rend le code 1, « File exists »).
   - Réussi → la passe est à toi. Rafraîchis-le avec `touch` avant chaque réindexation (étape 6).
   - Échec → une autre passe tourne : **STOP**, ne lis ni n'écris rien dans le Brain, et rends un bilan
     « passe déjà en cours depuis <heure> » (heure lue par `stat -c %y` sur le dossier). Ce n'est pas un
     échec de la tâche : la file sera vidée par l'autre passe.
   - Exception, verrou périmé : si `find "<verrou>" -maxdepth 0 -mmin +240` rend son chemin (aucun
     `touch` depuis plus de 4 h), la passe qui l'a posé est morte. Fais `rmdir` puis de nouveau `mkdir` ;
     si ce second `mkdir` échoue, une autre passe l'a repris → STOP. Limite connue : deux passes qui
     reprennent le même verrou périmé à la même seconde peuvent encore se croiser.
   - Le verrou est un dossier VIDE, sans extension `.md` : l'outillage ne lit que `inbox/*.md` et git
     ignore les dossiers vides. N'y écris jamais de fichier, sinon il apparaît dans git et peut partir
     dans un commit.
1. Compter la file : `ls <brainRoot>/inbox/*.md` (README exclu).
2. Rapport : `python tooling/brain_curate.py --brain <brainRoot>` → JSON
   `{candidates:[{verdict, reason, merge_with}]}`. `--brain` est OBLIGATOIRE : par défaut le script vise le
   dossier parent de son propre `tooling/` (la copie locale `%LOCALAPPDATA%\AmitelBrain`), où l'`inbox/` est
   vide — il rend alors `candidates: []` sans erreur, ce qui se lit à tort comme « file déjà vide »
   (mesuré le 2026-09-06 : 0 rapporté alors que 18 candidats attendaient).
   Redirige vers un fichier, le modèle d'embedding pollue stderr de barres de progression.
2 bis. **Filtre de pertinence — AVANT toute promotion.** Le Brain ne garde que ce qui sert le
   TRAVAIL : le métier (greffes, RIG, SQL, clients), le code et l'architecture des projets, les
   décisions techniques et leurs motifs, les contraintes d'outillage et d'environnement, les
   préférences de travail de l'utilisateur. Tout le reste est HORS SUJET, même vrai et même bien
   sourcé : anecdote de conversation, état du moment (« le run X a échoué hier »), auto-évaluation
   d'un agent, règle de comportement du modèle, vie privée. Lis CHAQUE candidat et pose la question :
   « dans 3 mois, sur une tâche de travail, est-ce que ce fait change une décision ? » — non → `reject`
   avec la raison « hors périmètre métier », et le candidat est retiré de `inbox/`. Ce tri se fait à la
   main : le script ne juge que la forme (source, doublon), jamais la pertinence.
3. Promotions mécaniques : `python tooling/brain_curate.py --brain <brainRoot> --apply --reviewer autowin-app-curation`.
   Le relecteur DOIT être d'une famille distincte de l'auteur, sinon la promotion est refusée.
4. `merge` — un par un, jamais en lot : lire le candidat ET la note visée (`merge_with`), écrire UNE
   note consolidée dans `knowledge/<type>/`, marquer les deux sources `status: superseded`, puis
   retirer le candidat de `inbox/`. Si la note existante dit déjà tout : supprimer le candidat en
   citant la note qui le couvre.
5. `reject` — lire la raison. « source locator is not verifiable » se corrige (`git:<chemin>@<sha>`,
   `session:<id>`) ; un secret ou une donnée personnelle détecté se SUPPRIME.
6. Réindexer : `python tooling/brain_index.py --knowledge <brainRoot>/knowledge --out <brainRoot>/tooling/index`
   (les deux arguments sont obligatoires). La sortie DOIT être `<brainRoot>/tooling/index` : c'est le seul
   dossier que le Brain relit (il y publie `CURRENT` + `generations/`). Mesuré le 2026-09-06 : indexer vers
   `<brainRoot>/index` réussit, dure ~20 min sur le partage réseau, et n'est JAMAIS lu — les notes promues
   restent introuvables par la recherche.
7. `python tooling/brain_validate.py --root <brainRoot>` doit rendre `"status": "valid"` avec
   `errors: []` (l'option est `--root`, PAS `--brain`, qui est refusé ; le statut est `valid`, pas `ok`).
   Le warning « legacy curated notes remain valid » est normal. Pièges connus : un candidat déposé
   à la RACINE de `knowledge/` (interdit — il doit vivre dans `inbox/` ou dans `knowledge/<type>/`),
   et l'index Obsidian généré devenu périmé après promotion — l'erreur `stale generated Obsidian index
   knowledge/_maps/vault-inventory.md` se corrige avec
   `python tooling/obsidian_graph.py --root <brainRoot> --refresh-indexes --reviewer <agent>`, puis on revalide.
8. Commit dans le dépôt Brain, message `curation: <n> promus, <m> fusionnés, <k> rejetés`.
9. Rendre le verrou : `rmdir "<brainRoot>/inbox/.curation.lock"`, APRÈS le commit — et aussi quand la
   passe s'arrête avant (blocage, erreur, interruption). Un verrou oublié bloque toutes les passes
   pendant 4 h. Le bilan dit que le verrou est rendu.

## Ce que la skill ne fait pas
Elle ne décide pas à la place du protocole : les fusions et les rejets sont des ÉCRITURES de
connaissance, elles se lisent avant d'être faites. Un candidat non lu ne se supprime pas.
