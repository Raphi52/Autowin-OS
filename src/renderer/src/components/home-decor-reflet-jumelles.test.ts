import { describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import { creerJumellesDuReflet } from './home-decor-reflet-jumelles'

/**
 * Les jumelles du reflet (voir home-decor-reflet-jumelles.ts) : un objet distinct pour three, qui lit
 * tout de l'original en direct. Mesure d'origine : 516 à 520 changements de programme et ~34 ms de
 * setProgram par image du fond avenue (2026-10-18), parce que les mêmes matières étaient dessinées
 * dans le reflet (sortie linéaire) puis à l'écran (sortie sRGB).
 */
const mesh = (m: THREE.Material | THREE.Material[]): THREE.Mesh =>
  new THREE.Mesh(new THREE.BoxGeometry(), m)

describe('les jumelles du reflet', () => {
  it('sont des matières DISTINCTES pour three (ses réglages internes sont indexés par la matière)', () => {
    const original = new THREE.MeshBasicMaterial()
    const scene = new THREE.Scene()
    const objet = mesh(original)
    scene.add(objet)
    const j = creerJumellesDuReflet()
    j.poser(scene)
    const jumelle = objet.material as THREE.MeshBasicMaterial
    expect(jumelle).not.toBe(original)
    const reglages = new WeakMap<object, string>([[original, 'sRGB']])
    expect(reglages.has(jumelle)).toBe(false)
    // même identifiant : l'ordre de tri de three ne change pas
    expect(jumelle.id).toBe(original.id)
  })

  it('LISENT L ORIGINAL EN DIRECT : couleur, opacité, uniformes, version', () => {
    const original = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.5 })
    const nuanceur = new THREE.ShaderMaterial({ uniforms: { uT: { value: 0 } } })
    const scene = new THREE.Scene()
    const a = mesh(original)
    const b = mesh(nuanceur)
    scene.add(a, b)
    const j = creerJumellesDuReflet()
    j.poser(scene)
    const ja = a.material as THREE.MeshBasicMaterial
    const jb = b.material as THREE.ShaderMaterial
    j.retirer()
    original.opacity = 0.15
    original.color.setRGB(1, 0, 0)
    nuanceur.uniforms.uT.value = 3
    const version = ja.version
    original.needsUpdate = true
    expect(ja.opacity).toBe(0.15)
    expect(ja.color.r).toBe(1)
    expect(jb.uniforms.uT.value).toBe(3)
    expect(ja.version).toBe(version + 1)
  })

  it('RETIRER rend à chaque objet sa matière, tableaux compris', () => {
    const m1 = new THREE.MeshBasicMaterial()
    const m2 = new THREE.MeshBasicMaterial()
    const tableau = [m1, m2]
    const scene = new THREE.Scene()
    const a = mesh(m1)
    const b = mesh(tableau)
    const s = new THREE.Sprite(new THREE.SpriteMaterial())
    const spriteMat = s.material
    scene.add(a, b, s)
    const j = creerJumellesDuReflet()
    j.poser(scene)
    expect((b.material as THREE.Material[])[0]).not.toBe(m1)
    // une même matière a UNE jumelle, où qu'elle soit portée
    expect((b.material as THREE.Material[])[0]).toBe(a.material)
    expect(s.material).not.toBe(spriteMat)
    j.retirer()
    expect(a.material).toBe(m1)
    expect(b.material).toBe(tableau)
    expect(s.material).toBe(spriteMat)
  })

  it('par défaut seuls les objets VISIBLES ; « tous » y ajoute les masqués (compile de three)', () => {
    const visible = mesh(new THREE.MeshBasicMaterial())
    const masque = mesh(new THREE.MeshBasicMaterial())
    masque.visible = false
    const origMasque = masque.material
    const scene = new THREE.Scene()
    scene.add(visible, masque)
    const j = creerJumellesDuReflet()
    j.poser(scene)
    expect(masque.material).toBe(origMasque)
    j.retirer()
    j.poser(scene, true)
    expect(masque.material).not.toBe(origMasque)
    j.retirer()
  })

  it('LIBÉRER la jumelle ne libère pas l original, et inversement', () => {
    const original = new THREE.MeshBasicMaterial()
    const scene = new THREE.Scene()
    const objet = mesh(original)
    scene.add(objet)
    // three s'abonne à la libération de CHAQUE matière qu'il prépare — l'original l'est déjà quand
    // sa jumelle naît : ses écouteurs existent, la jumelle ne doit pas écrire dedans
    const surOriginal = vi.fn()
    original.addEventListener('dispose', surOriginal)
    const j = creerJumellesDuReflet()
    j.poser(scene)
    const jumelle = objet.material as THREE.Material
    j.retirer()
    const surJumelle = vi.fn()
    jumelle.addEventListener('dispose', surJumelle)
    j.liberer()
    expect(surJumelle).toHaveBeenCalledTimes(1)
    expect(surOriginal).not.toHaveBeenCalled()
    original.dispose()
    expect(surOriginal).toHaveBeenCalledTimes(1)
    expect(surJumelle).toHaveBeenCalledTimes(1)
    expect([...j.matieres()]).toHaveLength(0)
  })
})
