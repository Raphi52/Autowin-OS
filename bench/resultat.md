# Banc du 2026-09-07 — pipeline complet contre build direct, sur 3 defauts reels

Tache mise au banc, identique pour les 6 bras : « faire passer une correction d'un defaut reel
du depot de l'etat signale a l'etat verifie hors-modele ».

3 defauts reels, fichiers disjoints (`defects.json`), chacun avec un critere binaire executable
(`check-d1.mjs`, `check-d2.mjs`, `check-d3.mjs`). Deux bras par defaut :

- `a` = pipeline complet (scout, frame, terrain, build, clean, judge — chaque etape ecrite avant d'agir)
- `x` = build direct + verification ciblee (aucun plan, correctif puis relance du seul critere)

Commit de depart des 6 copies : `889095b41fbd8473bb0a2137f3abb4d3280bda3b` (`preuves/commit-depart.txt`).

## Mesures

| bras | defaut | mode     | rouge -> vert | hors-critere | duree (mur) | cout rendu par le modele |
| ---- | ------ | -------- | ------------- | ------------ | ----------- | ------------------------ |
| d1-a | D1     | pipeline | oui           | propre       | 648 s       | 3,13 $                   |
| d1-x | D1     | direct   | oui           | propre       | 71 s        | 0,53 $                   |
| d2-a | D2     | pipeline | oui           | propre       | 720 s       | 3,98 $                   |
| d2-x | D2     | direct   | oui           | REGRESSION   | 109 s       | 0,69 $                   |
| d3-a | D3     | pipeline | oui           | propre       | 756 s       | 3,63 $                   |
| d3-x | D3     | direct   | oui           | propre       | 62 s        | 0,48 $                   |

Sources : `preuves/statut.txt`, `preuves/lance-sortie.txt`, `preuves/recapitulatif.txt` (sortie de
`report.sh`), journaux bruts `logs/*.log` (regenerables, hors historique git).

## Ce que le banc a departage

1. **Le critere binaire ne departage rien** : 6 bras sur 6 sont passes du rouge au vert, chacun
   avec son rouge de depart journalise (`preuves/rouge-par-bras.txt`, exit 1 partout) et son vert
   final (exit 0 partout). Sans second axe, le banc aurait conclu « egalite » et rate l'essentiel.
2. **Le second axe departage** : `hors-critere.mjs` mesure en DELTA contre une copie temoin non
   modifiee (formatage, lint, tests voisins, stabilite d'un test rejoue 3 fois). `d2-x` (build
   direct) est le seul bras a laisser une regression : `src/renderer/index.html` non formate et un
   test voisin vert devenu rouge. Reproduit independamment le 2026-09-07 a 14:16 (exit 1 contre
   exit 0 pour `d2-a`).
3. **Le cout du pipeline est reel** : environ 6 fois plus cher (3,13-3,98 $ contre 0,48-0,69 $) et
   10 fois plus long (648-756 s contre 62-109 s) — bien au-dela du seuil de bruit de 30 %.

Verdicts ecrits dans le journal des duels (`.autowin-data/autowin-os/arena-duels.jsonl`,
bancs `banc-defauts-2026-09-07-d1|d2|d3`) : `x` gagne D1 et D3 (meme resultat, 6x moins cher),
`a` gagne D2 (le bras direct a laisse une regression derriere lui).

## Ce que ce banc NE prouve pas

- **Une seule execution par case.** 3 defauts x 2 modes = 6 mesures, aucune repetition : la
  regression de `d2-x` peut etre un tirage, pas une propriete du mode. Il faudrait rejouer.
- Les couts et durees d'API sont ceux **rendus par le modele lui-meme** dans son JSON de sortie ;
  la duree « mur » est mesuree par `log.sh`, elle.
- Le test `8.3` a ete ECARTE de l'echantillon parce qu'il tombe rouge 7 fois sur 8 sans qu'une
  ligne bouge (`preuves/8-3-instable.txt`) : un bras aurait pu gagner sur un vert non produit.
  Les autres candidats ecartes et leur raison sont dans `rejets.md`.

## Rejouer

```sh
bash bench/mkcopy.sh          # recree les 6 copies de travail + le temoin
bash bench/lance.sh           # lance les 6 bras en parallele, journalise dans logs/
bash bench/report.sh          # tableau recapitulatif
node bench/journalise.mjs     # ecrit les 6 lignes dans le journal des duels du depot reel
```

`check-d1.mjs`, `check-d2.mjs` et `check-d3.mjs` sont laisses NON formates volontairement : leur
empreinte SHA-256 est la preuve que les bras n'ont pas touche a leur propre critere
(`preuves/checks-sha256-avant.txt` = `preuves/checks-sha256-apres.txt`). Les reformater casserait
cette preuve.
