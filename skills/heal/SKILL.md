---
name: heal
description: >-
  Pilote le pipeline COMPLET (scout → frame → terrain → build → clean → judge) contre la MALADIE
  d'une codebase — lenteur, bugs, code sous-optimisé et non structuré — jusqu'à ce qu'un projet
  bricolé devienne structuré, mesuré et fonctionnel. Contrairement à `remake`, qui dépense le recul
  de conception sur un livrable FINI, `heal` part de SYMPTÔMES : une latence mesurée, un bug
  reproduit, un chemin chaud que personne n'a profilé. Chaque candidat retenu porte un symptôme
  FALSIFIABLE avant qu'aucune phase ne tourne — un chiffre, un test rouge, une trace, OU, si rien ne
  peut être chronométré, un CRITÈRE STATIQUE COMPTÉ (O(n2), requête N+1, E/S synchrone) avec son
  `file:line` ; pas de symptôme falsifiable, pas de heal, mais un défaut de perf non mesurable se
  soigne quand même (§ 0 bis). Déclencher sur `/heal`, « c'est lent », « ça rame », « optimise /
  répare le projet », « make it fast ». heal ENCHAÎNE les phases, sans en réimplémenter.
---

# heal — du code bricolé au code structuré, mesuré, rapide

## À quoi ça sert

Un projet bricolé n'est pas cassé partout ; il est **lent et fragile à quelques endroits que personne
n'a mesurés**. `heal` refuse les deux échecs habituels : optimiser ce qui est déjà rapide, et « corriger »
un bug dont la cause n'a jamais été localisée. Il prend une cible, produit une liste classée de **symptômes avec
des chiffres**, et pilote chacun à travers tout le pipeline jusqu'à une fin vérifiée.

**L'anti-pansement est la colonne vertébrale de cette skill.** Élargir un timeout, avaler un catch, ajouter une reprise
en aveugle, desserrer une assertion jusqu'à ce qu'elle passe — tout cela est REFUSÉ ici par construction. Un correctif sur une
cause non localisée est un peut-être-correctif sur un peut-être-bug.

## Quand la déclencher — et quand NON
**Déclencheurs** : `/heal` · « c'est lent » · « ça rame » · « optimise le projet » · « répare le projet » · « make it fast » · « clean up this vibe-coded mess ».
**PAS pour** : choisir une fonctionnalité à construire → `scout` · refaire l'allure d'un écran → `draft` · auditer un livrable fini → `judge` · améliorer les règles du kit → `kaizen`.
**Différence avec `remake`** : `remake` dépense le recul de conception sur un livrable FINI ; `heal` part de SYMPTÔMES — une latence mesurée, un bug reproduit, un chemin chaud que personne n'a profilé.

## Procédure

### 0. RÉFÉRENCE — mesurer avant de toucher à quoi que ce soit

Aucune optimisation ne démarre sans un chiffre qui existe AVANT le changement.

- Perf : les mesures propres à l'app (vue / traces / temps) si elles existent ; sinon un harnais de
  chronométrage reproductible ajouté sous `terrain`.
- Bugs : un test ROUGE qui reproduit, ou une trace d'exécution. Un rapport de bug n'est pas un symptôme.
- Structure : un signal dénombrable (implémentations dupliquées, taille de fichier, points chauds de complexité).

Consigne chaque valeur de référence avec sa source. **Une mesure datée n'est pas l'état courant** — resonde
avant de t'en servir comme cible.

### 0 bis. AUCUNE MESURE POSSIBLE — le chemin de la perf statique

Un défaut de perf dont le coût ne peut pas être CHRONOMÉTRÉ reste un défaut de perf. Au moment où l'étape 0 ne peut pas produire de
chiffre (aucun profileur sur ce chemin, code froid, chronométrage noyé dans le bruit, harnais de mesure lui-même
trop coûteux) → **n'abandonne PAS le candidat et n'arrête PAS le heal** : bascule-le sur un CRITÈRE
STATIQUE, et dis-le.

Un critère statique se COMPTE dans le code, il ne se chronomètre pas à l'exécution, et il doit être falsifiable par
la lecture ou par un test :

- **complexité** — un balayage imbriqué sur la même collection (O(n²) là où O(n) suffit) : compte les
  balayages, nomme les deux boucles avec leur `file:line` ;
- **répétition** — la même lecture / requête / analyse exécutée N fois là où 1 suffit (requête par élément
  au lieu d'un lot, fichier relu à chaque appel, JSON réanalysé à chaque rendu) : compte N ;
- **blocage** — E/S synchrone, `readFileSync`, ou un `await` dans une boucle sur un chemin qui sert
  l'interface ou une requête ;
- **gaspillage** — du travail produit puis jeté (liste complète construite pour en prendre le premier élément, rendu sans
  mémoïsation sur une entrée stable), index manquant sur une colonne filtrée.

Règles de ce chemin, toutes obligatoires :
1. **La cause est LOCALISÉE** (`file:line`) avant le correctif — un critère statique n'autorise jamais une
   devinette. Pas de localisation → le candidat est abandonné, exactement comme avant.
2. **Le signal de fin devient dénombrable, pas chronométrique** : `3 balayages → 1`, `N+1 requêtes → 1 lot`,
   `readFileSync dans le rendu → mis en cache`. Quand c'est possible, il est FIGÉ par un test (compteur d'appels, espion,
   assertion sur le nombre de requêtes) pour qu'une régression revienne rouge.
3. **Le gain se rapporte en `gain non mesuré — cause localisée`**, jamais en accélération en ms. Écrire
   « 3× plus rapide » sans mesure est un faux vert (réflexe 2).
4. **Le comportement est préservé et PROUVÉ** : les tests existants des fichiers touchés passent de rouge à vert ou
   restent verts. Une optimisation sans preuve comportementale ne part pas.
5. **Aucun candidat statique qui ne fait qu'embellir le code.** Si rien de dénombrable ne change, c'est un
   candidat `🧱 structure`, pas un candidat de perf — classe-le comme tel au lieu de le déguiser.

Marque ces candidats `🐌 perf (statique)` dans le tableau pour que le rapport ne mélange jamais un écart mesuré
avec un écart compté.

### 1. SCOUT — faire remonter les symptômes

Joue `scout` sur la cible avec la barre de heal : chaque candidat DOIT porter
`file:line` + un symptôme mesuré + un signal de fin mesurable (par ex. `340 ms → < 80 ms`, `test rouge → vert`).
Les candidats sans chiffre sont abandonnés, pas devinés.

Présente UN tableau classé : Type (🐌 perf · 🐛 bug · 🧱 structure) · Symptôme (chiffre) · Où · Hypothèse de cause · Signal de fin.

### 2. Par candidat retenu — la chaîne complète

Pour chaque candidat que l'humain retient, dans l'ordre, un à la fois :

1. `frame` — le QUOI et l'approche, avec le signal de fin comme critère d'acceptation.
2. `terrain` — le harnais qui rend le symptôme OBSERVABLE et rejouable (sonde de profilage,
   test de reproduction). Sauté seulement si l'étape 0 l'a déjà produit.
3. `build` — le correctif, sur la cause NOMMÉE. Le rouge → vert est obligatoire pour un bug.
4. `clean` — retirer les sondes et les échafaudages qui ne servent plus.
5. `judge` — verdict sur le livrable, plus **la mesure d'après contre la référence**.

Ne groupe jamais plusieurs candidats dans une seule construction : un changement mélangé rend la mesure inattribuable.

### 3. RAPPORTER — avant / après, par candidat

Clos avec un tableau : candidat · référence · après · écart · preuve (code de sortie, nom du test, capture).
Tout ce qui n'a pas été remesuré est rapporté comme **non vérifié**, jamais comme une amélioration.

## À ne pas faire

- **N'optimise pas sans référence OU sans critère statique.** L'échec de heal le plus fréquent est
  d'accélérer du code froid ; le deuxième est d'abandonner un gaspillage localisé parce que rien ne pouvait être chronométré
  (voir 0 bis). L'un des deux est exigé — jamais aucun, jamais au feeling.
- **N'élargis pas un timeout, n'avale pas une erreur, ne desserre pas une assertion** pour faire disparaître un symptôme.
  Si une rustine est vraiment le bon choix, ÉTIQUETTE-la (« rustine temporaire — cause réelle : X ») et
  dispatche la cause réelle.
- **Ne touche pas à ce qui n'a pas été nommé.** Un nettoyage structurel est un candidat comme un autre, classé et
  retenu explicitement — jamais un « tant qu'on y est ».
- **Ne fais pas confiance à un vert auto-déclaré.** L'autorité de clôture est un artefact : code de sortie, test
  rouge→vert, une mesure rejouée.
