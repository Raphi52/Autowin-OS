---
name: check
description: Rejoue la PREUVE de la dernière demande d'un fil resté « À vérifier » sur le Board. Déclencher sur `/check`, envoyé dans le fil par les boutons « Vérifier » et « Tout vérifier » du Board, ou sur « vérifie ce qui a été fait ici ». Relit ce que le fil a demandé et livré, choisit la vérification la moins chère qui reproduit ce que voit l'utilisateur, la joue par l'outil `verify` ou par une commande de test lancée seule, et rend vert ou rouge sans rien modifier. NE PAS utiliser pour : corriger le défaut trouvé (→ `build`), auditer la qualité d'un livrable (→ `judge`), décrire un écran sans verdict (→ `look`).
---

# check — rejouer la preuve d'un fil « À vérifier »

## Pourquoi

Le Board (vue Carte du projet) range un fil en « À vérifier » quand le dernier tour a fini **sans
aucune vérification jouée**. La règle est dans `statutDuSegment`, `src/renderer/src/components/carte-du-fil.ts`.
Le Board ne lit que **deux sortes de preuves** :

- un appel à l'outil **`verify`** : il lit son code de sortie ;
- une **commande de test lancée SEULE** au terminal (`src/main/providers/tests-du-terminal.ts`).
  `… | tail`, `… > log; echo EXIT=$?` rendent le code du dernier maillon, pas celui du test :
  le Board ne les compte pas.

Le post-it passe en **« Fait »** si chaque vérification distincte finit verte. Il passe en
**« Bloqué »** si l'une finit rouge, ou si ta réponse porte `⛔ Bloqué` ou `⚠️ Non résolu`. Sans
aucune preuve, il **reste** en « À vérifier » : l'utilisateur tranche alors avec « Vérifié à la main ».

## Procédure

1. **Relis la demande visée** : le dernier message de l'utilisateur AVANT ce `/check` (pas `/check`
   lui-même), et la réponse finale qui l'a suivi. Note ce qui a CHANGÉ (fichiers, commit, réglage)
   et ce qui a été PROMIS.
2. **Classe le livrable** et choisis la preuve la moins chère qui reproduit ce que voit l'utilisateur :
   - code modifié → le test à côté du fichier touché (`x.ts` → `x.test.ts`), plus le typage si le
     langage en a un ;
   - interface → le test du composant ; dans Autowin, plus une capture `node scripts/ui-capture.mjs
     --code-dev` que tu LIS ;
   - skill, document, réglage → le test qui le garde (ex. `src/main/kit-cliquets.test.ts` pour une
     skill), sinon un script de contrôle qui rend un code de sortie ;
   - réponse sans artefact (question, avis, explication) → **rien à rejouer**. Dis-le en une ligne
     et ne fabrique pas de preuve : le post-it reste « À vérifier ».
3. **Joue la preuve** : l'outil `verify` d'abord (`type: test` avec une `cible`, `typecheck`, `lint`).
   Sinon une commande de test SEULE au terminal (`npx vitest run <fichier>`), sans `|`, sans
   redirection, sans `; echo`.
4. **Rouge** → ne corrige PAS dans ce tour (c'est `build`). Écris `⛔ Bloqué :` avec la commande, son
   code de sortie et la première assertion en échec.
5. **Vert** → dis en une ligne ce qui a été rejoué et son code de sortie.

## Interdits

- **Rien modifier** : ni édition, ni commit, ni push. `/check` observe.
- **Pas de faux vert** : une vérification sans rapport avec la demande (`node -e "1"`, la suite
  d'un autre dépôt), ou plus ancienne que la dernière modification, ne prouve rien.
- **Pas de suite complète** quand un test ciblé suffit : un `/check` peut partir dans dix fils à la fois.
- Jamais « vérifié » sans un code de sortie lu.

## Sortie

Trois lignes, en tête de ta réponse :

- **Demande vérifiée** : sa première ligne.
- **Preuve** : `commande` → exit N (ou « aucune : rien à rejouer par un outil »).
- **Verdict** : Fait · Bloqué · Reste à vérifier à la main.
