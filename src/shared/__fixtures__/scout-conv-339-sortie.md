## Cible
Les deux propositions retiennent la même piste : la ligne 1, **donner aux passants les reflets des néons, comme aux voitures**. Elles avancent ces raisons :
- C'est le seul manque vérifié de bout en bout.
- Le changement se fait à un seul endroit, `matiere()`.
- Aucun test ne protège le choix contraire.
- Elle passe devant la peau translucide parce qu'environ la moitié des passants a le visage sous une cagoule. L'effet sur la peau serait donc réduit.

La demande est lue comme « que faut-il améliorer » pour rapprocher les humains de l'Accueil du rendu de Cyberpunk. La réponse est donc une liste de pistes classées.

Depuis conv-312, les passants sont 18 vrais modèles Rocketbox, animés par des marches enregistrées sur de vrais acteurs. Il faut travailler la lumière, la peau, les textures et les ombres, pas remplacer les modèles.

Autowin peut réajuster les notes après coup (×1,5 pour une nouveauté, ×0,8 pour une correction). L'ordre peut alors changer, mais la cible reste la ligne 1.

**Lecture du tableau :** les deux notes sont données côte à côte (proposition 1 · proposition 2). Les lignes suivent l'ordre de la proposition 1. La proposition 2 classe autrement les lignes 4 à 7 : visages (50), fichier manquant (45), reflet du sol (42), textures (40).

| # | Score (P1 · P2) | Type | What | Why | How |
|---|---|---|---|---|---|
| 1 | 68 · 72 | 🔧 fix | Reflets des néons sur les passants | `matiere()` (`home-decor-foule.ts:341-350`) crée un `MeshStandardMaterial` sans `envMap`. Les passants reçoivent bien les lampes de la scène : réverbères (`home-decor-avenue.ts:793`), néons (l.871), ambiance (l.882). Mais ils ne reflètent pas l'environnement. Le panorama de rue nocturne existe déjà (`home-decor-avenue-voitures.ts:378`, préparé l.420, appliqué l.468). Le commentaire de la l.28 le réserve aux voitures. Atlantic le reçoit en paramètre (`home-decor-avenue-atlantic.ts:224`). `nuance.lumiere` a été vérifié : c'est un liseré de bord à couleur fixe (`bord(normal, …)`, `home-decor-foule-tribus.ts:138,149`), pas un reflet. | Partager le panorama des voitures et l'amener, avec une intensité faible, jusqu'à `matiere()`. C'est le seul point d'appel (`home-decor-foule.matieres.test.ts:56`). Preuve : capture `--code-dev` avant et après. |
| 2 | 62 · 62 | 🆕 feature | Peau moins « plastique » | La peau a une rugosité de 0,55 (`home-decor-foule.ts:208`, appliquée l.345). Rien ne simule la lumière qui traverse la peau. three 0.185.1 fournit pourtant `examples/jsm/shaders/SubsurfaceScatteringShader.js`. La présence de ce fichier a été vérifiée avec `ls` (l.37-41). Il suit la méthode GDC 2011, avec `thicknessMap`, `thicknessDistortion`, `thicknessAttenuation`, `thicknessPower` et `thicknessScale`. Limite : environ la moitié des 20 passants est de la tribu `survet` (`TRIBUS`, `home-decor-foule-tribus.ts:41-60`). Leur tête est sous une cagoule tricotée, seule la fente des yeux est nue (l.126-131 selon P1, l.129-133 selon P2). La peau visible se réduit au visage des punks et aux mains. | Reprendre le calcul de translucidité de ce nuanceur dans `nuancer()` (`home-decor-foule-tribus.ts`, l.200 selon P1, l.205 selon P2), sur la peau seulement, sans réinventer ce calcul. Preuve : capture de près. |
| 3 | 55 · 55 | 🔧 fix | Commentaire périmé : « 34 ms par image » | `home-decor-foule.ts:356-362` dit encore au présent que « setProgram coûte 34 ms ». Ce coût a été supprimé par les matières en double de la Spirale (`matieresDuReflet`, `home-decor-avenue-spirale.ts:958`). Le test « LE REFLET DESSINE DES JUMELLES » le vérifie (`home-decor-avenue-spirale.test.ts:384`, ligne trouvée avec grep). Ce commentaire fait croire qu'il ne reste aucune marge de calcul. Il pousse à refuser à tort les pistes 1 et 2 comme « trop coûteuses ». | Réécrire ce paragraphe avec le coût mesuré aujourd'hui. |
| 4 | 50 · 45 | 🔧 fix | Un seul fichier manquant fait disparaître toute la foule | `adresseFoule` (l.65), `chargerTexture` (l.299) et `chargerGlb` (l.319) lèvent une erreur. `chargerFoule` ne la rattrape pas, et l'avenue écrit seulement un `console.error` (~l.2126). Aucun test ne couvre ces fonctions. Les 97 textures sont présentes aujourd'hui. | Ajouter un test : chaque texture citée par un .glb existe dans le dossier. Si un personnage échoue, l'écarter seul et afficher son nom. |
| 5 | 48 · 40 | 🔧 fix | Textures réduites, sans moyen de les refabriquer | `LICENCE-ROCKETBOX.md:11` : sources en 2048 px, réduites à 1024 px pour la couleur et 512 px pour le relief (tailles mesurées). Le script `convertir.js` est dans un dossier ignoré par git (`.gitignore:74`) et ne contient aucune étape de réduction. Le flou de près est une déduction : aucune capture ne le montre. | Ranger ce script dans `scripts/`, avec la taille en paramètre. Repasser les têtes en 2048 px et comparer sur une capture. |
| 6 | 45 · 50 | 🆕 feature | Visages vivants : clignement, regard | Le script node trouve 0 forme de visage animable dans les 20 .glb. `LICENCE-ROCKETBOX.md:12,18` confirme que les animations du visage ont été retirées. Non vérifié : les FBX d'origine les contiennent peut-être. | Ouvrir un FBX d'origine. Si le visage y est animable, ajouter un clignement dans la boucle de la foule. |
| 7 | 42 · 42 | 🔧 fix | Passants absents du reflet du sol mouillé | **C'est un choix voulu, protégé par des tests.** Préparer d'un bloc la version « reflet » de la foule, à sa première image, ferait un à-coup (`home-decor-avenue-spirale.ts:38-39`). Deux tests imposent de cacher la foule dans ce reflet : `spirale.test.ts:368` et `:460-464` (`spirale.avantRendu([foule?.groupe])`). Relancés : 22/22, code de sortie 0. | ⚠️ **Il faut ton accord pour modifier ces deux tests.** Ensuite : `precompilerReflet` et `finaliserProgrammes(foule, spirale.matieresDuReflet())` dans `entrer()`. Puis retirer la foule de `exclus` et vérifier qu'aucun pic de temps n'apparaît après `foule-visible`. |
| 8 | 30 · 30 | 🔧 fix | Les ombres sont des taches rondes peintes | Une tache d'opacité 0,6 sous chaque passant (`home-decor-foule.ts:593-609`). Aucun `castShadow` dans `home-decor-*.ts`. Déduction faite sans capture. | Allonger la tache dans l'axe du réverbère le plus proche (`home-decor-avenue.ts:747`). |
| 9 | 25 · 25 | 🆕 feature | Humains filmés en volume (« splats ») | Selon [radiancefields](https://radiancefields.com/three.js-ships-its-native-gaussian-splat-renderer-and-splat-raycasting-in-r186), three r186 sait dessiner des `GaussianSplat`. Ce code est dans les modules d'exemple (`examples/jsm/objects`), et la source ne parle pas de splats animés. Or les passants marchent, et même les figurants font des gestes (`gestes.glb`, `LICENCE-ROCKETBOX.md:18`). C'est un obstacle majeur. | Gros effort : mettre three à jour, puis tester un seul figurant immobile. |

**Pistes écartées après vérification :**
- Les restes de l'ancien maillage sculpté : aucun fichier `home-decor-avenue-maillage*` ne subsiste.
- Les cheveux crénelés : les deux tribus ont `cheveux: false`, et les mèches ne sont jamais montées (`home-decor-foule.ts:556-561`).

### Bilan de l'étape
- **Verdict :** fait. Les six objections du juge sont corrigées :
  - le nuanceur de peau existe déjà ;
  - la limite de la cagoule est prise en compte ;
  - les splats animés ne sont pas couverts ;
  - `nuance.lumiere` a été vérifié ;
  - l'ordre du tableau est cohérent avec la cible ;
  - la ligne 384 du test est confirmée.
- **Fichiers touchés :** aucun.
- **Preuves (reprises des deux propositions, je ne les ai pas relancées pendant la fusion) :**
  - `npx vitest run src/renderer/src/components/home-decor-avenue-spirale.test.ts` : 22 tests réussis, code de sortie 0.
  - `ls …/SubsurfaceScatteringShader.js` : fichier présent (l.37-41), three 0.185.1.
  - `grep -n JUMELLES` : l.384.
  - Lignes lues : `home-decor-foule-tribus.ts:41-60` et `:120-150`, `home-decor-foule.ts:208,345`.
- **Reste à faire :** réaliser la ligne 1, avec une capture `--code-dev` avant et après. La ligne 7 attend ton accord pour changer ses deux tests.

SUITE: build
