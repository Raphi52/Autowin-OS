---
name: residus
description: >-
  Routine de scout du CODE RÉSIDUEL INUTILE à nettoyer. Lance la sonde déterministe
  `npm run scout:residus` (lecture seule) qui rend un rapport Markdown : fichiers jamais importés,
  exports jamais référencés ailleurs, TODO/FIXME/HACK, console.log/debug, catch vides, @ts-ignore,
  tests skip/todo, code commenté. Puis TRIE les candidats (vrai résidu vs faux positif : chargement
  dynamique, IPC, entrée d'app, réflexion) et rend une shortlist priorisée prête pour `clean`.
  Déclencher sur « cherche le code mort / le résiduel à nettoyer / la dette morte / scan les restes ».
  Ne SUPPRIME rien : elle propose. La suppression passe par `clean` puis `judge`.
---

# residus — scout du code résiduel inutile (lecture seule)

## Procédure
1. `npm run scout:residus` (ou `node scripts/scout-residus.mjs <racine>` pour cibler un sous-dossier).
2. Lire le rapport. Chaque item est un CANDIDAT, pas un verdict.
3. **Culler les faux positifs AVANT de lister** — ouvrir le `file:line` :
   - fichier « jamais importé » → vérifier `new Worker(...)`, `fork`, chemin en dur, config electron-builder, script npm ;
   - export « jamais référencé » → vérifier un import type dans un `.d.ts`, une ré-exportation `index.ts`, un usage par nom dynamique ;
   - `console.log` → distinguer une trace d'exploitation VOULUE d'un debug oublié ;
   - `catch {}` → distinguer un best-effort légitime d'une erreur avalée (celle-là est un DÉFAUT, pas un résidu).
4. Rendre une table classée : `Catégorie · file:line · Pourquoi c'est mort · Signal de retrait` (le signal = `npm test` vert après suppression).
5. Passer la main à `clean` pour l'exécution, jamais supprimer depuis ici.

## Garde-fous
- Aucun retrait sans preuve d'absence d'appelant RÉEL (réflexe 10 : énumérer et balayer les chemins atteignables).
- Ne jamais toucher à ce que la demande n'a pas nommé (réflexe 11).
- Un item non tranché reste listé AVEC sa réserve, il ne disparaît pas du rapport.
