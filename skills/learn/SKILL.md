---
name: learn
description: Écrit dans le Brain l'EMPREINTE du dépôt courant — ce qu'il est, ce qu'il fait, pourquoi et comment — en plusieurs faits ancrés et SANS doublon (relecture puis mise à jour de l'existant, jamais une seconde copie). Déclencher sur `/learn`, « sauvegarde l'état de la codebase », « note où on en est », « capitalise ce qu'on sait de ce dépôt », ou avant de quitter un dépôt sur lequel on reviendra. NE PAS utiliser pour retenir une leçon d'un run (c'est `remember` seul), ni pour un état passager (branche courante, test rouge du moment) : l'empreinte décrit ce qui reste vrai dans trois mois.
---

# Learn — l'empreinte durable d'un dépôt

## À quoi ça sert

Un dépôt se redécouvre à chaque conversation : on relit les mêmes fichiers pour réapprendre les mêmes
choses, et on repaie cette lecture à chaque fois. `learn` écrit une fois ce qui restera vrai, pour que
`think` le retrouve le jour où une tâche en a besoin.

Ce qui est capitalisé n'est pas un résumé de code — le code se relit. C'est ce qu'on ne peut PAS
déduire d'un fichier isolé : à quoi sert cette pièce, **pourquoi** elle est ainsi, **comment** les
morceaux tiennent ensemble, et où sont les pièges qui ont déjà coûté cher.

## Ce que tu écris, et ce que tu n'écris pas

| Écris | N'écris pas |
|---|---|
| ce que le produit fait, du point de vue de son utilisateur | la liste des fichiers, que `ls` donne mieux |
| les mécanismes et leurs frontières (qui appelle qui, ce qui est interdit) | une paraphrase de fonction |
| les décisions et leur MOTIF, surtout les options écartées | une décision sans son pourquoi : elle sera renversée par ignorance |
| les pièges vécus, avec leur coût observé | une supposition sur ce qui pourrait mal tourner |
| les invariants qu'un garde-fou protège | l'état du jour : branche, tests rouges du moment, travail en cours |

Le critère : **compréhensible dans trois mois, sans cette conversation**. Une phrase qui commence par
« actuellement » ou « en ce moment » n'a rien à faire dans une empreinte.

## Procédure

### 1. Établis l'identité du dépôt

Lis `git rev-parse --short HEAD`, le nom du dépôt et sa branche par défaut. Le SHA sert d'ancrage aux
sources ; sans lui, aucun fait n'est vérifiable.

### 2. RELIS AVANT D'ÉCRIRE — c'est ce qui évite les doublons

Appelle `brain_query` avec « empreinte <nom du dépôt> » **avant** toute écriture.

- **Rien ne revient** → tu écris la première empreinte.
- **Une empreinte existe** → tu ne réécris PAS ce qui est déjà juste. Tu compares, et tu n'écris que
  ce qui a CHANGÉ ou ce qui MANQUE, avec le même titre que l'existant pour que la curation reconnaisse
  une mise à jour au lieu d'empiler une variante.

Deux empreintes du même dépôt qui se contredisent valent moins qu'aucune : la suivante ne saura pas
laquelle croire, et les deux seront ignorées.

### 3. Découpe en faits, jamais un bloc

Un pavé unique est irrécupérable : on ne peut ni le corriger partiellement, ni le remplacer, ni le
retrouver par une question précise. Écris **un `remember` par domaine**, avec un titre stable et
prévisible — c'est lui qui fait la déduplication :

```
Empreinte <dépôt> — vue d'ensemble        (type: domain)
Empreinte <dépôt> — <domaine 1>           (type: domain)
Empreinte <dépôt> — décision <sujet>      (type: decision)
Empreinte <dépôt> — piège <sujet>         (type: lesson)
```

Vise 4 à 8 faits. En dessous, tu as résumé au lieu de capitaliser ; au-dessus, tu paraphrases le code.

### 4. Ancre CHAQUE fait

`source: git:<chemin>@<sha>` — le chemin relatif d'un fichier qui PROUVE le fait, et le SHA courant.
Un fait dont tu ne peux pas nommer le fichier est une supposition : ne l'écris pas.

Formes acceptées si le fait ne vient pas du code : `url:https://…`, `ticket:ABC-123`,
`session:current` (dans un run), `file:<chemin absolu existant>`.

### 5. Écris

Un appel `remember` par fait :

```
remember(
  title: "Empreinte <dépôt> — <domaine>",
  fact: "<le fait, autoporté, avec son POURQUOI>",
  type: "domain" | "decision" | "lesson",
  scope: "<nom du dépôt>",
  source: "git:<chemin>@<sha>",
  tags: "empreinte, <domaine>"
)
```

Le Brain dépose en inbox, déduplique et cure : un candidat peut rester en revue. C'est normal, et ce
n'est pas un échec — ne le réécris pas pour forcer sa publication.

### 6. Rends compte

Une ligne par fait écrit, et dis explicitement ce que tu as **mis à jour** plutôt qu'ajouté. Si tu
n'as rien écrit parce que l'empreinte était à jour, dis-le : c'est le bon résultat, pas un échec.

## Ce qui invalide une empreinte

- **Un fait sans ancrage.** Il sera cité comme vrai par toutes les conversations suivantes.
- **Un « pourquoi » inventé.** Si le motif d'une décision n'est écrit nulle part, dis « motif non
  tracé » — c'est une information utile, contrairement à une reconstruction plausible.
- **Un doublon.** Deux titres différents pour le même sujet créent deux vérités concurrentes.
- **Un état passager.** « 5 commits de retard », « la suite est verte » : vrai ce matin, faux ce soir.
