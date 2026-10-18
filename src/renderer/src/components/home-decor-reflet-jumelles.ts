import * as THREE from 'three'

/**
 * LE REFLET DESSINE AVEC SES PROPRES MATIÈRES — des « jumelles » qui lisent l'original en direct.
 *
 * DÉFAUT MESURÉ (2026-10-18, conv-312 puis conv-323, instance cachée `--code-dev`) : chaque image du
 * fond avenue coûtait 40 à 42 ms au fil principal, dont environ 34 ms dans `setProgram` de three, et
 * le nombre de changements de programme (`useProgram`) était de 516 à 520 par image. Cause, dans
 * three r185 (WebGLRenderer.js:2342 et 2396) : hors réalité virtuelle, une image à part
 * (WebGLRenderTarget) est TOUJOURS dessinée dans l'espace de travail linéaire, et l'écran en sRGB.
 * Une matière dessinée dans le reflet PUIS à l'écran voit donc
 * `materialProperties.outputColorSpace !== colorSpace` deux fois par image : three recalcule ses
 * paramètres et rebascule de programme, matière par matière, deux fois par image.
 *
 * CORRECTIF : le reflet ne dessine plus les matières de l'écran, mais leurs JUMELLES. Une jumelle est
 * `Object.create(original)` : un objet DISTINCT pour three (ses réglages internes vivent dans un
 * WeakMap indexé par la matière, donc la jumelle garde à demeure son programme « linéaire » et
 * l'original son programme « sRGB »), mais qui LIT tout de l'original par son prototype — couleur,
 * opacité, uniformes, `version` (un `needsUpdate` posé sur l'original recompile aussi la jumelle).
 * Aucune copie à synchroniser : l'enseigne qui clignote clignote aussi dans l'eau, à la même image.
 * Les programmes eux-mêmes sont les MÊMES qu'avant (même clé de cache) : le rendu est identique.
 *
 * Pourquoi pas « dessiner l'écran dans une image linéaire puis une passe sRGB » (la voie
 * EffectComposer) : elle supprime aussi le basculement, mais tous les mélanges transparents (halos
 * additifs, pluie, fumées) se feraient en espace linéaire au lieu de l'espace de l'écran — l'aspect
 * de chaque lueur du décor aurait changé.
 */
export interface JumellesDuReflet {
  /**
   * Remplace, sur chaque objet dessinable de `racine`, la matière par sa jumelle. `tous` : y compris
   * les objets masqués (la compilation de three les parcourt tous) ; sinon les seuls objets visibles,
   * ceux qu'un rendu dessinera.
   */
  poser(racine: THREE.Object3D, tous?: boolean): void
  /** Rend à chaque objet la matière qu'il avait avant `poser`. */
  retirer(): void
  /** Les jumelles créées, pour finaliser leurs programmes en tâche de fond. */
  matieres(): Iterable<THREE.Material>
  /** Libère les programmes des jumelles (pas les originaux, libérés par la scène). */
  liberer(): void
}

type Dessinable = THREE.Object3D & { material?: THREE.Material | THREE.Material[] }

const estDessinable = (o: THREE.Object3D): o is Dessinable => {
  const d = o as THREE.Object3D & {
    isMesh?: boolean
    isPoints?: boolean
    isLine?: boolean
    isSprite?: boolean
  }
  return !!(d.isMesh || d.isPoints || d.isLine || d.isSprite)
}

export function creerJumellesDuReflet(): JumellesDuReflet {
  const jumelles = new Map<THREE.Material, THREE.Material>()
  const poses: { objet: Dessinable; matiere: THREE.Material | THREE.Material[] }[] = []

  const jumelle = (m: THREE.Material): THREE.Material => {
    let j = jumelles.get(m)
    if (!j) {
      j = Object.create(m) as THREE.Material
      // SES PROPRES ÉCOUTEURS : hérités, ceux de l'original recevraient ceux de three pour la
      // jumelle (`addEventListener` écrit dans `this._listeners` s'il existe déjà), et libérer la
      // jumelle libérerait l'original.
      ;(j as unknown as { _listeners?: unknown })._listeners = undefined
      jumelles.set(m, j)
    }
    return j
  }

  const poserSur = (objet: THREE.Object3D): void => {
    if (!estDessinable(objet)) return
    const matiere = objet.material
    if (!matiere) return
    poses.push({ objet, matiere })
    objet.material = Array.isArray(matiere) ? matiere.map(jumelle) : jumelle(matiere)
  }

  return {
    poser(racine, tous = false) {
      if (tous) racine.traverse(poserSur)
      else racine.traverseVisible(poserSur)
    },
    retirer() {
      for (let i = poses.length - 1; i >= 0; i--) poses[i].objet.material = poses[i].matiere
      poses.length = 0
    },
    matieres() {
      return jumelles.values()
    },
    liberer() {
      for (const j of jumelles.values()) j.dispose()
      jumelles.clear()
    }
  }
}
