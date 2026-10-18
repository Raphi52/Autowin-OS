import { readFileSync } from 'node:fs'
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import {
  ECLAIRCIE,
  monterToile,
  TOILE,
  type ContexteToile,
  type EnseigneDeToile
} from './home-decor-avenue-toile'

/**
 * LA TOILE ÉLECTRIQUE DANS LE FOND DE L'ACCUEIL (conv-311).
 *
 * Demande de l'utilisateur, après le /draft « des éléments plus trash et chaotiques pour le fond
 * d'écran d'acceuil » et le mélange « 1+3+4 » : « je choisi que tu implémente le 3 », la variante
 * 3 · Toile électrique du brouillon.
 *
 * ENTRÉES QUI DOIVENT FAIRE ÉCHOUER CE FICHIER :
 *   1. la toile posée dans la scène et non dans le décor → elle ne défile pas avec la marche ;
 *   2. une lumière ponctuelle ajoutée pour l'étincelle ou le néon → toutes les matières de la rue
 *      s'alourdissent, le gel de l'Accueil revient (conv-301 : 22 lumières → 8) ;
 *   3. un maillage par câble → plus de 150 appels de dessin par travée ;
 *   4. les réglages de la variante 3 changés → ce n'est plus ce que l'utilisateur a choisi ;
 *   5. la toile montée APRÈS la compilation de la rue en tâche de fond, ou non animée dans `render`.
 *   6. (conv-319, « j'éclaircis les câbles devant le vaisseau ») des câbles effacés en pointillé au lieu
 *      d'entiers, un filet qui ne s'éclaircit plus devant le vaisseau, ou qui s'éclaircit ailleurs.
 */

const faux2d = (): CanvasRenderingContext2D => {
  const degrade = { addColorStop: (): void => {} }
  return new Proxy(
    {},
    {
      get: (_c, cle) =>
        cle === 'createRadialGradient' || cle === 'createLinearGradient'
          ? () => degrade
          : cle === 'measureText'
            ? () => ({ width: 10 })
            : () => {},
      set: () => true
    }
  ) as unknown as CanvasRenderingContext2D
}

function monter(eclaircie?: ContexteToile['eclaircie']): {
  ctx: ContexteToile
  emissions: () => number
  enseignes: EnseigneDeToile[]
  toile: ReturnType<typeof monterToile>
} {
  const scene = new THREE.Scene()
  const decor = new THREE.Group()
  scene.add(decor)
  let emissions = 0
  const enseignes: EnseigneDeToile[] = [0, 1, 2, 3].map((i) => ({
    box: new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial()),
    halo: new THREE.Sprite(new THREE.SpriteMaterial()),
    lum: null,
    reflet: new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial()),
    i
  }))
  const ctx: ContexteToile = {
    scene,
    decor,
    camera: new THREE.PerspectiveCamera(),
    P: 35,
    Z0: -130,
    copies: 4,
    FACADE: 7.5,
    GARDE: -7.2,
    TROTTOIR: 0.15,
    ROUTE: 4,
    GLOW: new THREE.Texture(),
    toile: (w, h) => [{ width: w, height: h } as HTMLCanvasElement, faux2d()],
    tex: (c) => new THREE.CanvasTexture(c),
    glow: (color, size, x, y, z, op = 1, parent = scene) => {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ color, opacity: op }))
      s.scale.set(size, size, 1)
      s.position.set(x, y, z)
      parent.add(s)
      return s
    },
    trainee: (color, w, l, op, parent) => {
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(w, l),
        new THREE.MeshBasicMaterial({ color, opacity: op })
      )
      parent.add(m)
      return m
    },
    emettre: () => {
      emissions++
    },
    enseignes,
    eclaircie
  }
  const toile = monterToile(ctx)
  return { ctx, emissions: () => emissions, enseignes, toile }
}

describe('la Toile électrique — fond de l Accueil (conv-311)', () => {
  it('garde les réglages de la variante 3 choisie', () => {
    expect(TOILE).toMatchObject({
      parPoint: 6,
      facade: 26,
      pendus: 5,
      etincelles: 1.6,
      pubs: 5,
      fenetres: 3,
      pixels: 200,
      sacs: 0.35,
      cartons: 5,
      papiers: 50
    })
    expect([...TOILE.lachent]).toEqual([1, 2])
  })

  it('DÉFILE AVEC LA MARCHE : une travée dans chaque copie du décor, à 35 m d intervalle', () => {
    const { ctx } = monter()
    expect(ctx.decor.children.map((g) => g.position.z)).toEqual([-130, -95, -60, -25])
  })

  it('N AJOUTE AUCUNE LUMIÈRE : l éclat de l étincelle et du néon est porté par des halos', () => {
    const { ctx } = monter()
    let lumieres = 0
    ctx.scene.traverse((o) => {
      if ((o as THREE.Light).isLight) lumieres++
    })
    expect(lumieres).toBe(0)
  })

  it('UN SEUL MAILLAGE pour tous les câbles d une travée : peu d appels de dessin', () => {
    const { ctx } = monter()
    const travee = ctx.decor.children[0]
    let maillages = 0
    let plusGros = 0
    travee.traverse((o) => {
      const m = o as THREE.Mesh
      if (!m.isMesh) return
      maillages++
      plusGros = Math.max(plusGros, m.geometry.attributes.position.count)
    })
    // ~150 câbles de 23 × 5 sommets dans un seul maillage
    expect(plusGros).toBeGreaterThan(15000)
    expect(maillages).toBeLessThanOrEqual(80)
  })

  it('AUCUNE GUIRLANDE sur les fils (conv-311 : « enleve les guirlandes lumineuses des fils electriques »)', () => {
    const { ctx } = monter()
    expect('guirlandes' in TOILE).toBe(false)
    for (const travee of ctx.decor.children) {
      let points = 0
      travee.traverse((o) => {
        if ((o as THREE.Points).isPoints) points++
      })
      expect(points).toBe(0)
    }
  })

  it('les câbles arrachés crachent des étincelles, les enseignes HOTEL et RAMEN lâchent', () => {
    const { ctx, emissions, enseignes, toile } = monter()
    // la marche fait passer les travées devant nous : on avance le décor comme `render` le fait
    let minLache = 1
    let minAutres = 1
    for (let pas = 0; pas < 600; pas++) {
      const t = pas / 60
      ctx.decor.position.z = (25 + 0.45 * t) % 35
      ctx.decor.updateMatrixWorld(true)
      enseignes.forEach((e) => e.box.material.color.setScalar(1))
      toile.maj(t, 1 / 60, 0.45)
      for (const e of enseignes) {
        const v = e.box.material.color.r
        if (TOILE.lachent.includes(e.i)) minLache = Math.min(minLache, v)
        else minAutres = Math.min(minAutres, v)
      }
    }
    expect(emissions()).toBeGreaterThan(50)
    expect(minLache).toBeLessThan(0.2)
    expect(minAutres).toBe(1)
  })
})

describe('la Toile électrique est branchée dans l avenue', () => {
  const sans = (source: string): string =>
    source
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
      .replace(/\s\/\/.*$/gm, '')
  const avenue = sans(readFileSync(new URL('./home-decor-avenue.ts', import.meta.url), 'utf8'))

  it('montée AVANT la compilation de la rue en tâche de fond : ses nuanceurs sont compilés avec elle', () => {
    const montage = avenue.indexOf('monterToile(')
    const compilation = avenue.indexOf('compilerEnFond(scene)')
    expect(montage).toBeGreaterThan(0)
    expect(compilation).toBeGreaterThan(montage)
  })

  it('animée à chaque image, après le scintillement des enseignes et avant les particules', () => {
    const appel = avenue.search(/toileElectrique\.maj\(t, dt, v\)/)
    const enseignes = avenue.indexOf('enseignes.forEach((e) => {\n        let bz')
    const particules = avenue.indexOf('majParticules(dt)', enseignes)
    expect(appel).toBeGreaterThan(enseignes)
    expect(particules).toBeGreaterThan(appel)
  })

  it('le module suit les règles d un fond : ni image, ni écouteur, ni boucle propre, ni lumière', () => {
    const toile = sans(
      readFileSync(new URL('./home-decor-avenue-toile.ts', import.meta.url), 'utf8')
    )
    expect(toile).not.toMatch(/\b\w*Loader\b|new Image\b|createImageBitmap|\.src\s*=|fetch\s*\(/)
    expect(toile).not.toMatch(
      /addEventListener|document\.|setAnimationLoop|requestAnimationFrame|setInterval/
    )
    expect(toile).not.toMatch(
      /new THREE\.(Point|Spot|Directional|Hemisphere|Ambient|RectArea)Light\(/
    )
  })
})

describe('l éclaircie devant le vaisseau mère (conv-319 : « j éclaircis les câbles devant le vaisseau »)', () => {
  const DIRECTION = new THREE.Vector3(0.1, 0.3, -0.95).normalize()
  const cables = (ctx: ContexteToile): THREE.Mesh => {
    const m = ctx.decor.children[0].getObjectByName('cables') as THREE.Mesh | undefined
    expect(m).toBeDefined()
    return m!
  }

  it('sans éclaircie, la toile reste entière', () => {
    const { ctx } = monter()
    const mat = cables(ctx).material as THREE.Material
    expect(mat.customProgramCacheKey()).not.toBe('toile-eclaircie')
  })

  it('chaque câble porte UN numéro (gardé ou effacé en entier), et un sur quatre environ reste devant le vaisseau', () => {
    const { ctx } = monter({ direction: DIRECTION, rayon: 0.23 })
    const tirages = cables(ctx).geometry.getAttribute('aTirage')
    expect(tirages.count).toBe(cables(ctx).geometry.getAttribute('position').count)
    // un tube de câble : 23 anneaux de 5 sommets, tous au même numéro
    const parCable = 23 * 5
    expect(tirages.count % parCable).toBe(0)
    let gardes = 0
    const n = tirages.count / parCable
    for (let k = 0; k < n; k++) {
      const t = tirages.getX(k * parCable)
      for (let i = 1; i < parCable; i++) expect(tirages.getX(k * parCable + i)).toBe(t)
      expect(t).toBeGreaterThanOrEqual(0)
      expect(t).toBeLessThan(1)
      if (t <= ECLAIRCIE.garde) gardes++
    }
    expect(gardes / n).toBeGreaterThan(0.15)
    expect(gardes / n).toBeLessThan(0.35)
  })

  it('le nuanceur efface les câbles dans le cône du vaisseau, et seulement là', () => {
    const { ctx } = monter({ direction: DIRECTION, rayon: 0.23 })
    const mat = cables(ctx).material as THREE.MeshStandardMaterial
    expect(mat.customProgramCacheKey()).toBe('toile-eclaircie')
    const sh = {
      uniforms: {} as Record<string, THREE.IUniform>,
      vertexShader: THREE.ShaderLib.standard.vertexShader,
      fragmentShader: THREE.ShaderLib.standard.fragmentShader
    }
    mat.onBeforeCompile(
      sh as unknown as THREE.WebGLProgramParametersWithUniforms,
      {} as THREE.WebGLRenderer
    )
    expect(sh.vertexShader).toMatch(/attribute float aTirage;/)
    expect(sh.vertexShader).toMatch(
      /vMondeFil = \(modelMatrix \* vec4\(transformed, 1\.0\)\)\.xyz;/
    )
    expect(sh.fragmentShader).toMatch(/discard;/)
    expect((sh.uniforms.uEclDir.value as THREE.Vector3).distanceTo(DIRECTION)).toBeLessThan(1e-6)
    // la même règle qu'en GLSL : au centre on garde un câble sur quatre, hors du cône tous
    const [cosExt, cosInt] = (sh.uniforms.uEclCos.value as THREE.Vector2).toArray()
    expect(cosExt).toBeLessThan(cosInt)
    const lisse = (a: number, b: number, x: number): number => {
      const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
      return t * t * (3 - 2 * t)
    }
    const seuil = (angle: number): number =>
      ECLAIRCIE.garde + (1 - ECLAIRCIE.garde) * (1 - lisse(cosExt, cosInt, Math.cos(angle)))
    expect(seuil(0)).toBeCloseTo(ECLAIRCIE.garde)
    expect(seuil(0.23 * 0.95)).toBeCloseTo(ECLAIRCIE.garde)
    expect(seuil(0.23 * 1.5)).toBeCloseTo(1)
  })
})
