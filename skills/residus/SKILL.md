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
AU MOMENT où la sonde a rendu son rapport → compare son nombre de fichiers scannés au nombre de
fichiers RÉELS du dossier (`ls`). L'écart est ton angle mort, et il se balaie À LA MAIN avant toute
shortlist. La sonde ne lit que les extensions de `EXT` (`scripts/scout-residus.mjs:10`) : les `.ps1`,
`.py`, `.bat`, `.vbs` en sont dehors. Mesuré au banc du 2026-09-05 : la sonde voyait 13 fichiers sur
159 dans `scripts/` — le bras qui ne s'est PAS arrêté à elle a trouvé le double de résidus.

AU MOMENT où tu n'as listé que des FICHIERS morts → tu n'as fait que la moitié. Le résidu le plus
coûteux vit DANS un fichier vivant : une branche jamais atteinte, une cible qui n'existe plus, un
chemin en dur vers un dossier disparu. Cherche-le explicitement avant de rendre.

## Procédure
1. `npm run scout:residus` (ou `node scripts/scout-residus.mjs <racine>` pour cibler un sous-dossier).
2. Applique la règle d'entrée : liste les extensions non couvertes du dossier et balaie-les à la main
   (cibles de scripts `.ps1`/`.bat` : le fichier visé existe-t-il encore ? le dossier en dur existe-t-il ?).
3. **Culler les faux positifs AVANT de lister** — ouvrir le `file:line` :
   - fichier « jamais importé » → vérifier `new Worker(...)`, `fork`, chemin en dur, `package.json`
     (scripts), `electron-builder.yml`, un wrapper `.ps1`, un test qui le `spawn`, un commentaire de
     procédure dans du code vivant ;
   - export « jamais référencé » → vérifier un import type dans un `.d.ts`, une ré-exportation `index.ts`, un usage par nom dynamique ;
   - `console.log` → distinguer une trace d'exploitation VOULUE d'un debug oublié ;
   - `catch {}` → distinguer un best-effort légitime d'une erreur avalée (celle-là est un DÉFAUT, pas un résidu).
4. Chaque item porte une PREUVE EXÉCUTÉE, pas une affirmation : la commande de recherche d'appelant
   citée AVEC son résultat (`git grep -n "<nom>" .` → 0 résultat). « Aucune mention nulle part » sans
   commande citée ne vaut rien.
5. Rendre une table classée : `Catégorie · file:line · Pourquoi c'est mort · Preuve d'absence d'appelant · Signal de retrait`.
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
