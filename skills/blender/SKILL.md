---
name: blender
description: Faire une BELLE image 3D dans Blender (objet, produit, nature morte, décor) avec la recette qualité contrôlée par script et la boucle rendre → regarder → corriger. Déclencher sur « /blender », « fais-moi une scène 3D », « un rendu Blender magnifique », « modélise X dans Blender ». NE PAS utiliser pour : le tanuki du Quartier (→ `tanuki`), une scène three.js dans le fil (bloc threejs), le décor 3D de l'interface (→ build).
---

# blender — une belle image, prouvée par le contrôle ET par l'œil

Créée le 2026-11-05 (conv-1570). Deux juges, jamais un seul : `scripts/blender_qualite.py` tient la
RECETTE (ce qu'un code sait vérifier), l'outil `look` du MCP tient le RESTE (ce que seul l'œil voit :
un livre qui ressemble à une gomme, une lumière plate). Mesuré sur la scène d'essai : le contrôle était
vert dès le premier rendu, et c'est l'œil qui a trouvé les deux défauts corrigés ensuite.

## 0. Brancher
- Blender doit tourner avec l'add-on MCP (port 9876). Outils `mcp__blender__*` qui répondent
  « Could not connect to Blender » → Blender est fermé : `bureau_cache_lancer` sur
  `C:\Program Files\Blender Foundation\Blender 5.2\blender.exe` (jamais l'écran de l'utilisateur) ;
  l'add-on démarre seul son serveur. Puis `get_addon_status`.
- **Poly Haven est un réglage de SCÈNE**, pas de Blender : chaque nouveau fichier repart à « off »
  (mesuré conv-1570 : Blender relancé → off). Allume-le dans chaque scène :
  `bpy.context.scene.blendermcp_use_polyhaven = True`. Gratuit (CC0), sans clé.
- `generate_3d` (Hyper3D, Tripo…) peut coûter un crédit : seulement si l'utilisateur l'a accepté.

## 1. Brief (déduit, jamais demandé)
Sujet · ambiance · lumière · caméra · sortie. Annonce-les en une ligne comme hypothèse et avance.
Sortie par défaut : 1280×720 (16:9).

## 2. Construire selon la recette
| Point | Par défaut | Comment |
|---|---|---|
| Lumière HDRI | Poly Haven, 2k | `search_assets(source='polyhaven', asset_type='hdris')` → `import_asset(asset_type='hdris', resolution='2k')`. Un intérieur chaud (warm_restaurant) ou un studio. |
| Vrais matériaux | textures PBR ou Principled réglé | `import_asset(asset_type='textures', apply_to=[...])` ; règle le nœud `MAPPING` (Scale = taille de la surface en m / taille réelle de la texture). Sinon Principled : couleur choisie, rugosité 0,2–0,8, bosse (bruit, ondes). Jamais le gris par défaut. |
| Objets | Poly Haven `models` d'abord | pose au sol avec la boîte englobante rendue par `import_asset`. Un objet modelé = plusieurs pièces (un livre : 2 plats, un dos, un bloc de pages en retrait), pas un pavé. |
| Biseaux | modificateur Bevel | largeur 1–3 mm à l'échelle réelle, 3 segments, limite par angle, ombrage lisse. |
| Objectif | 85 mm | 70–105 accepté. Recule la caméra pour cadrer ; sujet sur un tiers. |
| Profondeur de champ | f/2.8 | `dof.use_dof = True`, `dof.focus_object = <sujet>` (la netteté suit le sujet). |
| Couleur | AgX | `view_settings.view_transform = 'AgX'` (défaut de Blender 5.2). |
| Moteur | Cycles + débruitage | `render.engine = 'CYCLES'` (dans un try/except TypeError), `cycles.device = 'CPU'`, 128 échantillons, `use_adaptive_sampling`, seuil 0,02, `use_denoising`. |
| Lumière directionnelle | une lampe de zone si besoin | disque de 0,8 m, chaud, à 45° sur le côté et au-dessus : modèle le sujet et pose une ombre. |

## 3. Contrôler la recette (code, avant tout rendu)
Dans le Blender du MCP :
`exec(open(r"D:\AutoWinOS\scripts\blender_qualite.py", encoding="utf-8").read())`
→ une ligne `QUALITE_JSON: {ok, points: [{id, ok, detail, correction}]}` sur 7 points : `hdri`,
`materiaux`, `biseaux` (arête de plus de 75° sans biseau), `objectif`, `profondeur`, `agx`, `cycles`.
Un point rouge se corrige avec sa `correction`, puis on recontrôle. Jamais de rendu sur un contrôle rouge.

## 4. Rendre (hors du Blender interactif)
1. Copie de la scène, textures embarquées (Poly Haven les embarque déjà) :
   `bpy.ops.wm.save_as_mainfile(filepath=r"D:\AutoWinOS\.autowin-tmp\<fil>\blender\scene.blend", copy=True)`
2. `node scripts/blender-rendu-final.mjs --blend <scene.blend> --fil <conv> --nom <vN> --titre "<légende>" --langue <fr|en>`
   Blender en arrière-plan rend en Cycles, rejoue les 7 points, MESURE l'exposition de l'image
   (`exposition` : brûlé, bouché, moyenne, contraste) et écrit `<vN>.png`, `.jpg`, `.json`, `.html`.
   Codes : 0 vert · 5 rendu écrit mais un point rouge · 3 Blender a échoué · 2 arguments.
   Mesuré sur ce poste (CPU) : **24 à 29 s** pour 1280×720 à 128 échantillons, scène de 10 objets.
   Le rendu par le MCP bloquerait le Blender interactif pendant tout ce temps : d'où l'arrière-plan.

## 5. Regarder (l'œil)
`look(image="<vN>.png", max_size=1024)`, lu avec la procédure look (VU LE · QUESTION · TEXTE LU · VERDICT),
sur cette grille, défaut le plus visible d'abord :
- **sujet** lisible au premier coup d'œil, net là où on regarde ;
- **objets crédibles** : chaque objet ressemble à ce qu'il est (un pavé uni n'est pas un livre) ;
- **lumière** : une direction claire, un côté éclairé et un côté ombré, une ombre au contact du sol ;
- **matériaux** : rugosités variées, pas de plastique uniforme, texture sans répétition ni étirement ;
- **arêtes** : un fin reflet sur les bords ;
- **composition** : sujet sur un tiers, horizon droit, rien de coupé par erreur ;
- **propreté** : ni grain, ni points blancs isolés, ni taches du débruitage.

## 6. Corriger, puis reboucler
UN défaut à la fois, retour en 3. Au plus 4 tours ; au-delà, dis ce qui reste.
| Symptôme vu | Correction |
|---|---|
| objet « en plastique », jouet | le décomposer en pièces réelles, couleurs plus sourdes (AgX désature), rugosité 0,7, bosse |
| image plate, sujet éclairé de face | lampe de zone à 45°, ou tourner l'HDRI (nœud `MAPPING` du monde, rotation Z) |
| objet qui flotte | le poser (`get_scene_info fields=["ground"]`) |
| brûlé (`ecretees` > 2 %) | `view_settings.exposure` −0,5 ou fond du monde moins fort |
| grain | 256 échantillons ou seuil adaptatif 0,01 |

## 7. Montrer dans le fil
`node scripts/html-render-apercu.mjs <vN>.html` (code 0 exigé), puis l'outil `montrer_bloc`
(`path` = la page `.html`). Ne recopie jamais le base64 dans ta réponse. Un PNG ouvert par `Read`
s'affiche replié, sans aperçu (`skills/draft/SKILL.md`, conv-184). Dans la réponse : le brief, ce que
chaque tour de boucle a corrigé (avant → après), le temps de rendu, le chemin du `.blend`.

## Pièges mesurés
- Le seuil des biseaux est 75°, pas 50° : le pied du vase Poly Haven `antique_ceramic_vase_01` porte
  96 arêtes à 59° et 71°, un ressaut voulu par son auteur (conv-1570).
- `look` en ombrage `rendered` ne marche qu'avec EEVEE et Workbench : avec Cycles, regarde le vrai rendu.
- Un nœud se trouve par son type (`n.type == 'BSDF_PRINCIPLED'`), jamais par son nom (traduit).
- Contrôle d'exposition calibré sur des scènes claires à moyennes : une ambiance nocturne voulue peut
  sortir rouge en `exposition` ; dis-le plutôt que de l'éclaircir contre l'intention.
