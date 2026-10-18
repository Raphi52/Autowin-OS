import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { adapterNuanceurDeSprite, COUCHE_PORTEURS, regrouperHalos } from './home-decor-lots-halos'

/**
 * Les halos du fond avenue dessinés par lots (home-decor-lots-halos.ts, conv-323). Mesure qui le
 * motive : 424 halos additifs dessinés un par un, à chaque passe, sur ~1 900 dessins par image.
 * Ces tests tiennent les conditions du « rendu inchangé » que le module énonce.
 */
const GLOW = new THREE.Texture()
const FUMEE = new THREE.Texture()
const halo = (x: number, z: number, taille = 1, couleur = 0xff8040): THREE.Sprite => {
  const s = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: GLOW,
      color: couleur,
      opacity: 0.7,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    })
  )
  s.position.set(x, 1, z)
  s.scale.set(taille, taille, 1)
  return s
}
const fumee = (x: number, z: number, taille = 1): THREE.Sprite => {
  const s = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: FUMEE, transparent: true, opacity: 0.32, depthWrite: false })
  )
  s.position.set(x, 1, z)
  s.scale.set(taille, taille, 1)
  return s
}
const camera = (): THREE.PerspectiveCamera => {
  const c = new THREE.PerspectiveCamera(58, 1.6, 0.1, 6000)
  c.position.set(0, 1, 10)
  c.lookAt(0, 1, -10)
  c.updateMatrixWorld()
  return c
}
/** Une passe de rendu, comme three la commence : matrices à jour, puis `scene.onBeforeRender`. */
const passe = (scene: THREE.Scene, cam: THREE.Camera): void => {
  scene.updateMatrixWorld()
  scene.onBeforeRender(null as unknown as THREE.WebGLRenderer, scene, cam, null)
}
const lotsActifs = (scene: THREE.Scene): THREE.Mesh[] =>
  scene.children.filter(
    (o): o is THREE.Mesh => o.name === 'lot-halos' && (o as THREE.Mesh).layers.mask === 1
  )
const donnees = (m: THREE.Mesh): Float32Array =>
  (m.geometry.getAttribute('aCentre') as THREE.InterleavedBufferAttribute).data
    .array as Float32Array

describe('les halos du fond avenue dessinés par lots', () => {
  it('ne regroupe QUE les halos additifs sans profondeur, et ne les dessine plus un par un', () => {
    const scene = new THREE.Scene()
    const a = halo(0, -5)
    const b = halo(2, -8)
    // à l'écart : elle ne recouvre aucun halo, donc ne coupe pas le lot
    const f = fumee(-8, -6)
    scene.add(a, b, f)
    const lots = regrouperHalos(scene)
    expect(lots.halos).toBe(2)
    expect(a.layers.mask).toBe((1 << COUCHE_PORTEURS) >>> 0)
    expect(b.layers.mask).toBe((1 << COUCHE_PORTEURS) >>> 0)
    // la fumée (mélange normal) reste un sprite que three dessine
    expect(f.layers.mask).toBe(1)
    passe(scene, camera())
    expect(lots.dernierePasse()).toEqual({ lots: 1, halos: 2 })
  })

  it('UNE sorte par texture et réglages : deux textures, deux dessins', () => {
    const scene = new THREE.Scene()
    const autre = halo(0, -6)
    autre.material.map = FUMEE
    scene.add(halo(0, -5), halo(1, -7), autre)
    const lots = regrouperHalos(scene)
    expect(lots.sortes).toBe(2)
    passe(scene, camera())
    expect(lots.dernierePasse().lots).toBe(2)
  })

  it('LE NUANCEUR REÇOIT CE QUE THREE ENVOIE : centre vu de la caméra, axes, pivot, rotation, teinte', () => {
    const scene = new THREE.Scene()
    const parent = new THREE.Group()
    parent.position.set(0.3, -0.2, -3)
    parent.rotation.y = 0.4
    const a = halo(0.5, -4, 2.5, 0x3366ff)
    a.scale.set(2.5, 0.8, 1)
    a.center.set(0.5, 0)
    a.material.rotation = 1.2
    a.material.opacity = 0.42
    parent.add(a)
    scene.add(parent)
    regrouperHalos(scene)
    const cam = camera()
    passe(scene, cam)
    const [lot] = lotsActifs(scene)
    const d = donnees(lot)
    // exactement le calcul de three (renderObject) avant l'envoi en float32
    const mv = new THREE.Matrix4().multiplyMatrices(cam.matrixWorldInverse, a.matrixWorld)
    const e = a.matrixWorld.elements
    const f32 = (x: number): number => Math.fround(x)
    expect([...d.slice(0, 3)]).toEqual([mv.elements[12], mv.elements[13], mv.elements[14]].map(f32))
    expect([...d.slice(3, 9)]).toEqual([e[0], e[1], e[2], e[4], e[5], e[6]].map(f32))
    expect([...d.slice(9, 12)]).toEqual([0.5, 0, f32(1.2)])
    const c = a.material.color
    expect([...d.slice(12, 16)]).toEqual([c.r, c.g, c.b, 0.42].map(f32))
  })

  it('LIT LES VALEURS VIVANTES à chaque passe : opacité, couleur, visibilité du parent', () => {
    const scene = new THREE.Scene()
    const parent = new THREE.Group()
    // le plus lointain : le premier du lot
    const a = halo(0, -9)
    parent.add(a)
    scene.add(parent, halo(1, -6))
    const lots = regrouperHalos(scene)
    const cam = camera()
    a.material.opacity = 0.11
    passe(scene, cam)
    expect(lots.dernierePasse().halos).toBe(2)
    expect(Math.fround(0.11)).toBe(donnees(lotsActifs(scene)[0])[15])
    parent.visible = false
    passe(scene, cam)
    expect(lots.dernierePasse().halos).toBe(1)
    // décroché de la scène : plus dessiné
    parent.visible = true
    a.removeFromParent()
    passe(scene, cam)
    expect(lots.dernierePasse().halos).toBe(1)
  })

  it('L ORDRE DES HALOS DANS LE LOT EST CELUI DE THREE : du plus loin au plus proche', () => {
    const scene = new THREE.Scene()
    const pres = halo(0, -2)
    const loin = halo(0.2, -30)
    const milieu = halo(-0.2, -10)
    scene.add(pres, loin, milieu)
    regrouperHalos(scene)
    const cam = camera()
    passe(scene, cam)
    const [lot] = lotsActifs(scene)
    const d = donnees(lot)
    // le z vu de la caméra des trois instances, dans l'ordre du tampon
    expect([d[2], d[18], d[34]].map((z) => Math.round(z))).toEqual([-40, -20, -12])
    // three trie le lot à la place de son DERNIER halo (le plus proche)
    expect(lot.geometry.boundingSphere?.center.toArray()).toEqual([0, 1, -2])
  })

  it('UNE BARRIÈRE QUI RECOUVRE un halo coupe le lot : ce halo reste dessiné AVANT elle', () => {
    const scene = new THREE.Scene()
    const derriere = halo(0, -20, 2)
    const devant = halo(0.1, -2, 0.3)
    const voile = fumee(0, -8, 4)
    scene.add(derriere, devant, voile)
    const lots = regrouperHalos(scene)
    passe(scene, camera())
    expect(lots.dernierePasse().lots).toBe(2)
    const [l1, l2] = lotsActifs(scene)
    // chaque lot se place du bon côté du voile dans le tri des transparents de three (z décroissant)
    const ps = new THREE.Matrix4().multiplyMatrices(
      camera().projectionMatrix,
      camera().matrixWorldInverse
    )
    const zDe = (v: THREE.Vector3): number => new THREE.Vector4(v.x, v.y, v.z, 1).applyMatrix4(ps).z
    const zVoile = zDe(voile.position)
    const zLots = [l1, l2].map((l) => zDe(l.geometry.boundingSphere?.center as THREE.Vector3))
    expect(zLots.filter((z) => z > zVoile)).toHaveLength(1)
    expect(zLots.filter((z) => z < zVoile)).toHaveLength(1)
  })

  it('UNE BARRIÈRE QUI NE RECOUVRE AUCUN halo ne coupe rien : l ordre ne change aucun pixel', () => {
    const scene = new THREE.Scene()
    scene.add(halo(-6, -20, 1), halo(-6, -2, 0.3), fumee(6, -8, 1))
    const lots = regrouperHalos(scene)
    passe(scene, camera())
    expect(lots.dernierePasse()).toEqual({ lots: 1, halos: 2 })
  })

  it('un transparent ADDITIF qui recouvre un halo coupe aussi le lot (mesuré : sinon 0,3 à 0,9 % des pixels changent)', () => {
    const scene = new THREE.Scene()
    const voile = new THREE.Mesh(
      new THREE.PlaneGeometry(4, 4),
      new THREE.ShaderMaterial({
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      })
    )
    voile.position.set(0, 1, -8)
    scene.add(halo(0, -20, 2), halo(0.1, -2, 0.3), voile)
    const lots = regrouperHalos(scene)
    passe(scene, camera())
    expect(lots.dernierePasse().lots).toBe(2)
  })

  it('une barrière MASQUÉE à cette passe (la foule pendant le reflet) ne coupe rien', () => {
    const scene = new THREE.Scene()
    const voile = fumee(0, -8, 4)
    scene.add(halo(0, -20, 2), halo(0.1, -2, 0.3), voile)
    const lots = regrouperHalos(scene)
    voile.visible = false
    passe(scene, camera())
    expect(lots.dernierePasse().lots).toBe(1)
  })

  it('une barrière ARRIVÉE APRÈS (la foule) compte dès que les barrières sont relues', () => {
    const scene = new THREE.Scene()
    scene.add(halo(0, -20, 2), halo(0.1, -2, 0.3))
    const lots = regrouperHalos(scene)
    scene.add(fumee(0, -8, 4))
    passe(scene, camera())
    expect(lots.dernierePasse().lots).toBe(1)
    lots.relireBarrieres()
    passe(scene, camera())
    expect(lots.dernierePasse().lots).toBe(2)
  })

  it('un halo HORS DE L IMAGE n est pas envoyé : il ne colorerait aucun pixel', () => {
    const scene = new THREE.Scene()
    scene.add(halo(0, -5), halo(500, -5, 1))
    const lots = regrouperHalos(scene)
    passe(scene, camera())
    expect(lots.dernierePasse().halos).toBe(1)
  })

  it('une matière remplacée après coup : le halo redevient un sprite que three dessine', () => {
    const scene = new THREE.Scene()
    const a = halo(0, -5)
    scene.add(a, halo(1, -5))
    const lots = regrouperHalos(scene)
    a.material = a.material.clone()
    passe(scene, camera())
    expect(a.layers.mask).toBe(1)
    expect(lots.dernierePasse().halos).toBe(1)
  })

  it('la JUMELLE du reflet n est pas un changement de matière : le halo reste dans le lot', () => {
    // Pris pour un changement, le passage de la jumelle remettait les 424 sprites en dessin EN PLUS
    // des lots : 2 026 dessins au lieu de 1 970 (banc de l'Accueil, 2026-10-18).
    const scene = new THREE.Scene()
    const a = halo(0, -5)
    scene.add(a, halo(1, -5))
    const lots = regrouperHalos(scene)
    const original = a.material
    a.material = Object.create(original) as THREE.SpriteMaterial
    passe(scene, camera())
    a.material = original
    expect(a.layers.mask).toBe((1 << COUCHE_PORTEURS) >>> 0)
    expect(lots.dernierePasse().halos).toBe(2)
  })

  it('UNE FOIS PAR IMAGE : les passes (reflet, écran) rendent exactement ce que rendait chaque passe seule', () => {
    const construire = (): { scene: THREE.Scene; a: THREE.Sprite } => {
      const scene = new THREE.Scene()
      const parent = new THREE.Group()
      parent.position.set(0.4, 0.1, -2)
      parent.rotation.y = 0.3
      const a = halo(0.2, -6, 1.5, 0x33aaff)
      a.material.rotation = 0.7
      a.center.set(0.5, 0)
      parent.add(a)
      scene.add(parent, halo(-1, -12, 3), halo(1.5, -3, 0.4), fumee(0, -8, 2))
      return { scene, a }
    }
    const miroir = camera()
    miroir.position.set(0, -1, 10)
    miroir.updateMatrixWorld()
    // mode sûr : chaque passe relit tout
    const r1 = construire()
    regrouperHalos(r1.scene)
    const sansAnnonce: number[][] = []
    for (const cam of [miroir, camera()]) {
      passe(r1.scene, cam)
      sansAnnonce.push(...lotsActifs(r1.scene).map((l) => [...donnees(l)]))
    }
    // mode par image : une lecture, deux passes
    const r2 = construire()
    const lots = regrouperHalos(r2.scene)
    r2.scene.updateMatrixWorld()
    lots.nouvelleImage()
    const avecAnnonce: number[][] = []
    for (const cam of [miroir, camera()]) {
      passe(r2.scene, cam)
      avecAnnonce.push(...lotsActifs(r2.scene).map((l) => [...donnees(l)]))
    }
    expect(avecAnnonce).toEqual(sansAnnonce)
  })

  it('les valeurs sont celles LUES À L ANNONCE de l image : la suivante prend les nouvelles', () => {
    const scene = new THREE.Scene()
    const a = halo(0, -5)
    scene.add(a)
    const lots = regrouperHalos(scene)
    scene.updateMatrixWorld()
    lots.nouvelleImage()
    a.material.opacity = 0.2
    passe(scene, camera())
    expect(donnees(lotsActifs(scene)[0])[15]).toBe(Math.fround(0.7))
    lots.nouvelleImage()
    passe(scene, camera())
    expect(donnees(lotsActifs(scene)[0])[15]).toBe(Math.fround(0.2))
  })

  it('une barrière masquée LE TEMPS D UNE PASSE reste comptée : une coupe en trop, jamais un pixel', () => {
    const scene = new THREE.Scene()
    const voile = fumee(0, -8, 4)
    scene.add(halo(0, -20, 2), halo(0.1, -2, 0.3), voile)
    const lots = regrouperHalos(scene)
    scene.updateMatrixWorld()
    lots.nouvelleImage()
    voile.visible = false
    passe(scene, camera())
    // prudence assumée : le lot est coupé comme si le voile était là
    expect(lots.dernierePasse().lots).toBe(2)
  })

  it('LIBÉRER rend la scène d origine : sprites redessinés, lots retirés', () => {
    const scene = new THREE.Scene()
    const a = halo(0, -5)
    scene.add(a)
    const avant = scene.onBeforeRender
    const lots = regrouperHalos(scene)
    lots.liberer()
    expect(a.layers.mask).toBe(1)
    expect(scene.children.filter((o) => o.name === 'lot-halos')).toHaveLength(0)
    expect(scene.onBeforeRender).toBe(avant)
  })
})

describe('le nuanceur du lot est celui de three, entrées changées', () => {
  it('reprend le nuanceur « sprite » de three et n en change que les entrées', () => {
    const shader = {
      vertexShader: THREE.ShaderLib.sprite.vertexShader,
      fragmentShader: THREE.ShaderLib.sprite.fragmentShader
    }
    adapterNuanceurDeSprite(shader)
    expect(shader.vertexShader).toContain('vec4 mvPosition = vec4( aCentre, 1.0 );')
    expect(shader.vertexShader).toContain('vec2 scale = vec2( length( aAxeX ), length( aAxeY ) );')
    expect(shader.vertexShader).not.toMatch(
      /modelViewMatrix\[ 3 \]|modelMatrix\[|cos\( rotation \)/
    )
    expect(shader.fragmentShader).toContain('vec4 diffuseColor = vTeinte;')
    // le reste du nuanceur de three est intact : carte, brouillard, sortie de couleur
    for (const morceau of [
      '#include <map_fragment>',
      '#include <colorspace_fragment>',
      '#include <fog_fragment>'
    ])
      expect(shader.fragmentShader).toContain(morceau)
    expect(shader.vertexShader).toContain('gl_Position = projectionMatrix * mvPosition;')
  })

  it('refuse un nuanceur de three qui aurait changé, au lieu de dessiner autre chose en silence', () => {
    expect(() =>
      adapterNuanceurDeSprite({ vertexShader: 'void main(){}', fragmentShader: 'void main(){}' })
    ).toThrow(/introuvable dans le nuanceur/)
  })
})
