---
name: think
description: Charge dans la conversation l'EMPREINTE du dépôt courant écrite par `learn` — ce qu'il est, ce qu'il fait, pourquoi et comment — et signale ce qui a bougé depuis. Déclencher sur `/think`, « charge le contexte de la codebase », « remets-toi dans ce projet », « qu'est-ce que je sais déjà de ce dépôt », ou en ouverture d'une conversation sur un dépôt déjà connu. NE PAS utiliser pour répondre à une question ponctuelle sur un fichier (lire le fichier coûte moins cher), ni pour découvrir un dépôt sans empreinte : dans ce cas, dis-le et propose `/learn`.
---

# Think — remettre le dépôt dans le contexte

## À quoi ça sert

Éviter de repayer la redécouverte. Une conversation qui commence par relire vingt fichiers pour
réapprendre ce que le dépôt fait dépense son contexte avant d'avoir commencé à travailler.

## Ce que tu rends, et dans quel ordre

L'ordre n'est pas cosmétique : il suit ce dont on a besoin pour décider.

1. **Ce que c'est** — le produit, son utilisateur, le problème qu'il résout.
2. **Ce qu'il fait** — ses capacités, telles qu'un utilisateur les voit.
3. **Comment** — les mécanismes et leurs frontières : qui appelle qui, ce qui est interdit et pourquoi.
4. **Pourquoi** — les décisions et leur motif, en particulier les options ÉCARTÉES : c'est ce qui
   empêche de les reproposer.
5. **Les pièges** — ce qui a déjà coûté cher, avec son coût observé.

## Procédure

### 1. Identifie le dépôt

Nom du dépôt et `git rev-parse --short HEAD`. Le SHA sert à mesurer l'écart avec l'empreinte.

### 2. Interroge le Brain

`brain_query` avec « empreinte <nom du dépôt> ». Si le retour est maigre, pose une seconde question
sur un domaine précis (« <dépôt> décisions », « <dépôt> pièges ») plutôt que de conclure au vide :
une seule question ne couvre pas un dépôt entier.

### 3. AUCUNE empreinte ? Dis-le, ne la fabrique pas

Sans empreinte, tu ne charges rien. Ne comble PAS le vide en lisant le dépôt à la volée pour produire
un résumé qui ressemblerait à une empreinte : ce serait un résumé non vérifié, indiscernable d'un
savoir capitalisé. Dis qu'il n'y en a pas et propose `/learn`.

### 4. Mesure l'ÂGE de ce que tu charges

Chaque fait porte un ancrage `git:<chemin>@<sha>`. Compare ce SHA à `HEAD` :

- **même SHA** → l'empreinte décrit le code courant ;
- **SHA différent** → dis-le, avec le nombre de commits d'écart. L'empreinte reste utile — les
  mécanismes et les motifs bougent lentement — mais un chemin de fichier peut avoir changé.

Ce point n'est pas une formalité : un savoir daté cité comme actuel est exactement ce qui fait perdre
des heures sur un fichier qui a été déplacé ou supprimé.

### 5. Restitue, sans recopier

Rends l'empreinte dans l'ordre ci-dessus, en prose dense. Pas de copier-coller du Brain : ce qui est
utile, c'est la synthèse qui tient dans le contexte, pas le corpus.

Chaque affirmation garde son ancrage `fichier` — sans lui, la conversation suivante ne pourra pas
vérifier, et le doute la fera tout relire.

### 6. Nomme ce que tu n'as PAS

Un domaine absent de l'empreinte doit être dit absent. Un chargement qui présente une couverture
partielle comme complète est pire qu'un chargement vide : on croit savoir.

## Après le chargement

Tu as le contexte, pas la vérité du jour. Avant toute action qui dépend d'un détail de l'empreinte —
un chemin, une signature, un nom de commande — **vérifie ce détail dans le code**. L'empreinte dit où
regarder et pourquoi ; elle ne remplace pas la lecture du fichier que tu vas modifier.
