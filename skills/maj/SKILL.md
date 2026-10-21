---
name: maj
description: >-
  Débloque une MISE À JOUR d'Autowin OS refusée (bouton « Réparer la mise à jour », « la mise à jour
  est bloquée », « l'update ne passe pas ») : compte les conflits sans toucher l'arbre, garde le vrai
  travail local, met de côté le reste sur une branche de secours, fusionne origin/main, vérifie et
  redémarre. NE PAS utiliser pour : trier des travaux non publiés ou des remises de côté hors mise à
  jour (→ `salvage`), publier ou pousser (jamais sans demande), un autre dépôt qu'Autowin OS.
---

# maj — faire passer la mise à jour sans perdre ni ressusciter de travail

## À quoi ça sert

Le bouton « Réparer la mise à jour » ouvre un fil et y envoie `/maj` suivi de la raison du refus
(`src/renderer/src/components/UpdateBanner.tsx`). Six fils l'ont fait entre conv-712 et conv-1023.
Deux pièges y sont revenus : l'ancienne consigne disait « mets le fichier de côté (git stash) »,
que le garde-fou refuse aux agents (`src/shared/garde-git-destructeur.ts`, la pile de remises de côté
est partagée avec l'utilisateur) ; et une mise de côté sur `autowin/recovery/…` a été publiée puis
poussée toute seule par l'app quelques minutes plus tard (conv-1023 : `src/main/store/worktree-manager.ts`
traite ce préfixe comme un travail d'agent à publier).

## Contrôle d'entrée

- La raison citée vient de `src/main/git-update.ts`. Elle peut proposer `git stash` : cette phrase
  s'adresse à un humain. Pour toi, la mise de côté passe par l'étape 3.
- Le dépôt est Autowin OS, branche `main`. Un autre dépôt n'est pas le sujet de cette skill.

## Procédure

### 1. MESURER — sans rien toucher

```
git fetch origin
git status --porcelain
git log --oneline HEAD..origin/main
git merge-tree --write-tree --name-only HEAD origin/main     # conflits, arbre intact
```

Range la raison dans une des formes : fichiers locaux qui seraient écrasés · dépôt déjà en conflit ·
`fetch` en échec (souvent un `index.lock` tenu par une lecture git de l'app : attends quelques
secondes et retente UNE fois, sinon nomme le processus) · autre (cite git tel quel).

### 2. ATTRIBUER ET TRIER chaque fichier local en travers du chemin

Pour chaque fichier : `git diff HEAD origin/main -- <f>` et `git log --oneline HEAD..origin/main -- <f>`.

- **Qui l'a écrit ?** Cherche le chemin dans `.autowin-data/autowin-os/conversation-file-trace-spool/events.jsonl`
  (champ `conversationId`). C'est un CANDIDAT, pas une preuve : un fil qui tourne en même temps peut s'y
  voir attribuer les fichiers d'un autre (mesuré conv-1036). Un fil ENCORE EN COURS sur ce fichier :
  ne le touche pas, dis lequel, et attends sa fin plutôt que de lui retirer son travail.
- **Vieille copie reprise ?** Une modification qui REMET ce que main a supprimé ou annulé s'écarte :
  ne réintroduis jamais ce que main a retiré.
- **Vrai travail récent** : il se garde, committé par ses SEULS chemins :

```
git add -- <chemins>                          # un fichier NON SUIVI n'est connu de git qu'après cet ajout
git commit -m "<message> (conv-N)" -- <chemins>
git show --stat HEAD                          # exactement ces chemins : sinon, STOP
```

`git commit -- <chemins>` ne prend QUE les chemins nommés, même quand l'index commun porte déjà le
travail d'un autre fil : ce travail reste dans l'index, hors du commit. Sans le `git add`, un fichier
neuf fait échouer le commit (« pathspec … did not match any file(s) known to git »).
Jamais `git add -A` ni `git add .` : ils ajoutent tout l'arbre.

### 3. METTRE DE CÔTÉ — sur une branche de secours, jamais `git stash`, jamais `autowin/`

Sans toucher HEAD ni l'arbre, avec un index à part :

```
idx="$(git rev-parse --git-dir)/maj-index"
GIT_INDEX_FILE="$idx" git read-tree HEAD
GIT_INDEX_FILE="$idx" git add -- <fichiers>
c=$(git commit-tree "$(GIT_INDEX_FILE="$idx" git write-tree)" -p HEAD -m "sauvegarde(maj): <quoi> (conv-N)")
git update-ref refs/heads/sauvegarde/maj-<AAAA-MM-JJ>-<sujet> "$c"
rm -f "$idx"
git show --stat "$c"                      # chaque fichier y est : sinon, STOP
git checkout HEAD -- <fichiers suivis>    # seulement APRÈS la vérification ci-dessus
rm -- <fichiers non suivis>               # idem : leur seule copie est désormais la branche
```

Un fichier NON SUIVI (`??` dans `git status`) qu'origin/main ajoute bloque aussi la mise à jour
(« untracked working tree files would be overwritten »). `git checkout HEAD --` ne le connaît pas :
il se retire par `rm`, et seulement après avoir vu sa copie dans `git show --stat`.

Le préfixe `sauvegarde/` n'est ni publié ni nettoyé par l'app. Un nom sous `autowin/` le serait.

### 4. FUSIONNER

`git merge --ff-only origin/main` si aucun commit local n'est en avance, sinon `git merge origin/main`.
Un conflit se tranche par CONTENU en lisant les deux côtés : deux ajouts indépendants se gardent tous
les deux. Jamais `-X ours` ni `-X theirs` en bloc. `git merge --abort` reste la sortie.

### 5. VÉRIFIER, PUIS REDÉMARRER

`npm run typecheck`, puis `npx vitest run` sur les tests des fichiers tranchés ou committés. Rouge →
corrige ou annule la fusion, ne redémarre pas sur un arbre rouge. Vert → `restart_app`, avec une
consigne de reprise qui vérifie que HEAD est bien le commit fusionné. Rien ne se pousse sans demande.

## Rapport

La raison et sa forme · les conflits comptés à l'étape 1 · **Gardé** (chemins, commit) · **Écarté**
(chemins, et où il reste lisible : branche `sauvegarde/…` et son sha) · les vérifications avec leur code
de sortie · le commit sur lequel l'app redémarre.

## À ne pas faire

- `git stash`, `git reset --hard`, `git checkout -- .` : refusés, et ils emportent le travail des autres fils.
- Une branche de secours sous `autowin/` : l'app la publie et la pousse toute seule.
- Committer en bloc un fichier qu'un autre fil est en train d'écrire.
- Pousser, ouvrir une demande de fusion ou publier : la mise à jour est locale.
