---
name: grill
description: >-
  Interrogatoire sur un projet de TOUT domaine — « /grill », « grill-me », « interroge-moi », « trop de variables ».
  Dresse d'abord la CARTE de toutes les variables du sujet (y compris celles que l'utilisateur ne
  soupçonne pas), cherche lui-même les faits, pose en défauts contestables ce qui a peu d'enjeu, puis pose UNE
  décision à la fois en boutons cliquables avec réponse recommandée et conséquence, jusqu'à ce que chaque variable
  qui compte soit tranchée ; rend une fiche de décisions reprenable et la première action concrète. PAS pour : une
  tâche de code à cadrer sans interrogatoire demandé (→ `frame`), un design d'interface (→ `draft`), réunir du
  contexte sans rien demander (→ `think`).
---

# grill — l'interrogatoire qui trouve les variables à ta place

## À quoi ça sert

Un projet bloque rarement faute d'idées : il bloque parce qu'il a **trop de variables**, que certaines sont
invisibles pour qui débute, et qu'elles dépendent les unes des autres. `grill` fait trois choses qu'un simple
« pose-moi des questions » ne fait pas :

1. **Il trouve les variables** — celles d'un expert du domaine, pas seulement celles que l'utilisateur a en tête.
2. **Il trie** — un FAIT se cherche (l'agent le fait), une DÉCISION se demande (l'utilisateur tranche), un
   détail sans enjeu se pose par DÉFAUT (contestable, jamais caché).
3. **Il converge** — une question à la fois, dans l'ordre qui élimine le plus de branches, jusqu'à une fiche de
   décisions et une première action concrète.

Inspiré de `grill-me` / `grilling` (Matt Pocock : arbre de décisions, une question à la fois, réponse
recommandée, faits cherchés plutôt que demandés). Ce que `grill` ajoute :

| grill-me | grill |
|---|---|
| L'arbre reste dans la tête du modèle | **Carte visible** des variables dès le premier tour, avec progression chiffrée |
| Les variables viennent de l'utilisateur | **Recherche du domaine** : les variables qu'un expert considère, y compris les pièges de débutant |
| Toute décision est posée | **Défauts contestables** pour le faible enjeu : l'interrogatoire ne s'épuise pas sur des détails |
| Réponse en prose | **Boutons cliquables**, recommandation marquée, conséquence de chaque choix |
| Chaque réponse isolée | **Propagation** (une réponse ferme ou ouvre des branches) et **détection des contradictions** |
| S'arrête quand l'arbre est vide | **Pré-mortem** avant de clore, puis **fiche reprenable** et première action |

**Ici, interroger EST la tâche.** La règle générale « ne pose pas de question » cède pour les DÉCISIONS — jamais
pour les FAITS : une question dont la réponse se cherche (prix, compatibilité, faisabilité, version) reste une faute.

## Contrôle d'entrée

1. **Sujet nommé ?** Sinon, une seule question ouverte : « sur quoi veux-tu être interrogé ? ». Rien d'autre.
2. **Reprise ?** Une fiche existe déjà pour ce sujet (voir § Fiche) → relis-la, annonce en une ligne où on en
   était, et reprends à la frontière. Une question déjà tranchée ne se repose jamais.
3. **Intensité** — par défaut `normal`. L'utilisateur peut dire « rapide » ou « à fond » ; ne le demande pas.

| Intensité | Ce qui est demandé | Plafond indicatif |
|---|---|---|
| `rapide` | seulement les décisions à fort impact | ~5 questions |
| `normal` | fort et moyen impact | ~15 questions |
| `à fond` | tout, goûts fins compris | ~30 questions |

Au plafond : ce qui reste ouvert passe en défauts contestables, et on clôt (§ 5).

## Procédure

### 1. CARTE — les variables avant les questions

Avant la première question, construis la carte. C'est déjà un livrable : l'utilisateur voit enfin tout ce qui est en jeu.

- **Recherche du domaine** (1 à 3 `WebSearch` envoyées ensemble) : comment les gens du métier s'y prennent,
  les erreurs de débutant, les choix qui coûtent cher à défaire. Sujet de code : lecture ciblée du dépôt à la place.
  Une variable sans source reste permise, mais marquée « d'expérience ».
- **Trois couches de variables** :
  - **Universelles** (toujours) : le but et le critère de réussite (à quoi on verra que c'est réussi) · pour qui ·
    le livrable (forme, durée, qualité) · les contraintes (budget, temps, matériel, compétences) · l'existant
    (ce qu'il a déjà) · l'échéance.
  - **Du domaine** : celles trouvées par la recherche.
  - **Les dépendances** : quelle variable attend laquelle (le budget avant le matériel, le but avant tout).
- **Chaque variable reçoit une nature** — `fait` (tu le cherches) · `décision` (il tranche) · `défaut` (faible
  enjeu, tu proposes une valeur) — **et un impact** : fort / moyen / faible = combien d'autres variables changent
  selon la réponse.
- **Montre la carte** au premier tour en bloc ```mermaid `mindmap`, groupée par thème, et dis en une ligne combien
  de décisions restent à prendre.

### 2. FRONTIÈRE — quoi demander maintenant

La frontière = les décisions dont tous les prérequis sont tranchés. Prends-y la plus impactante ; à impact égal,
celle qui **ferme le plus de branches**. Le but et le critère de réussite passent presque toujours en premier.
Recalcule la frontière après chaque réponse.

### 3. UN TOUR = UNE DÉCISION

`ask` CLÔT le tour : tout ce que l'utilisateur doit voir tient dans le MÊME message, dans cet ordre, court :

1. **Progression** — `<progress>` + « 4 / 13 décisions prises ».
2. **Retenu** — la réponse précédente redite en une ligne, puis ses **conséquences en cascade** (« budget 0 € →
   combinaison exclue, reste la capture vidéo ; 3 variables fermées »).
3. **Faits trouvés** depuis le tour précédent, avec leur source, s'il y en a.
4. **Défauts posés** (3 au plus par tour) : « je pose 30 images/s et Blender — dis-le si non ». Ils sont
   contestables à tout moment et listés dans la fiche.
5. **La question** — une phrase, sans jargon (tout terme du métier traduit entre parenthèses), puis
   « **Pourquoi ça compte** : » en une ligne = ce que la réponse change concrètement.
6. **`ask`** — 2 à 6 réponses concrètes ; la PREMIÈRE est ta recommandation, marquée `recommande: true` ;
   chacune porte sa `consequence` (ce que ce choix entraîne). `choixMultiple: true` quand la variable n'est pas
   exclusive (« quelles parties du corps capturer ? »). Question de goût ou d'intention encore ouverte : les options
   sont des exemples, et le message dit qu'il peut taper sa propre réponse.

**Mode rafale** — si l'utilisateur le demande (« pose-les toutes », « plus vite »), donne jusqu'à 6 questions de la
frontière en liste numérotée, options lettrées, recommandation en gras, sans `ask` ; il répond « 1a 2c 3b ».

### 4. CHAQUE RÉPONSE — l'intégrer, pas seulement la noter

- **Propager** : fermer les branches devenues sans objet, ouvrir celles que la réponse crée.
- **Vérifier la cohérence** avec tout ce qui est déjà tranché. Une contradiction (« budget 0 € » + « combinaison
  pro ») devient LA question du tour suivant, posée comme un choix entre les deux.
- **« Je ne sais pas »** = ta recommandation devient une hypothèse marquée « à revoir », et on avance. Pas de cours
  magistral, sauf s'il le demande.
- **Un fait révélé** (« j'ai un iPhone 12 ») → cherche ce qu'il permet avant la question suivante.
- **Mets la fiche à jour** (§ Fiche) à chaque tour : c'est ce qui rend l'interrogatoire reprenable.

### 5. CLORE — pré-mortem, puis la fiche

Quand la frontière est vide pour l'intensité choisie :

1. **Pré-mortem** — « Imagine : c'est raté. Pourquoi ? » : trois causes plausibles. Chacune qu'aucune décision ne
   couvre devient une variable et retourne en boucle (une passe, deux au plus).
2. **Fiche finale** rendue dans le fil : décisions (chacune avec son pourquoi) · défauts posés · faits trouvés
   (sources) · risques et leur parade · angles morts restants · **la première action concrète**, faisable
   aujourd'hui (« filme 10 secondes de test avec le téléphone et importe-les dans X »).
3. **Rien n'est lancé** (achat, code, rendu) avant que l'utilisateur valide la fiche. Ensuite seulement, propose
   la suite : un plan d'exécution, ou `frame` → `build` si c'est du code.

## Fiche

Un fichier par sujet : `.autowin-data/autowin-os/grill/<sujet-en-kebab>.md` à la racine du dépôt Autowin (hors git,
survit au redémarrage). Jamais dans le dépôt de l'utilisateur sans qu'il le demande. Sections fixes :
`## Sujet` · `## Intensité` · `## Carte` (variables, nature, impact, statut : ouverte / tranchée / défaut /
à revoir) · `## Décisions` · `## Défauts` · `## Faits` (avec source) · `## Questions posées` (pour ne jamais en
reposer une).

## Rapport

À chaque tour : le format du § 3. À la clôture : la fiche finale du § 5 et son chemin.

## À ne pas faire

- Demander un fait qu'une recherche donne (prix, compatibilité, configuration requise, version).
- Poser plus d'une décision par tour hors mode rafale, ou un mur de questions au premier tour : la carte d'abord.
- Gaspiller une question sur un détail à faible impact : c'est un défaut contestable.
- Reposer une question tranchée, ou oublier une réponse donnée trois tours plus tôt : la fiche fait foi.
- Des options qui ne couvrent pas l'espace des réponses plausibles, ou une recommandation non argumentée.
- Le jargon du domaine non traduit : l'utilisateur débute peut-être.
- Agir avant la validation de la fiche finale.
- Un interrogatoire sans fin : au plafond de l'intensité, défauts puis clôture.
