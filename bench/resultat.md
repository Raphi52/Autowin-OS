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

   > **RECTIFICATION — cet axe ne departage rien, il RESTITUE la consigne.** `wf-x.txt:6-7`
   > interdit au bras direct toute verification hors de son critere ; `wf-a.txt:5` impose au
   > pipeline une etape `clean`. `hors-critere.mjs` mesure ensuite formatage, lint et tests
   > voisins — exactement ce qui a ete interdit a l'un et ordonne a l'autre. Il ne peut
   > structurellement penaliser que `x`. Pire, `hors-critere.mjs:5-8` dit lui-meme retenir cet
   > axe parce que « c'est la que le pipeline complet s'etait distingue » : l'axe a ete choisi
   > APRES avoir su ou le gagnant souhaite gagnait. Et les deux regressions annoncees ici ne
   > sont **portees par aucun fichier de `preuves/`** : `bench/runs/` et `bench/logs/` sont
   > gitignores et disparus. La seule mesure qui departage tout le banc est **indocumentee et
   > irrejouable**.
   >
   > S'ajoute une cause mecanique : `src/renderer/index.html` et `src/shared/boot-splash.ts` sont
   > deux copies miroir gardees par `boot-splash.test.ts`. **Tout** correctif D2 confine a un seul
   > des deux fichiers casse ce test, par construction. `d2-x` en a touche un, `d2-a` les deux :
   > ce n'est pas une difference de qualite emergente entre les workflows.
3. **Le cout du pipeline est reel** : environ 6 fois plus cher (3,13-3,98 $ contre 0,48-0,69 $) et
   10 fois plus long (648-756 s contre 62-109 s).

> **RECTIFICATION du 2026-09-07 (revue adverse, `bench/out-judge.json`).** Les trois points
> ci-dessus ont ete confrontes a un juge externe. Seul le point 3 survit, et encore : le
> « seuil de bruit de 30 % » qui y figurait etait **invente**. La dispersion reellement mesuree
> dans `.autowin-data/autowin-os/arena-duels.jsonl` monte a **+131 % de cout intra-bras**
> (`arena-bench-dogfood-v2`) et **+70 %** entre deux rejeux a l'identique
> (`arena-bench-residus-v4` / `-rejeu`). L'ecart de cout de 5,8x-7,6x reste ~4x au-dessus de ce
> bruit-la : le COUT tient. Le CLASSEMENT, lui, ne tient pas — voir la section suivante.

**Verdicts : la phrase d'origine etait FAUSSE et elle est retiree.** Elle annoncait six lignes
ecrites dans le journal des duels sous les bancs `banc-defauts-2026-09-07-d1|d2|d3`.
`grep -c banc-defauts .autowin-data/autowin-os/arena-duels.jsonl` rend **0** (verifie le
2026-09-07). `bench/journalise.mjs` exige `bench/logs/*.log`, gitignores et disparus : il n'a
jamais tourne et ne peut plus tourner. **Le banc n'est pas journalise.**

## Ce que ce banc NE prouve pas

- **Une seule execution par case.** 3 defauts x 2 modes = 6 mesures, aucune repetition : la
  regression de `d2-x` peut etre un tirage, pas une propriete du mode. Il faudrait rejouer.
- Les couts et durees d'API sont ceux **rendus par le modele lui-meme** dans son JSON de sortie ;
  la duree « mur » est mesuree par `log.sh`, elle.
- **Le banc ne departage aucun defaut.** 6 bras sur 6 passent le critere binaire ; le second axe
  ne fait que constater qu'un bras a qui on avait INTERDIT de verifier n'a pas verifie ; et le
  seul vert du pipeline (D2) etait un faux vert. Ce qui subsiste apres revue adverse : **le
  pipeline complet coute ~6x plus cher et dure ~10x plus longtemps. Rien d'autre.**
- **La procedure « Rejouer » ci-dessous est inexecutable en l'etat** : `bench/runs/`, `bench/logs/`
  et la copie temoin sont gitignores et absents, et `journalise.mjs` refuse de tourner sans les
  journaux.
- Revue adverse complete : `bench/prompt-judge.txt` (l'enonce donne a REFUTER) et
  `bench/out-judge.json` (session `6914c6c4`, 2,44 $). Limite de cette revue : **un seul
  relecteur, meme modele que le producteur** — ce n'est pas une confirmation independante.
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
empreinte SHA-256 devait prouver que les bras n'ont pas touche a leur propre critere
(`preuves/checks-sha256-avant.txt` = `preuves/checks-sha256-apres.txt`).

> **RECTIFICATION — cette preuve est PERIMEE et ces deux fichiers d'empreintes MENTENT aujourd'hui.**
> Deux criteres sur trois ont ete modifies APRES la mesure, par le producteur du banc lui-meme :
> `check-d1.mjs` au commit `a4132786` (16:28) et `check-d2.mjs` aux commits `868f95fb` (14:32) puis
> a la correction du faux vert D2 (voir plus bas). Seul `check-d3.mjs` est inchange. Les deux
> modifications d'origine etaient semantiquement neutres ou plus strictes — **la mesure rouge -> vert
> reste donc valide** —, mais le mecanisme presente comme preuve d'integrite n'a pas vu son propre
> producteur editer les criteres. Quiconque rejoue obtient une divergence sans pouvoir distinguer
> une triche de bras d'une maintenance posterieure. **Ne pas se fier a ces deux fichiers.**

## Suite donnee au banc — les correctifs sont entres dans le depot

Le banc mesurait des reparations qui vivaient dans des copies jetables (`bench/runs/*`) : le
depot lui-meme restait rouge sur les 3 defauts. Les correctifs GAGNANTS ont donc ete repris
tels quels dans le depot, commit `03d7e38a` :

| defaut | source reprise | fichiers |
| ------ | -------------- | -------- |
| D1 | `bench/runs/d1-x` | `scripts/scout-residus.angle-mort.test.mjs` |
| D2 | `bench/runs/d2-a` | `src/renderer/index.html`, `src/shared/boot-splash.ts` — **FAUX VERT, corrige depuis (voir plus bas)** |
| D3 | `bench/runs/d3-x` | `src/renderer/src/components/ChatComposer.tsx` |

Rouge -> vert re-verifie sur le depot, defaut reinjecte pour montrer que le critere mord
encore : `preuves/correctifs-dans-le-depot.txt`. Un rouge de base non lie au banc a ete
repare au passage (`378ad20a`, 2 variables mortes dans `ChatView.tsx` qui rendaient
`npm run typecheck` rouge).

## Le vert de D2 etait un FAUX VERT — constat et correction (2026-09-07)

**Ce que la revue adverse a trouve.** Le correctif `d2-a` n'a pas reuni les palettes : il a AJOUTE
un filet vertical dore/violet a `index.html` tout en laissant les teintes divergentes en place. Le
critere `check-d2.mjs` se contentait alors de constater la PRESENCE des deux couleurs dans une
declaration CSS — satisfait sans que la divergence disparaisse. Le seul vert du pipeline reposait
donc sur un grep de codes hexadecimaux, pour un defaut **visuel** dont aucune capture n'avait
jamais ete prise.

**Ce que la relecture du code a corrige dans ce constat.** Les teintes `#ff2d95 / #ff8a1f / #ffd66b`
que la revue designe comme « la divergence encore presente » ne sont PAS une derive : ce sont les
couleurs de l'atome de l'application, definies dans `src/renderer/src/assets/theme.css:728-742` et
recopiees sciemment dans le splash, sous la surveillance du test
`src/shared/boot-splash.test.ts` (« reprend les couleurs et les tempos de `theme.css` »). Le splash
a raison de les porter.

**La vraie divergence restante, et sa correction.** Le dore `#e9bd4e` et le violet `#9d79ed`
etaient ecrits **a la main dans trois fichiers**. Le lanceur Python les recopiait en dur
(`_DORE`, `_VIOLET`), et la garde censee refuser la derive cherchait l'hexadecimal dans le TEXTE
du lanceur — elle passait donc sur un simple **commentaire**, verte alors que l'ecran aurait pu
peindre autre chose. La palette a desormais **une source unique** :

- `src/shared/boot-splash.ts` porte le degrade ; `src/renderer/index.html` en est la copie,
  surveillee par `boot-splash.test.ts` (mutation verifiee : changer la couleur dans `index.html`
  seul fait **echouer** ce test, 1 failed / 7 passed, puis 8/8 apres restauration) ;
- `scripts/launch_dev_splash.py` ne recopie plus rien : il **extrait** les deux teintes du degrade
  de `index.html` (`_DORE = _ARCS.group(1)`), et s'arrete avec un message clair si le degrade
  disparait. Mutation verifiee : passer `index.html` au `#00ff00` fait suivre le lanceur
  (`DORE -> #00ff00`) sans aucune edition de son cote ;
- la garde `scripts/launch_dev_phases_test.py` compare desormais la valeur **executee** du lanceur
  (`_mod._DORE`) a celle lue dans `index.html`, plus une sous-chaine de son fichier source.

**Les criteres G4 et G5 ont ete REECRITS, et c'est assume.** Tous deux etaient des grep de
litteraux : G5 exigeait que la garde contienne `#e9bd4e`, ce qui **punissait** la source unique et
recompensait le codage en dur ; G4 exigeait la meme chose du lanceur. Ils sont remplaces par des
verifications de PROPRIETE, et la preuve qu'elles sont **plus strictes** est une double mutation :

| mutation appliquee | ancien critere | nouveau critere |
| ------------------ | -------------- | --------------- |
| retour au codage en dur dans le lanceur | passait (c'est ce qu'il exigeait) | **RATE** G1 + G5 |
| palette en COMMENTAIRE seulement, ecrans peints en `#ff2d95` | passait (l'hexa est dans le texte) | **RATE** G1 + G4 + G5 |
| depot en l'etat | rouge (G5) | **CRITERE ATTEINT**, exit 0 |

**Observe a l'ecran**, pas seulement teste : `preuves/splash-app.png` (rendu headless de
`preuves/splash-app.html`) montre le fond noir, le filet vertical **dore en haut, violet en bas**
a gauche, l'atome et le titre — la meme palette que le filet du lanceur Python.

**Ce que cela change pour le classement du banc :** `a` ne gagne plus D2. Son vert etait un faux
vert et le critere qui le lui accordait a du etre reecrit. Le banc ne departage donc plus **aucun**
des trois defauts : 6 bras sur 6 passent, le second axe est circulaire, et le seul resultat qui
survit est l'ecart de COUT.
