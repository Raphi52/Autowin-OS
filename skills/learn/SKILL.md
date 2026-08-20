---
name: learn
description: Écrit dans le Brain ce que la tâche vient d'établir. Cela couvre la fonctionnalité livrée, la cause réelle d'un correctif, la décision prise et les options écartées, le piège découvert et son coût — en faits ancrés et sans doublon (relecture puis mise à jour de l'existant, jamais une seconde copie). Déclencher sur `/learn`, « capitalise ce qu'on vient de faire », « note la décision », ou en fin de workflow, une fois le travail vérifié. NE PAS utiliser pour dresser un portrait général du dépôt, ni pour un état passager (branche courante, suite verte du moment) : on capitalise ce qui restera vrai dans trois mois.
---

# Learn — capitaliser ce que cette tâche a établi

## À quoi ça sert

Le travail qu'on vient de finir a produit deux choses : un changement dans le code, et un SAVOIR sur
ce changement. Le code est committé ; le savoir, lui, s'évapore avec la conversation.

Ce savoir est ce qui a coûté le plus cher : la cause réelle derrière le symptôme, les options
essayées puis écartées, le piège qu'on a payé pour découvrir. La prochaine tâche sur ce terrain le
repaiera intégralement s'il n'est écrit nulle part.

`learn` écrit ce savoir-là, pour que `think` le retrouve le jour où une tâche en a besoin.

## L'échelle : cette tâche, pas le dépôt

**On capitalise un TRAVAIL, pas un projet.** Ce qui s'écrit ici est ce que CE run a établi — pas un
panorama de la codebase, qui serait à la fois trop gros pour être juste et trop vague pour servir.

Corollaire à assumer : **il est légitime de ne rien écrire.** Un correctif d'une ligne, un renommage,
un ajustement de style n'établissent aucun savoir durable. Le dire est un bon résultat — écrire du
remplissage pour avoir écrit pollue la mémoire que la tâche suivante devra trier.

## Ce que tu écris, et ce que tu n'écris pas

| Écris | N'écris pas |
|---|---|
| ce que la fonctionnalité livrée permet, du point de vue de qui l'utilise | le diff : il est dans git, mieux raconté |
| la CAUSE réelle d'un correctif — pas le symptôme réparé | « bug corrigé » : sans la cause, rien n'est réutilisable |
| la décision prise et son MOTIF, surtout les options écartées | une décision sans son pourquoi : elle sera renversée par ignorance |
| le piège rencontré, avec son coût observé | une supposition sur ce qui pourrait mal tourner |
| l'invariant qu'un nouveau garde-fou protège, et ce qu'il refuse | la paraphrase de la fonction qu'on vient d'écrire |

Le critère : **compréhensible dans trois mois, sans cette conversation**. Une phrase qui commence par
« actuellement » ou « en ce moment » n'a rien à faire ici.

## Où est ta matière

**Dans ton contexte, déjà.** Tu n'as pas vécu le travail : tu arrives après. Ce que les étapes
précédentes ont produit t'est transmis — la tâche, puis chaque sortie de phase, préfixée
`[phase <nom>]`. C'est là que vivent le chemin des fichiers touchés, la cause établie, le diff et
les preuves.

Lis-les AVANT de conclure que tu n'as rien. Mesuré le 2026-08-20 sur le run `conv-1339` : un nœud
`learn` a déclaré « je n'ai ni diff, ni fichier à ancrer » alors que son contexte contenait le
chemin exact du fichier ET le diff complet. Il a refusé d'écrire pour une bonne raison appliquée à
une prémisse fausse — le pire des refus, parce qu'il a l'air rigoureux.

Contexte réellement vide (aucune phase avant toi) → là, oui, dis-le et n'écris rien.

## Procédure

### 1. Nomme ce que la tâche a établi

Avant d'écrire, liste — en une phrase chacun — les savoirs que ce travail a produits. Passe chacun au
filtre : **est-ce que la prochaine tâche sur ce terrain le repaierait ?** Si non, il ne se capitalise
pas. Souvent la liste tient en un ou deux éléments ; parfois elle est vide.

### 2. Ancre chaque savoir — et n'abandonne pas sur un SHA manquant

Par ordre de préférence, le PREMIER que tu peux réellement produire :

1. `git:<chemin>@<sha>` — la meilleure forme pour un fait de code, si tu obtiens le SHA
   (`git rev-parse --short HEAD`).
2. `session:current` — la forme prévue POUR UN RUN, et elle vaut ancrage. Dans un nœud de workflow
   tu es dans un run : si le SHA n'est pas à ta portée, c'est celle-ci, et le chemin du fichier va
   dans le corps du fait.
3. `url:` · `ticket:` · `file:<chemin absolu existant>` — quand le fait ne vient pas du code.

Ce qui interdit d'écrire, c'est de ne pas pouvoir nommer le FICHIER — pas de ne pas avoir le SHA.
Un SHA absent dégrade la précision de l'ancrage ; il n'annule pas le savoir. Renoncer pour cette
seule raison, c'est jeter ce que la tâche a coûté pour un détail rattrapable.

### 3. RELIS AVANT D'ÉCRIRE — c'est ce qui évite les doublons

`brain_query` sur le sujet que tu t'apprêtes à écrire, **avant** de l'écrire.

- **Rien ne revient** → tu écris.
- **Un fait existe déjà** → tu ne le réécris PAS. Tu compares : ce que ta tâche apporte de NOUVEAU
  s'écrit sous le MÊME titre, pour que la curation reconnaisse une mise à jour au lieu d'empiler une
  variante concurrente.

Deux faits contradictoires sur le même sujet valent moins qu'aucun : la conversation suivante ne
saura pas lequel croire, et ignorera les deux.

### 4. Un fait par sujet, jamais un bloc

Un pavé unique est irrécupérable : ni corrigeable partiellement, ni retrouvable par une question
précise. Titres stables et prévisibles — c'est le titre qui fait la déduplication :

```
<dépôt> — décision <sujet>     (type: decision)
<dépôt> — piège <sujet>        (type: lesson)
<dépôt> — <mécanisme>          (type: domain)
```

### 5. Écris

```
remember(
  title: "<dépôt> — <sujet>",
  fact: "<ce que la tâche a établi, autoporté, avec son POURQUOI>",
  type: "decision" | "lesson" | "domain",
  scope: "<nom du dépôt>",
  source: "git:<chemin>@<sha>",
  tags: "<sujet>, <domaine>"
)
```

Le Brain dépose en inbox, déduplique et cure : un candidat peut rester en revue. C'est normal, ce
n'est pas un échec — ne le réécris pas pour forcer sa publication.

### 6. Rends compte

Une ligne par fait, en disant lesquels sont des **mises à jour** plutôt que des ajouts. Rien écrit
parce que la tâche n'a rien établi de durable → dis-le franchement : c'est le résultat correct.

## Ce qui invalide une capitalisation

- **Un fait sans ancrage.** Il sera cité comme vrai par toutes les conversations suivantes.
- **Un correctif écrit sans sa cause.** « Réparé » n'apprend rien ; ce qui se réutilise est POURQUOI
  c'était cassé.
- **Un « pourquoi » inventé.** Si le motif n'est écrit nulle part, dis « motif non tracé » — c'est
  une information utile, contrairement à une reconstruction plausible.
- **Un doublon.** Deux titres pour le même sujet créent deux vérités concurrentes.
- **Un état passager.** « la suite est verte », « 5 commits de retard » : vrai ce matin, faux ce soir.
- **Du remplissage.** Écrire pour avoir écrit dégrade tout ce qui est autour.
