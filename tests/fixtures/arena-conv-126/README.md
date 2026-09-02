# Banc /arena de conv-126 — copie figée du 2026-09-02

Pourquoi ce dossier existe : le seul vrai banc `/arena` (conversation conv-126, run
`lance-arena-sur-une-tache-de-taille-reel-mtk0rejs`) est passé au VERT alors qu'il avait sauté des
étapes obligatoires de `skills/arena/SKILL.md`. C'est le cas de référence que le contrôle
`scripts/arena-protocole-check.mjs` doit refuser. Sans cette copie, le test qui le prouve dépendrait
de `.autowin-data/` — un dossier hors git, effacé au premier ménage : le test deviendrait vert par
disparition de sa preuve.

## Provenance exacte

- `RUN.md` ← `.autowin-data/autowin-os/runs/conv-126/lance-arena-sur-une-tache-de-taille-reel-mtk0rejs-workspace/RUN.md`
- `bench/*` ← `.autowin-data/autowin-os/arena-bench/` (seuls les fichiers que le contrôle LIT :
  `check.mjs`, `tache.txt`, `statut.txt`, `prompt-{a,b,c,x}.txt`, `out-{a,b,c,x,judge}.json`,
  `lance.sh`).

## La SEULE modification apportée

Dans `bench/lance.sh`, les deux variables de chemin absolu ont été remplacées :

| avant | après |
|---|---|
| `B="D:/AutoWinOS/.autowin-data/autowin-os/arena-bench"` | `B="D:/arena-fixture-conv-126/bench"` |
| `W="D:/AutoWinOS/.autowin-data/autowin-os/worktrees/arena"` | `W="D:/arena-fixture-conv-126/worktrees/arena"` |

Raison : le point P13 (« copies de travail perdantes retirées du disque ») regarde si les chemins
cités par le script existent ENCORE. Recopié tel quel, il aurait pointé le vrai dossier de banc, qui
existe toujours sur ce poste — P13 serait devenu rouge à cause de la copie, pas à cause de conv-126,
et le résultat aurait dépendu du poste. Les deux chemins neutralisés n'existent sur aucune machine :
P13 rend « ok », exactement son verdict sur le run réel. Le reste du script (4 bras en arrière-plan,
`wait`, un `cd "$W/$a"` par bras) est intact — c'est ce que lisent P6 et P7.

Aucun autre octet n'a été touché.

## Fidélité vérifiée

Le contrôle rend une sortie STRICTEMENT identique sur la copie et sur le run réel (`diff` vide,
2026-09-02) : 4 points ratés — P1, P2, P3, P11 — 9 points tenus, code de sortie 1.
