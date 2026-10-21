---
name: heal
description: >-
  Trouve ET corrige les défauts PROUVÉS d'une cible (« trouve et corrige les défauts de X », /heal,
  « c'est lent ») en enchaînant scout → frame → build → clean → judge, sans en réimplémenter. Part
  de SYMPTÔMES falsifiables — un test rouge, un chiffre mesuré, ou, si rien ne peut être chronométré,
  un CRITÈRE STATIQUE COMPTÉ (O(n2), requête N+1, E/S synchrone) avec son `file:line` (§ 0 bis) ;
  pas de preuve, pas de correction. Mode AUTONOME par défaut : chaque défaut prouvé est corrigé
  d'office, un à la fois, et seul un geste risqué ou irréversible attend l'accord humain (§ 1 bis).
  Autres déclencheurs : « corrige tous les défauts de X », « chasse les bugs de X », « répare le
  projet », « ça rame », « optimise », « make it fast ». PAS pour : auditer sans corriger → `judge`
  · choisir une fonctionnalité → `scout` · repenser un livrable FINI → `remake` · les règles du kit
  → `kaizen`.
---

# heal — du code bricolé au code structuré, mesuré, rapide

## À quoi ça sert

Un projet bricolé n'est pas cassé partout ; il est **lent et fragile à quelques endroits que personne
n'a mesurés**. `heal` refuse les deux échecs habituels : optimiser ce qui est déjà rapide, et « corriger »
un bug dont la cause n'a jamais été localisée. Il prend une cible, produit une liste classée de **symptômes avec
des chiffres**, et pilote chacun à travers tout le pipeline jusqu'à une fin vérifiée — **d'office**, sans attendre
qu'on choisisse, dès que le défaut est prouvé (§ 1 bis).

**L'anti-pansement est la colonne vertébrale de cette skill.** Élargir un timeout, avaler un catch, ajouter une reprise
en aveugle, desserrer une assertion jusqu'à ce qu'elle passe — tout cela est REFUSÉ ici par construction. Un correctif sur une
cause non localisée est un peut-être-correctif sur un peut-être-bug.

## Quand la déclencher — et quand NON
**Déclencheurs** : `/heal` · « trouve et corrige les défauts de X » · « corrige tous les défauts de X » · « chasse les bugs de X » · « c'est lent » · « ça rame » · « optimise le projet » · « répare le projet » · « make it fast » · « clean up this vibe-coded mess ».
**PAS pour** : choisir une fonctionnalité à construire → `scout` · refaire l'allure d'un écran → `draft` · auditer un livrable SANS le corriger → `judge` (il ne répare jamais) · améliorer les règles du kit → `kaizen`.
**Différence avec `remake`** : `remake` dépense le recul de conception sur un livrable FINI ; `heal` part de SYMPTÔMES — une latence mesurée, un bug reproduit, un chemin chaud que personne n'a profilé.

## Procédure

### 0. RÉFÉRENCE — mesurer avant de toucher à quoi que ce soit

Aucune optimisation ne démarre sans un chiffre qui existe AVANT le changement.

- Perf : les mesures propres à l'app (vue / traces / temps) si elles existent ; sinon un harnais de
  chronométrage reproductible, ajouté ici avant tout changement.
- Gel d'Autowin OS (fenêtre figée, « freeze ») : joue d'abord `gel` (`skills/gel/SKILL.md`). Son
  classement du journal des gels, remonté aux `fichier:ligne`, EST la référence de cette étape.
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

Présente UN tableau classé : Type (🐌 perf · 🐛 bug · 🧱 structure) · Symptôme (chiffre) · Où · Hypothèse de cause · Preuve · Signal de fin.

### 1 bis. MODE — autonome par défaut, sélection sur demande

Annonce le mode en une ligne, juste après le tableau.

- **Autonome (défaut)** — toute demande qui dit de CORRIGER (« trouve et corrige les défauts de X »,
  « répare », « corrige tout », `/heal X` nu) : chaque candidat PROUVÉ du tableau part d'office dans la
  chaîne de l'étape 2, dans l'ordre du tableau. Aucune question « je commence par lequel ? ».
- **Sélection** — seulement si l'utilisateur demande de voir ou de choisir d'abord (« montre-moi
  d'abord », « liste sans corriger », « je choisis ») : rends le tableau, puis attends son choix.

**Prouvé = l'une de ces trois preuves, obtenue AVANT le correctif et écrite dans la colonne Preuve :**
1. **test rouge** — il reproduit le défaut, et il est rouge pour la BONNE raison : son message d'échec
   nomme le comportement fautif, pas une importation cassée ni un harnais mal posé. Un rouge peut venir
   d'autre chose que le défaut annoncé : exécute la brique fautive avec les données exactes du test
   pour le confirmer ;
2. **chiffre** — une mesure de l'étape 0, avec sa source et sa date, resondée si elle n'est plus fraîche ;
3. **`file:line`** — une cause localisée ET un critère compté (§ 0 bis, ou signal dénombrable de
   structure) que la lecture du code peut contredire.

Un candidat sans l'une des trois n'est JAMAIS corrigé d'office : il sort au rapport en `✋ non prouvé`,
avec ce qui manque pour le prouver.

**Seul arrêt du mode autonome : un geste risqué ou irréversible.** Au moment où le correctif d'un
candidat exige l'un des gestes ci-dessous, ce candidat passe en `⏸ attend ton accord` — tu nommes le
geste et ce qu'il ferait perdre — et le heal CONTINUE avec le candidat suivant :
- **irréversible** — suppression de fichiers en masse, réécriture d'historique, `reset`, `checkout --`
  ou `stash` dans un dossier partagé, migration ou réécriture de données déjà persistées, écriture dans
  une base ou un service externe ;
- **risqué** — sécurité, authentification ou secrets ; format de données déjà écrit chez l'utilisateur ;
  mise à jour de dépendance ; comportement visible retiré ou changé (fonction, libellé, choix produit) ;
  correctif qui déborde de la cause nommée sur d'autres modules ;
- **publication** — commit, push, PR, déploiement : jamais d'office, seulement sur demande explicite.

Les candidats en attente sont présentés ENSEMBLE à la fin, en une seule question — jamais un par un
en cours de route.

**L'échec d'un candidat n'arrête pas le heal.** Après 2 à 3 approches DISTINCTES sans vert : annule ses
changements partiels, classe-le `⚠️ non résolu` avec ce que chaque tentative a produit, passe au suivant.

**Budget.** Une passe de scout, puis ses candidats ; pas de nouveau scout en boucle sans demande. Dans le
chat d'Autowin, une seule orchestration est permise par tour (plafond du produit,
`src/shared/orchestration-outcome.ts`) : joue chaque correctif avec tes propres outils (édition, puis
`verify` ciblé), un candidat à la fois — jamais une orchestration par candidat.

### 2. Par candidat retenu — la chaîne complète

Pour chaque candidat retenu — d'office en mode autonome, par l'humain en mode sélection —, dans l'ordre, un à la fois :

1. `frame` — le QUOI et l'approche, avec le signal de fin comme critère d'acceptation.
2. `build` — le correctif, sur la cause NOMMÉE, observé par le harnais de l'étape 0 (sonde de
   profilage, test de reproduction) ; s'il manque pour ce candidat, le build le construit d'abord.
   Le rouge → vert est obligatoire pour un bug.
3. `clean` — retirer les sondes et les échafaudages qui ne servent plus.
4. `judge` — verdict sur le livrable, plus **la mesure d'après contre la référence**.

Ne groupe jamais plusieurs candidats dans une seule construction : un changement mélangé rend la mesure inattribuable.

### 3. RAPPORTER — avant / après, par candidat

Clos avec un tableau : candidat · statut · référence · après · écart · preuve (code de sortie, nom du test, capture).
Statut = `✅ corrigé` · `⚠️ non résolu` · `⏸ attend ton accord` · `✋ non prouvé` — chaque candidat du
tableau de l'étape 1 y figure, aucun ne disparaît en silence.
Tout ce qui n'a pas été remesuré est rapporté comme **non vérifié**, jamais comme une amélioration.
Termine par la seule question restante : les candidats `⏸`, groupés, avec le geste de chacun.

## À ne pas faire

- **N'optimise pas sans référence OU sans critère statique.** L'échec de heal le plus fréquent est
  d'accélérer du code froid ; le deuxième est d'abandonner un gaspillage localisé parce que rien ne pouvait être chronométré
  (voir 0 bis). L'un des deux est exigé — jamais aucun, jamais au feeling.
- **N'élargis pas un timeout, n'avale pas une erreur, ne desserre pas une assertion** pour faire disparaître un symptôme.
  Si une rustine est vraiment le bon choix, ÉTIQUETTE-la (« rustine temporaire — cause réelle : X ») et
  dispatche la cause réelle.
- **Ne touche pas à ce qui n'a pas été nommé.** Un nettoyage structurel est un candidat comme un autre, classé
  dans le tableau avec sa preuve — jamais un « tant qu'on y est » glissé dans le correctif d'un autre.
- **N'arrête pas le mode autonome pour demander la permission d'un geste sûr.** Seuls les gestes de § 1 bis
  attendent l'accord ; tout le reste se fait, puis se rapporte.
- **Ne fais pas confiance à un vert auto-déclaré.** L'autorité de clôture est un artefact : code de sortie, test
  rouge→vert, une mesure rejouée.
