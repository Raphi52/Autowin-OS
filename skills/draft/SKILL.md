---
name: draft
description: À utiliser quand l'utilisateur veut CONCEVOIR ou itérer une interface / une mise en page et que l'intention visuelle n'est PAS encore arrêtée — "fais-moi une interface / un écran / une page", "propose des layouts", "je sais pas quel design", "itère sur le design", "trouve le bon agencement", "refais le look de X". Pilote une BOUCLE D'ÉLICITATION VISUELLE : diverger en ~6 directions distinctes rendues en maquettes → l'utilisateur garde/jette/mélange → affiner → converger vers une approbation explicite → porter vers la technique cible. NEUTRE côté technique (web / WinForms / WPF). NE PAS utiliser quand l'utilisateur DÉCRIT déjà la structure de la mise en page ou fournit une spec finie — c'est un ordre d'implémentation, va directement à `frontend-design` ; ni pour du travail back-end ou de logique.
---

# draft — faire émerger le visuel par maquettes successives

## À quoi ça sert
Faire remonter la VRAIE intention visuelle de l'utilisateur en la MONTRANT, pas en la devinant (les mots perdent de l'information ; l'utilisateur reconnaît ce qu'il veut quand il le VOIT). DIVERGER en directions distinctes → rendre en maquettes comparables → capter le choix → RESSERRER → converger vers une approbation explicite → matérialiser le gagnant dans la technique cible. PAS « produire une bonne interface » (ça, c'est `frontend-design`, INVOQUÉ par variante). Ce qui est neuf ici, c'est la **boucle de convergence** (invariante) ; le moteur de rendu et de capture est INTERCHANGEABLE.

## Quand NE PAS l'utiliser (frontière avec frontend-design)
- L'utilisateur DÉCRIT déjà la mise en page (« barre latérale à gauche, grille de cartes, en-tête bleu ») → c'est une spec → `frontend-design`.
- Un design ou une spec finie à implémenter → `frontend-design`.
- Back-end / données / logique → pas cette skill.
Ne l'utilise que tant que l'intention visuelle est OUVERTE et mérite qu'on diverge dessus.

## La boucle (procédure)
1. **Cadre le minimum** — quel écran/quelle surface, le VRAI contenu, la TECHNIQUE CIBLE (web/WinForms/WPF — DEMANDE si ce n'est pas évident, ne suppose jamais le web), les contraintes dures (un design system ? du responsive ?). Ne SUR-cadre pas le style — la boucle le découvre.
2. **Lis D'ABORD le goût de l'utilisateur en mémoire — BLOQUANT, avant de dessiner quoi que ce soit** (`brain_query` sur ses préférences visuelles ; si l'hôte n'a aucun outil de mémoire, dis-le ; fiche `[[feedback_portail_design_lineaire]]`), ne le fige pas en dur — pour que la divergence reste dans le goût + ses anti-motifs, et reste à jour si le goût évolue.
3. **Diverge en K = 6 directions DISTINCTES** (pas des variantes cosmétiques). Dans les garde-fous du goût, chacune DOIT différer sur **≥ 2 axes** : densité d'information · hiérarchie typographique · usage de la couleur d'accent · structure spatiale (grille/colonnes/cartes) · mouvement ou retenue. Invoque `frontend-design` pour la qualité d'exécution de chaque direction. Tour 1 = divergence large (mise en page + ton). **Vocabulaire partagé** : les directions, structures et détails nommés (Linéaire, éditorial, dense, rail, filet fin, bandeau de statut…) avec leurs exemples rendus vivent dans `design-glossary.html` (embarqué) — emploie ses termes ; il marque la direction par défaut de l'utilisateur + les anti-motifs bannis.
4. **Rends + CAPTURE + LIS** chaque direction (moteur selon la technique, ci-dessous). **Auto-contrôle AVANT de montrer** : rien de cassé (rendu non vide, glyphes corrects, aucune liaison ni mise en page morte) + garde-fous du goût respectés. Une capture non LUE n'a aucune valeur.
5. **Présente pour CHOIX** (et TOUJOURS avec une nouvelle fournée de 6 — voir « Ne jamais cesser de proposer ») — un seul artefact de galerie côte à côte + demande **garde/jette/mélange** (+ commentaire libre). Préfère `AskUserQuestion` s'il existe, sinon demande simplement. Si l'utilisateur rejette les 6 → rediverge autrement, ne repropose jamais le même lot.
6. **Resserre** — affine la direction gardée + GREFFE les parties aimées des autres. Les tours suivants resserrent (style/densité/détail), ils ne divergent plus largement.
7. **Converge → ARRÊTE-TOI à l'approbation EXPLICITE de l'utilisateur** (jamais d'arrêt automatique : l'esthétique ne se prouve pas toute seule). Plafond ~4-5 tours ; sans convergence → « on verrouille la mise en page, on n'itère plus que le style » ou remonte à l'utilisateur.
8. **Fige + PORTE** — produis une spec de design (ci-dessous), passe-la à `frontend-design`/`build` pour l'implémentation. Cette skill ne réécrit pas le moteur d'implémentation ; elle livre le design arrêté et le porte.

### Gabarit de spec de design (le gel remis au portage)
```
TECHNIQUE CIBLE : web (React/Next…) | WinForms | WPF
MISE EN PAGE    : grille/structure (régions + placement)
JETONS          : couleurs (fond/surface/accent/texte) · typographie (titre/corps) · échelle d'espacement · rayon
TON             : la direction esthétique choisie, en une ligne
GARDE-FOUS      : les règles de goût qui doivent tenir (depuis la mémoire)
GARDÉ/JETÉ      : éléments greffés, éléments rejetés
```
**Notes de portage par technique** (une maquette HTML transmet la mise en page et l'intention, pas le pixel exact) :
- **web** → passe l'artefact HTML + la spec à `frontend-design` (la cible la plus proche).
- **WPF** → la mise en page vers `Grid`/`StackPanel`/`DockPanel` ; les jetons vers un `ResourceDictionary` (brosses, styles) ; abandonne les effets propres au web. **OBLIGATOIRE** : ≥ 1 capture du rendu réel (build → `capture-window.ps1` → Read) avant de présenter — le HTML ne peut pas représenter fidèlement la mise en page d'un contrôle natif.
- **WinForms** → vers `TableLayoutPanel`/`FlowLayoutPanel`/`Panel` ; ignore le CSS ; même capture OBLIGATOIRE du rendu réel.

## Moteurs de rendu et de capture (interchangeables selon la technique)
| Cible | Rendu | Capture LUE par Claude |
|---|---|---|
| **web / HTML** | outil `Artifact` (page autonome) | rends en local avec **Claude Preview** et prends une capture. Outils différés — charge-les d'abord : `ToolSearch "select:mcp__Claude_Preview__preview_start,mcp__Claude_Preview__preview_screenshot,mcp__Claude_Preview__preview_stop"`. Cycle par tour : `preview_start` → `preview_screenshot` → **Read** du PNG → **`preview_stop`** (arrête toujours avant le tour suivant, sinon un aperçu périmé bloque le `preview_start` suivant) |
| **WPF / WinForms** | build + lancement du projet | `capture-window.ps1` (embarqué) : `-Exe <chemin>` / `-WindowTitle <fragment>` / `-ProcId <pid>` → PrintWindow → PNG → **Read** |
| n'importe quelle cible | qualité par variante | invoque `frontend-design` (ne le réimplémente PAS) |
| **surface d'une app EN COURS D'EXÉCUTION** (refonte d'une partie d'une app vivante — barre de chat, panneau, barre d'outils) | rendu en ligne dans le chat hôte | l'app vivante EST la cible de rendu : **`desktop_observe`** l'écran réel, puis dessine à l'ÉCHELLE RÉELLE de ce composant (même largeur, mêmes tailles de police, mêmes couleurs vivantes lues dans son CSS/XAML). Une vignette 3 fois plus petite que le vrai composant n'est PAS une maquette et trompe l'utilisateur. |
| **hôte SANS `Artifact` ni Claude Preview** (par ex. un chat d'agent embarqué) | bloc HTML en ligne supporté par l'hôte | ces outils MCP différés N'EXISTENT PAS ici — ne fais pas semblant de capturer. Remplacement : `desktop_observe` sur la surface réelle, sinon dis clairement « non observé ». |

### Recettes de maquette en ligne (chat hôte, sans Preview) — OBLIGATOIRES
Le moteur de rendu en ligne n'a AUCUNE police d'emoji et AUCUNE police d'icônes. Chaque icône ou bouton de maquette DOIT être construit avec ces recettes, jamais avec un glyphe collé :
- **BALISES AUTORISÉES SEULEMENT** — le filtre de l'hôte (`src/renderer/src/components/chat-html-inline.ts`, `ALLOWED_TAGS`) SUPPRIME `<button>`, `<svg>`, `<path>`, `<input>` et toute balise inconnue, n'en gardant que le texte. Une maquette dessinée avec `<button>`/`<svg>` arrive VIDE dans le fil — mesuré le 2026-09-04, conv-257 : cinq variantes de bouton rendues en cases vides. Ne dessine qu'avec `div`, `span`, `p`, `table`, `hr`, `b`, `code`, `details`.
- **CSS AUTORISÉ SEULEMENT** — `ALLOWED_STYLE_PROPS`, dans le même fichier. PAS de `box-shadow`, PAS de `position`, PAS de `transform`, PAS de `grid-template-rows`, PAS d'`inset`. Disponibles : `display`, `flex*`, `gap`, `grid-template-columns`, `align-items`, `justify-content`, `background`, `border*`, `border-radius`, `border-image`, `color`, `font*`, `opacity`, `padding*`, `margin*`, `width/height`, `text-*`. Les marges verticales sont PLAFONNÉES à 12px et le `line-height` à 1.55 — ne lutte pas contre.
- **PAS DE GRILLE CSS pour les planches de maquettes** — `grid-column` / `grid-row` ne sont PAS dans `ALLOWED_STYLE_PROPS` (seul `grid-template-columns` y est). Un séparateur écrit `grid-column:1/-1` PERD cette règle, occupe UNE case au lieu d'une ligne entière, et décale d'une colonne tout ce qui suit : la planche entière se rend en désordre (mesuré le 2026-09-04, conv-257). Construis les planches en EMPILANT des lignes `<div>`, chaque ligne en `display:flex` avec l'échantillon à gauche et la légende à droite ; les séparateurs sont de simples `<div>` frères entre les lignes.
- **Simule un bouton** avec un `<span>` : `display:inline-flex;align-items:center;justify-content:center;width:32px;height:32px;border-radius:50%;background:...`. Le relief sans `box-shadow` = une bordure haute de 1px plus claire que la bordure basse.
- **Icônes** : pas d'emoji (aucune police d'emoji dans l'hôte) et pas de `<svg>` (retiré). Utilise un MOT en monospace minuscule (`envoyer`, `micro`) ou une flèche en texte simple dans le faux bouton (`→`, `↑`, `➤`), dimensionnée par `font-size`/`line-height:1`.
- **Auto-contrôle avant de montrer** : relis ton propre HTML — chaque balise dans ALLOWED_TAGS, chaque propriété CSS dans ALLOWED_STYLE_PROPS, zéro emoji. Une maquette dont le contrôle disparaît invalide TOUT le tour : l'utilisateur juge le dessin, pas l'intention.

Note : `visualize.show_widget` rend EN LIGNE dans le chat (pour présenter à l'utilisateur) — aucun PNG sur le disque, ce n'est PAS un substitut à l'auto-contrôle par LECTURE ; pour ça, utilise Claude Preview.

`capture-window.ps1` (embarqué) : générique (titre/PID/exe), détecte le plantage « sorti trop tôt » et les rendus quasi noirs. Ex. : `powershell -NoProfile -File capture-window.ps1 -Exe "C:\proj\bin\Debug\App.exe" -KillFirst`.

## Garde-fous du goût
Lis-les en mémoire au moment de l'exécution (`[[feedback_portail_design_lineaire]]`), ne fige pas les valeurs ici (elles se périmeraient). La fiche est la source unique de vérité. Les garde-fous BORNENT la divergence, ils ne l'annulent pas (les 6 directions restent distinctes sur ≥ 2 axes). Valide toujours contre la capture lue.

## Ne jamais cesser de proposer (invariant sur toute la conversation)
La boucle ne s'arrête PAS quand un tour est présenté. Tant que l'utilisateur n'a PAS explicitement ordonné l'IMPLÉMENTATION d'une solution (« implémente celle-là », « go sur la 2 », « code-la », une approbation explicite de construire), CHAQUE réponse de la conversation se termine par une NOUVELLE fournée de **6** propositions. Cela vaut pour TOUTE la conversation, d'un tour à l'autre, y compris après un retour, un mélange, un rejet, une digression ou un « j'aime bien la 2 » partiel — une préférence n'est PAS un ordre d'implémentation ; continue d'en proposer 6 affinements.
- Ne réponds jamais seulement par des commentaires, des questions ou une analyse : commente/demande ET propose 6.
- Ne repropose jamais un lot identique : chaque nouvelle fournée de 6 doit différer (tour 1 = divergence large, tours suivants = resserrement sur la direction gardée).
- La SEULE sortie est le feu vert explicite de l'utilisateur pour implémenter (ou un « stop » explicite). À ce moment, fige la spec et porte (étape 8).

## Plafonds
- K = **6** directions par tour (la question cliquable porte jusqu'à 10 options, donc 6 tiennent — voir `PLAFOND_REPONSES` dans `src/main/ask-options.ts`), **à chaque tour, jusqu'à ce que l'utilisateur ordonne l'implémentation** · cible ~**4-5 tours** (souple : continue de proposer tant que l'utilisateur itère) · variantes générées en parallèle.
- Clôture = **approbation explicite de l'utilisateur** (attestable, pas rejouable — prise honnêtement pour argent comptant).

## À ne pas faire
- NE réimplémente PAS `frontend-design` (la qualité par variante) ni l'outil `Artifact` — ORCHESTRE-les.
- NE converge PAS au hasard : respecte les garde-fous de goût lus en mémoire.
- NE montre PAS une maquette qui n'a pas été CAPTURÉE + LUE (une liaison ou une mise en page morte est invisible autrement).
- NE colle PAS d'emoji ni de caractères symboles comme icônes ou boutons dans une maquette en ligne — l'hôte n'a pas de police d'emoji, ils se rendent en formes monochromes illisibles ou débordent de leur cercle (voir les recettes de maquette en ligne).
- N'INVENTE PAS le contenu d'un composant existant : si le vrai balisage écrit le mot « OK », ta maquette écrit « OK » — pas une coche. Une maquette qui change un LIBELLÉ ou un GLYPHE promet un changement de balisage : dis-le sur la maquette, et au portage livre-le (ou nomme ce que tu ne livres pas). Mesuré conv-605 le 2026-09-16 : coche montrée, « OK » livré « en CSS seul », l'utilisateur a vu autre chose que son choix.
- N'esquisse PAS la surface d'une app vivante d'imagination ou à échelle réduite : LIS son vrai fichier de style (couleurs, tailles, espacements) et fais un `desktop_observe` D'ABORD — les maquettes dessinées en aveugle sont la source n° 1 des « propositions douteuses ».
- NE déclare PAS « fini » sans approbation explicite de l'utilisateur.
- NE cesse PAS de proposer des fournées de 6 tant qu'aucun ordre d'implémentation n'a été donné — une réponse sans 6 nouvelles propositions est un échec de cette skill.
- NE suppose PAS la technique (web contre WinForms contre WPF) — demande.
- Implémenter un design DÉJÀ arrêté → `frontend-design` directement (pas cette boucle).

## Moteur et réflexes
- Génération de variantes en parallèle, boucle jusqu'à épuisement, déduplication par idée centrale → **moteur ch.1 (GENERATE & GATE)**. Passation gel→portage + incréments de code depuis la spec → **moteur ch.4 (BUILD)**. En cas de divergence, le moteur gagne.
- Réflexe : une capture non LUE n'a aucune valeur ; la clôture de l'esthétique, c'est l'œil humain, pas un « ça rend bien » auto-jugé.
