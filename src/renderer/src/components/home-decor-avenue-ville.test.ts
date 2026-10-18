import { readFileSync } from 'node:fs'
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { CAMERA_AVENUE } from './home-decor-avenue'
import { SPIRALE } from './home-decor-avenue-spirale'
import {
  AMBIANCE_KOWLOON,
  ANNEAU,
  HOLOGRAMMES,
  KOWLOON,
  monterVille,
  type ContexteVille
} from './home-decor-avenue-ville'

/**
 * LA VILLE DE GAUCHE DU FOND DE L'ACCUEIL : LE KOWLOON NÉON (conv-315).
 *
 * Demande de l'utilisateur : « /draft refais la ville de gauche du fond d'écran de l'accueil »,
 * « Affiner la 2 · Kowloon néon », puis « implémente 6 » — l'affinage 6 · Néons animés.
 *
 * ENTRÉES QUI DOIVENT FAIRE ÉCHOUER CE FICHIER :
 *   1. les réglages de la 6 changés (mouvement coupé, hologrammes retirés, graine changée) → ce
 *      n'est plus le quartier que l'utilisateur a choisi ;
 *   2. la ville tirée sur le hasard de la rue → elle change de visage dès qu'on touche à la rue ;
 *   3. une lumière ponctuelle ajoutée → toutes les matières de la rue s'alourdissent (conv-301) ;
 *   4. les enseignes ou les hologrammes qui ne regardent plus le trottoir → on lit leur tranche ;
 *   5. une texture dessinée gardée pour soi → elle n'est jamais libérée avec la scène ;
 *   6. l'ancienne ville (tours-boîtes, holo-panneaux, voies rapides) encore montée dans
 *      `home-decor-avenue.ts`, ou la nouvelle non animée dans `render`.
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

const CAMERA = [-5.55, 1.75, 10] as const

function monter(canevas = { height: 900 }): {
  ctx: ContexteVille
  ville: ReturnType<typeof monterVille>
} {
  const ctx: ContexteVille = {
    scene: new THREE.Scene(),
    SOL: -95,
    uT: { value: 0 },
    uFlash: { value: 0 },
    uBrume: { value: new THREE.Color(AMBIANCE_KOWLOON.brume) },
    camera: CAMERA,
    canevas,
    toile: (w, h) => [{ width: w, height: h } as HTMLCanvasElement, faux2d()],
    textures: []
  }
  return { ctx, ville: monterVille(ctx) }
}

const instances = (g: THREE.Object3D): THREE.InstancedMesh[] =>
  g.children.filter((o): o is THREE.InstancedMesh => (o as THREE.InstancedMesh).isInstancedMesh)

describe('la ville de gauche — Kowloon néon, affinage 6 (conv-315)', () => {
  it('garde les réglages de la 6 · Néons animés choisie', () => {
    expect(KOWLOON).toMatchObject({
      graine: 23,
      pas: 11,
      enseignes: 1.15,
      toitEnseignes: 0.3,
      caissons: 0.28,
      anime: true,
      hologrammes: true
    })
    expect(HOLOGRAMMES.map((h) => h.mot)).toEqual(['AUTOWIN', '夜市', 'NOIR HOLO', '電脳', 'SCOUT'])
    expect(AMBIANCE_KOWLOON.rue.pas).toBe(KOWLOON.pas)
  })

  it('A SA PROPRE GRAINE : deux montages donnent exactement le même quartier', () => {
    const a = monter().ville
    const b = monter().ville
    expect(a.enseignes).toBe(b.enseignes)
    const [qa] = instances(a.groupe)
    const [qb] = instances(b.groupe)
    expect(qa.count).toBe(qb.count)
    const ma = new THREE.Matrix4()
    const mb = new THREE.Matrix4()
    for (const i of [0, 17, qa.count - 1]) {
      qa.getMatrixAt(i, ma)
      qb.getMatrixAt(i, mb)
      expect(ma.elements).toEqual(mb.elements)
    }
  })

  it('UN QUARTIER BAS ET SERRÉ, HÉRISSÉ D ENSEIGNES, sous le trottoir près de la falaise', () => {
    const { ville } = monter()
    const [quartier] = instances(ville.groupe)
    // ~2 200 îlots de 11 m, un immeuble chacun, près de la moitié coiffés d'un bloc
    expect(quartier.count).toBeGreaterThan(2500)
    expect(ville.enseignes).toBeGreaterThan(3000)
    // au bord de la falaise, les toits restent sous nos pieds : c'est la vue plongeante
    const m = new THREE.Matrix4()
    const p = new THREE.Vector3()
    const q = new THREE.Quaternion()
    const s = new THREE.Vector3()
    for (let i = 0; i < quartier.count; i++) {
      quartier.getMatrixAt(i, m)
      m.decompose(p, q, s)
      if (p.x > -60) expect(p.y + s.y).toBeLessThan(0)
    }
  })

  it('N AJOUTE AUCUNE LUMIÈRE : l éclat des néons est dans les nuanceurs et des halos', () => {
    const { ctx } = monter()
    let lumieres = 0
    ctx.scene.traverse((o) => {
      if ((o as THREE.Light).isLight) lumieres++
    })
    expect(lumieres).toBe(0)
  })

  it('LES ENSEIGNES REGARDENT LE TROTTOIR, à quelques degrés près', () => {
    const { ville } = monter()
    const panneaux = instances(ville.groupe).find((m) => m.geometry.getAttribute('aUV'))
    expect(panneaux).toBeDefined()
    const m = new THREE.Matrix4()
    const p = new THREE.Vector3()
    const q = new THREE.Quaternion()
    const s = new THREE.Vector3()
    const normale = new THREE.Vector3()
    for (let i = 0; i < (panneaux as THREE.InstancedMesh).count; i += 97) {
      ;(panneaux as THREE.InstancedMesh).getMatrixAt(i, m)
      m.decompose(p, q, s)
      normale.set(0, 0, 1).applyQuaternion(q)
      const versNous = new THREE.Vector3(CAMERA[0] - p.x, 0, CAMERA[2] - p.z).normalize()
      // ± 0,15 rad de jeu : le cosinus reste au-dessus de cos(0,15)
      expect(normale.dot(versNous)).toBeGreaterThan(Math.cos(0.151))
    }
  })

  it('LE MOUVEMENT DE LA 6 : texte qui défile, hologrammes et anneau qui tournent', () => {
    const { ctx, ville } = monter()
    const enseignes = instances(ville.groupe).find((m) => m.geometry.getAttribute('aUV'))
    expect((enseignes?.material as THREE.ShaderMaterial).uniforms.uAnim.value).toBe(1)
    const tournants = ville.groupe.children.filter(
      (o) => (o as THREE.Mesh).isMesh && !(o as THREE.InstancedMesh).isInstancedMesh
    )
    // 5 hologrammes, 5 faisceaux, 1 anneau
    expect(tournants).toHaveLength(HOLOGRAMMES.length * 2 + 1)
    ville.animer(1)
    const avant = tournants.map((o) => o.rotation.y)
    ctx.uT.value = 4
    ville.animer(4)
    const apres = tournants.map((o) => o.rotation.y)
    expect(apres.filter((r, i) => r !== avant[i]).length).toBe(HOLOGRAMMES.length + 1)
  })

  it('LES HOLOGRAMMES SE TOURNENT VERS LE TROTTOIR', () => {
    const { ville } = monter()
    ville.animer(0)
    const plans = ville.groupe.children.filter(
      (o) =>
        (o as THREE.Mesh).isMesh &&
        !(o as THREE.InstancedMesh).isInstancedMesh &&
        (o as THREE.Mesh).geometry.type === 'PlaneGeometry'
    )
    expect(plans).toHaveLength(HOLOGRAMMES.length)
    for (const plan of plans) {
      const normale = new THREE.Vector3(0, 0, 1).applyEuler(plan.rotation)
      const versNous = new THREE.Vector3(
        CAMERA[0] - plan.position.x,
        0,
        CAMERA[2] - plan.position.z
      )
      expect(normale.dot(versNous.normalize())).toBeGreaterThan(0.95)
    }
  })

  it('LES HOLOGRAMMES ET L ANNEAU SE VOIENT DANS LE VRAI CADRE DE L ACCUEIL, hors de la tour de la Spirale', () => {
    // Aux positions du brouillon, quatre hologrammes et l'anneau tombaient hors de l'image et le
    // cinquième derrière la tour (2026-10-17) : on les projette ici dans la vraie caméra du fond.
    const { ctx, ville } = monter()
    ville.animer(0)
    ctx.scene.updateMatrixWorld(true)
    const plans = ville.groupe.children.filter(
      (o) =>
        (o as THREE.Mesh).isMesh &&
        !(o as THREE.InstancedMesh).isInstancedMesh &&
        (o as THREE.Mesh).geometry.type === 'PlaneGeometry'
    ) as THREE.Mesh[]
    expect(plans).toHaveLength(HOLOGRAMMES.length)
    const { x: TX, z: TZ, largeur: TL } = SPIRALE.tour
    // les fenêtres d'usage : 16:10, 16:9 et ultra-large
    for (const aspect of [16 / 10, 16 / 9, 21 / 9]) {
      const cam = new THREE.PerspectiveCamera(CAMERA_AVENUE.fov, aspect, 0.1, 6000)
      cam.position.set(...CAMERA_AVENUE.position)
      cam.lookAt(...CAMERA_AVENUE.cible)
      cam.updateMatrixWorld()
      const etendue = (pts: THREE.Vector3[]): [number, number] => {
        const xs = pts.map((p) => p.clone().project(cam).x)
        return [Math.min(...xs), Math.max(...xs)]
      }
      for (const plan of plans) {
        const g = plan.geometry as THREE.PlaneGeometry
        const { width: w, height: h } = g.parameters
        const coins = [
          [-w / 2, -h / 2],
          [w / 2, -h / 2],
          [-w / 2, h / 2],
          [w / 2, h / 2]
        ].map(([a, b]) => new THREE.Vector3(a, b, 0).applyMatrix4(plan.matrixWorld))
        const [g0, g1] = etendue(coins)
        // dans l'image, côté ville (moitié gauche)
        expect(g0).toBeGreaterThan(-1)
        expect(g1).toBeLessThan(0)
        // hors de la colonne de la tour, à la hauteur de l'hologramme
        const y = plan.position.y
        const [t0, t1] = etendue(
          [-1, 1].flatMap((a) =>
            [-1, 1].map((b) => new THREE.Vector3(TX + (a * TL) / 2, y, TZ + (b * TL) / 2))
          )
        )
        expect(g1 < t0 || g0 > t1).toBe(true)
        // tout entier au-dessus du trottoir : la vue vers son pied passe au-dessus du bord, à la
        // rambarde (x = −7,2 m, trottoir à 0,15 m : `GARDE` et `TROTTOIR` de home-decor-avenue.ts)
        const [CX, CY, CZ] = CAMERA_AVENUE.position
        const pied = new THREE.Vector3(0, -h / 2, 0).applyMatrix4(plan.matrixWorld)
        const k = (-7.2 - CX) / (pied.x - CX)
        expect(CY + k * (pied.y - CY)).toBeGreaterThan(0.15)
        expect(CZ + k * (pied.z - CZ)).toBeLessThan(CZ)
      }
      const anneau = ville.groupe.children.find(
        (o) =>
          (o as THREE.Mesh).geometry?.type === 'CylinderGeometry' &&
          ((o as THREE.Mesh).geometry as THREE.CylinderGeometry).parameters.radiusTop === 16
      ) as THREE.Mesh
      expect(
        Math.hypot(anneau.position.x - ANNEAU.vers[0], anneau.position.z - ANNEAU.vers[1])
      ).toBeLessThan(ANNEAU.rayon)
      const [a0, a1] = etendue([anneau.position])
      expect(a0).toBeGreaterThan(-1)
      expect(a1).toBeLessThan(0)
    }
  })

  it('REND TOUTES SES TEXTURES À L APPELANT, qui les libère avec la scène', () => {
    const { ctx } = monter()
    // le halo, l'atlas des enseignes, les cinq hologrammes, l'anneau
    expect(ctx.textures).toHaveLength(1 + 1 + HOLOGRAMMES.length + 1)
    const vues = new Set<THREE.Texture>()
    ctx.scene.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | undefined
      if (!m) return
      if ((m as THREE.SpriteMaterial).map)
        vues.add((m as THREE.SpriteMaterial).map as THREE.Texture)
      const uniformes: Record<string, THREE.IUniform> = (m as THREE.ShaderMaterial).uniforms ?? {}
      for (const u of Object.values(uniformes))
        if ((u.value as THREE.Texture)?.isTexture) vues.add(u.value as THREE.Texture)
    })
    for (const t of vues) expect(ctx.textures).toContain(t)
  })

  it('LA TAILLE DES LUMIÈRES SUIT LE CANEVAS DU FOND, pas la fenêtre', () => {
    const canevas = { height: 900 }
    const { ville } = monter(canevas)
    const points = ville.groupe.children.find((o) => (o as THREE.Points).isPoints) as THREE.Points
    const uE = (points.material as THREE.ShaderMaterial).uniforms.uE
    ville.animer(0)
    expect(uE.value).toBeCloseTo(810)
    canevas.height = 1400
    ville.animer(0.1)
    expect(uE.value).toBeCloseTo(1260)
  })
})

describe('branchement dans le fond de l Accueil (home-decor-avenue.ts)', () => {
  const avenue = readFileSync(new URL('./home-decor-avenue.ts', import.meta.url), 'utf8')
  const sans = (s: string): string => s.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')

  it('monte le Kowloon à la place de l ancienne ville', () => {
    expect(avenue).toMatch(/from '\.\/home-decor-avenue-ville'/)
    expect(sans(avenue)).toMatch(/monterVille\(\{/)
    // l'ancienne ville : tours-boîtes, holo-panneaux du centre, voies rapides et leurs balises
    expect(sans(avenue)).not.toMatch(/PANNEAUX|VOIES_V|majFlots|matTour|balises/)
  })

  it('l anime à chaque image, et la monte AVANT la compilation de la rue en tâche de fond', () => {
    const corps = sans(avenue)
    expect(corps).toMatch(/villeBasse\.animer\(t\)/)
    expect(corps.indexOf('monterVille(')).toBeLessThan(corps.indexOf('compilerEnFond(scene)'))
  })

  it('prend l ambiance du Kowloon pour le ciel, la brume et le damier des rues', () => {
    const corps = sans(avenue)
    expect(corps).toMatch(/new THREE\.Color\(AMBIANCE_KOWLOON\.brume\)/)
    expect(corps).toMatch(/AMBIANCE_KOWLOON\.horizon/)
    expect(corps).toMatch(/AMBIANCE_KOWLOON\.rue/)
  })
})
