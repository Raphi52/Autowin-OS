import * as THREE from 'three'

/**
 * LES OBJETS FIXES IDENTIQUES, DESSINÉS EN UN SEUL APPEL (conv-337, 2026-10-19).
 *
 * MESURE QUI LE MOTIVE (banc de rendu, relevé dessin par dessin) : three paie PAR DESSIN, pas par
 * triangle. Dans chaque travée de la toile électrique, les sacs-poubelle, les cartons et les poteaux
 * sont des maillages séparés qui partagent la même géométrie et la même matière : 107 dessins à
 * l'écran pour trois copies de travée visibles, autant dans le reflet.
 *
 * CE QUE FAIT `regrouperEnInstances` : parmi les ENFANTS DIRECTS de `parent`, chaque groupe d'au
 * moins deux maillages qui partagent une géométrie de `geometries` et une matière OPAQUE devient un
 * seul `InstancedMesh`, chaque instance gardant la matrice locale de son maillage d'origine.
 *
 * POURQUOI LE RENDU NE CHANGE PAS : même géométrie, même matière, mêmes matrices ; three applique
 * `instanceMatrix` dans le nuanceur à la place de la matrice de l'objet (positions ET normales).
 * L'ordre ne compte pas pour un opaque : le test de profondeur décide. Seuls les opaques sont pris :
 * un transparent dépend de l'ordre de dessin, que l'instance ne garde pas.
 *
 * CE QUI N'EST JAMAIS PRIS (il pourrait bouger ou être relu ailleurs) : un maillage nommé, qui porte
 * des `userData`, qui a des enfants, ou qui n'est pas un enfant direct de `parent` (un poteau pendu à
 * un pivot animé reste tel quel). L'appelant ne passe que des objets qu'il ne déplace jamais.
 *
 * Rend le nombre de maillages remplacés.
 */
export function regrouperEnInstances(
  parent: THREE.Object3D,
  geometries: Iterable<THREE.BufferGeometry>
): number {
  const prises = new Set(geometries)
  const groupes = new Map<string, THREE.Mesh[]>()
  for (const o of parent.children) {
    const m = o as THREE.Mesh
    if (!m.isMesh || (m as THREE.InstancedMesh).isInstancedMesh) continue
    if ((m as THREE.SkinnedMesh).isSkinnedMesh) continue
    if (!prises.has(m.geometry) || Array.isArray(m.material) || m.material.transparent) continue
    if (m.name || m.children.length > 0 || Object.keys(m.userData).length > 0) continue
    const cle = `${m.geometry.uuid}:${m.material.uuid}`
    const liste = groupes.get(cle) ?? []
    liste.push(m)
    groupes.set(cle, liste)
  }
  let remplaces = 0
  for (const liste of groupes.values()) {
    if (liste.length < 2) continue
    const [premier] = liste
    const lot = new THREE.InstancedMesh(
      premier.geometry,
      premier.material as THREE.Material,
      liste.length
    )
    liste.forEach((m, i) => {
      m.updateMatrix()
      lot.setMatrixAt(i, m.matrix)
      parent.remove(m)
    })
    lot.instanceMatrix.needsUpdate = true
    lot.computeBoundingSphere()
    lot.computeBoundingBox()
    parent.add(lot)
    remplaces += liste.length
  }
  return remplaces
}
