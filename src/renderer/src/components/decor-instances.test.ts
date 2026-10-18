import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { regrouperEnInstances } from './decor-instances'

/**
 * LES OBJETS FIXES IDENTIQUES EN UN SEUL DESSIN (conv-337). Ce qui doit faire échouer ce fichier :
 * une instance qui ne reprend pas EXACTEMENT la position, l'orientation et l'échelle de son objet
 * d'origine (le décor bougerait) ; un transparent ou un objet relu ailleurs (nommé, `userData`,
 * enfants) avalé par un lot (son ordre de dessin ou son animation seraient perdus).
 */
const monter = (): {
  parent: THREE.Group
  geo: THREE.BoxGeometry
  mat: THREE.MeshStandardMaterial
  originaux: THREE.Mesh[]
} => {
  const parent = new THREE.Group()
  const geo = new THREE.BoxGeometry(1, 1, 1)
  const mat = new THREE.MeshStandardMaterial({ color: 0x5c4630 })
  const originaux = [0, 1, 2].map((i) => {
    const m = new THREE.Mesh(geo, mat)
    m.position.set(i * 2, 0.3 * i, -i)
    m.rotation.set(0.1 * i, 2 * i, -0.2)
    m.scale.set(0.4 + i * 0.1, 0.05 + i, 0.7)
    parent.add(m)
    return m
  })
  return { parent, geo, mat, originaux }
}

describe('regrouperEnInstances', () => {
  it('trois boîtes fixes identiques deviennent UN dessin, chaque instance à la place exacte de son objet', () => {
    const { parent, geo, mat, originaux } = monter()
    const attendues = originaux.map((m) => {
      m.updateMatrix()
      return m.matrix.clone()
    })
    expect(regrouperEnInstances(parent, [geo])).toBe(3)
    expect(parent.children).toHaveLength(1)
    const lot = parent.children[0] as THREE.InstancedMesh
    expect(lot.isInstancedMesh).toBe(true)
    expect(lot.geometry).toBe(geo)
    expect(lot.material).toBe(mat)
    expect(lot.count).toBe(3)
    // la carte graphique reçoit des flottants 32 bits, pour une instance comme pour la matrice
    // d'un objet seul : c'est cette valeur-là qui doit être identique
    const lue = new THREE.Matrix4()
    attendues.forEach((m, i) => {
      lot.getMatrixAt(i, lue)
      expect(lue.elements).toEqual(m.elements.map((x) => Math.fround(x)))
    })
  })

  it('ne prend ni un transparent, ni un objet nommé, relu (userData) ou parent, ni une autre géométrie', () => {
    const { parent, geo, mat } = monter()
    const verre = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ transparent: true }))
    const verre2 = new THREE.Mesh(geo, verre.material)
    const nomme = new THREE.Mesh(geo, mat)
    nomme.name = 'enseigne'
    const lu = new THREE.Mesh(geo, mat)
    lu.userData.pendu = 3
    const pere = new THREE.Mesh(geo, mat)
    pere.add(new THREE.Object3D())
    const autre = new THREE.Mesh(new THREE.SphereGeometry(), mat)
    const autre2 = new THREE.Mesh(autre.geometry, mat)
    parent.add(verre, verre2, nomme, lu, pere, autre, autre2)
    expect(regrouperEnInstances(parent, [geo])).toBe(3)
    for (const o of [verre, verre2, nomme, lu, pere, autre, autre2]) expect(o.parent).toBe(parent)
  })

  it('un objet seul reste tel quel : un lot d une seule instance ne gagne rien', () => {
    const parent = new THREE.Group()
    const geo = new THREE.BoxGeometry()
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial())
    parent.add(m)
    expect(regrouperEnInstances(parent, [geo])).toBe(0)
    expect(parent.children).toEqual([m])
  })

  it('un lot cloné (copie de travée) garde ses instances', () => {
    const { parent, geo } = monter()
    regrouperEnInstances(parent, [geo])
    const copie = parent.clone()
    const a = parent.children[0] as THREE.InstancedMesh
    const b = copie.children[0] as THREE.InstancedMesh
    expect(b.isInstancedMesh).toBe(true)
    expect(b.count).toBe(3)
    expect(Array.from(b.instanceMatrix.array)).toEqual(Array.from(a.instanceMatrix.array))
  })
})
