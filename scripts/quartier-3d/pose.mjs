// Les gestes du tanuki pour le dojo et les pauses (conv-1428), sur le vrai squelette de la fiche.
// Usage (depuis l'atelier conv-1421/gen) : node ../../conv-1428/pose.mjs sortie.bin geste temps durée [avancée de l'assise, de 0 à 1]
// Boucles : tout passe par des sinus de 2π·t/d, la dernière image rejoint la première.
import * as THREE from 'three'
import { readFileSync, writeFileSync } from 'node:fs'
globalThis.THREE = THREE
const src = readFileSync(new URL('./marionnette.js', import.meta.url), 'utf8')
const TOUR = 2 * Math.PI
const COUSSIN = 0.1
const borne = (x, a, b) => Math.max(0, Math.min(1, (x - a) / (b - a)))
const lisse = (x) => x * x * (3 - 2 * x)

function assoirTailleur(o) {
  o.hanches.position.y = o.hanches.userData.r.y - 0.31 + COUSSIN
  o.cuG.rotation.set(-1.5, 0, 1.25)
  o.cuD.rotation.set(-1.5, 0, -1.25)
  o.tiG.rotation.set(0, 0, -2.1)
  o.tiD.rotation.set(0, 0, 2.1)
  o.piG.rotation.x = 0.6
  o.piD.rotation.x = 0.6
}

const POSES = {
  // Assis sur le coussin, en tailleur, le dos droit, les mains jointes dans le creux des jambes. Inspirer
  // gonfle le buste et lève les épaules ; le reste du corps suit un peu après.
  zazen(c, t, d) {
    const a = Math.sin((TOUR * t) / d)
    const b = Math.sin((TOUR * t) / d - 0.7)
    const o = c.o
    assoirTailleur(o)
    o.buste.rotation.set(-0.03 + 0.02 * a, 0, 0)
    o.buste.position.y = o.buste.userData.r.y + 0.014 * a
    const s = 1 + 0.028 * a
    o.buste.scale.set(s, 1, s)
    // Les bras du tanuki sont courts : les mains se rejoignent bas, juste au-dessus des chevilles.
    o.epD.rotation.set(-0.74 + 0.02 * b, 0, 0.84 + 0.02 * a)
    o.coD.rotation.set(-0.42, 0, 0)
    o.epG.rotation.set(-0.74 + 0.02 * b, 0, -0.84 - 0.02 * a)
    o.coG.rotation.set(-0.42, 0, 0)
    o.tete.rotation.set(0.2 - 0.03 * a, 0, 0)
    o.oG.rotation.z = -0.1 - 0.05 * b
    o.oD.rotation.z = 0.1 + 0.05 * b
    o.q1.rotation.set(1.02, 0.25, 0)
    o.q2.rotation.y = 0.4 + 0.14 * b
    o.q3.rotation.y = 0.3 + 0.16 * a
  },
  // Boire le thé : même assise, le bol monte à deux mains, une gorgée, il redescend, il souffle.
  the(c, t, d) {
    const u = (t / d) % 1
    const o = c.o
    POSES.zazen(c, t, d)
    const leve = lisse(borne(u, 0.14, 0.32)) * (1 - lisse(borne(u, 0.62, 0.8)))
    const bois = lisse(borne(u, 0.34, 0.42)) * (1 - lisse(borne(u, 0.54, 0.62)))
    // Les bras sont courts : c'est le buste et la tête qui descendent vers le bol, comme à une vraie cérémonie.
    o.epD.rotation.set(-0.74 - 0.72 * leve, 0, 0.84)
    o.coD.rotation.x = -0.42 - 0.3 * leve
    o.epG.rotation.set(-0.74 - 0.72 * leve, 0, -0.84)
    o.coG.rotation.x = -0.42 - 0.3 * leve
    o.tete.rotation.set(0.1 + 0.3 * bois, 0, 0)
    o.buste.rotation.x = -0.02 + 0.2 * bois
    o.oG.rotation.z = -0.12 - 0.14 * bois
    o.oD.rotation.z = 0.12 + 0.14 * bois
  },
  // Assis au bord : les jambes pendent dans le vide et se balancent l'une après l'autre.
  bord(c, t, d) {
    const a = Math.sin((TOUR * t) / d)
    const b = Math.sin((TOUR * t) / d + 1.9)
    const o = c.o
    o.hanches.position.y = o.hanches.userData.r.y - 0.172
    o.cuG.rotation.set(-1.5, 0, 0.12)
    o.cuD.rotation.set(-1.5, 0, -0.12)
    o.tiG.rotation.set(1.5 - 0.42 * a, 0, 0)
    o.tiD.rotation.set(1.5 - 0.42 * b, 0, 0)
    o.piG.rotation.x = 0.1
    o.piD.rotation.x = 0.1
    o.buste.rotation.set(-0.16 + 0.02 * a, 0, 0)
    o.epD.rotation.set(0.55, 0, 0.3)
    o.coD.rotation.x = -0.2
    o.epG.rotation.set(0.55, 0, -0.3)
    o.coG.rotation.x = -0.2
    o.tete.rotation.set(-0.04 + 0.03 * b, 0.34 * Math.sin((TOUR * t) / d / 2 + 0.6), 0.04 * a)
    o.oG.rotation.z = -0.08
    o.oD.rotation.z = 0.08
    o.q1.rotation.set(1.25, 0, 0)
    o.q2.rotation.y = 0.18 * a
    o.q3.rotation.y = 0.2 * b
  },
  // Ratisser le sable : il tire le râteau vers lui en reculant le buste, puis le renvoie.
  rateau(c, t, d) {
    const a = Math.sin((TOUR * t) / d)
    const o = c.o
    o.buste.rotation.set(0.3 + 0.2 * a, 0.1 * a, 0)
    o.hanches.position.y = o.hanches.userData.r.y - 0.05
    o.cuG.rotation.x = -0.42
    o.tiG.rotation.x = 0.62
    o.piG.rotation.x = -0.2
    o.cuD.rotation.x = 0.24
    o.tiD.rotation.x = 0.28
    o.piD.rotation.x = -0.5
    o.epD.rotation.set(-1.15 - 0.34 * a, 0, -0.02)
    o.coD.rotation.x = -0.42 + 0.24 * a
    o.epG.rotation.set(-1.0 - 0.34 * a, 0, 0.04)
    o.coG.rotation.x = -0.2 + 0.24 * a
    o.tete.rotation.set(0.14, 0, 0)
    o.q1.rotation.set(0.9, 0.18 * a, 0)
    o.q2.rotation.y = 0.2 * a
  },
  // Arroser : le bras tendu, l'arrosoir penché ; il se balance doucement d'un pied sur l'autre.
  arrose(c, t, d) {
    const a = Math.sin((TOUR * t) / d)
    const o = c.o
    o.buste.rotation.set(0.1, 0, 0.03 * a)
    o.epD.rotation.set(-1.42 + 0.05 * a, 0, 0.22)
    o.coD.rotation.x = -0.1
    o.epG.rotation.set(0.1, 0, -0.22)
    o.coG.rotation.x = -0.7
    o.tete.rotation.set(0.22, 0, 0.03 * a)
    o.q1.rotation.set(0.9, 0.16 * a, 0)
    o.q2.rotation.y = 0.14 * a
  },
  // Keiko : en garde, le sabre de bois monte au-dessus de la tête, frappe, revient.
  keiko(c, t, d) {
    const u = (t / d) % 1
    const o = c.o
    const monte = lisse(borne(u, 0.12, 0.42))
    const frappe = borne(u, 0.42, 0.56) ** 2
    const retour = lisse(borne(u, 0.7, 1))
    const b = (monte - frappe * 1.28) * (1 - retour) // 1 en haut, -.28 après la frappe, 0 en garde
    o.hanches.position.y = o.hanches.userData.r.y - 0.06 - 0.03 * frappe * (1 - retour)
    o.cuG.rotation.x = -0.5
    o.tiG.rotation.x = 0.66
    o.piG.rotation.x = -0.16
    o.cuD.rotation.x = 0.28
    o.tiD.rotation.x = 0.34
    o.piD.rotation.x = -0.6
    o.buste.rotation.set(0.12 - 0.14 * b, 0, 0)
    o.epD.rotation.set(-0.95 - 1.5 * b, 0, 0.72 - 0.46 * Math.max(0, b))
    o.coD.rotation.x = -0.5 + 0.2 * Math.max(0, b)
    o.epG.rotation.set(-0.95 - 1.5 * b, 0, -0.72 + 0.46 * Math.max(0, b))
    o.coG.rotation.x = -0.5 + 0.2 * Math.max(0, b)
    o.tete.rotation.set(0.02, 0, 0)
    o.q1.rotation.set(0.9, 0, 0)
  }
}

const api = new Function(src + ';return { chargerTanuki, creerTanuki, poseMarche }')()
const M = JSON.parse(readFileSync('b3d/' + (process.env.MODELE || 'renard') + '-hd.json', 'utf8'))
const T = await api.chargerTanuki(M)
const c = api.creerTanuki(T)
const [sortie, geste, tt, dd, entree] = process.argv.slice(2)
api.poseMarche(c, 0.25, 0)
c.o.buste.rotation.set(0.02, 0, 0)
c.o.tete.rotation.set(-0.04, 0, 0)
c.o.coG.rotation.x = -0.22
c.o.coD.rotation.x = -0.22
const capter = () =>
  Object.fromEntries(
    Object.entries(c.o).map(([n, b]) => [
      n,
      { q: b.quaternion.clone(), p: b.position.clone(), s: b.scale.clone() }
    ])
  )
let ferme = geste === 'zazen' ? 1 : 0
if (process.env.IK) {
  // Cherche les angles du bras qui amènent la main à un point donné, par descente coordonnée.
  POSES[geste](c, Number(tt ?? 0), Number(dd ?? 1))
  const [nom, cx, cy, cz] = process.env.IK.split(',')
  const cible = new THREE.Vector3(Number(cx), Number(cy), Number(cz))
  const ep = c.o['ep' + nom], co = c.o['co' + nom]
  const main = () => {
    c.m.updateMatrixWorld(true)
    const p = co.getWorldPosition(new THREE.Vector3())
    const av = new THREE.Vector3(0, -1, 0).applyQuaternion(co.getWorldQuaternion(new THREE.Quaternion()))
    return p.addScaledVector(av, 0.1)
  }
  const val = [ep.rotation.x, ep.rotation.y, ep.rotation.z, co.rotation.x]
  const poser = () => { ep.rotation.set(val[0], val[1], val[2]); co.rotation.x = val[3] }
  const cout = () => { poser(); return main().distanceTo(cible) + 0.002 * Math.abs(val[1]) }
  let pas = 0.3, m = cout()
  for (let i = 0; i < 400 && pas > 0.002; i++) {
    let mieux = false
    for (let k = 0; k < 4; k++)
      for (const s of [-1, 1]) {
        const v = val[k]
        val[k] = v + s * pas
        if (k === 3 && val[k] > 0) { val[k] = v; continue }
        const e = cout()
        if (e < m - 1e-6) { m = e; mieux = true } else val[k] = v
      }
    if (!mieux) pas /= 2
  }
  poser()
  console.log(nom, 'erreur', m.toFixed(4), 'ep', val.slice(0, 3).map((x) => x.toFixed(3)).join(', '), 'co', val[3].toFixed(3), 'main', main().toArray().map((x) => x.toFixed(3)).join(' '))
  process.exit(0)
}
if (entree !== undefined && entree !== '') {
  // S'asseoir : de debout à la pose assise, le buste penché à mi-chemin pour que le poids descende.
  const u = Number(entree)
  const A = capter()
  POSES[geste](c, 0, Number(dd ?? 1))
  const B = capter()
  const v = lisse(u)
  for (const [n, b] of Object.entries(c.o)) {
    b.quaternion.copy(A[n].q).slerp(B[n].q, v)
    b.position.lerpVectors(A[n].p, B[n].p, v)
    b.scale.lerpVectors(A[n].s, B[n].s, v)
  }
  c.o.buste.rotateX(0.34 * Math.sin(Math.PI * v))
  c.o.tete.rotateX(0.14 * Math.sin(Math.PI * v))
  ferme *= lisse(borne(u, 0.55, 1))
} else POSES[geste](c, Number(tt ?? 0), Number(dd ?? 1))
c.m.updateMatrixWorld(true)
c.m.skeleton.update()
const n = T.g.attributes.position.count
const P = new Float32Array(n * 3)
const v = new THREE.Vector3()
for (let i = 0; i < n; i++) {
  c.m.getVertexPosition(i, v)
  P[i * 3] = v.x
  P[i * 3 + 1] = v.y
  P[i * 3 + 2] = v.z
}
// Fermer les yeux : chaque perle s'écrase en un trait courbé vers le bas, le long des axes de la tête.
if (ferme > 0) {
  const bin = readFileSync(`b3d/base-${process.env.MODELE || 'renard'}.gl.bin`)
  const Gl = new Float32Array(bin.buffer, bin.byteOffset, bin.length / 4)
  const q = c.o.tete.getWorldQuaternion(new THREE.Quaternion())
  const dr = new THREE.Vector3(1, 0, 0).applyQuaternion(q)
  const ha = new THREE.Vector3(0, 1, 0).applyQuaternion(q)
  const te = c.o.tete.getWorldPosition(new THREE.Vector3())
  const lire = (i) => new THREE.Vector3(P[i * 3], P[i * 3 + 1], P[i * 3 + 2])
  for (const signe of [-1, 1]) {
    const ids = []
    for (let i = 0; i < n; i++)
      // conv-1558 : seules les perles (G = 1) ; « mat » vaut 128/255 = 0,502 dans le modèle v3 et passait le seuil 0,5.
      if (Gl[i] > 0.75 && lire(i).sub(te).dot(dr) * signe > 0.045) ids.push(i)
    const ce = new THREE.Vector3()
    for (const i of ids) ce.add(lire(i))
    ce.divideScalar(ids.length)
    for (const i of ids) {
      const r = lire(i).sub(ce)
      const x = r.dot(dr)
      const y = r.dot(ha)
      const dy = y * (1 - 0.9 * ferme) - y - ferme * ((0.9 * x * x) / 0.02 - 0.006)
      const w = lire(i).addScaledVector(ha, dy)
      P[i * 3] = w.x
      P[i * 3 + 1] = w.y
      P[i * 3 + 2] = w.z
    }
  }
}
writeFileSync(sortie, Buffer.from(P.buffer))
// Les deux mains : le bout de chaque avant-bras. Les objets tenus s'y accrochent.
const main = (nom) => {
  const co = new THREE.Vector3()
  const o = c.o['co' + nom]
  o.getWorldPosition(co)
  const av = new THREE.Vector3(0, -1, 0).applyQuaternion(
    o.getWorldQuaternion(new THREE.Quaternion())
  )
  return { p: co.clone().addScaledVector(av, 0.1).toArray(), a: av.toArray() }
}
writeFileSync(sortie + '.json', JSON.stringify({ D: main('D'), G: main('G') }))
