import { readFileSync } from 'node:fs'
import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'
import { VIADUC } from './home-decor-avenue'
import {
  abscisseRame,
  FACES_PRISMES,
  FONDU_REFLET_MS,
  monterSpirale,
  REFLET_UNE_IMAGE_SUR,
  SPIRALE,
  voieHelice,
  type ContexteSpirale,
  type EnseigneDeSpirale
} from './home-decor-avenue-spirale'

/**
 * LA SPIRALE DANS LE FOND DE L'ACCUEIL (conv-310).
 *
 * Demande de l'utilisateur, au bout du /draft « des moyens de rendre le fond d'écran de l'acceuil
 * magnifique effet waouh maximum » : « implémente spirale », la variante 4 · Spirale du brouillon
 * (rue inondée, tour de contrôle, rame en hélice, essaim AUTOWIN → ✓, enseignes en prismes).
 *
 * ENTRÉES QUI DOIVENT FAIRE ÉCHOUER CE FICHIER :
 *   1. une lumière ponctuelle ajoutée → toutes les matières de la rue s'alourdissent (conv-301) ;
 *   2. les prismes ou la marquise posés dans la scène et non dans le décor → ils ne défilent pas ;
 *   3. le reflet dessiné sans masquer les plans d'eau, ou sans rendre la foule à la fin du reflet ;
 *   4. la version « reflet » des nuanceurs non précompilée → elle se compile à la première image et
 *      fige l'Accueil, comme le gel de 3 s corrigé en conv-301 ;
 *   5. les réglages de la variante 4 changés → ce n'est plus ce que l'utilisateur a choisi ;
 *   6. la spirale non branchée dans l'avenue, ou branchée APRÈS la compilation de la rue.
 */

const faux2d = (): CanvasRenderingContext2D => {
  const degrade = { addColorStop: (): void => {} }
  return new Proxy(
    {},
    {
      get: (_c, cle) => {
        if (cle === 'createRadialGradient' || cle === 'createLinearGradient') return () => degrade
        if (cle === 'measureText') return () => ({ width: 10 })
        // l'emprise réelle des lettres « AUTOWIN » (bold 120px Bahnschrift sur 644 × 140, mesurée
        // dans l'app le 2026-10-17) : colonnes 70 à 565, lignes 23 à 109, pleines. Un dessin plein
        // sur toute la toile ferait monter l'essaim plus haut qu'à l'écran.
        if (cle === 'getImageData')
          return (_x: number, _y: number, w: number, h: number) => {
            const data = new Uint8ClampedArray(w * h * 4)
            for (let y = 23; y <= Math.min(109, h - 1); y++)
              for (let x = Math.round((70 * w) / 644); x <= Math.round((565 * w) / 644); x++)
                data.fill(255, (y * w + x) * 4, (y * w + x) * 4 + 4)
            return { data }
          }
        return () => {}
      },
      set: () => true
    }
  ) as unknown as CanvasRenderingContext2D
}

interface FauxRendu {
  cible: THREE.WebGLRenderTarget | null
  rendus: {
    cible: THREE.WebGLRenderTarget | null
    camera: THREE.Camera
    visibles: Map<THREE.Object3D, boolean>
    /** La matière que portait chaque enseigne et chaque prisme pendant ce rendu. */
    matieres: Map<THREE.Object3D, THREE.Material | THREE.Material[]>
  }[]
}

function monter(): {
  ctx: ContexteSpirale
  rendu: FauxRendu
  spirale: ReturnType<typeof monterSpirale>
  enseignes: EnseigneDeSpirale[]
  foule: THREE.Group
} {
  const scene = new THREE.Scene()
  const decor = new THREE.Group()
  scene.add(decor)
  const foule = new THREE.Group()
  scene.add(foule)
  const rendu: FauxRendu = { cible: null, rendus: [] }
  let spirale: ReturnType<typeof monterSpirale> | null = null
  const renderer = {
    getRenderTarget: () => rendu.cible,
    setRenderTarget: (c: THREE.WebGLRenderTarget | null) => {
      rendu.cible = c
    },
    getDrawingBufferSize: (v: THREE.Vector2) => v.set(800, 400),
    render: (_s: THREE.Scene, camera: THREE.Camera) => {
      const visibles = new Map<THREE.Object3D, boolean>()
      for (const o of [foule, ...(spirale?.miroirs ?? []), ...(spirale?.sansReflet ?? [])])
        visibles.set(o, o.visible)
      const matieres = new Map<THREE.Object3D, THREE.Material | THREE.Material[]>()
      for (const o of [...enseignes.map((e) => e.box), ...(spirale?.prismes ?? [])])
        matieres.set(o, o.material as THREE.Material | THREE.Material[])
      rendu.rendus.push({ cible: rendu.cible, camera, visibles, matieres })
    }
  } as unknown as THREE.WebGLRenderer
  const camera = new THREE.PerspectiveCamera(58, 2, 0.1, 6000)
  camera.position.set(-5.55, 1.75, 10)
  camera.lookAt(-2.2, 1.45, -14)
  const enseignes: EnseigneDeSpirale[] = []
  for (let rep = 0; rep < 4; rep++)
    [0, 1, 2, 3].forEach((i) => {
      const box = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 3.2), new THREE.MeshBasicMaterial())
      box.position.set(6.95, 6, -130 + rep * 35 + 4 + i * 8.6)
      decor.add(box)
      enseignes.push({ box, i })
    })
  const ctx: ContexteSpirale = {
    scene,
    decor,
    renderer,
    camera,
    P: 35,
    Z0: -130,
    copies: 4,
    FACADE: 7.5,
    ROUTE: 4,
    GARDE: -7.2,
    TROTTOIR: 0.15,
    SOL: -95,
    uT: { value: 0 },
    GLOW: new THREE.Texture(),
    toile: (w, h) => [{ width: w, height: h } as HTMLCanvasElement, faux2d()],
    tex: (c) => new THREE.CanvasTexture(c),
    enseignes,
    motifs: ['BAR', 'HOTEL', 'RAMEN', '24H'].map((mot, i) => ({
      mot,
      couleur: ['#ff2fa0', '#2ee8ff', '#8fa8ff', '#e63ca0'][i],
      texture: new THREE.Texture()
    }))
  }
  spirale = monterSpirale(ctx)
  return { ctx, rendu, spirale, enseignes, foule }
}

describe('la Spirale — fond de l Accueil (conv-310)', () => {
  it('garde les réglages de la variante 4 choisie', () => {
    expect(SPIRALE.tour).toEqual({ x: -95, z: -230, hauteur: 170, largeur: 20 })
    expect(SPIRALE.anneaux).toBe(3)
    expect(SPIRALE.rame).toEqual({ voitures: 7, vitesse: 70, marge: 300, depart: 260 })
    expect([...SPIRALE.portiques]).toEqual([0.2, 0.32, 0.44, 0.56, 0.68])
    expect(SPIRALE.essaim.drones).toBe(700)
    expect([...SPIRALE.essaim.formes]).toEqual(['autowin', 'check'])
    expect(SPIRALE.trafic).toEqual({ densite: 0.5, vitesse: 0.7 })
    expect(SPIRALE.periodePrismes).toBe(3)
    expect(FACES_PRISMES.BAR).toEqual({ autre: 'BEER', kata: 'バー' })
  })

  it('N AJOUTE AUCUNE LUMIÈRE : l éclat est porté par des halos et des matières qui émettent', () => {
    const { ctx } = monter()
    let lumieres = 0
    ctx.scene.traverse((o) => {
      if ((o as THREE.Light).isLight) lumieres++
    })
    expect(lumieres).toBe(0)
  })

  it('L ESSAIM PASSE SOUS L EN-TÊTE « AUTOWIN ACCUEIL », transitions comprises', () => {
    // Fenêtre de l'utilisateur : 1745 × 938 px CSS ; le bas de l'en-tête de l'Accueil est à 88 px
    // (mesuré le 2026-10-17 sur son app et sur l'instance cachée qui la reproduit, conv-310). Le ✓
    // montait à 88 px : il touchait l'en-tête. On exige 20 px d'air sur un cycle entier de l'essaim.
    const { spirale, ctx } = monter()
    const vue = new THREE.PerspectiveCamera(58, 1745 / 938, 0.1, 6000)
    vue.position.set(-5.55, 1.75, 10)
    vue.lookAt(-2.2, 1.45, -14)
    vue.updateMatrixWorld()
    let vol: THREE.Points | null = null
    ctx.scene.traverse((o) => {
      if (o.name === 'essaim')
        vol = o.children.find((c) => (c as THREE.Points).isPoints) as THREE.Points
    })
    expect(vol).not.toBeNull()
    const points = vol as unknown as THREE.Points
    const p = new THREE.Vector3()
    let plusHaut = Infinity
    const cycle = SPIRALE.essaim.durees.reduce((a, b) => a + b, 0)
    for (let t = 0; t <= cycle; t += 0.05) {
      spirale.animer(t, 0)
      ctx.scene.updateMatrixWorld(true)
      const pos = points.geometry.getAttribute('position')
      for (let i = 0; i < pos.count; i++) {
        p.fromBufferAttribute(pos, i).applyMatrix4(points.matrixWorld).project(vue)
        plusHaut = Math.min(plusHaut, ((1 - p.y) / 2) * 938)
      }
    }
    expect(plusHaut).toBeGreaterThanOrEqual(88 + 20)
  })

  it('LE RAIL S ENROULE AUTOUR DE LA TOUR : un tour et demi, au rayon voulu, en montant', () => {
    const voie = voieHelice()
    const { x, z } = SPIRALE.tour
    let angle = 0
    let precedent: number | null = null
    let yMin = Infinity
    let yMax = -Infinity
    for (let i = 0; i <= 2000; i++) {
      const p = voie.getPointAt(i / 2000)
      const r = Math.hypot(p.x - x, p.z - z)
      if (Math.abs(r - SPIRALE.helice.rayon) > 4) continue
      const a = Math.atan2(p.z - z, p.x - x)
      if (precedent !== null) {
        let d = a - precedent
        if (d > Math.PI) d -= 2 * Math.PI
        if (d < -Math.PI) d += 2 * Math.PI
        angle += d
      }
      precedent = a
      yMin = Math.min(yMin, p.y)
      yMax = Math.max(yMax, p.y)
    }
    expect(Math.abs(angle)).toBeGreaterThan(Math.PI * 2.8)
    expect(yMax - yMin).toBeGreaterThan(45)
  })

  it('L HÉLICE SE LIT : un néon épais et un halo posés sur la seule partie en hélice', () => {
    // Le rail seul (tube de 0,9 m, cyan et rose comme les liserés des anneaux) se perdait entre les
    // anneaux de texte : on ne lisait pas de spirale dans l'Accueil de l'utilisateur (2026-10-17).
    const { ctx } = monter()
    const trouver = (nom: string): THREE.Mesh => {
      let m: THREE.Mesh | null = null
      ctx.scene.traverse((o) => {
        if (o.name === nom) m = o as THREE.Mesh
      })
      expect(m, nom).not.toBeNull()
      return m as unknown as THREE.Mesh
    }
    const { x, z } = SPIRALE.tour
    for (const [nom, rayonMin] of [
      ['helice-neon', 1.4],
      ['helice-halo', 4]
    ] as const) {
      const m = trouver(nom)
      const geo = m.geometry as THREE.TubeGeometry
      expect(geo.parameters.radius, nom).toBeGreaterThanOrEqual(rayonMin)
      // rien que l'hélice : l'arrivée du rail, près de la caméra, n'est pas épaissie
      const chemin = geo.parameters.path
      let angle = 0
      let precedent: number | null = null
      for (let i = 0; i <= 400; i++) {
        const p = chemin.getPointAt(i / 400)
        expect(Math.abs(Math.hypot(p.x - x, p.z - z) - SPIRALE.helice.rayon), nom).toBeLessThan(5)
        const a = Math.atan2(p.z - z, p.x - x)
        if (precedent !== null) {
          let d = a - precedent
          if (d > Math.PI) d -= 2 * Math.PI
          if (d < -Math.PI) d += 2 * Math.PI
          angle += d
        }
        precedent = a
      }
      // toute l'hélice : au moins un tour et quart
      expect(Math.abs(angle), nom).toBeGreaterThan(Math.PI * 2.5)
    }
  })

  it('L HÉLICE SE LIT DE CÔTÉ À CÔTÉ dans l Accueil de l utilisateur, écartée des anneaux', () => {
    // Une hélice se lit à ses côtés, là où les boucles tournent. Fenêtre de l'utilisateur 1745 × 938 :
    // la ville est dégagée de x = 226 (bord du menu) à x = 615 (poteau noir de l'avenue), mesuré le
    // 2026-10-17 (conv-310). À 52 m de rayon, l'hélice allait de 158 à 619 : ses deux côtés cachés.
    const vue = new THREE.PerspectiveCamera(58, 1745 / 938, 0.1, 6000)
    vue.position.set(-5.55, 1.75, 10)
    vue.lookAt(-2.2, 1.45, -14)
    vue.updateMatrixWorld()
    const { x, z } = SPIRALE.tour
    const voie = voieHelice()
    let gauche = Infinity
    let droite = -Infinity
    for (let i = 0; i <= 2000; i++) {
      const p = voie.getPointAt(i / 2000)
      if (Math.abs(Math.hypot(p.x - x, p.z - z) - SPIRALE.helice.rayon) > 3) continue
      const sx = ((p.project(vue).x + 1) / 2) * 1745
      gauche = Math.min(gauche, sx)
      droite = Math.max(droite, sx)
    }
    expect(gauche).toBeGreaterThanOrEqual(226 + 12)
    expect(droite).toBeLessThanOrEqual(615 - 12)
    // les anneaux de texte serrés contre la tour : 8 m de vide au moins jusqu'à l'hélice
    const { ctx } = monter()
    const rayons: number[] = []
    ctx.scene.traverse((o) => {
      if (o.name !== 'anneau') return
      const cyl = (o as THREE.Group).children.find(
        (c) => (c as THREE.Mesh).geometry instanceof THREE.CylinderGeometry
      ) as THREE.Mesh<THREE.CylinderGeometry>
      rayons.push(cyl.geometry.parameters.radiusTop)
    })
    expect(rayons).toHaveLength(SPIRALE.anneaux)
    expect(Math.max(...rayons)).toBeLessThanOrEqual(SPIRALE.helice.rayon - 8)
  })

  it('LA RAME PASSE : sept voitures sur la voie, qui avancent, et un portique s allume à son passage', () => {
    const { spirale, ctx } = monter()
    const longueur = voieHelice().getLength()
    // un instant où la rame est en plein milieu de la voie
    const t = (longueur * 0.45 + 120 - SPIRALE.rame.depart) / SPIRALE.rame.vitesse
    expect(abscisseRame(t, longueur)).toBeCloseTo(longueur * 0.45, 3)
    spirale.animer(t, 0)
    const wagons: THREE.Object3D[] = []
    ctx.scene.traverse((o) => {
      if (o.name === 'wagon') wagons.push(o)
    })
    expect(wagons).toHaveLength(7)
    expect(wagons.every((w) => w.visible)).toBe(true)
    const avant = wagons[0].position.clone()
    spirale.animer(t + 0.5, 0)
    expect(wagons[0].position.distanceTo(avant)).toBeGreaterThan(20)
  })

  it('TOUT CE QUI APPARAÎTRA EST VISIBLE AU MONTAGE : la compilation en tâche de fond le prépare', () => {
    const { ctx } = monter()
    const caches: string[] = []
    ctx.scene.traverse((o) => {
      // les drapeaux remplacés par les prismes restent cachés, et ils sont dans le décor
      if (!o.visible && (o as THREE.Mesh).isMesh && o.parent !== ctx.decor)
        caches.push(o.name || o.type)
    })
    const wagons: THREE.Object3D[] = []
    ctx.scene.traverse((o) => {
      if (o.name === 'wagon') wagons.push(o)
    })
    expect(wagons.every((w) => w.visible)).toBe(true)
    expect(caches).toEqual([])
  })

  it('LES PRISMES REMPLACENT LES ENSEIGNES : dans le décor, à leur place, et pivotent', () => {
    const { spirale, enseignes, ctx } = monter()
    expect(spirale.prismes).toHaveLength(enseignes.length)
    spirale.prismes.forEach((p, k) => {
      expect(p.parent).toBe(ctx.decor)
      expect(p.position.equals(enseignes[k].box.position)).toBe(true)
      expect(enseignes[k].box.visible).toBe(false)
    })
    spirale.animer(0.1, 0)
    const avant = spirale.prismes.map((p) => p.rotation.y)
    spirale.animer(3.1, 0)
    expect(spirale.prismes.some((p, k) => Math.abs(p.rotation.y - avant[k]) > 1)).toBe(true)
  })

  it('UN PRISME GARDE LE CLIGNOTEMENT DE SON ENSEIGNE (BAR qui clignote, court-circuit)', () => {
    const { spirale, enseignes } = monter()
    enseignes[0].box.material.color.setScalar(0.15)
    spirale.animer(1, 0)
    const faces = spirale.prismes[0].material as THREE.MeshBasicMaterial[]
    const textures = faces.filter((m) => m.map)
    expect(textures).toHaveLength(4)
    textures.forEach((m) => expect(m.color.r).toBeCloseTo(0.15, 5))
  })

  it('LA MARQUISE DÉFILE AVEC LA MARCHE : une par travée, dans le décor', () => {
    const { spirale, ctx } = monter()
    expect(spirale.marquises.map((m) => m.position.z)).toEqual([-113, -78, -43, -8])
    spirale.marquises.forEach((m) => expect(m.parent).toBe(ctx.decor))
  })

  it('TOUTE LA CHAUSSÉE EST INONDÉE : trois plans d eau, de la rambarde à la façade, fixes', () => {
    const { spirale, ctx } = monter()
    expect(spirale.miroirs).toHaveLength(3)
    const bords = spirale.miroirs.map((m) => {
      const w = (m.geometry as THREE.PlaneGeometry).parameters.width
      return [m.position.x - w / 2, m.position.x + w / 2]
    })
    expect(Math.min(...bords.map((b) => b[0]))).toBeCloseTo(ctx.GARDE - 0.25, 5)
    expect(Math.max(...bords.map((b) => b[1]))).toBeCloseTo(ctx.FACADE, 5)
    spirale.miroirs.forEach((m) => expect(m.parent).not.toBe(ctx.decor))
  })

  it('LE REFLET : dessiné dans son image, plans d eau et foule masqués le temps du reflet, rendus après', () => {
    const { spirale, rendu, foule } = monter()
    spirale.animer(1, 0)
    spirale.activerReflet()
    spirale.avantRendu([foule, null])
    expect(rendu.rendus).toHaveLength(1)
    const r = rendu.rendus[0]
    expect(r.cible).toBe(spirale.cibleReflet)
    expect(r.visibles.get(foule)).toBe(false)
    spirale.miroirs.forEach((m) => expect(r.visibles.get(m)).toBe(false))
    expect(rendu.cible).toBeNull()
    expect(foule.visible).toBe(true)
    spirale.miroirs.forEach((m) => expect(m.visible).toBe(true))
    // à la moitié de la résolution de l'image
    expect([spirale.cibleReflet.width, spirale.cibleReflet.height]).toEqual([400, 200])
  })

  it('LE REFLET DESSINE DES JUMELLES : matières distinctes de l écran, lues en direct, rendues après', () => {
    // Portées par les mêmes matières que l'écran, les versions « reflet » faisaient rebasculer chaque
    // matière de programme deux fois par image : ~34 ms de setProgram par image (2026-10-18).
    const { spirale, rendu } = monter()
    const prisme = spirale.prismes[0]
    const originales = prisme.material as THREE.MeshBasicMaterial[]
    spirale.animer(1, 0)
    spirale.activerReflet()
    spirale.avantRendu([])
    const pendant = rendu.rendus[0].matieres.get(prisme) as THREE.MeshBasicMaterial[]
    expect(pendant).toHaveLength(originales.length)
    pendant.forEach((j, i) => {
      expect(j).not.toBe(originales[i])
      // la couleur reprise de l'enseigne (clignotement, court-circuit) est celle de l'original
      expect(j.color).toBe(originales[i].color)
    })
    expect(prisme.material).toBe(originales)
    // la même jumelle d'un reflet à l'autre (une image sur deux) : son programme reste compilé
    spirale.avantRendu([])
    spirale.avantRendu([])
    expect((rendu.rendus[1].matieres.get(prisme) as THREE.Material[])[0]).toBe(pendant[0])
    expect([...spirale.matieresDuReflet()]).toContain(pendant[0])
  })

  it('PAS DE REFLET AVANT SES PROGRAMMES : rien n est dessiné et l eau ne reflète rien', () => {
    // conv-337 : la rue apparaît avant que la version « reflet » ne soit prête. Dessiner le reflet à
    // ce moment la compilerait sur le fil, à l'image (le gel de conv-301).
    const { spirale, rendu } = monter()
    spirale.animer(1, 0)
    const force = (spirale.miroirs[0].material as THREE.ShaderMaterial).uniforms.uForce
    for (let i = 0; i < 4; i++) spirale.avantRendu([])
    expect(rendu.rendus).toHaveLength(0)
    expect(force.value).toBe(0)
  })

  it('LE REFLET MONTE EN FONDU à son activation, jusqu à sa force', () => {
    const { spirale } = monter()
    const horloge = vi.spyOn(performance, 'now').mockReturnValue(1000)
    try {
      spirale.activerReflet()
      const force = (spirale.miroirs[0].material as THREE.ShaderMaterial).uniforms.uForce
      spirale.avantRendu([])
      expect(force.value).toBe(0)
      horloge.mockReturnValue(1000 + FONDU_REFLET_MS / 2)
      spirale.avantRendu([])
      expect(force.value).toBeCloseTo(SPIRALE.miroir.force / 2, 5)
      horloge.mockReturnValue(1000 + FONDU_REFLET_MS * 3)
      spirale.avantRendu([])
      expect(force.value).toBeCloseTo(SPIRALE.miroir.force, 5)
    } finally {
      horloge.mockRestore()
    }
  })

  it('UN REFLET SUR DEUX IMAGES : entre deux, l eau relit le précédent avec SA matrice', () => {
    // conv-337 : 702 dessins sur 1 684 par image allaient au reflet ; l'eau ridée en permanence ne
    // laisse pas voir un reflet vieux d'une image.
    expect(REFLET_UNE_IMAGE_SUR).toBe(2)
    const { spirale, rendu, ctx } = monter()
    spirale.activerReflet()
    const uTex = (spirale.miroirs[0].material as THREE.ShaderMaterial).uniforms.uTex
    // reflets aux images 1, 3 et 5
    for (let i = 0; i < 5; i++) spirale.avantRendu([])
    expect(rendu.rendus).toHaveLength(3)
    // l'image sautée garde la matrice du reflet pris, même si la caméra a bougé entre-temps
    const prise = (uTex.value as THREE.Matrix4).clone()
    ctx.camera.position.x += 0.3
    ctx.camera.updateMatrixWorld()
    spirale.avantRendu([])
    expect(rendu.rendus).toHaveLength(3)
    expect((uTex.value as THREE.Matrix4).equals(prise)).toBe(true)
    spirale.avantRendu([])
    expect(rendu.rendus).toHaveLength(4)
    expect((uTex.value as THREE.Matrix4).equals(prise)).toBe(false)
  })

  it('UNE IMAGE DU REFLET RÉALLOUÉE est redessinée tout de suite, sans attendre son tour', () => {
    const { spirale, rendu, ctx } = monter()
    spirale.activerReflet()
    spirale.avantRendu([])
    expect(rendu.rendus).toHaveLength(1)
    ;(
      ctx.renderer as unknown as { getDrawingBufferSize: (v: THREE.Vector2) => THREE.Vector2 }
    ).getDrawingBufferSize = (v) => v.set(1000, 500)
    spirale.avantRendu([])
    expect(rendu.rendus).toHaveLength(2)
    expect([spirale.cibleReflet.width, spirale.cibleReflet.height]).toEqual([500, 250])
  })

  it('CE QUI NE SE VOIT PAS DANS L EAU n y est pas dessiné : rame, portiques, anneaux — puis rendus', () => {
    const { spirale, rendu } = monter()
    const noms = new Set(spirale.sansReflet.map((o) => o.name))
    expect(noms).toEqual(new Set(['wagon', 'portique', 'anneau']))
    expect(spirale.sansReflet.filter((o) => o.name === 'wagon')).toHaveLength(SPIRALE.rame.voitures)
    expect(spirale.sansReflet.filter((o) => o.name === 'portique')).toHaveLength(
      SPIRALE.portiques.length
    )
    expect(spirale.sansReflet.filter((o) => o.name === 'anneau')).toHaveLength(SPIRALE.anneaux)
    // masqués pendant le reflet (relevé par le faux moteur), rendus à l'écran ensuite
    spirale.activerReflet()
    spirale.sansReflet.forEach((o) => (o.visible = true))
    spirale.avantRendu([])
    expect(rendu.rendus).toHaveLength(1)
    spirale.sansReflet.forEach((o) => expect(rendu.rendus[0].visibles.get(o)).toBe(false))
    spirale.sansReflet.forEach((o) => expect(o.visible).toBe(true))
  })

  it('LA VERSION « REFLET » DES NUANCEURS SE COMPILE EN TÂCHE DE FOND, dans l image du reflet', async () => {
    const { spirale, rendu, ctx } = monter()
    let pendant: THREE.WebGLRenderTarget | null = null
    let miroirsPendant: boolean[] = []
    let racine: THREE.Object3D | null = null
    const box = ctx.enseignes[0].box
    const original = box.material
    let matierePendant: THREE.Material | THREE.Material[] | null = null
    await spirale.precompilerReflet(async (objet) => {
      pendant = rendu.cible
      miroirsPendant = spirale.miroirs.map((m) => m.visible)
      racine = objet
      matierePendant = box.material
    })
    // ce sont les jumelles du reflet qui se compilent, et l'écran retrouve ses matières
    expect(matierePendant).not.toBe(original)
    expect([...spirale.matieresDuReflet()]).toContain(matierePendant)
    expect(box.material).toBe(original)
    expect(pendant).toBe(spirale.cibleReflet)
    expect(racine).toBe(ctx.scene)
    expect(miroirsPendant.every((v) => !v)).toBe(true)
    expect(rendu.cible).toBeNull()
    spirale.miroirs.forEach((m) => expect(m.visible).toBe(true))
  })
})

describe('la Spirale est branchée dans l avenue', () => {
  const source = readFileSync(new URL('./home-decor-avenue.ts', import.meta.url), 'utf8')

  it('est montée AVANT la compilation de la rue en tâche de fond', () => {
    const montage = source.indexOf('monterSpirale(')
    const compilation = source.indexOf('compilerEnFond(scene)')
    expect(montage).toBeGreaterThan(0)
    expect(compilation).toBeGreaterThan(montage)
  })

  it('la rue apparaît sans attendre son reflet, qui ne s active qu une fois précompilé ET finalisé', () => {
    // conv-337 : la rue attendait aussi les 37 programmes du seul reflet. Elle est désormais déclarée
    // compilée dès SES programmes prêts. Le reflet, lui, reste éteint jusqu'à ce que sa version des
    // programmes soit compilée en tâche de fond PUIS finalisée : compilée mais pas finalisée, elle se
    // finalisait d'un bloc au premier reflet (`onFirstUse` 310 ms dans la première image, conv-310).
    expect(source).toMatch(
      /compilerEnFond\(scene\)\s*\.then\(\(\) => finaliserProgrammes\(scene\)\)\s*\.then\(rueEstCompilee,[\s\S]*?\)\s*\.then\(\(\) => \(vivante \? spirale\.precompilerReflet\(compilerEnFond\) : undefined\)\)\s*\.then\(\(\) => finaliserProgrammes\(scene, spirale\.matieresDuReflet\(\)\)\)\s*\.then\(refletEstPret/
    )
    const pret = source.slice(source.indexOf('const refletEstPret'))
    expect(pret.slice(0, pret.indexOf('\n  }\n'))).toMatch(/spirale\.activerReflet\(\)/)
  })

  it('finalise TOUS les programmes d une matière, pas seulement le courant', () => {
    // Une matière transparente à double face a deux programmes (face arrière, face avant), et une
    // matière dessinée à l'écran puis dans le reflet en a deux aussi. Ne finaliser que le programme
    // courant en laissait deux pour le premier reflet : 187 ms de lecture de journaux (espion de
    // linkProgram dans l'Accueil, 2026-10-17, conv-310).
    const debut = source.indexOf('const finaliserProgrammes')
    const corps = source.slice(debut, source.indexOf('\n  }\n', debut))
    expect(corps).toMatch(/\.programs\b/)
  })

  it('anime la spirale et dessine son reflet, foule et arêtes du viaduc exclues, juste avant le rendu', () => {
    expect(source).toMatch(/spirale\.animer\(t, parcours\)/)
    expect(source).toMatch(
      /spirale\.avantRendu\(\[foule\?\.groupe, \.\.\.aretesViaduc\]\)\s*\n\s*renderer\.render\(scene, camera\)/
    )
    expect(source).toMatch(/aretesViaduc\.push\(arete\)/)
  })

  it('libère l image du reflet avec la scène', () => {
    expect(source).toMatch(/spirale\.liberer\(\)/)
  })
})

describe('le viaduc du métro aérien s écarte de la spirale', () => {
  // Demande de l'utilisateur (conv-310, 2026-10-17) : « Écarte les viaducs du métro aérien de la zone
  // de la tour, pour qu'on voie toute la spirale ». Le viaduc en béton traversait toute la ville : la
  // boucle de la marche (70 m) en gardait toujours une ou deux dalles entre la caméra et la tour, qui
  // coupaient l'hélice en bandes.
  const source = readFileSync(new URL('./home-decor-avenue.ts', import.meta.url), 'utf8')

  it('AUCUN BÉTON DU VIADUC NE COUVRE L HÉLICE, sur toute la boucle de la marche', () => {
    // Fenêtre de l'utilisateur, 1745 × 938. Les objets à moins de 12 m (réverbères, pile au bord de la
    // rambarde) passent devant en quelques secondes en défilant : seuls ceux qui s'attardent comptent.
    const vue = new THREE.PerspectiveCamera(58, 1745 / 938, 0.1, 6000)
    vue.position.set(-5.55, 1.75, 10)
    vue.lookAt(-2.2, 1.45, -14)
    vue.updateMatrixWorld()
    const ecran = (x: number, y: number, z: number): [number, number] => {
      const p = new THREE.Vector3(x, y, z).project(vue)
      return [((p.x + 1) / 2) * 1745, ((1 - p.y) / 2) * 938]
    }
    const { x, z } = SPIRALE.tour
    const voie = voieHelice()
    const helice: [number, number][] = []
    for (let i = 0; i <= 1500; i++) {
      const p = voie.getPointAt(i / 1500)
      if (Math.abs(Math.hypot(p.x - x, p.z - z) - SPIRALE.helice.rayon) < 3)
        helice.push(ecran(p.x, p.y, p.z))
    }
    const V = VIADUC
    const blocs = (zc: number): { nom: string; min: number[]; max: number[] }[] => [
      {
        nom: 'tablier',
        min: [V.gauche, V.y - V.epaisseur / 2, zc - V.profondeur / 2],
        max: [7.5, V.y + V.epaisseur / 2, zc + V.profondeur / 2]
      }
    ]
    const couverts: string[] = []
    for (let decal = 0; decal < V.boucle; decal += 0.5)
      for (let k = 0; k < V.copies; k++) {
        const zc = V.z - k * V.boucle + decal
        if (10 - zc < 12) continue
        for (const b of blocs(zc)) {
          const coins = [0, 1, 2, 3, 4, 5, 6, 7].map((m) =>
            ecran(
              m & 1 ? b.max[0] : b.min[0],
              m & 2 ? b.max[1] : b.min[1],
              m & 4 ? b.max[2] : b.min[2]
            )
          )
          const xs = coins.map((c) => c[0])
          const ys = coins.map((c) => c[1])
          const n = helice.filter(
            ([sx, sy]) =>
              sx >= Math.min(...xs) &&
              sx <= Math.max(...xs) &&
              sy >= Math.min(...ys) &&
              sy <= Math.max(...ys)
          ).length
          if (n > 0) couverts.push(`${b.nom} à ${Math.round(10 - zc)} m : ${n} points`)
        }
      }
    expect(couverts.slice(0, 6)).toEqual([])
  })

  it('le viaduc est construit d après ces réglages', () => {
    expect(source).toMatch(/VIADUC\.gauche/)
    // aucune pile dans le vide : même collée à la rambarde, une pile couvre l'hélice en défilant
    expect(source).not.toMatch(/VIADUC\.y - SOL/)
    // la voie continue en lumière au-dessus du vide, jusqu'au bout de la course de la rame
    expect(VIADUC.fin).toBe(-230)
    expect(source).toMatch(/arete\.name = 'viaduc-holo'/)
    // une copie du viaduc par tour de la boucle de la marche
    expect(source).toContain(`const W = ${VIADUC.boucle}`)
    expect(source).toMatch(/for \(let k = 0; k < VIADUC\.copies; k\+\+\)/)
  })
})
