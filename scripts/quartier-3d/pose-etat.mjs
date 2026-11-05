// Les 4 états du tanuki sur le vrai squelette (conv-1421) : même personnage que la marche et les gestes, rendu par le même Cycles.
// Usage : node q4/pose-etat.mjs sortie.bin etat temps
// Ils bouclent sur leur durée : tout passe par des sinus de 2π·t/d. La pancarte sort sa position dans sortie.bin.json.
import * as THREE from 'three'
import { readFileSync, writeFileSync } from 'node:fs'
globalThis.THREE = THREE
const src = readFileSync(new URL('./marionnette.js', import.meta.url), 'utf8')
const ETATS = String.raw`
const TOUR = 2 * Math.PI
// Assis par terre : le bassin descend, les cuisses partent en avant et s'écartent, les tibias reviennent, le pied reste à plat.
function assoir(c, ec, pli) {
  const o = c.o
  o.hanches.position.y = o.hanches.userData.r.y - .2
  o.cuG.rotation.set(-1.42, 0, ec); o.cuD.rotation.set(-1.42, 0, -ec)
  o.tiG.rotation.x = pli; o.tiD.rotation.x = pli
  o.piG.rotation.x = 1.42 - pli; o.piD.rotation.x = 1.42 - pli
  o.q1.rotation.set(.9, 0, 0); o.q2.rotation.y = 0
}
Object.assign(GESTES, {
  // Réfléchir : assis, le menton dans la main, le regard qui cherche.
  assis(c, t, d) {
    const a = Math.sin(TOUR * t / d)
    assoir(c, .3, 1.15)
    c.o.buste.rotation.set(.22, 0, 0)
    c.o.epD.rotation.set(-1.0, 0, .38); c.o.coD.rotation.x = -1.95
    c.o.epG.rotation.set(-.55, 0, -.1); c.o.coG.rotation.x = -.9
    c.o.tete.rotation.set(.04 + .05 * a, .22 * a, -.14)
    c.o.oG.rotation.z = -.08 + .1 * Math.sin(TOUR * t / d * 2); c.o.oD.rotation.z = .08
    c.o.q2.rotation.y = .3 * a
  },
  // T'attendre : debout, la pancarte levée à bout de bras, qu'il agite un peu pour se faire voir.
  pancarte(c, t, d) {
    const a = Math.sin(TOUR * t / d)
    c.o.epD.rotation.set(-2.72, 0, -.12 + .1 * a); c.o.coD.rotation.x = -.12
    c.o.epG.rotation.set(.05, 0, -.1); c.o.coG.rotation.x = -.5
    c.o.buste.rotation.set(-.04, 0, .05 * a)
    c.o.tete.rotation.set(-.2, .1 * a, 0)
    c.o.q2.rotation.y = .4 * a
  },
  // Planté : assis, tassé, la tête basse et les oreilles tombées. Il ne bouge presque plus.
  plante(c, t, d) {
    const a = Math.sin(TOUR * t / d)
    assoir(c, .55, .55)
    c.o.buste.rotation.set(.46 + .02 * a, 0, .07)
    c.o.epD.rotation.set(-.1, 0, .25); c.o.coD.rotation.x = -.2
    c.o.epG.rotation.set(-.1, 0, -.02); c.o.coG.rotation.x = -.2
    c.o.tete.rotation.set(.52 + .03 * a, 0, .12)
    c.o.oG.rotation.z = -.62; c.o.oD.rotation.z = .62
    c.o.q1.rotation.set(1.05, 0, 0)
  },
  // Méditer : en tailleur, le dos droit, les mains sur les genoux, la tête un peu baissée. Seul le souffle bouge.
  tailleur(c, t, d) {
    const a = Math.sin(TOUR * t / d)
    const o = c.o
    o.hanches.position.y = o.hanches.userData.r.y - .31
    o.cuG.rotation.set(-1.5, 0, 1.25); o.cuD.rotation.set(-1.5, 0, -1.25)
    o.tiG.rotation.set(0, 0, -2.1); o.tiD.rotation.set(0, 0, 2.1)
    o.piG.rotation.x = .6; o.piD.rotation.x = .6
    o.buste.rotation.set(-.02 + .018 * a, 0, 0)
    o.epD.rotation.set(-.62, 0, .34 + .012 * a); o.coD.rotation.x = -.62
    o.epG.rotation.set(-.62, 0, -.34 - .012 * a); o.coG.rotation.x = -.62
    o.tete.rotation.set(.16 + .012 * a, 0, 0)
    o.oG.rotation.z = -.06 - .02 * a; o.oD.rotation.z = .06 + .02 * a
    o.q1.rotation.set(1.02, 0, 0); o.q2.rotation.y = .08 * a
  },
  // Fini : dans le baquet, les bras posés sur le bord, la tête en arrière.
  aubain(c, t, d) {
    const a = Math.sin(TOUR * t / d)
    c.o.hanches.position.y = c.o.hanches.userData.r.y - .1
    c.o.epD.rotation.set(-.12, 0, -.82); c.o.epG.rotation.set(-.12, 0, .82)
    c.o.coD.rotation.x = -.35; c.o.coG.rotation.x = -.35
    c.o.buste.rotation.set(-.12, 0, 0)
    c.o.tete.rotation.set(-.26 + .04 * a, .14 * a, .05 * a)
    c.o.oG.rotation.z = -.32; c.o.oD.rotation.z = .32
  },
  // Endormi au bain (conv-1558, « sleepy when nothing is running ») : la pose du bain, mais la tête tombe sur
  // l'épaule, les oreilles s'affaissent et seul un souffle lent soulève le buste.
  somme(c, t, d) {
    const a = Math.sin(TOUR * t / d)
    c.o.hanches.position.y = c.o.hanches.userData.r.y - .1
    c.o.epD.rotation.set(-.12, 0, -.82); c.o.epG.rotation.set(-.12, 0, .82)
    c.o.coD.rotation.x = -.35; c.o.coG.rotation.x = -.35
    c.o.buste.rotation.set(-.04 + .025 * a, 0, 0)
    c.o.tete.rotation.set(.13 + .03 * a, .06, .24 + .02 * a)
    c.o.oG.rotation.z = -.55; c.o.oD.rotation.z = .55
  },
  // Surpris (conv-1558, « surprised on an error ») : debout, il sursaute — bras levés et écartés, buste et tête
  // rejetés en arrière, oreilles dressées —, puis retombe. Un sursaut par cycle, pieds au sol.
  surpris(c, t, d) {
    const u = (t / d) % 1
    const s = Math.pow(Math.sin(Math.PI * u), 2)
    c.o.buste.rotation.set(-.1 - .12 * s, 0, 0)
    c.o.tete.rotation.set(-.12 - .1 * s, 0, 0)
    c.o.epD.rotation.set(-.7 - .7 * s, 0, -.45 - .35 * s); c.o.epG.rotation.set(-.7 - .7 * s, 0, .45 + .35 * s)
    c.o.coD.rotation.x = -1.1 + .3 * s; c.o.coG.rotation.x = -1.1 + .3 * s
    c.o.oG.rotation.z = .1 + .06 * s; c.o.oD.rotation.z = -.1 - .06 * s
  }
})
`
const api = new Function(src + ETATS + ';return { chargerTanuki, creerTanuki, poseMarche, GESTES }')()
const M = JSON.parse(readFileSync('b3d/' + (process.env.MODELE || 'renard') + '-hd.json', 'utf8'))
const T = await api.chargerTanuki(M)
const c = api.creerTanuki(T)
const [sortie, etat, tt, dd] = process.argv.slice(2)
api.poseMarche(c, .25, 0)
c.o.buste.rotation.set(.02, 0, 0); c.o.tete.rotation.set(-.04, 0, 0)
c.o.coG.rotation.x = -.22; c.o.coD.rotation.x = -.22
api.GESTES[etat](c, Number(tt ?? 0), Number(dd ?? 1))
c.m.updateMatrixWorld(true)
c.m.skeleton.update()
const n = T.g.attributes.position.count, P = new Float32Array(n * 3), v = new THREE.Vector3()
for (let i = 0; i < n; i++) { c.m.getVertexPosition(i, v); P[i * 3] = v.x; P[i * 3 + 1] = v.y; P[i * 3 + 2] = v.z }
writeFileSync(sortie, Buffer.from(P.buffer))
// La main droite : le bout de l'avant-bras. C'est là que la pancarte se tient.
const co = new THREE.Vector3(), ep = new THREE.Vector3()
c.o.coD.getWorldPosition(co); c.o.epD.getWorldPosition(ep)
const av = new THREE.Vector3(0, -1, 0).applyQuaternion(c.o.coD.getWorldQuaternion(new THREE.Quaternion()))
const main = co.clone().addScaledVector(av, .1)
writeFileSync(sortie + '.json', JSON.stringify({ main: main.toArray(), axe: av.toArray() }))
console.log(etat, 'main', main.toArray().map((u) => u.toFixed(3)).join(' '))
