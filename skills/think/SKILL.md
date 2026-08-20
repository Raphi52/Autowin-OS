---
name: think
description: Rassemble ce qu'il faut savoir pour résoudre la tâche en cours, et rien de plus. Part de la tâche, en déduit les connaissances nécessaires, va les chercher (mémoire durable, code, décisions passées), et rend un briefing dense et ancré. Déclencher sur `/think`, « donne-moi le contexte pour faire X », « de quoi as-tu besoin pour traiter ça », ou en tête d'un workflow dont les étapes suivantes travailleront sur un terrain qu'elles ne connaissent pas. NE PAS utiliser pour CHERCHER quoi faire (c'est `scout`), pour cadrer un besoin (c'est `frame`), ni pour répondre à une question ponctuelle sur un fichier — l'ouvrir coûte moins cher.
---

# Think — le contexte que la tâche exige, et rien de plus

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

- **La mémoire durable** (`brain_query`) — pour les décisions, les motifs et les pièges. Une seule
  question ne couvre pas un domaine : si le retour est maigre, re-questionne sur un angle précis
  plutôt que de conclure au vide.
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

### 5. Rends un briefing, pas un corpus

En prose dense, organisée par ce que la tâche va devoir décider — pas par source. Aucun copier-coller
de la mémoire : ce qui sert, c'est la synthèse qui tient en contexte.

Chaque affirmation garde son ancrage. Sans lui, l'étape suivante ne peut pas vérifier, et le doute la
fera tout relire — le coût que `think` existait pour éviter.

### 6. Nomme les trous

Termine par ce que tu n'as PAS trouvé, et qui manque. Une couverture partielle présentée comme
complète est pire qu'un contexte vide : on croit savoir. Un trou nommé devient une question que
l'étape suivante saura poser ; un trou passé sous silence devient une hypothèse que personne ne
testera.

## Ce que `think` ne fait pas

- **Il ne cherche pas quoi faire** — la tâche est déjà donnée. Chercher une tâche, c'est `scout`.
- **Il ne cadre pas le besoin** — délimiter le problème et son critère de réussite, c'est `frame`.
- **Il ne décide pas** — il donne de quoi décider. Une recommandation glissée ici court-circuite le
  cadrage qui vient après.
- **Il ne modifie rien.** Lecture seule, par construction.

## Après

Le briefing dit où regarder et pourquoi. Il ne remplace pas la lecture du fichier que tu vas
modifier : avant tout geste qui dépend d'un détail — un chemin, une signature, un nom de commande —
**vérifie ce détail dans le code**.
