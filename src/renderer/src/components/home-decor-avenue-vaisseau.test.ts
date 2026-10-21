import { readFileSync } from 'node:fs'
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { AVENUE, CAMERA_AVENUE, CIEL_LUNAIRE, directionLune } from './home-decor-avenue'
import {
  brumePour,
  ECLAT,
  eclaircieVaisseau,
  GROSSISSEMENT_FEUX,
  monterVaisseau,
  MOYEU_CITE,
  VAISSEAU,
  type ContexteVaisseau
} from './home-decor-avenue-vaisseau'
import { AMBIANCE_KOWLOON } from './home-decor-avenue-ville'

/**
 * LE CIEL « ÉCLAIRCIE LUNAIRE » ET LE VAISSEAU MÈRE DU FOND DE L'ACCUEIL (conv-319).
 *
 * Demande de l'utilisateur : « /draft le fond le ciel violet de l'acceuil », « Affiner la 4 · Azur
 * d'orage », puis « implémente la 5 et met un vaisseau mere » ; et pour le vaisseau, après deux /draft
 * de la coque, « /draft des variantes du vaisseau spatial » : « le 5 mais j'aime pas le dessous de la
 * ville et j'aimerais que le dessus de la ville ait quelques lumieres », puis « Implémenter la 6 ·
 * Anneaux d'approche ».
 *
 * ENTRÉES QUI DOIVENT FAIRE ÉCHOUER CE FICHIER :
 *   1. une couleur du ciel, de la brume ou de l'horizon qui redevient violette (rouge au-dessus du
 *      vert), ou l'ancien violet encore écrit dans `home-decor-avenue.ts` ;
 *   2. la lune ou le vaisseau hors du cadre de la rue, ou sous l'horizon ; le vaisseau qui quitte le
 *      haut du centre de l'écran, ou la lune qui revient à sa droite (« Au centre en haut, en grand : je
 *      déplace la lune à gauche au-dessus de la ville ») ; un vaisseau qui n'est plus deux fois plus
 *      large qu'à l'origine (« plus grandes plus belle ») ;
 *   3. le vaisseau, sa couronne ou une de ses tours posés sur la lune (sa trouée est la raison d'être de la 5) ;
 *   4. une lumière ajoutée par le vaisseau → toutes les matières de la rue s'alourdissent (conv-301) ;
 *   5. une matière du vaisseau soumise au brouillard de la rue → à 1,3 km il disparaît ;
 *   6. DEUX vaisseaux au lieu d'un ; une tour qui PEND de nouveau sous la ville, ou qui quitte le disque ;
 *      un dessus sans lumières, ou des feux de toit cachés par leur propre toit (pas de mât) ; plus de
 *      cercles de feux d'atterrissage sous la plaque, ou une vague qui ne court plus du centre au bord ;
 *      une roue immobile ; des fenêtres qui glissent sur les tours ;
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

/** L'axe y de l'instance k, dans le monde : le sens dans lequel la tour (ou le mât) monte. */
const sens = (im: THREE.InstancedMesh, k: number): THREE.Vector3 => {
  const m4 = new THREE.Matrix4()
  im.getMatrixAt(k, m4)
  return new THREE.Vector3()
    .setFromMatrixColumn(m4, 1)
    .normalize()
    .transformDirection(im.matrixWorld)
}

describe('le vaisseau mère : la 6 · Anneaux d approche (une cité sur le moyeu d une roue)', () => {
  it('UN SEUL VAISSEAU : une seule roue, aucune cité à part', () => {
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

  it('ÉCHAPPE AU BROUILLARD DE LA RUE : à 1,3 km, FogExp2 l effacerait', () => {
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

  it('PLUS AUCUNE TOUR NE PEND sous la ville (« j aime pas le dessous ») : toutes montent, posées sur le disque', () => {
    const { vaisseau } = monter()
    vaisseau.groupe.updateMatrixWorld(true)
    expect(vaisseau.tours.count).toBe(MOYEU_CITE.tours)
    expect(vaisseau.tours.parent).toBe(vaisseau.roue)
    const m4 = new THREE.Matrix4()
    const p = new THREE.Vector3()
    const quarts = new Set<number>()
    for (let k = 0; k < vaisseau.tours.count; k++) {
      expect(sens(vaisseau.tours, k).y).toBeGreaterThan(0.8)
      vaisseau.tours.getMatrixAt(k, m4)
      p.setFromMatrixPosition(m4)
      // la base est sur le DESSUS du disque (z −9 dans le repère de la roue, où −z monte), dans ses 140 m
      expect(p.z).toBeCloseTo(-9)
      expect(Math.hypot(p.x, p.y)).toBeLessThan(140)
      quarts.add(Math.floor(((Math.atan2(p.y, p.x) + Math.PI) / (2 * Math.PI)) * 4) % 4)
    }
    expect(quarts.size).toBe(4)
    // aucun autre bloc d'instances ne pend vers le bas
    vaisseau.groupe.traverse((o) => {
      const im = o as THREE.InstancedMesh
      if (!im.isInstancedMesh) return
      for (let k = 0; k < im.count; k++) expect(sens(im, k).y).toBeGreaterThan(0.8)
    })
  })

  it('le DESSUS a quelques lumières : six toits sur dix allumés, balises rouges sur les plus hautes tours', () => {
    const { vaisseau } = monter()
    const pos = vaisseau.feux.geometry.getAttribute('position')
    const taille = vaisseau.feux.geometry.getAttribute('aS')
    let dessus = 0
    let balises = 0
    for (let i = 0; i < pos.count; i++) {
      if (pos.getZ(i) > -20) continue
      dessus++
      if (taille.getX(i) < 0) balises++
    }
    expect(balises).toBe(MOYEU_CITE.balises)
    expect(dessus).toBeGreaterThan(MOYEU_CITE.tours * 0.45)
    expect(dessus).toBeLessThan(MOYEU_CITE.tours * 0.85)
  })

  it('chaque feu de toit est au bout d un MÂT qui dépasse le bord du toit (vu d en dessous, sinon le toit le cache)', () => {
    const { vaisseau } = monter()
    vaisseau.groupe.updateMatrixWorld(true)
    const m4 = new THREE.Matrix4()
    const p = new THREE.Vector3()
    const e = new THREE.Vector3()
    const q = new THREE.Quaternion()
    const cle = (x: number, y: number): string => `${x.toFixed(2)},${y.toFixed(2)}`
    const toits = new Map<string, { z: number; demi: number }>()
    for (let k = 0; k < vaisseau.tours.count; k++) {
      vaisseau.tours.getMatrixAt(k, m4)
      m4.decompose(p, q, e)
      toits.set(cle(p.x, p.y), { z: p.z - e.y, demi: Math.max(e.x, e.z) / 2 })
    }
    expect(vaisseau.mats.count).toBeGreaterThan(MOYEU_CITE.tours * 0.45)
    for (let k = 0; k < vaisseau.mats.count; k++) {
      vaisseau.mats.getMatrixAt(k, m4)
      m4.decompose(p, q, e)
      const toit = toits.get(cle(p.x, p.y))
      expect(toit, 'le mât est planté sur une tour').toBeDefined()
      expect(p.z).toBeCloseTo(toit!.z)
      expect(e.y).toBeGreaterThan(toit!.demi + 3)
    }
    // et les feux du dessus sont au bout des mâts, pas à ras des toits
    const pos = vaisseau.feux.geometry.getAttribute('position')
    for (let i = 0; i < pos.count; i++) {
      if (pos.getZ(i) > -20) continue
      const toit = toits.get(cle(pos.getX(i), pos.getY(i)))
      expect(toit).toBeDefined()
      expect(toit!.z - pos.getZ(i)).toBeGreaterThan(toit!.demi + 3)
    }
  })

  it('le DESSOUS porte les cercles de feux d atterrissage, et une vague y court du centre vers le bord', () => {
    const { vaisseau } = monter()
    vaisseau.groupe.updateMatrixWorld(true)
    const { anneaux } = vaisseau
    expect(anneaux.parent).toBe(vaisseau.roue)
    const pos = anneaux.geometry.getAttribute('position')
    const rayons = new Set<number>()
    for (let i = 0; i < pos.count; i++) {
      // sous la plaque, dont la face du dessous est à z = 21 dans le repère de la roue
      expect(pos.getZ(i)).toBeGreaterThan(21)
      rayons.add(Math.round(Math.hypot(pos.getX(i), pos.getY(i))))
    }
    expect(rayons.size).toBe(MOYEU_CITE.anneaux)
    // +z de la roue pointe bien vers le bas du monde : les cercles sont SOUS la cité
    const bas = new THREE.Vector3(0, 0, 1).transformDirection(vaisseau.roue.matrixWorld)
    expect(bas.y).toBeLessThan(-0.9)
    // la vague : un pic de lumière au rayon fract(uT × 0,22), qui grandit avec le temps
    const vs = (anneaux.material as THREE.ShaderMaterial).vertexShader
    expect(vs).toMatch(/fract\(uT\*0\.22\)-r/)
  })

  it('les fenêtres des tours sont posées dans le repère de chaque tour : elles ne glissent pas quand la roue tourne', () => {
    const { vaisseau } = monter()
    const fs = (vaisseau.tours.material as THREE.ShaderMaterial).fragmentShader
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

  it('PLANE HAUT AU-DESSUS DU DÉCOR, sa roue mesure ses 600 m, et il reste sous la sphère du ciel', () => {
    const { vaisseau } = monter()
    // ce qu'il y a de plus haut sous lui : les tours lointaines, ≤ 50 m à cet endroit, et la tour de la
    // Spirale (x −95, z −230), antenne comprise vers 90 m
    expect(coque(vaisseau.groupe).min.y).toBeGreaterThan(200)
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

  it('LAISSE LA LUNE DANS SA TROUÉE : aucun rayon vers son disque ni son halo proche ne touche la coque, une tour ni un mât', () => {
    const { vaisseau } = monter()
    const pieces: THREE.Object3D[] = []
    vaisseau.groupe.updateMatrixWorld(true)
    vaisseau.groupe.traverse((o) => {
      const m = o as THREE.Mesh
      if (m.isMesh && !(m.material as THREE.ShaderMaterial).transparent) pieces.push(m)
    })
    expect(pieces).toContain(vaisseau.tours)
    expect(pieces).toContain(vaisseau.mats)
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

  it('« Au centre en haut » : au milieu de l écran, dans sa moitié haute, la lune à sa gauche', () => {
    const { vaisseau } = monter()
    const centre = coque(vaisseau.groupe).getCenter(new THREE.Vector3())
    // l'écran de l'utilisateur (1745 × 938) et les formats courants
    for (const aspect of [1745 / 938, 16 / 9, 16 / 10]) {
      const c = camera(aspect)
      const ecran = centre.clone().project(c)
      const lune = OEIL.clone().addScaledVector(directionLune(), 3000).project(c)
      expect(Math.abs(ecran.x)).toBeLessThan(0.15)
      expect(ecran.y).toBeGreaterThan(0.3)
      expect(lune.x).toBeLessThan(ecran.x - 0.35)
    }
  })

  it('« plus belle » : feux plus vifs, vague plus lumineuse et lueur plus large qu avant', () => {
    const { vaisseau } = monter()
    // avant : jante 7, disque 7, tramways 10, toits 10, cercles 6, vague 0,18 + 1,4, lueur 160 m à 0,3
    expect(ECLAT.jante).toBeGreaterThan(7)
    expect(ECLAT.disque).toBeGreaterThan(7)
    expect(ECLAT.tramways).toBeGreaterThan(10)
    expect(ECLAT.toits).toBeGreaterThan(10)
    expect(ECLAT.anneaux).toBeGreaterThan(6)
    expect(ECLAT.vaguePic).toBeGreaterThan(1.4)
    expect(ECLAT.lueur).toBeGreaterThan(160)
    // et le vaisseau s'en sert : les feux blancs de la jante, la vague des cercles, la lueur
    const tailles = vaisseau.feux.geometry.getAttribute('aS')
    let jante = 0
    for (let i = 0; i < tailles.count; i++) if (tailles.getX(i) === ECLAT.jante) jante++
    expect(jante).toBe(132)
    expect((vaisseau.anneaux.material as THREE.ShaderMaterial).vertexShader).toMatch(
      /vC=aC\*\(0\.30\+2\.00\*k\)/
    )
    let lueur = 0
    vaisseau.roue.traverse((o) => {
      if ((o as THREE.Sprite).isSprite && o.scale.x === ECLAT.lueur) lueur++
    })
    expect(lueur).toBe(1)
  })

  it('l éclaircie des câbles vise le vaisseau et couvre sa jante', () => {
    const { vaisseau } = monter()
    const { direction, rayon } = eclaircieVaisseau()
    const centre = coque(vaisseau.groupe).getCenter(new THREE.Vector3()).sub(OEIL)
    expect(centre.angleTo(direction)).toBeLessThan(0.03)
    vaisseau.roue.updateWorldMatrix(true, true)
    const taille = new THREE.Box3().setFromObject(vaisseau.roue).getSize(new THREE.Vector3())
    // le rayon apparent de la jante, feux compris (606 m de diamètre)
    expect(rayon).toBeCloseTo(Math.max(taille.x, taille.z) / 2 / VAISSEAU.distance, 1)
  })

  it('« plus grandes » : 423 px de large en 1600 × 900, plus de deux fois les 195 px d origine', () => {
    const { vaisseau } = monter()
    vaisseau.groupe.updateMatrixWorld(true)
    const c = camera(1600 / 900)
    const xs: number[] = []
    const p = new THREE.Vector3()
    vaisseau.groupe.traverse((o) => {
      const m = o as THREE.Mesh
      if (!m.isMesh || (m as unknown as THREE.InstancedMesh).isInstancedMesh) return
      if ((m.material as THREE.Material).transparent) return
      const pos = m.geometry.getAttribute('position')
      for (let i = 0; i < pos.count; i += 3)
        xs.push((p.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld).project(c).x + 1) * 800)
    })
    const largeur = Math.max(...xs) - Math.min(...xs)
    expect(largeur / 195).toBeGreaterThan(1.9)
    expect(largeur / 195).toBeLessThan(2.4)
  })

  it('TOUS SES FEUX partagent une seule taille en pixels, exposée pour que le reflet la réduise (conv-1037)', () => {
    // Dans l'eau (image à demi-résolution), cette taille doit être réduite de moitié : sinon chaque feu
    // de toit y est deux fois trop gros et déborde sur la plaque qui devrait le cacher.
    const { vaisseau } = monter()
    const points: THREE.Points[] = []
    vaisseau.groupe.traverse((o) => {
      if ((o as THREE.Points).isPoints) points.push(o as THREE.Points)
    })
    expect(points.length).toBeGreaterThanOrEqual(3)
    points.forEach((p) =>
      expect((p.material as THREE.ShaderMaterial).uniforms.uE).toBe(vaisseau.tailleFeux)
    )
    vaisseau.animer(2)
    expect(vaisseau.tailleFeux.value).toBeCloseTo(900 * 0.9 * GROSSISSEMENT_FEUX, 5)
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

  it('donne à la toile la direction du vaisseau : les câbles s éclaircissent devant lui', () => {
    expect(sans).toMatch(
      /import \{ eclaircieVaisseau, monterVaisseau \} from '\.\/home-decor-avenue-vaisseau'/
    )
    expect(sans).toMatch(/monterToile\(\{[\s\S]*?eclaircie: eclaircieVaisseau\(\)[\s\S]*?\}\)/)
  })

  it('confie la taille de ses feux au reflet de l eau, qui la réduit à sa résolution (conv-1037)', () => {
    expect(sans).toMatch(/spirale\.suivreLaResolution\(vaisseau\.tailleFeux\)/)
    expect(sans.indexOf('spirale.suivreLaResolution(')).toBeGreaterThan(
      sans.indexOf('const spirale = monterSpirale(')
    )
  })
})
