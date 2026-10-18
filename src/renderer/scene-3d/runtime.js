/*
 * MOTEUR DES SCENES 3D DU FIL — point d'entree regroupe par esbuild en UN script classique.
 *
 * Il ne sert qu'a `page-scene-3d.mjs`, qui le pose EN LIGNE dans la page `scene-3d.html` : la page
 * vit dans un cadre isole, sans reseau, elle ne peut rien charger d'autre. Le code ecrit par le
 * modele trouve donc ses outils en variables globales, sans aucun `import` :
 *   - `THREE` : tout l'espace de noms de three.js, plus `THREE.OrbitControls` ;
 *   - `OrbitControls` : la meme classe, pour le code ecrit a la mode des exemples recents.
 *
 * La version est celle du paquet `three` installe : l'app et le fil dessinent avec le meme moteur
 * que le decor de l'Accueil (`home-decor-scene.ts`).
 */
import * as THREE_MODULE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'

const THREE = Object.assign({}, THREE_MODULE, { OrbitControls })

globalThis.THREE = THREE
globalThis.OrbitControls = OrbitControls
