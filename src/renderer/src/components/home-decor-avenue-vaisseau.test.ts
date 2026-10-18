import { readFileSync } from 'node:fs'
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { AVENUE, CAMERA_AVENUE, CIEL_LUNAIRE, directionLune } from './home-decor-avenue'
import {
  brumePour,
  monterVaisseau,
  VAISSEAU,
  VILLE_ANNEAU,
  type ContexteVaisseau
} from './home-decor-avenue-vaisseau'
import { AMBIANCE_KOWLOON } from './home-decor-avenue-ville'

/**
 * LE CIEL « ÉCLAIRCIE LUNAIRE » ET LE VAISSEAU MÈRE DU FOND DE L'ACCUEIL (conv-319).
 *
 * Demande de l'utilisateur : « /draft le fond le ciel violet de l'acceuil », « Affiner la 4 · Azur
 * d'orage », puis « implémente la 5 et met un vaisseau mere » ; et pour les vaisseaux, « /draft le
 * vaisseau mère du fond de l'Accueil : propose 6 formes de coque… », « implémente 2 et 6 », et enfin
 * « tas mis les 2 vaisseaux mais j'en veux qu'un je voulais une ville de la forme de celui du haut ».
 *
 * ENTRÉES QUI DOIVENT FAIRE ÉCHOUER CE FICHIER :
 *   1. une couleur du ciel, de la brume ou de l'horizon qui redevient violette (rouge au-dessus du
 *      vert), ou l'ancien violet encore écrit dans `home-decor-avenue.ts` ;
 *   2. la lune ou le vaisseau hors du cadre de la rue, ou sous l'horizon ;
 *   3. le vaisseau, sa couronne ou une de ses tours posés sur la lune (sa trouée est la raison d'être de la 5) ;
 *   4. une lumière ajoutée par le vaisseau → toutes les matières de la rue s'alourdissent (conv-301) ;
 *   5. une matière du vaisseau soumise au brouillard de la rue → à 2,9 km il disparaît ;
 *   6. DEUX vaisseaux au lieu d'un, ou une ville qui n'épouse plus la roue (tours hors de la couronne,
 *      tours qui ne pendent plus vers le bas) ; une roue immobile ; des fenêtres qui glissent sur les tours ;
 *   7. le vaisseau non monté, non animé, ou monté après la compilation de la rue en tâche de fond.
 */

const camera = (aspect: number): THREE.PerspectiveCamera => {
  const c = new THREE.PerspectiveCamera(CAMERA_AVENUE.fov, aspect, 0.1, 6000)
  c.position.set(...CAMERA_AVENUE.position)
  c.lookAt(...CAMERA_AVENUE.cible)
  c.updateMatrixWorld(true)
  return c
}
const OEIL = new THREE.Vector3(...CAMERA_AVENUE.position)

function monter(): { ctx: ContexteVaisseau; vaisseau: ReturnType<typeof monterVaisseau> } {
  const ctx: ContexteVaisseau = {
    scene: new THREE.Scene(),
    uT: { value: 0 },
    uFlash: { value: 0 },
    uBrume: { value: new THREE.Color(AMBIANCE_KOWLOON.brume) },
    lune: directionLune(),
    camera: CAMERA_AVENUE.position,
    canevas: { height: 900 },
    GLOW: new THREE.Texture()
  }
  return { ctx, vaisseau: monterVaisseau(ctx) }
}

/** Les coques seules, sans les halos ni les feux. */
const coque = (g: THREE.Group): THREE.Box3 => {
  const boite = new THREE.Box3()
  g.updateMatrixWorld(true)
  g.traverse((o) => {
    const m = o as THREE.Mesh
    if (m.isMesh && !(m.material as THREE.ShaderMaterial).transparent) boite.expandByObject(m)
  })
  return boite
}

/** Vert au moins égal au rouge : un bleu, pas un violet. */
const pasViolet = (r: number, g: number, b: number): boolean => g >= r && b >= r

describe('le ciel « Éclaircie lunaire » (la 5 du tour 2)', () => {
  it('N A PLUS UNE TOUCHE DE VIOLET : ciel, nuages, éclair, brume et horizon sont bleus', () => {
    const { fond, flash, zenith, bas, nuages, eclair } = CIEL_LUNAIRE
    for (const hex of [
      fond,
      flash,
      zenith,
      bas,
      nuages.dessous,
      nuages.dessus,
      eclair,
      AMBIANCE_KOWLOON.brume
    ]) {
      const c = new THREE.Color(hex)
      expect(pasViolet(c.r, c.g, c.b), `#${hex.toString(16).padStart(6, '0')}`).toBe(true)
    }
    expect(pasViolet(...AMBIANCE_KOWLOON.horizon)).toBe(true)
  })

  it('l ancien violet n est plus écrit dans le fond', () => {
    const avenue = readFileSync(new URL('./home-decor-avenue.ts', import.meta.url), 'utf8')
    const sans = avenue.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')
    expect(sans).not.toMatch(
      /0x170b24|0x8a78c8|0x6a4a9a|0x1a0f24|0x8a3c9a|0x3c3a8a|0xcab8ff|0xf0e6ff/
    )
    // le ciel porte sa lune et sa trouée, et les nuages en sprites s'effacent autour d'elle
    expect(sans).toMatch(/uLune: \{ value: LUNE \}/)
    expect(sans).toMatch(/opacity = \(0\.16 \+ f \* 0\.5\) \* horsTrouee\(s\)/)
  })

  it('l orage s éloigne et la pluie s affine, comme sur la 5', () => {
    expect(AVENUE.orage).toBe(22)
    expect(AVENUE.pluie).toBeCloseTo(0.7)
  })

  it.each([16 / 9, 16 / 10, 4 / 3])(
    'LA LUNE EST DANS LE CADRE, haut dans le ciel (rapport %f)',
    (aspect) => {
      const p = OEIL.clone().addScaledVector(directionLune(), 3000).project(camera(aspect))
      expect(Math.abs(p.x)).toBeLessThan(0.9)
      expect(p.y).toBeGreaterThan(0.3)
      expect(p.y).toBeLessThan(0.95)
    }
  )
})

describe('le vaisseau mère : UNE ville en anneau (la 6 · Cité suspendue sur la forme de la 2 · Anneau)', () => {
  it('UN SEUL VAISSEAU : « j en veux qu un » — une seule roue, aucune cité à part', () => {
    const { ctx, vaisseau } = monter()
    expect(ctx.scene.children).toEqual([vaisseau.groupe])
    let roues = 0
    vaisseau.groupe.traverse((o) => {
      if (o.name === 'roue') roues++
      expect(o.name).not.toBe('cite-suspendue')
    })
    expect(roues).toBe(1)
  })

  it('N AJOUTE AUCUNE LUMIÈRE : son éclat est dans ses nuanceurs, ses feux et ses halos', () => {
    const { ctx } = monter()
    let lumieres = 0
    ctx.scene.traverse((o) => {
      if ((o as THREE.Light).isLight) lumieres++
    })
    expect(lumieres).toBe(0)
  })

  it('ÉCHAPPE AU BROUILLARD DE LA RUE : à 2,9 km, FogExp2 l effacerait', () => {
    const { vaisseau } = monter()
    let matieres = 0
    vaisseau.groupe.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | undefined
      if (!m) return
      matieres++
      expect((m as THREE.Material & { fog?: boolean }).fog ?? false).toBe(false)
    })
    expect(matieres).toBeGreaterThan(10)
  })

  it('LA VILLE A LA FORME DE L ANNEAU : chaque tour part de la couronne, tout autour de la roue', () => {
    const { vaisseau } = monter()
    const { rayon: R, boudin: B } = VILLE_ANNEAU
    const m4 = new THREE.Matrix4()
    const p = new THREE.Vector3()
    for (const [im, n] of [
      [vaisseau.pendues, VILLE_ANNEAU.pendues],
      [vaisseau.debout, VILLE_ANNEAU.debout]
    ] as const) {
      expect(im.count).toBe(n)
      expect(im.parent).toBe(vaisseau.roue)
      const quarts = new Set<number>()
      for (let k = 0; k < im.count; k++) {
        im.getMatrixAt(k, m4)
        p.setFromMatrixPosition(m4)
        // la base de la tour est sur le boudin de la couronne (à 4 m près, elle y est enfoncée)
        const radial = Math.hypot(p.x, p.y)
        expect(Math.hypot(radial - R, p.z)).toBeLessThan(B + 5)
        quarts.add(Math.floor(((Math.atan2(p.y, p.x) + Math.PI) / (2 * Math.PI)) * 4) % 4)
      }
      expect(quarts.size).toBe(4)
    }
  })

  it('les tours pendues pendent VERS LE BAS du monde, les tours debout montent', () => {
    const { vaisseau } = monter()
    vaisseau.groupe.updateMatrixWorld(true)
    const m4 = new THREE.Matrix4()
    const sens = (im: THREE.InstancedMesh, k: number): number => {
      im.getMatrixAt(k, m4)
      const y = new THREE.Vector3().setFromMatrixColumn(m4, 1).normalize()
      return y.transformDirection(im.matrixWorld).y
    }
    for (let k = 0; k < 50; k++) {
      expect(sens(vaisseau.pendues, k)).toBeLessThan(-0.8)
      expect(sens(vaisseau.debout, k)).toBeGreaterThan(0.8)
    }
  })

  it('les fenêtres des tours sont posées dans le repère de chaque tour : elles ne glissent pas quand la roue tourne', () => {
    const { vaisseau } = monter()
    const fs = (vaisseau.pendues.material as THREE.ShaderMaterial).fragmentShader
    expect(fs).toMatch(/vL\.z\*vZ\.z/)
    expect(fs).not.toMatch(/vW\.xz|vG\.xz/)
  })

  it.each([16 / 9, 16 / 10, 4 / 3])('EST DANS LE CADRE, dans le ciel (rapport %f)', (aspect) => {
    const { vaisseau } = monter()
    const centre = coque(vaisseau.groupe).getCenter(new THREE.Vector3()).project(camera(aspect))
    expect(Math.abs(centre.x)).toBeLessThan(0.8)
    expect(centre.y).toBeGreaterThan(0.1)
    expect(centre.y).toBeLessThan(0.95)
  })

  it('PLANE AU-DESSUS DE LA VILLE, sa roue mesure ses 600 m, et il reste sous la sphère du ciel', () => {
    const { vaisseau } = monter()
    expect(coque(vaisseau.groupe).min.y).toBeGreaterThan(300)
    vaisseau.roue.updateWorldMatrix(true, true)
    const taille = new THREE.Box3().setFromObject(vaisseau.roue).getSize(new THREE.Vector3())
    expect(Math.max(taille.x, taille.y, taille.z)).toBeGreaterThan(600)
    // la sphère du ciel a 4000 m de rayon, centrée sur l'origine de la scène
    let loin = 0
    const p = new THREE.Vector3()
    vaisseau.groupe.traverse((o) => {
      const m = o as THREE.Mesh
      if (!m.isMesh || (m as unknown as THREE.InstancedMesh).isInstancedMesh) return
      const pos = m.geometry.getAttribute('position')
      for (let i = 0; i < pos.count; i++)
        loin = Math.max(loin, p.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld).length())
    })
    expect(loin).toBeLessThan(3950)
  })

  it('garde l air que le brouillon avait à 2,3 km : sa brume suit sa distance', () => {
    expect(brumePour(2300)).toBeCloseTo(0.00035)
    expect(brumePour(VAISSEAU.distance) * VAISSEAU.distance).toBeCloseTo(0.00035 * 2300)
  })

  it('LAISSE LA LUNE DANS SA TROUÉE : aucun rayon vers son disque ni son halo proche ne touche la coque ni une tour', () => {
    const { vaisseau } = monter()
    const pieces: THREE.Object3D[] = []
    vaisseau.groupe.updateMatrixWorld(true)
    vaisseau.groupe.traverse((o) => {
      const m = o as THREE.Mesh
      if (m.isMesh && !(m.material as THREE.ShaderMaterial).transparent) pieces.push(m)
    })
    expect(pieces).toContain(vaisseau.pendues)
    // le disque fait 0,02 rad de rayon : on vise son centre, puis trois couronnes autour (0,03 à 0,07)
    const lune = directionLune()
    const a = new THREE.Vector3(0, 1, 0).cross(lune).normalize()
    const b = lune.clone().cross(a).normalize()
    const rayons = [lune.clone()]
    for (const r of [0.03, 0.05, 0.07])
      for (let k = 0; k < 16; k++) {
        const ang = (k / 16) * Math.PI * 2
        rayons.push(
          lune
            .clone()
            .addScaledVector(a, Math.cos(ang) * r)
            .addScaledVector(b, Math.sin(ang) * r)
            .normalize()
        )
      }
    const rc = new THREE.Raycaster()
    for (const d of rayons) {
      rc.set(OEIL, d)
      expect(rc.intersectObjects(pieces, false)).toHaveLength(0)
    }
  })

  it('reste PRÈS de la trouée : la lune argente sa silhouette au lieu de briller ailleurs', () => {
    const { vaisseau } = monter()
    const centre = coque(vaisseau.groupe).getCenter(new THREE.Vector3()).sub(OEIL)
    expect(centre.angleTo(directionLune())).toBeLessThan(0.3)
  })

  it('flotte sans s en aller, et la roue tourne en emportant sa ville', () => {
    const { vaisseau } = monter()
    vaisseau.animer(0)
    const depart = vaisseau.groupe.position.clone()
    const angle0 = vaisseau.roue.rotation.z
    for (let t = 0; t < 3600; t += 37) {
      vaisseau.animer(t)
      expect(vaisseau.groupe.position.distanceTo(depart)).toBeLessThan(12)
    }
    vaisseau.animer(60)
    expect(Math.abs(vaisseau.roue.rotation.z - angle0)).toBeGreaterThan(1)
  })
})

describe('branchement dans le fond de l Accueil (home-decor-avenue.ts)', () => {
  const avenue = readFileSync(new URL('./home-decor-avenue.ts', import.meta.url), 'utf8')
  const sans = avenue.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')

  it('monte le vaisseau AVANT la compilation de la rue, et l anime à chaque image', () => {
    expect(avenue).toMatch(/from '\.\/home-decor-avenue-vaisseau'/)
    expect(sans).toMatch(/const vaisseau = monterVaisseau\(\{/)
    expect(sans.indexOf('monterVaisseau({')).toBeLessThan(sans.indexOf('compilerEnFond(scene)'))
    expect(sans).toMatch(/vaisseau\.animer\(t\)/)
  })
})
