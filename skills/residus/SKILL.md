---
name: residus
description: >-
  Routine de scout du CODE RÉSIDUEL INUTILE à nettoyer. Lance la sonde déterministe
  `npm run scout:residus` (lecture seule) qui rend un rapport Markdown : fichiers jamais importés,
  exports jamais référencés ailleurs, TODO/FIXME/HACK, console.log/debug, catch vides, @ts-ignore,
  tests skip/todo, code commenté. Puis BALAIE ce que la sonde ne voit pas, TRIE les candidats
  (vrai résidu vs faux positif : chargement dynamique, IPC, entrée d'app, réflexion) et rend une
  shortlist priorisée prête pour `clean`.
  Déclencher sur « cherche le code mort / le résiduel à nettoyer / la dette morte / scan les restes ».
  Ne SUPPRIME rien : elle propose. La suppression passe par `clean` puis `judge`.
---

# residus — scout du code résiduel inutile (lecture seule)

## Règle d'entrée — la sonde est un DÉPART, jamais le périmètre
AU MOMENT où la sonde a rendu son rapport → lis sa section `## 0. Angle mort` : elle compte et NOMME
les fichiers qu'elle n'a PAS ouverts, par extension. Cet angle mort se balaie À LA MAIN avant toute
shortlist — il ne se déduit plus d'un `ls`, la sonde le déclare elle-même. La sonde ne lit que les extensions de `EXT` (`scripts/scout-residus.mjs:10`) : les `.ps1`,
`.py`, `.bat`, `.vbs` en sont dehors. Mesuré au banc du 2026-09-05 : la sonde voyait 13 fichiers sur
159 dans `scripts/` — le bras qui ne s'est PAS arrêté à elle a trouvé le double de résidus.

AU MOMENT où tu n'as listé que des FICHIERS morts → tu n'as fait que la moitié. Le résidu le plus
coûteux vit DANS un fichier vivant : une branche jamais atteinte, une cible qui n'existe plus, un
chemin en dur vers un dossier disparu. Cherche-le explicitement avant de rendre.


## Deuxième règle — un fichier VIVANT peut avoir cessé de MARCHER
AU MOMENT où tu t'apprêtes à écrire qu'un script est vivant, sain ou vert → **EXÉCUTE-LE**. Le mort
non listé n'est pas le seul risque : un script parfaitement appelé peut être cassé depuis des mois par
une racine codée en dur vers un dossier disparu, et personne ne le voit puisque rien ne le déclare mort.
- La section `## 0 bis. Chemins absolus morts` du rapport te donne les candidats : chaque `file:line`
  y cite un chemin dont le **dossier parent n'existe pas**. Ces fichiers ne sont pas résiduels, ils sont
  **cassés** — c'est une catégorie à part, à rendre comme telle.
- Cette section ne te dispense PAS d'exécuter : elle ne voit que les chemins littéraux. Un script peut
  échouer pour dix autres raisons. Lance ceux que tu vas déclarer vivants et **cite leur code de sortie**.
- AU MOMENT où un script sort 0 → vérifie qu'il a vraiment fait quelque chose. Un filtre `vitest` qui
  n'apparie rien est ignoré **en silence** : cinq cibles, quatre fichiers joués, exit 0 quand même.
  La couverture perdue ne fait aucun bruit — c'est la ligne qui est morte, pas le fichier.

Mesuré au banc /arena du 2026-09-06 : `assert-package-content.ps1` et `assert-ui-package-fresh.ps1`
pointaient une racine disparue et sortaient exit 1, entraînant deux `verify-*.ps1` vivants avec eux.
Le bras qui suivait cette skill les avait déclarés verts — et a perdu le banc là-dessus.

## Procédure
1. `npm run scout:residus` (ou `node scripts/scout-residus.mjs <racine>` pour cibler un sous-dossier).
2. Applique la règle d'entrée : la section `## 0. Angle mort` du rapport donne les extensions non
   couvertes et leur nombre — balaie ces fichiers à la main
   (cibles de scripts `.ps1`/`.bat` : le fichier visé existe-t-il encore ? le dossier en dur existe-t-il ?).
3. **Exécute les scripts que tu vas déclarer vivants** (deuxième règle) : pars de la section
   `## 0 bis. Chemins absolus morts`, puis lance les autres. Cite le code de sortie de chacun. Un
   fichier cassé se rend dans une catégorie distincte des résidus — il est à RÉPARER, pas à retirer.
4. **Culler les faux positifs AVANT de lister** — ouvrir le `file:line` :
   - fichier « jamais importé » → vérifier `new Worker(...)`, `fork`, chemin en dur, `package.json`
     (scripts), `electron-builder.yml`, un wrapper `.ps1`, un test qui le `spawn`, un commentaire de
     procédure dans du code vivant ;
   - export « jamais référencé » → vérifier un import type dans un `.d.ts`, une ré-exportation `index.ts`, un usage par nom dynamique ;
   - `console.log` → distinguer une trace d'exploitation VOULUE d'un debug oublié ;
   - `catch {}` → distinguer un best-effort légitime d'une erreur avalée (celle-là est un DÉFAUT, pas un résidu).
5. Chaque item porte une PREUVE EXÉCUTÉE, pas une affirmation : la commande de recherche d'appelant
   citée AVEC son résultat (`git grep -n "<nom>" .` → 0 résultat). « Aucune mention nulle part » sans
   commande citée ne vaut rien.
6. Rendre une table classée : `Catégorie · file:line · Pourquoi c'est mort · Preuve d'absence d'appelant · Signal de retrait`.
   Le signal de retrait doit ÊTRE exécutable et VRAIMENT rouge sans le fichier : vérifie-le. Piège
   mesuré : `npx vitest list <fichier absent> <fichier présent>` sort **0** — un filtre qui ne matche
   rien est ignoré en silence, donc « la suite passe encore » ne prouve pas que le code était mort.
6. Passer la main à `clean` pour l'exécution, jamais supprimer depuis ici.

## Garde-fous
- Aucun retrait sans preuve d'absence d'appelant RÉEL (réflexe 10 : énumérer et balayer les chemins atteignables).
- Deux fichiers qui se ressemblent ne font pas doublon : compare ce qu'ils font vraiment (API appelée,
  option passée) avant d'en déclarer un mort, et regarde ce que la documentation cite.
- Ne jamais toucher à ce que la demande n'a pas nommé (réflexe 11).
- Un item non tranché reste listé AVEC sa réserve, il ne disparaît pas du rapport.
