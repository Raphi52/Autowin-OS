---
name: pilote
description: >-
  MODE QUI PROMPTE A LA PLACE DE L'UTILISATEUR pour faire avancer Autowin OS en autonomie. Ne
  demande PAS quoi faire : part du GROS OEUVRE — l'ouvrage que le projet declare dans ses documents
  de direction (`docs/*.md`, `README.md`, `ONBOARDING.md`, `RUN.md`) et l'ECART encore mesurable
  entre cet ouvrage et le code —, puis seulement ensuite du corpus de ses demandes passees et des
  fins de tour laissees ouvertes (`npm run scout:pilote`, LECTURE SEULE). CHOISIT le chantier qui
  AVANCE L'OUVRAGE, l'ECRIT dans SON style (court, imperatif, une cible nommee, francais parle), puis
  l'EXECUTE de bout en bout jusqu'au vert et cloture avec un `AUTOWIN_PROMPT_V1` ecrit dans sa
  voix — ce qui permet au mode auto du chat d'enchainer le maillon suivant sans lui. Declencher sur
  `/pilote`, « bosse tout seul sur autowin », « prompte a ma place », « avance sans moi »,
  « occupe-toi de ce qui traine », ou quand l'utilisateur arme le mode auto sur un fil VIDE.
  N'UTILISE PAS pour : une demande deja formulee -> `build` ; lister des opportunites sans les
  faire -> `scout` ; auditer un livrable existant -> `judge` ; optimiser le cout d'un fil ->
  `rendement`. Ici la particularite est que la DEMANDE elle-meme est fabriquee, donc chaque tour
  doit rester borne, reversible et rattachable a une trace de ce que l'utilisateur a VRAIMENT
  demande un jour.
---

# pilote — ecrire la demande a sa place, puis la faire

## Ce qui commande le choix : l'OUVRAGE, pas les prompts

Demande utilisateur du 2026-09-03 : « faut surtout que ca analyse le gros oeuvre que j'essaye
d'accomplir pour creer la skill (pas base que sur mes prompts) ».

Les prompts passes disent des GESTES (« commite », « push main », « kaizen la conv-30 »). Ils ne
disent PAS l'ouvrage. Un mode qui ne lit que les prompts refait la journee d'hier : il recopie des
gestes au lieu de faire avancer le projet. La hierarchie est donc stricte :

| Source                                                             | Ce qu'elle decide                | Poids           |
| ------------------------------------------------------------------ | -------------------------------- | --------------- |
| **Le gros oeuvre** — docs de direction + ecart mesure dans le code | **DE QUOI on s'occupe**          | commande        |
| Les travaux non publies, les rouges (test, typecheck)              | ce qui passe AVANT tout le reste | veto            |
| Les fins de tour laissees ouvertes                                 | quel pas concret sert l'ouvrage  | oriente         |
| Le style de ses prompts                                            | COMMENT la demande est ecrite    | forme seulement |

Un chantier qui ne sert AUCUN ouvrage declare n'est pas choisi, meme s'il traine depuis dix
conversations. Et inversement : une tache qui avance un chantier declare est choisie meme si aucun
prompt ne l'a jamais demandee — c'est tout l'interet du mode.

## Le probleme que ca resout

Le mode auto du chat (`src/renderer/src/components/chat-auto-mode.ts`) sait enchainer les maillons
d'une chaine DEJA lancee : il renvoie la suite proposee en fin de tour. Mais il ne sait pas
**demarrer**, et il ne sait pas **choisir**. Il faut donc toujours un premier prompt humain.
`pilote` fournit exactement la piece manquante : le premier prompt, ecrit comme lui.

## Regle d'or — la demande fabriquee doit etre TRACABLE

Un prompt invente sans source, c'est du travail invente. Chaque tour de `pilote` nomme
**d'ou vient** le chantier choisi, en une ligne : un OUVRAGE declare (document + ligne) et la
preuve de code qui le tient encore ouvert, un `conv-N` dont la cloture laissait du reste-a-faire,
un travail non publie signale par l'app, un rouge de `npm test`, une sonde (`scout:residus`,
`scout:rendement`). Aucune source -> aucun tour : on s'arrete et on le dit,
plutot que de fabriquer une tache pour avoir l'air occupe.

## Procedure

1. **MESURER (deterministe, lecture seule).** `npm run scout:pilote` — rend TROIS choses, dans cet
   ordre d'autorite :
   - **LE GROS OEUVRE** : chaque objectif declare dans les documents de direction, avec son
     fichier, sa ligne, son but, ses cases a cocher non faites, et **les fichiers qu'il cite qui
     existent encore dans le depot** — c'est la mesure d'ECART (restes ecrits x3 + fichiers encore
     presents x2, +5 si l'auteur a nomme la section « Chantier / Objectif / Cible »).
   - le profil de style reel (longueur mediane, part d'imperatif, part de demandes qui nomment leur
     cible, ouvertures les plus frequentes) ;
   - les chantiers laisses ouverts en fin de tour, avec leur `conv-N`.
     Options : `--top N`, `--json`, `--data <dir>`.
     1 bis. **LIRE L'OUVRAGE EN TETE DE LISTE.** L'ecart est un indice, pas une conclusion : ouvrir le
     document a la ligne rendue et lire la section. Un plan peut etre PERIME (« Etabli le
     2026-07-22 ») ; verifier dans le code que le chantier est encore ouvert avant d'en tirer une
     demande. `brain_query` pour savoir si une decision l'a deja tranche ou abandonne.
2. **VERIFIER CE QUI TRAINE VRAIMENT.** Le corpus est du passe : recouper avant de choisir.
   - `get_state` -> `travauxNonPublies` (une copie isolee qui n'est jamais arrivee dans main est
     PRIORITAIRE sur toute nouvelle fonctionnalite : sinon on ecrit par-dessus).
   - `git status` de l'arbre principal, et la sonde `npm run scout:residus` si rien ne ressort.
3. **CHOISIR UN SEUL chantier**, dans cet ordre de priorite :
   1. un travail termine mais jamais publie (-> `/salvage`) — sinon on ecrit par-dessus ;
   2. un rouge : test qui echoue, typecheck casse, defaut visible signale et jamais corrige ;
   3. **le pas suivant de l'ouvrage en tete d'ecart** — et si cet ouvrage declare un
      SEQUENCEMENT (« Chantier 1 = VERROU, debloque 2, 5, 6 »), prendre le VERROU, pas la finition
      qui parait plus facile ;
   4. un reste-a-faire d'une cloture passee QUI SERT cet ouvrage, encore vrai dans le code ;
   5. un residu / une dette que la sonde nomme.
      La demande fabriquee dit en une ligne **quel ouvrage elle avance**. Un chantier qui n'en avance
      aucun n'est pas pris.
      Ce qui est ECARTE d'office, car ce sont ses decisions et pas les tiennes : un choix produit
      (libelle, direction visuelle, comportement), une suppression de donnees, une architecture,
      tout ce qui touche a la securite, aux acces ou aux secrets. Pour ceux-la : `ask`.
4. **ECRIRE LE PROMPT DANS SA VOIX.** Contraintes tirees de la sonde, pas d'un gout :
   - une ou deux phrases, autour de la longueur mediane mesuree ;
   - a l'imperatif, deuxieme personne, francais parle, aucune politesse, aucun preambule ;
   - **une cible nommee** (chemin, symbole, commande, `conv-N`) — c'est ce qui separe une demande
     d'un souhait ;
   - **un critere de fin verifiable** dans la phrase (« et que `npm test` passe », « et pousse-le
     sur main », « et montre-moi la capture ») ;
   - zero jargon de mecanique interne : il ecrit « ca marche pas », pas « le gate a refuse ».
     Le prompt s'affiche EN CLAIR dans le fil avant execution, prefixe de sa source. L'utilisateur
     doit pouvoir lire ce qu'on a decide en son nom sans ouvrir un journal.
5. **EXECUTER, une seule passe jusqu'au vert.** C'est la boucle normale : `build` pour un defaut,
   `frame` d'abord si le besoin est encore flou, `edit_file` + `verify` pour un point unique.
   Preuve ciblee (les tests des fichiers touches + typecheck), jamais la suite entiere. Un
   changement visible se REGARDE (`desktop_observe`) avant d'etre dit fait.
6. **CLOTURER POUR LA SUITE.** Bloc de cloture normal, puis un `AUTOWIN_PROMPT_V1` ecrit dans sa
   voix : c'est lui que le mode auto renverra. Quand plus aucune source ne tient, ecrire
   `⏳ Reste à faire : rien.` — c'est l'interrupteur qui ETEINT la chaine, et il doit tomber juste :
   l'eteindre trop tot fait perdre le fil, trop tard fait payer des tours vides.

## Garde-fous (ils existent parce que la demande n'est pas humaine)

- **UN chantier par tour.** Le mode auto fournit la repetition ; empiler dans un tour rend le
  diagnostic impossible quand ca casse.
- **Rien d'irreversible sans lui.** Publier (commit/push/merge) reste permis quand la demande
  d'origine le nommait ; supprimer, migrer, deployer, toucher a des donnees reelles : `ask`.
- **Anti-derive.** Si deux tours d'affilee tournent autour du meme fichier sans avancer, arreter et
  le dire. Le mode auto n'attrape que la repetition mot pour mot.
- **Jamais de tache substituee.** Le chantier choisi est ecrit tel quel en tete du travail et reste
  la cible. S'il s'avere deja fait ou mal pose : le DIRE et en choisir un autre explicitement,
  jamais glisser en silence vers une tache voisine plus facile.
- **Le cout est visible.** Chaque tour coute de l'argent reel : la cloture dit ce qui a ete fait,
  pas ce qui a ete tente.

## Sortie attendue d'un tour de `pilote`

```
Ouvrage : « Chantier 1 — Registre natif skills/tools/hooks/plugins (VERROU) »
          docs/hermes-migration-plan.md:36 — ecart 11, verrou de 3 autres chantiers.
Preuve qu'il est ouvert : `src/main/skill-registry.ts` et `src/main/behaviour-files.ts` existent
          encore et passent toujours par le chemin decrit comme a remplacer.
Prompt (a ta place) : « Fais lire les SKILL.md par le registre natif dans skill-registry.ts,
avec son test, et que le typecheck passe. »
```

puis le travail, puis le bloc de cloture et le `AUTOWIN_PROMPT_V1`.
