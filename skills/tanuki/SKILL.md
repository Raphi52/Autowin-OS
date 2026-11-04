---
name: tanuki
description: Refaire ou améliorer un tanuki d'Autowin (le personnage du Quartier, sur l'accueil) dans Blender, en le comparant à la fiche de référence MESURÉE `skills/tanuki/reference.json`. Déclencher sur « refais le tanuki », « un tanuki plus beau », « nouveau tanuki dans Blender », ou un nouvel animal bâti sur le même squelette. NE PAS utiliser pour : changer l'affichage du Quartier dans l'interface (→ build sur `src/renderer/src/quartier/`), ni inventer des couleurs sans les mesurer.
---

# tanuki — rendre dans Blender, comparer à la fiche, montrer dans le fil

Créée le 2026-11-05 (conv-1562, lot 1 du plan conv-1558).

## La référence
- Image source : `D:\AutoWinOS\src\renderer\src\assets\quartier\atlas.avif` — c'est elle qu'affiche
  l'accueil (`HomeView.tsx` → `quartier/useQuartierAccueil` → `quartier/quartier-scene.ts`, import `urlAtlas`).
  Cases de 126 × 170 px (`assets/quartier/donnees.json`, clé `an`). Rangée 0 = face, 1 = trois-quarts,
  2 = profil (queue visible), 3 = trois-quarts dos.
- Fiche : `D:\AutoWinOS\skills\tanuki\reference.json`, produite par
  `node scripts/tanuki-mesurer.mjs --sortie skills/tanuki/reference.json`. Elle porte le `sha256` de
  l'atlas : si l'atlas change, relance le script, ne retouche jamais la fiche à la main.
- Sculpture d'origine (feutrine, rendu Cycles déterministe) : `D:\AutoWinOS\.autowin-tmp\conv-1421\gen\d3\tanuki.py`
  — note Brain `knowledge/domain/quartier-fabriquer-l-atlas-d-un-nouvel-animal-sur-le-squelette-du-tanuki.md`.
  Pour un nouvel animal : même squelette, mêmes poids, même semelle (pied à y = 0).

## Ce que dit la fiche (médianes sur les 9 cases de face, 9 de profil)
| Clé | Sens |
|---|---|
| `proportions.teteSurHauteur` | hauteur tête (oreilles comprises, jusqu'au cou) / hauteur totale |
| `proportions.largeurTeteSurCorps` | tête la plus large / corps le plus large (manches comprises) |
| `oreilles.*` | 2 oreilles ; hauteur, écart intérieur et largeur de base, en fraction de la tête |
| `masque.clair` | face crème : part de la tête, couleur, boîte (x en fraction de la case, y de la tête) |
| `masque.sombre` | yeux + truffe (pas un masque noir de raton : la face est crème, le tour gris) |
| `queue.*` | longueur / hauteur du personnage, nombre d'anneaux sombres, couleurs des anneaux |
| `palette.ensemble / tete / corps` | k-moyennes sur les pixels opaques, triées par part |
| `style.partDeBordAdouci` | part de pixels semi-transparents (bord doux du rendu) |

Limite connue : l'écharpe bleue est trop petite et trop grise pour sortir en couleur propre dans
`palette.corps` ; elle est visible sur l'atlas, pas dans la fiche.

## Procédure
1. **Rendre dans Blender, sans fenêtre et hors de l'écran de l'utilisateur.**
   `"C:\Program Files\Blender Foundation\Blender 5.2\blender.exe" --background <scene.blend> --python <script.py>`
   Rendu face (caméra orthographique, comme la rangée 0) ET profil (rangée 2), fond transparent (PNG RGBA),
   cadré dans une case de 126 × 170 (ou un multiple). Si une fenêtre est nécessaire (add-on blender-mcp),
   passe par `scripts/hdesk-lancer.ps1` dans TON bureau caché ; la connexion se prouve par
   `node scripts/blender-mcp-verifier.mjs`. Le rendu multi-vues outillé est le lot 2 (`scripts/blender-rendu-vues.mjs`).
2. **Mesurer le rendu avec le même script** : assemble un atlas de cases 126 × 170 :
   face en rangée 0, profil en rangée 2 (la rangée 1 peut rester transparente), puis
   `node scripts/tanuki-mesurer.mjs --atlas <ton-atlas.png> --sortie <mesure.json>`.
3. **Comparer à la fiche**, clé par clé. Repères de tolérance (à confirmer par le lot 3,
   `scripts/tanuki-controle.mjs`) : proportions à ± 0,05 ; 2 oreilles ; anneaux de queue à ± 1 ;
   chaque couleur dominante de `palette.tete` et `palette.corps` à moins de ~25 en distance RVB.
   Un écart se corrige dans la sculpture ou les matériaux, puis on recommence en 1.
4. **Montrer dans le fil** : l'image du rendu côte à côte avec la case 0 de l'atlas, et le tableau
   des écarts mesurés (valeur fiche, valeur rendu, écart). Jamais « c'est fidèle » sans ce tableau.

## Pièges mesurés
- Une oreille démarre 2 rangées plus haut que l'autre sur l'atlas : les oreilles se lisent jusqu'à la
  DERNIÈRE rangée coupée en deux, pas tant que la rangée est coupée.
- Moustaches et franges du rendu font des plages d'1 px : ignorées, sinon la tête paraît plus large.
- Les pixels transparents de l'atlas portent des couleurs étirées (traînées) : seule l'opacité compte.
- Une oreille qui dépasse y ≈ 1,0 sort du haut de la case vue de dos (note Brain ci-dessus).
