---
name: mise-en-forme
description: À charger avant d'écrire un bloc aw-tableau, aw-comparaison, aw-etapes, html-interactif ou un mermaid rare — schémas JSON, page interactive et son aperçu, types de diagrammes. PAS pour une page html-render simple : sa consigne est déjà dans le chat.
---

# mise-en-forme — le détail des blocs du fil

La consigne du chat dit déjà QUAND écrire chaque bloc, la direction « transparence totale » et les
classes `aw-*` : elles valent ici aussi. Ce fichier donne le détail à suivre au moment d'écrire le
bloc.

## Blocs de données

BLOCS DE DONNÉES (à préférer à une page html-render quand la forme s'y prête) : pour un TABLEAU, une COMPARAISON d'options ou des ÉTAPES, écris un bloc fermé dont le contenu est UNIQUEMENT du JSON — l'app le met en page elle-même, dans le thème choisi, et il ne coûte presque rien à relire. ```aw-tableau {"titre"?, "colonnes": ["…"], "lignes": [["…", 12, {"texte": "vert", "ton": "ok"}]], "note"?} ; ```aw-comparaison {"titre"?, "options": [{"nom": "…", "points": ["…"], "verdict"?: "…", "recommande"?: true}]} (2 à 6 options) ; ```aw-etapes {"titre"?, "etapes": [{"titre": "…", "detail"?: "…", "statut"?: "fait|en-cours|a-faire|echec"}]}. Tons d'une cellule ou d'un verdict : ok, ko, attention, chiffre, discret. Un JSON invalide s'affiche en code brut : vérifie-le. Garde html-render pour une mise en page libre.

## Interactif sans JavaScript (html-render)

INTERACTIF SANS JAVASCRIPT : le HTML du fil accepte `<details>/<summary>`, les cases a cocher et
boutons radio (`<input type="checkbox">`, `<input type="radio">`) avec leur `<label for>`, les
identifiants `id`, et les jauges `<progress>` et `<meter>`. Avec `:checked` en CSS, cela donne de
VRAIS onglets, des accordeons et des filtres sans une ligne de script — sers-t'en des que ta reponse
compare plusieurs options ou porte un avancement chiffre. Aucun autre champ n'est accepte (ni texte,
ni envoi) : ce qui se clique ne fait que changer l'affichage.

## Pages interactives (html-interactif)

PAGES INTERACTIVES : quand la reponse gagne a etre MANIPULEE — graphique qu'on survole,
calculateur, simulation, tri ou filtre sur des donnees —, ecris un bloc ferme ```html-interactif :
meme HTML/CSS et memes classes `aw-*` que html-render, pose sans fond sur le fil, mais ses
`<script>` et ses `onclick` TOURNENT, dans un cadre isole SANS reseau ni acces a Autowin. Tout en
ligne : un `<script src>`, une police ou une image externe sont refuses — dessine en `<canvas>` ou
en SVG ; `THREE` est disponible. La hauteur suit le contenu. Garde html-render quand rien ne bouge.

Pour un graphique, n'ecris NI axes NI survol : `autowin.graphique('#zone', {type, titre, categories, valeurs, unite})`
les fait, avec bulle au survol et au clavier, legende, couleurs du theme et largeur fluide. `type` :
barres (defaut), lignes, aires, secteurs, points. Plusieurs series : `series: [{nom, valeurs}]`
(points : `points: [[x, y]]`), `empile: true` pour les empiler, `format: (v) => texte` pour les
valeurs. Il rend `{maj(options), detruire()}` : `maj({valeurs})` pour un simulateur. Bulle a
verifier : `.aw-graphique-bulle`.

Marchent comme dans un navigateur : localStorage (survit au redemarrage de l'app), formulaires,
alert, copie et lien http(s) APRES un clic ; l'evenement `aw-theme` signale un changement de theme
(redessine tes canvas). Ni confirm, ni prompt, ni telechargement : des boutons dans la page. Un lien
`<a href="#autowin-prompt">Libelle</a>` y REMPLIT la saisie de l'utilisateur avec son libelle, sans l'envoyer
(`autowin.remplirSaisie(texte)` pour un message compose par la page) ; il relit et envoie lui-meme.

Pour un canvas, lis les couleurs sur la page :
`getComputedStyle(document.documentElement).getPropertyValue('--gold-clair')` (--text, --text-dim,
--gold-doux, --gold-clair, --ok, --err, --warn, --line).

Avant de montrer, ecris la page dans `.autowin-tmp/<id du fil>/`, puis
`node scripts/html-interactif-apercu.mjs <fichier>` (depot Autowin) la fait tourner comme le fil,
en clique et en survole chaque element : code 0 exige ; 3 = erreur JavaScript (clic compris) ou geste que le fil refuse,
4 = vide, 5 = deborde de la colonne, 6 = hauteur qui grandit seule, 7 = fond peint,
8 = scenario rouge ; lis ses captures et `texteFinal`. Ces clics ne remplissent aucun champ : des qu'une page
calcule, filtre ou enchaine des etapes, ajoute `--scenario <fichier.json>` plutot que d'ecrire ton
propre banc d'essai. C'est un tableau d'etapes jouees a la vraie souris et au vrai clavier, avec des
valeurs attendues calculees a part : `{"remplir":"#montant","valeur":"200000"}`,
`{"choisir":"#type","valeur":"RTT"}`, `{"cliquer":"#calculer"}` ou `"texte=Calculer"`,
`{"survoler":"canvas","x":0.5,"y":0.5}`, `{"touche":"Enter"}`, `{"attendre":500}`,
`{"voir":"1 109,20","dans":"#mensualite"}`, `{"pasVoir":"NaN"}`,
`{"demande":"prompt","contient":"Conges"}`.

## Diagrammes (mermaid)

DIAGRAMMES : un bloc ferme ```mermaid est RENDU en diagramme dans le fil, aux couleurs du theme
(flowchart, sequenceDiagram, stateDiagram, classDiagram, erDiagram, pie, gantt). Prends le type qui
colle a la FORME de l'idee : mindmap (idees autour d'un centre), timeline (dates), quadrantChart
(matrice effort/valeur), xychart-beta (barres, courbes), sankey-beta (flux ; AUCUNE lettre accentuee, meme entre guillemets),
gitGraph (branches), journey (parcours vecu), kanban, treeView-beta (arborescence de fichiers),
ishikawa-beta (causes d'un defaut), venn-beta, radar-beta, treemap-beta, block-beta,
architecture-beta (libelles accentues entre guillemets). C'est bien plus court et plus lisible qu'un
SVG dessine a la main. Une syntaxe invalide retombe simplement sur le texte source : verifie ta
syntaxe, elle n'est pas rattrapee.
