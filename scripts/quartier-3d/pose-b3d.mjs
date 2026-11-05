// Fige le tanuki dans une pose du vrai squelette (marionnette.js) pour le rendu Cycles (conv-1421).
// Usage : node b3d/pose.mjs sortie.bin phase [geste temps]
import * as THREE from 'three'
import { readFileSync, writeFileSync } from 'node:fs'
globalThis.THREE = THREE
const src = readFileSync(new URL('./marionnette.js', import.meta.url), 'utf8')
const api = new Function(src + ';return { chargerTanuki, creerTanuki, poseMarche, poseGeste }')()
const M = JSON.parse(readFileSync('b3d/' + (process.env.MODELE || 'renard') + '-hd.json', 'utf8'))
const T = await api.chargerTanuki(M)
const c = api.creerTanuki(T)
const [sortie, ph, geste, tg] = process.argv.slice(2)
if (geste) api.poseGeste(c, geste, Number(tg ?? 0)); else api.poseMarche(c, Number(ph))
c.m.updateMatrixWorld(true)
c.m.skeleton.update()
const n = T.g.attributes.position.count, P = new Float32Array(n * 3), v = new THREE.Vector3()
for (let i = 0; i < n; i++) { c.m.getVertexPosition(i, v); P[i * 3] = v.x; P[i * 3 + 1] = v.y; P[i * 3 + 2] = v.z }
writeFileSync(sortie, Buffer.from(P.buffer))
// Une fois suffit : faces, couleurs (linéaires) et perles (yeux, nez : pas de poils).
const col = T.g.attributes.color.array, ao = T.g.attributes.aG.array, idx = T.g.index.array
// conv-1448 : une base par animal, écrite une seule fois avant le lot (les rendus parallèles la lisent pendant ce temps).
const MOD = process.env.MODELE || 'renard'
if (!process.env.SANS_BASE) {
  writeFileSync(`b3d/base-${MOD}.col.bin`, Buffer.from(new Float32Array(col).buffer))
  writeFileSync(`b3d/base-${MOD}.gl.bin`, Buffer.from(new Float32Array(ao).buffer))
  writeFileSync(`b3d/base-${MOD}.idx.bin`, Buffer.from(new Uint32Array(idx).buffer))
}
console.log(n, idx.length / 3)
