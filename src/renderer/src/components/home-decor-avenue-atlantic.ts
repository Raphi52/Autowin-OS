import * as THREE from 'three'
import type { Cle, ContexteVoitures } from './home-decor-avenue-voitures'

/*
 * LA VOITURE GARÉE : L'« ATLANTIC VOLANTE » (conv-330).
 *
 * Demande de l'utilisateur : « /draft des plus belles voitures pour le fond d'écran de l'accueil ».
 * Tour 1 : six écoles de dessin ; il garde la 5 (Atlantic, streamliner art déco) et la 4 (Volante,
 * berline sans roues), « pas assez détaillées ». Tour 2 : six affinements détaillés ; il choisit la
 * 3 — « ouai go implémente la 3 » : la carrosserie de l'Atlantic, sans roues, qui flotte sur quatre
 * réacteurs ambrés. Elle remplace la GT nacrée garée le long du trottoir de droite, là où le
 * brouillon la montrait.
 *
 * Ce qu'elle porte, repris du brouillon (.autowin-tmp/draft-belles-voitures/f-tour2.js) :
 *   - une caisse en goutte tirée de ses sections (superellipses), ailes avant détachées qui gonflent
 *     au-dessus des anciens passages de roue, laque noire miroir, vitres CLAIRES (on voit dedans) ;
 *   - l'arête dorsale dorée du nez à la poupe, rivetée, la ceinture dorée, la calandre en fer à
 *     cheval, les phares ronds ambrés dans les ailes, les feux ronds ;
 *   - les détails : portes, capot, malle, poignées, rétroviseurs, cadre de vitre, ouïes, pare-chocs,
 *     échappements, mascotte ; dedans, deux baquets de cuir fauve, un volant, des cadrans ambrés ;
 *   - quatre réacteurs sous le ventre, turbines qui tournent, et leur lueur ambre sur la chaussée.
 *
 * Mêmes règles que les autres véhicules (home-decor-avenue-voitures.ts) : AUCUNE LUMIÈRE AJOUTÉE
 * (phares, cadrans et réacteurs sont des halos), aucun fichier chargé, la peinture reflète la carte
 * d'environnement de la rue. Côté programmes : les matières physiques gardent les mêmes options que
 * le reste ; seuls le verre (transparent) et les fonds unis en ajoutent, compilés avec la rue.
 */

/** Une forme de caisse à superellipses, avec ses ailes avant détachées. */
export interface FormeAtlantic {
  cles: readonly Cle[]
  S: number
  R: number
  /** Les anciens passages de roue : là où les ailes gonflent, et où sont les réacteurs. */
  roues: { z: readonly number[]; r: number }
  /** Gonflement des ailes en largeur, et en hauteur au-dessus des roues. */
  aile: number
  aileY: number
  vitre: { z0: number; z1: number; seuil: number; toit: number; arrondi: number }
  bas: number
}

/** Altitude de vol, en m, et largeur ajoutée par les ailes. */
export const VOL_ATLANTIC = 0.45

export const ATLANTIC: FormeAtlantic = {
  cles: [
    [-2.48, 0.34, 0.22, 0.44, 0.5, 2.4, 0],
    [-2.32, 0.68, 0.16, 0.48, 0.62, 2.6, 0],
    [-1.8, 0.82, 0.14, 0.54, 0.74, 2.8, 0.06],
    [-1, 0.86, 0.14, 0.58, 0.84, 2.8, 0.12],
    [-0.3, 0.88, 0.14, 0.6, 1.1, 2.6, 0.4],
    [0.5, 0.9, 0.14, 0.62, 1.2, 2.6, 0.46],
    [1.3, 0.9, 0.16, 0.62, 1.02, 2.6, 0.4],
    [2, 0.8, 0.2, 0.6, 0.8, 2.6, 0.28],
    [2.56, 0.4, 0.28, 0.56, 0.62, 2.4, 0.1]
  ],
  S: 160,
  R: 96,
  roues: { z: [-1.5, 1.45], r: 0.36 },
  // 0,05 : la caisse reste dans les 0,95 m de demi-largeur de la place (GAREE.demiLargeur)
  aile: 0.05,
  aileY: 0.15,
  vitre: { z0: -0.42, z1: 1.3, seuil: 0.52, toit: 0.9, arrondi: 0.4 },
  bas: -0.42
}

// ---------- LA CAISSE ----------

const TAU = Math.PI * 2
const catmull = (a: number, b: number, c: number, d: number, t: number): number =>
  0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (-a + 3 * b - 3 * c + d) * t * t * t)
const lisser = (t: number): number => {
  const u = Math.min(1, Math.max(0, t))
  return u * u * (3 - 2 * u)
}

function station(cles: readonly Cle[], u: number): number[] {
  const k = u * (cles.length - 1)
  const i = Math.min(cles.length - 2, Math.floor(k))
  const f = k - i
  const s: number[] = []
  for (let c = 0; c < 7; c++)
    s.push(
      catmull(cles[Math.max(0, i - 1)][c], cles[i][c], cles[i + 1][c], cles[Math.min(cles.length - 1, i + 2)][c], f)
    )
  s[1] = Math.max(0.005, s[1])
  return s
}

const rel = (n: number, a: number): [number, number] => {
  const c = Math.cos(a)
  const s = Math.sin(a)
  return [Math.sign(c) * Math.abs(c) ** (2 / n), Math.sign(s) * Math.abs(s) ** (2 / n)]
}

/** Le point d'angle `a` de la section `s`, gonflé de `g` (pour poser un jonc SUR la tôle). */
function pt(F: FormeAtlantic, s: number[], a: number, g: number, out: THREE.Vector3): THREE.Vector3 {
  const [z, w0, yb, ys, yt, n, tb] = s
  const [px, py] = rel(n, a)
  let w = w0 + g
  let dy = 0
  for (const zr of F.roues.z) {
    const d = (z - zr) / (F.roues.r * 2.2)
    const b = Math.exp(-d * d * 2.5)
    w += F.aile * b * Math.max(0, 1 - Math.abs(py + 0.05) / 0.8)
    if (py > 0) dy += F.aileY * b * lisser((Math.abs(px) - 0.3) / 0.5) * Math.min(1, py / 0.35)
  }
  if (py >= 0) return out.set(w * px * (1 - tb * py), ys + py * (yt + g - ys) + dy, z)
  return out.set(w * px * (1 + 0.1 * py), ys + py * (ys - (yb - g)), z)
}

export interface CaisseAtlantic {
  geo: THREE.BufferGeometry
  st: number[][]
}

/** S sections de R points, fermées devant et derrière ; groupes 0 tôle, 1 vitre, 2 bas de caisse. */
export function caisseAtlantic(F: FormeAtlantic): CaisseAtlantic {
  const { S, R } = F
  const st: number[][] = []
  for (let i = 0; i < S; i++) st.push(station(F.cles, i / (S - 1)))
  const pos: number[] = []
  const v = new THREE.Vector3()
  for (const s of st)
    for (let j = 0; j < R; j++) {
      pt(F, s, (j / R) * TAU, 0, v)
      pos.push(v.x, v.y, v.z)
    }
  const centre = (i: number, dz: number): number => {
    let y = 0
    for (let j = 0; j < R; j++) y += pos[(i * R + j) * 3 + 1]
    pos.push(0, y / R, st[i][0] + dz)
    return pos.length / 3 - 1
  }
  const cAv = centre(0, -0.012)
  const cAr = centre(S - 1, 0.012)
  const V = F.vitre
  const groupes: number[][] = [[], [], []]
  const matiere = (z: number, py: number): number => {
    if (z > V.z0 && z < V.z1) {
      const bord = Math.max(0, 1 - Math.min(z - V.z0, V.z1 - z) / V.arrondi)
      if (py > V.seuil + (1 - V.seuil) * 0.7 * bord * bord && py < V.toit) return 1
    }
    return py < F.bas ? 2 : 0
  }
  for (let i = 0; i < S - 1; i++) {
    const zm = (st[i][0] + st[i + 1][0]) / 2
    const n = (st[i][5] + st[i + 1][5]) / 2
    for (let j = 0; j < R; j++) {
      const a = i * R + j
      const b = i * R + ((j + 1) % R)
      const c = (i + 1) * R + j
      const d = (i + 1) * R + ((j + 1) % R)
      groupes[matiere(zm, rel(n, ((j + 0.5) / R) * TAU)[1])].push(a, b, c, b, d, c)
    }
  }
  for (let j = 0; j < R; j++) {
    const m = rel(2, ((j + 0.5) / R) * TAU)[1] < F.bas ? 2 : 0
    groupes[m].push(cAv, (j + 1) % R, j)
    groupes[m].push(cAr, (S - 1) * R + j, (S - 1) * R + ((j + 1) % R))
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  geo.setIndex(groupes.flat())
  let debut = 0
  groupes.forEach((g, m) => {
    geo.addGroup(debut, g.length, m)
    debut += g.length
  })
  geo.computeVertexNormals()
  geo.computeBoundingSphere()
  return { geo, st }
}

// ---------- SE POSER SUR LA TÔLE ----------

const idx = (st: number[][], z: number): number => {
  let b = 0
  for (let i = 1; i < st.length; i++) if (Math.abs(st[i][0] - z) < Math.abs(st[b][0] - z)) b = i
  return b
}
const angleDe = (n: number, py: number): number => (Math.sign(py) || 1) * Math.asin(Math.min(1, Math.abs(py)) ** (n / 2))
/** Le point du flanc (côté c = ±1) à la hauteur relative py de la station i, posé sur la tôle. */
function surTole(F: FormeAtlantic, st: number[][], i: number, py: number, c: number, g: number): THREE.Vector3 {
  const a = angleDe(st[i][5], py)
  const p = pt(F, st[i], c > 0 ? a : Math.PI - a, g, new THREE.Vector3())
  if (i === 0) p.z -= g * 2
  else if (i === st.length - 1) p.z += g * 2
  return p
}
const flanc = (F: FormeAtlantic, st: number[][], z: number, py: number, c: number, g = 0.004): THREE.Vector3 =>
  surTole(F, st, idx(st, z), py, c, g)
function ligne(F: FormeAtlantic, st: number[][], i0: number, i1: number, py: number, c: number, g: number): THREE.Vector3[] {
  const pts: THREE.Vector3[] = []
  const pas = i1 >= i0 ? 1 : -1
  for (let i = i0; pas > 0 ? i <= i1 : i >= i1; i += pas) pts.push(surTole(F, st, i, py, c, g))
  return pts
}
/** Le point du flanc droit à la demi-largeur x, cherché depuis le nez ou depuis la poupe. */
function auBout(F: FormeAtlantic, st: number[][], x: number, py: number, avant: boolean): THREE.Vector3 {
  for (let k = 0; k < st.length; k++) {
    const i = avant ? k : st.length - 1 - k
    const p = surTole(F, st, i, py, 1, 0)
    if (p.x >= x) return new THREE.Vector3(x, p.y, st[i][0] + (avant ? -0.012 : 0.012))
  }
  return new THREE.Vector3(x, 0.5, st[avant ? 0 : st.length - 1][0])
}
const paire = (p: THREE.Vector3): THREE.Vector3[] => [p, new THREE.Vector3(-p.x, p.y, p.z)]

// ---------- LA VOITURE ----------

export interface Atlantic {
  /** Le groupe posé par l'avenue (z suit la rue) ; la caisse y flotte à VOL_ATLANTIC. */
  g: THREE.Group
  /** Phares et feux, en coordonnées du groupe : les feux de détresse s'y allument. */
  phares: THREE.Vector3[]
  feux: THREE.Vector3[]
  /** Le point du flanc droit où se branche le câble de la borne. */
  prise: THREE.Vector3
  animer(t: number): void
}

export function monterAtlantic(ctx: ContexteVoitures, env: THREE.Texture): Atlantic {
  const { glow } = ctx
  const F = ATLANTIC
  const phys = (
    color: number,
    metalness: number,
    roughness: number,
    extra: THREE.MeshPhysicalMaterialParameters = {}
  ): THREE.MeshPhysicalMaterial =>
    new THREE.MeshPhysicalMaterial({
      color,
      metalness,
      roughness,
      clearcoat: 1,
      clearcoatRoughness: 0.05,
      envMap: env,
      envMapIntensity: 1.7,
      ...extra
    })
  const laque = phys(0x060609, 0.2, 0.08, { clearcoatRoughness: 0.02 })
  const verre = phys(0x1a1408, 0.1, 0.02, { transparent: true, opacity: 0.34, envMapIntensity: 2.8, depthWrite: false })
  const sombre = phys(0x0a0a0e, 0.5, 0.55, { clearcoat: 0.2 })
  const or = phys(0xd9b265, 1, 0.14, { envMapIntensity: 2.1 })
  const chrome = phys(0xe2e6ee, 1, 0.05, { envMapIntensity: 2.3 })
  const cuir = phys(0x7a3f1c, 0, 0.5, { clearcoat: 0.25, clearcoatRoughness: 0.4 })
  const planche = phys(0x3a1e0e, 0.1, 0.35)
  const fond = phys(0x0d0b0a, 0, 0.9, { clearcoat: 0 })
  const noir = new THREE.MeshBasicMaterial({ color: 0x020203 })
  const joint = new THREE.MeshBasicMaterial({ color: 0x030304 })
  const ambre = 0xffb04a

  const g = new THREE.Group()
  g.name = 'vehicule-atlantic'
  const corps = new THREE.Group()
  corps.position.y = VOL_ATLANTIC
  g.add(corps)
  const { geo, st } = caisseAtlantic(F)
  corps.add(new THREE.Mesh(geo, [laque, verre, sombre]))

  const tube = (pts: THREE.Vector3[], r: number, mat: THREE.Material, ferme = false): void => {
    if (pts.length < 2) return
    corps.add(
      new THREE.Mesh(
        new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, ferme), Math.min(420, pts.length * 2), r, 6, ferme),
        mat
      )
    )
  }
  const barre = (a: THREE.Vector3, b: THREE.Vector3, r: number, mat: THREE.Material): void => {
    const d = new THREE.Vector3().subVectors(b, a)
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, d.length(), 6), mat)
    m.position.copy(a).addScaledVector(d, 0.5)
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize())
    corps.add(m)
  }
  const boite = (w: number, h: number, l: number, p: THREE.Vector3, mat: THREE.Material): THREE.Mesh => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, l), mat)
    m.position.copy(p)
    corps.add(m)
    return m
  }
  /** Un feu rond : jonc, verre qui luit, halo — tourné vers `dir`. */
  const rond = (p: THREE.Vector3, dir: THREE.Vector3, r: number, coul: number): void => {
    const o = new THREE.Group()
    o.position.copy(p)
    o.lookAt(p.clone().add(dir))
    o.add(new THREE.Mesh(new THREE.TorusGeometry(r, r * 0.17, 8, 28), or))
    const d = new THREE.Mesh(new THREE.CircleGeometry(r * 0.9, 28), new THREE.MeshBasicMaterial({ color: coul }))
    d.position.z = -0.004
    o.add(d)
    corps.add(o)
    glow(coul, r * 5, 0, 0, 0.03, 0.9, o)
  }
  /** Une flaque de lumière à plat sur la chaussée (sous les réacteurs). */
  const flaque = (coul: number, l: number, p: number, op: number, z: number): void => {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(l, p).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({
        map: ctx.GLOW,
        color: coul,
        transparent: true,
        opacity: op,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      })
    )
    m.position.set(0, 0.035, z)
    g.add(m)
  }
  const S = st.length - 1

  // l'arête dorsale dorée, du nez à la poupe, ses rivets ; la ceinture dorée
  const dos = ligne(F, st, 1, S - 1, 1, 1, 0.012)
  tube(dos, 0.022, or)
  {
    const sphere = new THREE.SphereGeometry(0.012, 8, 6).toNonIndexed()
    const unite = sphere.getAttribute('position').array
    const pos: number[] = []
    for (const p of dos.filter((_, k) => k % 5 === 0))
      for (const dx of [-0.045, 0.045])
        for (let k = 0; k < unite.length; k += 3) pos.push(unite[k] + dx, unite[k + 1] + p.y - 0.004, unite[k + 2] + p.z)
    const rivets = new THREE.BufferGeometry()
    rivets.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    rivets.computeVertexNormals()
    corps.add(new THREE.Mesh(rivets, or))
    sphere.dispose()
  }
  for (const c of [1, -1]) tube(ligne(F, st, idx(st, -2.2), idx(st, 2.35), 0.3, c, 0.006), 0.008, or)

  // les phares ronds dans les ailes, la calandre en fer à cheval, les feux ronds
  const phares = paire(auBout(F, st, 0.58, 0.3, true))
  for (const p of phares) rond(p, new THREE.Vector3(Math.sign(p.x) * 0.25, 0.1, -1), 0.09, 0xffd08a)
  const nez = auBout(F, st, 0.001, 0, true)
  {
    const pts: THREE.Vector3[] = []
    for (let k = 0; k < 44; k++) {
      const a = (k / 44) * TAU
      pts.push(new THREE.Vector3(Math.cos(a) * 0.12, nez.y + Math.sin(a) * 0.17, nez.z - 0.03))
    }
    tube(pts, 0.014, or, true)
    const m = new THREE.Mesh(new THREE.CircleGeometry(1, 44), noir)
    m.scale.set(0.12, 0.17, 1)
    m.position.set(0, nez.y, nez.z - 0.022)
    m.rotation.y = Math.PI
    corps.add(m)
    for (let k = -2; k <= 2; k++)
      barre(
        new THREE.Vector3(k * 0.045, nez.y - 0.15, nez.z - 0.025),
        new THREE.Vector3(k * 0.045, nez.y + 0.15, nez.z - 0.025),
        0.005,
        or
      )
  }
  const feux = paire(auBout(F, st, 0.3, 0.2, false))
  for (const p of feux) rond(p, new THREE.Vector3(Math.sign(p.x) * 0.3, 0.1, 1), 0.045, 0xff3a18)

  // les coupes de tôle : portes, capot, malle
  for (const [z, py0, py1] of [
    [-0.3, -0.36, 0.5],
    [0.98, -0.36, 0.5]
  ])
    for (const c of [1, -1]) {
      const pts: THREE.Vector3[] = []
      for (let k = 0; k <= 12; k++) pts.push(flanc(F, st, z, py0 + ((py1 - py0) * k) / 12, c, 0.003))
      tube(pts, 0.006, joint)
    }
  for (const [z, py] of [
    [-0.48, 0.62],
    [1.78, 0.45]
  ]) {
    const s = st[idx(st, z)]
    const a = angleDe(s[5], py)
    const pts: THREE.Vector3[] = []
    for (let k = 0; k <= 18; k++) pts.push(pt(F, s, a + ((Math.PI - 2 * a) * k) / 18, 0.003, new THREE.Vector3()))
    tube(pts, 0.006, joint)
  }

  // poignées, rétroviseurs, cadre de vitre, ouïes sur les ailes
  for (const c of [1, -1]) {
    boite(0.022, 0.024, 0.16, flanc(F, st, 0.82, 0.38, c, 0.009), or)
    const p = flanc(F, st, -0.28, 0.5, c, 0)
    const t = p.clone().add(new THREE.Vector3(c * 0.14, 0.07, 0.03))
    barre(p, t, 0.013, or)
    const coque = new THREE.Mesh(new THREE.SphereGeometry(0.075, 18, 12), laque)
    coque.scale.set(1.1, 0.62, 1.5)
    coque.position.copy(t)
    corps.add(coque)
    const miroir = new THREE.Mesh(new THREE.CircleGeometry(0.06, 18), chrome)
    miroir.scale.set(1.05, 0.6, 1)
    miroir.position.copy(t).add(new THREE.Vector3(0, 0, 0.112))
    corps.add(miroir)
    tube(ligne(F, st, idx(st, F.vitre.z0 + 0.08), idx(st, F.vitre.z1 - 0.08), F.vitre.seuil + 0.02, c, 0.006), 0.008, or)
    for (let k = 0; k < 5; k++) {
      const z = -1.08 + k * 0.075
      barre(flanc(F, st, z, -0.12, c, 0.007), flanc(F, st, z + 0.07, 0.2, c, 0.007), 0.008, or)
    }
  }

  // pare-chocs, échappements, mascotte
  for (const avant of [true, false])
    for (const c of [1, -1]) {
      const a = auBout(F, st, 0.64, -0.22, avant)
      const b = auBout(F, st, 0.28, -0.22, avant)
      const dz = avant ? -0.035 : 0.035
      barre(new THREE.Vector3(c * a.x, a.y, a.z + dz), new THREE.Vector3(c * b.x, b.y, b.z + dz), 0.02, or)
    }
  {
    const p = auBout(F, st, 0.32, -0.55, false)
    for (const c of [1, -1]) {
      const e = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.036, 0.16, 16, 1, true).rotateX(Math.PI / 2), chrome)
      e.position.set(c * 0.32, p.y, p.z - 0.03)
      corps.add(e)
      const d = new THREE.Mesh(new THREE.CircleGeometry(0.03, 16), noir)
      d.position.set(c * 0.32, p.y, p.z + 0.03)
      corps.add(d)
    }
    const s = st[idx(st, -2.12)]
    const h = pt(F, s, Math.PI / 2, 0, new THREE.Vector3())
    const aile = new THREE.Shape()
    aile.moveTo(0, 0)
    aile.lineTo(-0.2, 0)
    aile.lineTo(-0.02, 0.11)
    aile.closePath()
    const m = new THREE.Mesh(new THREE.ExtrudeGeometry(aile, { depth: 0.012, bevelEnabled: false }).rotateY(Math.PI / 2), or)
    m.position.set(-0.006, h.y - 0.005, h.z)
    corps.add(m)
  }

  // l'habitacle : un fond sombre, deux baquets de cuir fauve, un volant, une planche aux cadrans ambrés
  {
    const V = F.vitre
    const s = st[idx(st, (V.z0 + V.z1) / 2)]
    const w = s[1] * 0.78
    const y0 = s[2] + 0.18
    const zs = 0.5
    const zd = -0.18
    boite(w * 2, 0.12, V.z1 - V.z0 - 0.1, new THREE.Vector3(0, s[2] + 0.1, (V.z0 + V.z1) / 2), fond)
    for (const c of [-1, 1]) {
      const x = c * w * 0.46
      boite(0.44, 0.1, 0.48, new THREE.Vector3(x, y0, zs), cuir)
      const dossier = new THREE.Mesh(new THREE.CapsuleGeometry(0.17, 0.25, 6, 14), cuir)
      dossier.scale.set(1.25, 1, 0.42)
      dossier.position.set(x, y0 + 0.32, zs + 0.26)
      dossier.rotation.x = 0.28
      corps.add(dossier)
      const tete = new THREE.Mesh(new THREE.SphereGeometry(0.1, 14, 10), cuir)
      tete.scale.set(1.1, 0.85, 0.5)
      tete.position.set(x, y0 + 0.72, zs + 0.4)
      corps.add(tete)
    }
    const volant = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.018, 8, 28), sombre)
    volant.position.set(-w * 0.46, y0 + 0.4, zd + 0.28)
    volant.rotation.x = -0.45
    corps.add(volant)
    boite(w * 2, 0.14, 0.32, new THREE.Vector3(0, y0 + 0.36, zd), planche)
    const lueur = new THREE.MeshBasicMaterial({ color: 0xffb060 })
    for (const [x, l] of [
      [-0.34, 0.12],
      [0, 0.28],
      [0.34, 0.12]
    ]) {
      const e = new THREE.Mesh(new THREE.PlaneGeometry(l, 0.06), lueur)
      e.position.set(x, y0 + 0.44, zd + 0.165)
      e.rotation.x = -0.5
      corps.add(e)
      glow(0xffb060, l * 1.5, x, y0 + 0.46, zd + 0.1, 0.4, corps)
    }
  }

  // les quatre réacteurs : nacelle noyée dans le ventre, turbine qui tourne, halo et flaque ambre
  const rotors: THREE.Group[] = []
  const flammes: THREE.Sprite[] = []
  {
    const sourd = new THREE.MeshBasicMaterial({ color: new THREE.Color(ambre).multiplyScalar(0.18) })
    const vif = new THREE.MeshBasicMaterial({ color: ambre })
    for (const z of F.roues.z)
      for (const c of [-1, 1]) {
        const y = st[idx(st, z)][2]
        const x = c * 0.58
        const n = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.22, 0.22, 28), sombre)
        n.position.set(x, y + 0.06, z)
        corps.add(n)
        const t = new THREE.Group()
        t.position.set(x, y - 0.052, z)
        corps.add(t)
        t.add(new THREE.Mesh(new THREE.CircleGeometry(0.17, 28).rotateX(Math.PI / 2), sourd))
        const r = new THREE.Group()
        r.position.y = -0.006
        t.add(r)
        for (let k = 0; k < 9; k++) {
          const a = (k * TAU) / 9
          const pale = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.006, 0.045), chrome)
          pale.position.set(Math.cos(a) * 0.085, 0, Math.sin(a) * 0.085)
          pale.rotation.set(0.55, -a, 0, 'YXZ')
          r.add(pale)
        }
        const an = new THREE.Mesh(new THREE.TorusGeometry(0.175, 0.013, 6, 40).rotateX(Math.PI / 2), vif)
        an.position.y = -0.004
        t.add(an)
        rotors.push(r)
        flammes.push(glow(ambre, 1.1, x, y - 0.12, z, 0.85, corps))
      }
    for (const z of F.roues.z) flaque(ambre, 2.4, 1.8, 0.6, z)
    flaque(0xffa040, 3, 5.4, 0.25, 0)
  }

  const enVol = (p: THREE.Vector3): THREE.Vector3 => p.clone().setY(p.y + VOL_ATLANTIC)
  return {
    g,
    phares: phares.map(enVol),
    feux: feux.map(enVol),
    prise: enVol(flanc(F, st, 1.2, 0.1, 1, 0)),
    animer(t) {
      corps.position.y = VOL_ATLANTIC + 0.02 * Math.sin(t * 2.1)
      for (const r of rotors) r.rotation.y = t * 7
      for (const f of flammes)
        f.material.opacity = 0.7 + 0.22 * Math.sin(t * 29 + f.position.z * 7 + f.position.x * 3)
    }
  }
}
