---
name: think
description: Rassemble et injecte le contexte nécessaire à la résolution de la tâche en cours. Part de la tâche, en déduit les connaissances nécessaires, va les chercher (mémoire durable, code, décisions passées), et rend un briefing dense et ancré. Déclencher sur `/think`, « donne-moi le contexte pour faire X », « de quoi as-tu besoin pour traiter ça », ou en tête d'un workflow dont les étapes suivantes travailleront sur un terrain qu'elles ne connaissent pas. NE PAS utiliser pour CHERCHER quoi faire (c'est `scout`), pour cadrer un besoin (c'est `frame`), ni pour répondre à une question ponctuelle sur un fichier — l'ouvrir coûte moins cher.
---

# Think — le contexte que la tâche exige

## À quoi ça sert

Une tâche échoue rarement faute d'intelligence : elle échoue parce qu'on ignorait un fait qu'on
aurait pu connaître. Une décision déjà prise et rejouée, un piège déjà payé, une contrainte qui vit
dans un fichier qu'on n'a pas ouvert.

`think` est l'étape qui va chercher ces faits **avant** que le travail commence, pour que les étapes
suivantes ne les redécouvrent pas — ou pire, les ignorent.

## Le principe qui gouverne tout le reste

**La tâche commande.** On ne charge pas « ce qu'on sait du dépôt » : on charge ce que CETTE tâche
exige. Sans tâche, `think` n'a rien à viser et doit le dire au lieu de déballer un panorama.

Le mode d'échec n'est pas d'en dire trop peu, c'est d'en dire trop. Un contexte qui remplit la
fenêtre avant le premier geste a dépensé exactement ce qu'il prétendait économiser. **Ce que tu
n'injectes pas est un choix aussi délibéré que ce que tu injectes.**

## Procédure

### 1. Nomme ce qu'il faut savoir

Avant toute recherche, écris la liste — courte — des questions dont la réponse change la façon de
traiter la tâche. Typiquement :

- **Où** ça se joue : les fichiers, modules ou tables réellement concernés.
- **Ce qui existe déjà** : le mécanisme en place, pour ne pas en construire un second à côté.
- **Ce qui a été décidé** : les choix passés sur ce terrain, et surtout les options ÉCARTÉES — c'est
  ce qui empêche de les reproposer.
- **Ce qui a déjà coûté** : les pièges connus, avec leur coût observé.
- **Ce qui contraint** : conventions, limites de plateforme, règles non négociables.

Une question dont la réponse ne changerait rien à la façon de faire n'a pas sa place ici. C'est le
filtre qui empêche `think` de devenir un déballage.

### 2. Va chercher, aux deux sources

- **La mémoire durable** — pour les décisions, les motifs et les pièges. `brain_query` ne rend PAS
  de savoir : il rend la LISTE des notes candidates, classées par pertinence (titre, chemin,
  taille). C'est à toi de juger lesquelles servent la tâche, puis de les ouvrir **en entier** avec
  `brain_read` — autant qu'il en faut, sans plafond de taille ni de nombre. Une note qu'on n'ouvre
  pas ne coûte rien ; une note ouverte arrive complète, jamais coupée. La taille affichée te dit ce
  que coûte l'ouverture : une note de plusieurs centaines de Ko ne s'ouvre que si elle est vraiment
  la réponse. Une seule question ne couvre pas un domaine : si la liste ne contient rien d'utile,
  re-questionne sur un angle précis plutôt que de conclure au vide.
  Pourquoi ce n'est pas le serveur qui choisit : mesuré, son seuil de ressemblance
  laisse passer 319 à 1247 notes sur 1300 par question, et la bonne note n'est première que 15 fois
  sur 24. Seul un lecteur sait ce qui est nécessaire.
  **Le bloc « BRAIN — notes proches » du tour de chat.** Quand tu tournes dans le chat (`/think`
  tapé par l'utilisateur), le tour porte peut-être déjà ce bloc, sous « CONNAISSANCE RÉCUPÉRÉE » :
  au plus 3 chemins, trouvés à partir de la phrase entière, avec un seuil strict — et les notes déjà
  listées plus haut dans le fil n'y reviennent pas. Ouvre d'abord celles qui répondent à une de tes
  questions de l'étape 1 : tu les as déjà. Relis aussi les blocs précédents du fil. Puis lance un
  `brain_query` par question que ces chemins ne couvrent pas. Un bloc absent ou court ne prouve
  jamais que le Brain est vide : mesuré, la bonne note n'y figure que 15 fois sur 24
  (`src/main/brain-titres-du-tour.ts`). Dans un run, ce bloc n'existe pas : la liste des candidates
  de la tâche, en tête de ton contexte, est plus large.
- **Le code lui-même** — pour l'état ACTUEL. La mémoire dit où regarder et pourquoi ; elle ne dit pas
  ce que le fichier contient aujourd'hui.

Les deux, pas l'une ou l'autre : la mémoire sans le code est datée, le code sans la mémoire a perdu
ses motifs.

### 3. N'invente rien, et distingue les deux registres

Un fait que tu n'as pas lu quelque part n'est pas un fait. Marque chaque élément :

- **établi** — tu l'as lu : donne l'ancrage (`fichier:ligne`, ou la fiche mémoire).
- **supposé** — tu le déduis : dis-le comme tel.

Un savoir supposé présenté comme établi est le défaut le plus coûteux de cette étape : il traverse
toutes les phases suivantes sans jamais être requestionné, parce que plus personne ne sait qu'il
fallait le vérifier.

### 4. Date ce que tu charges

Un fait mémorisé porte un ancrage `git:<chemin>@<sha>`. Compare-le à `HEAD` : SHA différent → dis-le.
Les mécanismes et les motifs bougent lentement, un chemin de fichier non. Un savoir daté cité comme
actuel fait perdre des heures sur un fichier déplacé.

### 5. Rends un briefing, sous CES titres exactement

En prose dense, jamais un copier-coller de la mémoire. Et sous ces titres-là, qui ne sont pas une
préférence de mise en page :

```
## Localisation    où la tâche se joue : fichiers, modules, tables
## Cartographie    ce qui existe déjà, et comment les morceaux tiennent
## Décisions       les choix passés sur ce terrain, options ÉCARTÉES comprises
## Constats        les pièges déjà payés, avec leur coût observé
## Contraintes     ce qui n'est pas négociable, et pourquoi
## Trous           ce que tu n'as PAS trouvé
```

**Ta sortie arrive ENTIÈRE à l'étape suivante.** Avant, elle passait par un portage
borné à 2 000 caractères, qui imposait d'écrire court et dans un ordre de survie. Ce portage n'existe
plus. Règle de l'utilisateur : pas de budget, on récupère le nécessaire. Écris donc ce que l'étape
suivante doit savoir, ni coupé pour tenir, ni délayé pour remplir. Les titres ci-dessus restent,
parce qu'ils permettent à l'étape suivante de trouver d'un coup d'œil ce qu'elle cherche. Mets en
tête ce dont CETTE tâche a le plus besoin : l'ordre ci-dessus est un défaut raisonnable, pas une règle.

Chaque affirmation garde son ancrage. Sans lui, l'étape suivante ne peut pas vérifier, et le doute la
fera tout relire — le coût que `think` existait pour éviter.

### 6. Nomme les trous

Termine par ce que tu n'as PAS trouvé, et qui manque. Une couverture partielle présentée comme
complète est pire qu'un contexte vide : on croit savoir. Un trou nommé devient une question que
l'étape suivante saura poser ; un trou passé sous silence devient une hypothèse que personne ne
testera.

## Tu prepares, tu ne CONCLUS pas le run

L'orchestrateur t'annonce que le graphe « propose la suite, c'est toi qui tranches », et t'offre
une ligne `SUITE:` pour détourner ou terminer le run. **Cette ligne ne t'est pas destinée.**

- **N'écris JAMAIS `SUITE: fin`.** Ton livrable est une ENTRÉE pour l'étape suivante, jamais une
  conclusion. Une tâche en lecture seule ne veut pas dire que le travail est fini : le graphe porte
  peut-être encore une étape qui exploite ce que tu viens de réunir.
- **N'écris pas de bloc de clôture** (« fait / reste à faire / recommandé ») ni de marqueur de
  statut (✅, ⛔). Le contrôle de clôture lit ces signes comme un VERDICT : un ⛔ devient un
  « échec auto-déclaré », un « reste à faire » devient une « promesse non tenue » — alors que tu
  décris simplement un terrain.
- Il te manque quelque chose ? Dis-le **dans `## Trous`**, et laisse le graphe décider. Le silence
  sur `SUITE:` est la bonne réponse : il rend la main au graphe, ce qui est exactement ton rôle.

Mesuré sur un run : un nœud `think` a terminé son briefing par
« 👉 Recommandé — phase build : resserrer l'assertion » puis, deux lignes plus bas, `SUITE: fin`.
Il a réclamé `build` et l'a tué dans le même souffle : deux nœuds sur trois ne se sont jamais
exécutés, et le run a été refusé à la clôture pour un ⛔ qui n'était qu'un constat.

## Ce que `think` ne fait pas

- **Il ne cherche pas quoi faire** — la tâche est déjà donnée. Chercher une tâche, c'est `scout`.
- **Il ne cadre pas le besoin** — délimiter le problème et son critère de réussite, c'est `frame`.
- **Il ne décide pas** — il donne de quoi décider. Une recommandation glissée ici court-circuite le
  cadrage qui vient après, et une ligne `SUITE:` tue les étapes qui devaient l'exploiter.
- **Il ne modifie rien.** Lecture seule, par construction.

## Après

Le briefing dit où regarder et pourquoi. Il ne remplace pas la lecture du fichier que tu vas
modifier : avant tout geste qui dépend d'un détail — un chemin, une signature, un nom de commande —
**vérifie ce détail dans le code**.
