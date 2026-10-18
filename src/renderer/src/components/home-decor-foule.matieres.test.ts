import { readFileSync } from 'node:fs'
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { remplacerMatieres } from './home-decor-foule'

/**
 * CE QUE L'UTILISATEUR A DEMANDÉ, conv-312 : « Partage les matières de la foule par matière d'origine
 * du modèle (environ 140 → 50) dans home-decor-foule.ts ».
 *
 * Le chargeur glTF découpe une matière d'origine en plusieurs morceaux de maillage : 157 morceaux de
 * corps pour 40 matières d'origine dans la foule (compté sur le banc le 2026-10-18). Une matière neuve
 * par morceau en faisait 140, que three prépare chacune à sa première image.
 *
 * ENTRÉES QUI DOIVENT FAIRE ÉCHOUER CE FICHIER :
 *   1. une matière neuve par morceau → deux morceaux d'une même matière d'origine n'en partagent pas ;
 *   2. deux matières d'origine fondues en une → la peau prend la texture des vêtements ;
 *   3. une matière d'origine libérée deux fois, ou pas du tout.
 */
describe('foule de l Accueil — une matière par matière d origine', () => {
  it('les morceaux d une même matière d origine partagent la même matière neuve', () => {
    const corps = new THREE.MeshStandardMaterial({ name: 'm001_body' })
    const tete = new THREE.MeshStandardMaterial({ name: 'm001_head' })
    const liberees: string[] = []
    corps.addEventListener('dispose', () => liberees.push('corps'))
    tete.addEventListener('dispose', () => liberees.push('tete'))
    const modele = new THREE.Group()
    const morceaux = [corps, tete, corps, tete, corps].map((m) => {
      const mesh = new THREE.Mesh(new THREE.BufferGeometry(), m)
      modele.add(mesh)
      return mesh
    })
    const fabriquees: string[] = []
    const n = remplacerMatieres(modele, (mesh) => {
      const origine = mesh.material as THREE.Material
      fabriquees.push(origine.name)
      return new THREE.MeshBasicMaterial({ name: `neuve-${origine.name}` })
    })
    expect(n).toBe(2)
    expect(fabriquees.sort()).toEqual(['m001_body', 'm001_head'])
    const [c1, t1, c2, t2, c3] = morceaux.map((m) => m.material as THREE.Material)
    expect(c1.name).toBe('neuve-m001_body')
    expect(t1.name).toBe('neuve-m001_head')
    expect(c2).toBe(c1)
    expect(c3).toBe(c1)
    expect(t2).toBe(t1)
    expect(c1).not.toBe(t1)
    // chaque matière d'origine est libérée une fois, après le remplacement
    expect(liberees.sort()).toEqual(['corps', 'tete'])
  })

  it('le chargement de la foule passe par ce partage', () => {
    const foule = readFileSync(new URL('./home-decor-foule.ts', import.meta.url), 'utf8')
    expect(foule).toMatch(
      /remplacerMatieres\(modele, \(mesh\) => matiere\(mesh, textures, tribu\)\)/
    )
    expect(foule.match(/matiere\(mesh, textures, tribu\)/g)).toHaveLength(1)
  })
})
