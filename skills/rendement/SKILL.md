---
name: rendement
description: >-
  Analyse TOUT ce que l'app stocke des conversations (`conversations.json`, `activity/*.jsonl`,
  `causal-trace/*.jsonl`, `cost.jsonl`, les `RUN.md` des runs) pour OPTIMISER le chemin
  DEMANDE -> MEILLEURE VERSION DU TRAVAIL FINAL, au coût le plus bas et dans la durée la plus courte.
  Lance d'abord la sonde déterministe `npm run scout:rendement` (LECTURE SEULE) qui mesure, par
  conversation : tours utilisateur, reprises (l'utilisateur redemande la même chose), $ dépensés,
  $/tour, minutes modèle, orchestrations, demande initiale floue — et classe par GASPILLAGE
  (coût pondéré par le taux de reprise). Puis remonte, sur les 3-5 pires, à la CAUSE du détour en
  lisant le fil réel (`conversation_read`, `conversation_search`, `retrospective`), et rend un
  plan d'optimisation chiffré : pour chaque cause, le tour où le chemin a bifurqué, le chemin
  MINIMAL qui aurait livré le même résultat, le delta $ et minutes, et le point d'intégration
  (règle de routage, consigne de phase, garde-fou, hook, skill). Déclencher sur « analyse nos
  conversations », « pourquoi ça coûte si cher », « comment aller plus vite au bon résultat »,
  « optimise le chemin demande -> livrable », « où on perd du temps/de l'argent ».
  N'UTILISE PAS pour : auditer un livrable unique -> `judge` ; corriger un défaut de code -> `build` ;
  auditer le COMPORTEMENT depuis un transcript de session -> `kaizen`. Ici la matière est le CORPUS
  stocké et la métrique est ÉCONOMIQUE (coût, durée, nombre de tours jusqu'au livrable accepté).
---

# rendement — du corpus stocké vers le chemin le plus court demande → livrable

## Ce que la skill optimise
Trois grandeurs mesurables, jamais une impression :
- **Qualité finale** — le livrable a-t-il été ACCEPTÉ sans reprise (aucun message utilisateur de correction après) ?
- **Coût** — $ réellement consommés sur la conversation (`activity/*.jsonl`, recoupés par `cost.jsonl`).
- **Durée** — minutes modèle cumulées, et durée mur du premier message au livrable.
Le gaspillage = ce qui a coûté cher ET a dû être repris. C'est la cible.

## Procédure
1. **MESURER (déterministe, lecture seule).** `npm run scout:rendement` (options : `--top N`,
   `--json`, `--data <dir>` pour un autre profil). Aucun chiffre de cette skill n'est estimé :
   il vient de la sonde. **Mais la sonde a un corpus FIGÉ** : si la cible n'y figure pas — une
   conversation récente ou EN COURS —, ne pas conclure « hors corpus ». Lire son
   `activity/conv-N.jsonl` (voir « Les LOGS de conversation » plus bas) : il est déjà écrit.
   « Corpus vide » ne se dit qu'après avoir cherché le journal ET ne l'avoir pas trouvé.
2. **CHOISIR la cible.** Les 3-5 conversations en tête du classement gaspillage — et TOUJOURS
   au moins une conversation « bon élève » (coût bas, zéro reprise) comme contrôle négatif :
   sans elle, on attribue à un défaut ce qui n'est que la difficulté de la tâche.
3. **REMONTER À LA CAUSE, par le contenu.** La sonde PROPOSE déjà le tour de bifurcation (section
   « Tour de bifurcation » du rapport : premier tour dont le coût est >= 2x la médiane des tours alors
   qu'il reste >= 50 % du coût à dépenser). C'est un CANDIDAT, pas un verdict : le confirmer par le fil
   réel — `conversation_read`, `retrospective` (outils appelés, refus, verdicts, RUN.md). LE TOUR DE
   BIFURCATION est le premier tour après lequel le coût monte sans que le livrable avance. Nommer la
   cause dans ce vocabulaire, avec la citation exacte comme ancre falsifiable :
   - **cadrage** — demande exécutée telle quelle alors qu'elle arrivait en forme de solution / floue ;
   - **routage** — phase jouée ≠ phase appelée (build sur un besoin non cadré, judge alors qu'il restait du travail) ;
   - **preuve** — « fait » annoncé sans artefact, d'où la reprise au tour suivant ;
   - **redite** — travail déjà fait ailleurs, refait faute d'avoir cherché (`conversation_search`, `brain_query`) ;
   - **surdimensionnement** — fan-out / pipeline complet là où une lecture + une édition suffisaient ;
   - **boucle** — même approche retentée à l'identique après échec.
4. **CHIFFRER LE CHEMIN MINIMAL.** Pour chaque cause : écrire le chemin qui aurait produit le
   MÊME livrable (les tours et outils, dans l'ordre), et le delta mesuré — $ économisés,
   minutes économisées, tours supprimés. Un delta non calculable se marque « non chiffrable »,
   il ne s'invente pas.
5. **RENDRE le plan.** Une table classée par delta décroissant :
   `cause · conv:tour (ancre citée) · chemin réel · chemin minimal · Δ$ · Δmin · point d'intégration`.
   Puis UNE règle par cause dominante, écrite en RÉFLEXE (« au moment où X → fais Y »), jamais en
   interdit (« ne fais plus X ») — un interdit ne laisse aucun comportement à exécuter.
6. **INTÉGRER seulement ce qui est nommé.** Les règles retenues se posent au point qui les
   déclenche vraiment (consigne de phase, règle de routage, garde-fou de preuve, skill). Une règle
   installée sans replay de la situation d'origine n'est pas vérifiée : le dire.

## Les LOGS de conversation — la source de première main

L'app écrit sous `.autowin-data/<profil>/` quatre journaux par conversation. **Les lire est la
première main ; une sonde agrégée est la seconde.** Ils remplacent l'Observatory : ce que
l'Observatory affichait, ces fichiers le PORTENT, et eux se lisent sans ouvrir une vue.

| journal | un fichier par | ce qu'il porte |
|---|---|---|
| `activity/conv-N.jsonl` | conversation | `chat-usage` : `costUsd`, `durationMs`, `inputTokens`, `outputTokens`, `cacheReadTokens`, `provider`, `model`, `reasoningEffort`, `label` (= le message utilisateur du tour) ; `conversation-route` : la phase choisie |
| `causal-trace/conv-N.jsonl` | conversation | `message`, `model-response`, `decision`, `injection`, `boundary`, `error`, `response-displayed` — l'enchaînement causal réel |
| `turn-journals/conv-N/` | tour | le journal fin du tour : appels, commandes, verdicts |
| `prompt-observability/conv-N.jsonl` | conversation | ce qui est réellement parti au modèle |

**Réflexe.** Au moment où la cible est une conversation NOMMÉE — et TOUJOURS avant d'écrire
« non mesurable », « pas de données » ou « corpus vide » —, ouvrir son `activity/conv-N.jsonl` et
son `causal-trace/conv-N.jsonl` avant de conclure. Une sonde agrégée a un corpus FIGÉ : les
conversations récentes ou en cours n'y sont pas encore, alors que leur journal, lui, est déjà écrit.

**Mesuré le 2026-09-01 (conv-27).** `scout:rendement` couvrait 25 conversations et ignorait
conv-27, conv-26 et conv-28 — les trois plus récentes. La procédure telle qu'écrite menait à
« hors corpus ». `activity/conv-27.jsonl` portait pourtant les 19 appels, $9,885 et 63,3 min qui
ont permis toute l'analyse. Coût de l'omission : l'analyse entière, ou un chiffre inventé.

**Garde-fous.** Lecture seule, jamais d'écriture sur ces journaux. Un tour à `costUsd = 0` est un
tour NON INSTRUMENTÉ, pas un tour gratuit : l'exclure des moyennes. Et un journal DIT ce qui a été
consommé, jamais si le livrable était bon — l'acceptation se lit dans le fil, pas dans le coût.

## Garde-fous
- **Corrélation ≠ cause.** Une conversation chère peut l'être parce que la tâche était dure. Le contrôle
  négatif de l'étape 2 est OBLIGATOIRE avant d'accuser un défaut de process.
- **Coût de l'analyse.** L'analyse elle-même consomme. Sonde d'abord (gratuite), puis lire au plus
  5 conversations en entier. « Analyse toutes les conversations » = un échantillon NOMMÉ, jamais tout implicitement.
- **Aucune écriture sur le corpus.** La skill ne renomme, ne supprime, ne reclasse aucune conversation.
- **Les tours sans coût** (`$0`) sont des tours non instrumentés, pas des tours gratuits : les exclure
  des moyennes plutôt que de conclure qu'ils étaient efficaces.
- Ne toucher qu'à ce que la demande a nommé (réflexe 11) ; toute règle proposée est déclarée avant d'être posée.
