---
name: forge
description: FORGE l'outil qui manque au lieu d'abandonner l'exécution. Déclenche-toi AU MOMENT où une exécution cale parce qu'une capacité n'existe pas — "je n'ai pas d'outil pour ça", "aucune commande ne fait X", un outil refusé ou absent du catalogue. Un outil qui EXISTE et se comporte seulement mal (plantage, blocage, mauvaise sortie) n'est PAS un cas forge (→ `heal`). `forge` transforme cette impasse en une capacité nommée, testée, enregistrée, puis REPREND le travail interrompu. NE PAS utiliser pour : réparer un outil qui existe et qui est seulement cassé (→ `heal`), choisir quoi construire ensuite (→ `scout`), ou ajouter une règle au kit (→ `kaizen`). forge construit UNE capacité, celle sur laquelle l'exécution courante est réellement bloquée.
---

# forge — le superviseur construit l'outil qui lui manque

## À quoi ça sert

Une exécution qui s'arrête sur « je n'ai pas d'outil pour ça » est un faux mur : l'outil est un fichier que le
superviseur peut écrire. `forge` existe pour que le blocage devienne une capacité, pas une excuse. Ce n'est jamais
un permis d'inventer du périmètre — il forge la PLUS PETITE capacité qui débloque l'exécution NOMMÉE.

## Contrôle d'entrée — trois questions, dans l'ordre

1. **Qu'est-ce qui est bloqué, exactement ?** Nomme l'exécution, l'étape, et l'échec observable
   (message de refus, code de sortie, commande absente). Pas de blocage nommé → pas de forge.
2. **Est-ce que ça existe déjà ?** Cherche dans le catalogue, dans le dépôt (`find_in_files`) et dans le Brain
   (`brain_query`) AVANT d'écrire quoi que ce soit. Le doublon est le mode d'échec numéro un : une seconde
   commande qui fait ce qu'une commande existante fait déjà coupe la vérité en deux.
3. **Un outil est-il la bonne forme ?** Un besoin ponctuel est une commande lancée une fois, pas une capacité permanente.
   Ne forge que ce qui sera rappelé, ou ce sans quoi l'exécution ne peut pas continuer.

Si la réponse à la question 2 est « oui », arrête-toi et utilise-le. Rapporte la recherche, ne forge pas.

## Procédure

### 1. SPÉCIFIER — écris le contrat avant le code

Un bloc court, dans le run : `name` · ce qu'il fait en une phrase · ses arguments et leurs types ·
ce qu'il rend · ce qu'il REFUSE. Un outil sans surface de refus énoncée est un outil qui mentira
un jour.

Choisis la forme la moins chère qui satisfasse le contrat, dans cet ordre :
- une commande existante avec d'autres arguments (aucun nouvel outil du tout),
- un script dans le dépôt, appelé par le lanceur autorisé,
- une vraie capacité câblée dans le bus de commandes de l'app.

### 2. CONSTRUIRE — rouge avant vert

Écris le test qui échoue D'ABORD : il doit échouer pour la capacité manquante, pas pour une faute de frappe. Puis
implémente. `edit_file` vérifie chaque édition, donc DÉFINIR vient avant CÂBLER — le symbole doit exister avant que
quoi que ce soit y fasse référence.

Non négociable pour tout ce qui est câblé dans le bus :
- liste blanche explicite des arguments ; tout ce qui est inconnu est refusé, pas ignoré en silence,
- les refus sont RENDUS, jamais jetés dans un catch avalé,
- pas d'auto-récursion : un outil ne doit pas pouvoir relancer le pipeline qui l'a appelé.

### 3. ENREGISTRER — le rendre découvrable

Un outil que personne ne voit n'est pas un outil. Déclare-le là où l'app lit vraiment son catalogue, et
vérifie que la déclaration est exactement la chaîne que l'appelant utilise. Deux listes = l'étiquette qui ment.

L'enregistrement se PROUVE, il ne se suppose pas : après avoir déclaré, RELIS le catalogue que l'appelant consulte
réellement et trouves-y le nouveau nom. Une déclaration écrite dans un fichier que l'app ne lit jamais est la
même impasse que celle pour laquelle forge a été invoqué, une couche plus bas.

**Autowin OS a DEUX surfaces d'enregistrement, et le bus seul ne suffit pas.**
1. **Le bus de commandes** — y publier rend l'outil visible à l'agent du CHAT, dont le prompt est
   généré depuis le catalogue vivant (`src/main/chat-pilotage-prompt.ts`). Rien d'autre à faire de ce côté.
2. **`OUTILS_NOEUD_SKILL`** dans `src/main/skill-node-tools.ts` — une liste blanche EN DUR. Elle filtre
   le prompt du nœud de skill, le chemin d'exécution `<cmd>` (un nom non listé est RENDU en `refuse`), les
   outils natifs `mcp__autowin__*`, et le câblage du bus dans `src/main/index.ts`. Un outil absent de
   ce tableau est invisible ET refusé dans chaque nœud de workflow — l'orchestrateur qui joue les
   skills ne le choisira jamais, si correctement publié soit-il sur le bus.

Donc : ajoute le nom exact de l'outil à `OUTILS_NOEUD_SKILL`, puis PROUVE-le sur les DEUX surfaces — le nom
apparaît dans le prompt de nœud de skill généré (`promptOutilsNoeudSkill`, avec ses vrais noms d'arguments),
et un appel depuis un nœud revient OK au lieu de « REFUSÉ — indisponible depuis un nœud de workflow ».
Enregistrer sur le seul bus, puis rapporter l'outil comme disponible pour l'orchestrateur, est un faux
vert.

### 4. PROUVER

Lance `verify`, ciblé sur le nouveau fichier de test. Rapporte le code de sortie. « auto-déclaré, non vérifié »
est la seule formulation honnête quand le run n'a pas eu lieu.

### 5. REPRENDRE

Retourne à l'exécution qui a calé et termine-la AVEC le nouvel outil. Un forge qui s'arrête à l'outil,
sans le travail pour lequel il a été forgé, est un demi-travail.

### 6. RETENIR

`remember` UNE leçon : la capacité qui manquait, et ce que le manque a révélé. `type: domain`
pour la capacité elle-même, `type: lesson` si un motif a causé le manque.

## Rapport

Clos avec : le blocage (nommé) · l'outil forgé (nom + contrat en une ligne) · où il est
enregistré · la preuve (nom du test, code de sortie) · l'exécution reprise et son résultat.

## À ne pas faire

- Ne simule pas la sortie de l'outil pour continuer. Un bouchon qui rend des données plausibles est le pire
  résultat possible de cette skill.
- N'élargis pas un outil existant « tant qu'on y est » — seulement le blocage nommé.
- Ne forge pas un outil pour une capacité que l'environnement n'expose vraiment pas (pas d'identifiants,
  pas de réseau, pas de permission). Dis-le, nomme ce que tu as sondé, et arrête.
- Ne le déclare pas enregistré avant d'avoir lu le compte-rendu de la commande elle-même : un appel peut RÉUSSIR en
  portant un refus.
- Ne forge pas depuis l'intérieur d'un forge. Si l'outil en cours de forge est lui-même bloqué sur une capacité
  manquante, ARRÊTE à la profondeur deux : rapporte la chaîne de manques et laisse un humain la trancher. Une skill dont la
  réponse à son propre blocage est elle-même n'a pas de plancher.
