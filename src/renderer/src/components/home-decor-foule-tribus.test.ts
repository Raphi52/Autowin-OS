// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { FIGURANTS } from './home-decor-figurants'
import { AVATARS, HEURE_DE_POINTE } from './home-decor-foule'
import {
  creerTailleur,
  mesurer,
  neonDe,
  nuancer,
  numeroAvatar,
  STYLE_TRIBU,
  TRIBUS,
  yeuxDeLiaison
} from './home-decor-foule-tribus'

/**
 * CE QUE L'UTILISATEUR A DEMANDÉ, conv-312 : « ils doivent tous avoir l'air de voyous du futur »,
 * puis, devant les six tribus rendues dans le vrai décor, « implémente survet et punk ».
 *
 * ENTRÉES QUI DOIVENT FAIRE ÉCHOUER CE FICHIER :
 *   1. une personne sans tribu, ou toute la foule dans la même → la demande n'est pas tenue ;
 *   2. un repère du nuanceur de three renommé → la tribu disparaît EN SILENCE sans l'erreur nommée ;
 *   3. un accessoire accroché au mauvais os → la crête flotte au-dessus des épaules ;
 *   4. une pièce par clou au lieu d'une géométrie fusionnée → 37 objets dessinés par punk au lieu de 5.
 */

describe('foule de l Accueil — deux tribus de voyous du futur', () => {
  it('chaque personne a sa tribu, et la rue mélange survêt et punks sur les deux trottoirs', () => {
    expect(Object.keys(TRIBUS).sort()).toEqual(Object.keys(AVATARS).sort())
    const tribus = HEURE_DE_POINTE.map((p) => TRIBUS[p.av])
    expect(tribus.filter((t) => t === 'survet')).toHaveLength(9)
    expect(tribus.filter((t) => t === 'punk')).toHaveLength(9)
    for (const cote of [-1, 1]) {
      const ici = new Set(
        HEURE_DE_POINTE.filter((p) => Math.sign(p.x) === cote).map((p) => TRIBUS[p.av])
      )
      expect(ici, `trottoir ${cote}`).toEqual(new Set(['survet', 'punk']))
    }
    // au deal, deux tribus face à face : le dealer en survêt', le client punk
    expect(TRIBUS[FIGURANTS.dealer]).toBe('survet')
    expect(TRIBUS[FIGURANTS.client]).toBe('punk')
    // cagoule et crâne rasé : aucune mèche de cheveux à monter
    expect(STYLE_TRIBU.survet.cheveux).toBe(false)
    expect(STYLE_TRIBU.punk.cheveux).toBe(false)
  })

  it('lit le numéro de la personne dans le nom de ses matières', () => {
    expect(numeroAvatar('m023_body')).toBe(23)
    expect(numeroAvatar('f170_hat')).toBe(170)
    expect(numeroAvatar('sans numero')).toBe(0)
  })

  it('habille les matières sur les VRAIS repères des nuanceurs de three, un programme par tribu', () => {
    const essai = (
      tribu: 'survet' | 'punk'
    ): { sh: THREE.WebGLProgramParametersWithUniforms; m: THREE.MeshStandardMaterial } => {
      const m = new THREE.MeshStandardMaterial()
      nuancer(m, tribu, {
        tete: true,
        cheveux: false,
        oeil: new THREE.Vector3(0, -8, 165),
        numero: 23
      })
      const sh = {
        uniforms: {},
        vertexShader: THREE.ShaderLib.standard.vertexShader,
        fragmentShader: THREE.ShaderLib.standard.fragmentShader
      } as unknown as THREE.WebGLProgramParametersWithUniforms
      m.onBeforeCompile(sh, {} as THREE.WebGLRenderer)
      return { sh, m }
    }
    const survet = essai('survet')
    const punk = essai('punk')
    expect(survet.sh.fragmentShader).toMatch(/bandesSurvet\(vBind, vBindN\)/)
    expect(survet.sh.fragmentShader).toMatch(/float fente =/)
    expect(punk.sh.fragmentShader).toMatch(/float barbele =/)
    expect(punk.sh.fragmentShader).not.toMatch(/float fente =/)
    expect(survet.sh.vertexShader).toMatch(/vBind = position; vBindN = normal;/)
    expect(Object.keys(survet.sh.uniforms).sort()).toEqual(
      ['uAppoint', 'uCheveux', 'uCouleur', 'uNeon', 'uOeil', 'uTete'].sort()
    )
    expect(survet.sh.uniforms.uTete.value).toBe(1)
    expect(survet.sh.uniforms.uAppoint.value).toBe(STYLE_TRIBU.survet.appoint)
    expect(survet.m.customProgramCacheKey()).toBe('foule-survet')
    expect(punk.m.customProgramCacheKey()).toBe('foule-punk')
    // Un repère disparu est une erreur nommée, pas une tribu qui s'efface sans bruit.
    const m = new THREE.MeshStandardMaterial()
    nuancer(m, 'punk', { tete: false, cheveux: false, oeil: new THREE.Vector3(), numero: 1 })
    const casse = { uniforms: {}, vertexShader: 'void main() {}', fragmentShader: '' }
    expect(() =>
      m.onBeforeCompile(
        casse as unknown as THREE.WebGLProgramParametersWithUniforms,
        {} as THREE.WebGLRenderer
      )
    ).toThrow(/sans le repère #include <common>/)
  })

  it('mesure le corps dans la pose de liaison : yeux, dos, poitrine, cou', () => {
    const { racine, corps } = squelette('m001_body')
    const yeux = yeuxDeLiaison(corps)
    // les deux yeux sont à ±3,2 de l'axe : leur milieu est sur l'axe, au niveau de l'os des yeux
    expect(yeux.z).toBeCloseTo(0, 6)
    expect(yeux.x).toBeCloseTo(TETE_X + 11.1, 6)
    expect(yeux.y).toBeCloseTo(7, 6)
    const m = mesurer(racine)
    expect(m.s).toBeCloseTo(1, 6)
    expect(m.dos).toBeCloseTo(-15, 6)
    expect(m.poitrine).toBeCloseTo(15, 6)
    expect(m.cou.x).toBeCloseTo(20, 6)
    expect(m.epG.z).toBeGreaterThan(0)
    expect(m.epD.z).toBeLessThan(0)
  })

  it('accroche les accessoires du punk à la tête, au torse et au cou, fusionnés en cinq objets', () => {
    const tailleur = creerTailleur()
    const a = squelette('m018_body').racine
    const b = squelette('m018_body').racine
    tailleur.habiller(a, 'M18', 0)
    tailleur.habiller(b, 'M18', 1)
    const pieces = accessoires(a)
    expect(pieces.map((p) => p.name).sort()).toEqual(
      [
        'punk-clous-collier',
        'punk-clous-epaules',
        'punk-collier',
        'punk-crete',
        'punk-epaulettes'
      ].sort()
    )
    const crete = pieces.find((p) => p.name === 'punk-crete')
    expect(osPorteur(crete)).toBe('Bip01_Head')
    expect(osPorteur(pieces.find((p) => p.name === 'punk-epaulettes'))).toBe('Bip01_Spine2')
    expect(osPorteur(pieces.find((p) => p.name === 'punk-collier'))).toBe('Bip01_Neck')
    // la crête est AU-DESSUS du crâne : dans le repère de la tête, ses pics montent le long de x
    crete?.geometry.computeBoundingBox()
    const boite = crete?.geometry.boundingBox
    expect(boite && boite.max.y).toBeGreaterThan(10)
    // deux copies d'une personne : mêmes géométries, néon de crête différent
    const creteB = accessoires(b).find((p) => p.name === 'punk-crete')
    expect(creteB?.geometry).toBe(crete?.geometry)
    expect((creteB?.material as THREE.MeshBasicMaterial).color.getHex()).not.toBe(
      (crete?.material as THREE.MeshBasicMaterial).color.getHex()
    )
    expect(new THREE.Color(neonDe(18)).multiplyScalar(1.35).getHex()).toBe(
      (crete?.material as THREE.MeshBasicMaterial).color.getHex()
    )
    expect(tailleur.textures()).toHaveLength(0)
  })

  it('pose la chaîne en or du survêt sur le torse, et dessine son reflet sans charger d image', () => {
    const tailleur = creerTailleur()
    const r = squelette('f007_body').racine
    tailleur.habiller(r, 'F07', 0)
    const pieces = accessoires(r)
    expect(pieces.map((p) => p.name)).toEqual(['survet-chaine'])
    expect(osPorteur(pieces[0])).toBe('Bip01_Spine2')
    expect((pieces[0].material as THREE.MeshMatcapMaterial).matcap).toBeInstanceOf(
      THREE.CanvasTexture
    )
    expect(tailleur.textures()).toHaveLength(1)
    // aucune lumière ajoutée : la rue ne recompile pas ses programmes à l'arrivée de la foule
    let lumieres = 0
    r.traverse((o) => {
      if ((o as THREE.Light).isLight) lumieres++
    })
    expect(lumieres).toBe(0)
    // Sous happy-dom, `import.meta.url` n'est pas une adresse `file:` : la source est lue par son chemin.
    const source = readFileSync(
      join(process.cwd(), 'src/renderer/src/components/home-decor-foule-tribus.ts'),
      'utf8'
    )
    expect(source).not.toMatch(/Light\s*\(|\bfetch\s*\(|new Image\b|Loader\b|\.src\s*=|url\(/)
  })
})

// ─────────────────────────────── un squelette Rocketbox réduit ───────────────────────────────
/** Le torse, puis la tête au-dessus : les os ont l'axe x vers le haut, comme ceux de Rocketbox. */
const TORSE_X = 120
const TETE_X = TORSE_X + 30

function squelette(nomMatiere: string): { racine: THREE.Group; corps: THREE.SkinnedMesh } {
  const os: THREE.Bone[] = []
  const nouvel = (
    nom: string,
    x: number,
    y: number,
    z: number,
    parent?: THREE.Bone
  ): THREE.Bone => {
    const b = new THREE.Bone()
    b.name = nom
    b.position.set(x, y, z)
    parent?.add(b)
    os.push(b)
    return b
  }
  const bip = nouvel('Bip01', 0, 0, 0)
  const torse = nouvel('Bip01_Spine2', TORSE_X, 0, 0, bip)
  const cou = nouvel('Bip01_Neck', 20, 0, 0, torse)
  const tete = nouvel('Bip01_Head', 10, 0, 0, cou)
  nouvel('Bip01_LEye', 11.1, 7, 3.2, tete)
  nouvel('Bip01_REye', 11.1, 7, -3.2, tete)
  nouvel('Bip01_L_UpperArm', 15, 0, 18, torse)
  nouvel('Bip01_R_UpperArm', 15, 0, -18, torse)
  // la peau du torse : une boîte de 30 cm de profondeur centrée sur la colonne mesurée (x + 4)
  const geo = new THREE.BoxGeometry(20, 30, 30, 4, 6, 6)
  geo.translate(TORSE_X + 4, 0, 0)
  const n = geo.attributes.position.count
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(new Uint16Array(n * 4), 4))
  geo.setAttribute(
    'skinWeight',
    new THREE.Float32BufferAttribute(new Float32Array(n * 4).fill(0.25), 4)
  )
  const corps = new THREE.SkinnedMesh(geo, new THREE.MeshStandardMaterial({ name: nomMatiere }))
  const racine = new THREE.Group()
  racine.add(bip, corps)
  racine.updateMatrixWorld(true)
  corps.bind(new THREE.Skeleton(os))
  return { racine, corps }
}

function accessoires(racine: THREE.Object3D): THREE.Mesh[] {
  const out: THREE.Mesh[] = []
  racine.traverse((o) => {
    if (/^(punk|survet)-/.test(o.name)) out.push(o as THREE.Mesh)
  })
  return out
}
/** L'os auquel est accroché le socle d'un accessoire. */
function osPorteur(mesh: THREE.Object3D | undefined): string | undefined {
  return mesh?.parent?.parent?.name
}
