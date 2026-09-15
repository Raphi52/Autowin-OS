---
name: graft
description: GREFFE une nouvelle skill quand une PROCÉDURE manque au kit. Déclenche-toi AU MOMENT où le même enchaînement est improvisé pour la deuxième fois — "on refait le même enchaînement à la main", "il faudrait une skill pour ça", une classe de travail récurrente que personne ne possède dans le kit, un échec répété qu'aucun déclencheur de skill existante n'attrape. `graft` transforme cette répétition en un SKILL.md nommé, borné et découvrable, puis le JOUE sur le cas présent. NE PAS utiliser pour : construire un OUTIL ou une commande qui manque (→ `forge`), corriger ou affûter les règles d'une skill EXISTANTE (→ `kaizen`), choisir sur quoi travailler (→ `scout`). graft ajoute UNE skill, celle que le travail courant n'arrête pas d'improviser.
---

# graft — le superviseur étend son propre kit

## À quoi ça sert

`forge` répond à « je n'ai pas d'OUTIL pour ça ». `graft` répond à « je n'ai pas de PROCÉDURE pour ça ». Une
forme de travail récurrente, improvisée à chaque fois, est une skill qui n'a pas encore été écrite. `graft`
l'écrit — une fois, bornée, découvrable — et jamais comme un permis de faire grossir le kit pour le plaisir
de le faire grossir. Chaque skill ajoutée est une ligne que le modèle doit lire à chaque tour : le kit la paie.

## Contrôle d'entrée — quatre questions, dans l'ordre

1. **Quelle forme de travail répétée ?** Nomme au moins DEUX occurrences réelles (identifiants de conversation, runs,
   commits). Une seule occurrence est une tâche, pas une skill. Pas de seconde occurrence → pas de greffe.
2. **Une skill existante la possède-t-elle déjà ?** Lis le front-matter `description` de chaque skill
   du kit — cette ligne EST le déclencheur. Si l'une couvre le cas, la réponse est `kaizen` (affûter son
   déclencheur), pas une nouvelle skill. La skill en doublon est le mode d'échec numéro un : deux déclencheurs qui
   se chevauchent font choisir le routeur au hasard.
3. **Une skill est-elle la bonne forme ?** Une capacité manquante, c'est `forge`. Une règle manquante, c'est `kaizen`. Un
   coup unique n'est que du travail. Ne greffe qu'une PROCÉDURE reproductible avec un MOMENT reconnaissable.
4. **Combien ça coûte ?** Dis-le : une ligne de plus dans l'instantané de chaque tour. Si la skill se déclenchait
   moins d'environ une fois par mois, dis-le et arrête.

Si la question 2 répond « oui », arrête-toi et dis quelle skill possède le cas. Rapporte la recherche, ne greffe pas.

## Procédure

### 1. SPÉCIFIER — le déclencheur avant le corps

Écris, dans le run, avant tout fichier : le `name` (un mot, tourné comme un verbe) · le MOMENT où elle se déclenche, dans les
mots de l'utilisateur · ce pour quoi elle ne doit PAS être utilisée, en nommant les skills voisines · l'artefact qu'elle
doit laisser derrière elle. Une skill sans frontière énoncée sera choisie pour un travail qu'elle ne sait pas faire.

### 2. ÉCRIRE — le front-matter d'abord

`skills/<nom>/SKILL.md`, avec un front-matter YAML portant `name` et `description`. La
`description` n'est pas de la documentation : c'est la SEULE chose que le routeur voit, et elle est tronquée à
environ 200 caractères dans l'instantané du tour. La première phrase doit donc porter le MOMENT, pas la
philosophie. Reprends la forme des skills existantes : À quoi ça sert · Contrôle d'entrée · Procédure · Rapport · À ne pas faire.

### 3. ENREGISTRER — vérifie la découverte, ne la suppose pas

La racine du kit est balayée, donc aucune liste n'est à éditer — ce qui est exactement pourquoi cette étape est sautée et
exactement pourquoi elle ne doit pas l'être. Relis l'état de l'app et confirme que le nouveau nom apparaît dans
la liste de skills de l'instantané, avec sa phrase de déclenchement attachée. Pas d'apparition = pas de greffe, quoi que
dise le fichier sur le disque.

### 4. PROUVER SUR UN CAS RÉEL

Joue la nouvelle skill tout de suite sur l'occurrence qui l'a motivée, et rapporte ce qu'elle a produit.
Une skill jamais exercée est une hypothèse. Si le premier run montre que le déclencheur est faux, corrige le
front-matter avant de clore — cette correction ne sera jamais moins chère.

### 5. JUGER

Soumets le nouveau SKILL.md à `judge` comme livrable : recouvrement avec les voisines, précision du déclencheur,
sortie falsifiable. Une skill écrite et jugée par le même modèle est auto-déclarée ; dis-le.

### 6. RETENIR

`remember` UN fait : la forme de travail que personne ne possédait, `type: lesson`, avec les deux occurrences
comme preuve.

## Rapport

Clos avec : les deux occurrences · les skills voisines vérifiées et pourquoi elles ne possèdent pas le cas · la
skill greffée (nom + son déclencheur en une ligne) · la découverte confirmée depuis l'état de l'app · le cas réel
sur lequel elle a été jouée et son résultat · le verdict du juge.

## À ne pas faire

- Ne greffe pas depuis une seule occurrence, une intuition, ou un « ça pourrait servir un jour ».
- N'écris pas une skill dont le déclencheur chevauche celui d'une voisine — affûte plutôt la voisine.
- Ne la déclare pas disponible parce que le fichier existe : lis le catalogue de l'app elle-même.
- Ne greffe pas une skill en laissant inachevé le travail qui l'a motivée.
- Ne laisse pas le kit grossir en silence : chaque greffe nomme son coût dans le rapport.
