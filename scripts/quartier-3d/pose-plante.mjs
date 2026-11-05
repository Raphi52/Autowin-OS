// L'agent PLANTÉ qui pleure, fume ou boit (conv-1549, lot 1 du plan de conv-1537) : copie de pose.mjs, sur la base
// de la pose `plante` de pose-etat.mjs (assis par terre, tassé). Trois boucles assises de 12 images :
//   pleure — les deux mains aux yeux, les épaules secouées de sanglots, la tête basse ;
//   fume   — la main droite porte la cigarette à la bouche, il aspire, elle redescend, il souffle ;
//   boit   — avachi, la bouteille de saké portée à la bouche, il tangue.
// Usage : MODELE=tanuki node pose-plante.mjs sortie.bin geste temps durée
// Sort la pose dans sortie.bin et, dans sortie.bin.json, les deux mains (D, G : point p, axe a de l'avant-bras),
// la tête (centre, axes dr/ha/av), les deux yeux (yD, yG), la bouche et la phase : sprite5-plante.py y accroche
// les larmes, la cigarette et la bouteille. Les mains vont aux yeux ou à la bouche par cinématique inverse, refaite
// à chaque image : le geste tombe juste sur les quatre animaux, quelles que soient leurs proportions.
import * as THREE from 'three'
import { readFileSync, writeFileSync } from 'node:fs'
globalThis.THREE = THREE
const src = readFileSync(new URL('./marionnette.js', import.meta.url), 'utf8')
const TOUR = 2 * Math.PI
const borne = (x, a, b) => Math.max(0, Math.min(1, (x - a) / (b - a)))
const lisse = (x) => x * x * (3 - 2 * x)
const MODELE = process.env.MODELE || 'renard'

// Copie de assoir() et de l'état `plante` de pose-etat.mjs : la même assise, pour que l'agent planté ne saute pas
// d'une pose à l'autre.
function assoir(c, ec, pli) {
  const o = c.o
  o.hanches.position.y = o.hanches.userData.r.y - 0.2
  o.cuG.rotation.set(-1.42, 0, ec)
  o.cuD.rotation.set(-1.42, 0, -ec)
  o.tiG.rotation.x = pli
  o.tiD.rotation.x = pli
  o.piG.rotation.x = 1.42 - pli
  o.piD.rotation.x = 1.42 - pli
  o.q1.rotation.set(0.9, 0, 0)
  o.q2.rotation.y = 0
}
function plante(c, t, d) {
  const a = Math.sin((TOUR * t) / d)
  assoir(c, 0.55, 0.55)
  c.o.buste.rotation.set(0.46 + 0.02 * a, 0, 0.07)
  c.o.epD.rotation.set(-0.1, 0, 0.25)
  c.o.coD.rotation.x = -0.2
  c.o.epG.rotation.set(-0.1, 0, -0.02)
  c.o.coG.rotation.x = -0.2
  c.o.tete.rotation.set(0.52 + 0.03 * a, 0, 0.12)
  c.o.oG.rotation.z = -0.62
  c.o.oD.rotation.z = 0.62
  c.o.q1.rotation.set(1.05, 0, 0)
}

const api = new Function(src + ';return { chargerTanuki, creerTanuki, poseMarche }')()
const M = JSON.parse(readFileSync('b3d/' + MODELE + '-hd.json', 'utf8'))
const T = await api.chargerTanuki(M)
const c = api.creerTanuki(T)
const bin = readFileSync(`b3d/base-${MODELE}.gl.bin`)
const Gl = new Float32Array(bin.buffer, bin.byteOffset, bin.length / 4)
const PERLES = []
// conv-1558 : seules les perles (G = 1) ; « mat » vaut 128/255 = 0,502 dans le modèle v3.
for (let i = 0; i < Gl.length; i++) if (Gl[i] > 0.75) PERLES.push(i)

// Le bout de l'avant-bras : c'est la main, là où les objets s'accrochent (même définition que pose.mjs).
const main = (nom) => {
  c.m.updateMatrixWorld(true)
  const o = c.o['co' + nom]
  const p = o.getWorldPosition(new THREE.Vector3())
  const av = new THREE.Vector3(0, -1, 0).applyQuaternion(o.getWorldQuaternion(new THREE.Quaternion()))
  return { p: p.clone().addScaledVector(av, 0.1), a: av }
}
// La tête : son centre et ses trois axes (droite de l'image, haut, avant), puis les yeux et la bouche, lus sur le
// maillage déformé (les perles brillantes : deux yeux de part et d'autre, la truffe au milieu).
function repere() {
  c.m.updateMatrixWorld(true)
  c.m.skeleton.update()
  const q = c.o.tete.getWorldQuaternion(new THREE.Quaternion())
  const dr = new THREE.Vector3(1, 0, 0).applyQuaternion(q)
  const ha = new THREE.Vector3(0, 1, 0).applyQuaternion(q)
  const av = new THREE.Vector3(0, 0, 1).applyQuaternion(q)
  const te = c.o.tete.getWorldPosition(new THREE.Vector3())
  const v = new THREE.Vector3()
  const yeux = { G: [new THREE.Vector3(), 0], D: [new THREE.Vector3(), 0] }
  const nez = [new THREE.Vector3(), 0, -1e9]
  for (const i of PERLES) {
    c.m.getVertexPosition(i, v)
    const r = v.clone().sub(te)
    const x = r.dot(dr)
    if (Math.abs(x) > 0.045) {
      const y = yeux[x > 0 ? 'G' : 'D']
      y[0].add(v)
      y[1]++
    } else {
      nez[0].add(v)
      nez[1]++
      nez[2] = Math.max(nez[2], r.dot(av))
    }
  }
  const yG = yeux.G[0].divideScalar(Math.max(1, yeux.G[1]))
  const yD = yeux.D[0].divideScalar(Math.max(1, yeux.D[1]))
  // Pas de truffe brillante (ou trop peu de points) : la bouche se déduit des yeux.
  const milieu = yG.clone().add(yD).multiplyScalar(0.5)
  const truffe = nez[1] > 8 ? nez[0].divideScalar(nez[1]) : milieu.clone().addScaledVector(av, 0.06).addScaledVector(ha, -0.04)
  const bouche = truffe.clone().addScaledVector(ha, -0.045).addScaledVector(av, -0.005)
  return { te, dr, ha, av, yG, yD, truffe, bouche }
}
// Cinématique inverse d'un bras (copie de la descente de pose.mjs, mode IK) : amène la main au point voulu.
function ik(nom, cible) {
  const ep = c.o['ep' + nom], co = c.o['co' + nom]
  const val = [ep.rotation.x, ep.rotation.y, ep.rotation.z, co.rotation.x]
  const poser = () => { ep.rotation.set(val[0], val[1], val[2]); co.rotation.x = val[3] }
  const cout = () => { poser(); return main(nom).p.distanceTo(cible) + 0.002 * Math.abs(val[1]) }
  let pas = 0.3, m = cout()
  for (let i = 0; i < 400 && pas > 0.002; i++) {
    let mieux = false
    for (let k = 0; k < 4; k++)
      for (const s of [-1, 1]) {
        const v = val[k]
        val[k] = v + s * pas
        if (k === 3 && (val[k] > 0 || val[k] < -2.6)) { val[k] = v; continue }
        const e = cout()
        if (e < m - 1e-6) { m = e; mieux = true } else val[k] = v
      }
    if (!mieux) pas /= 2
  }
  poser()
  return { val, erreur: m }
}
const HAUT = new THREE.Vector3(0, 1, 0)
// La composante horizontale d'un axe, normée.
const plat = (v) => new THREE.Vector3(v.x, 0, v.z).normalize()
// Les objets placés ici (cigarette, bouteille) : la main et l'objet restent ensemble quel que soit l'animal.
const OBJETS = {}

const POSES = {
  // Pleurer : la tête basse, les deux mains écrasées sur les yeux, les épaules secouées de sanglots. Deux sanglots
  // par boucle : le buste se soulève d'un coup, retombe, et la tête tremble.
  pleure(c, t, d) {
    const u = (t / d) % 1
    const o = c.o
    plante(c, t, d)
    // Un sanglot : un hoquet brusque (montée rapide, retombée lente), deux fois par boucle.
    const hoquet = (x) => { const w = x % 0.5 / 0.5; return w < 0.18 ? lisse(w / 0.18) : 1 - lisse((w - 0.18) / 0.82) }
    const s = hoquet(u)
    const tremble = Math.sin(TOUR * u * 6) * (0.4 + 0.6 * s)
    o.buste.rotation.set(0.3 - 0.1 * s, 0.03 * tremble, 0.04 * tremble)
    o.buste.position.y = o.buste.userData.r.y + 0.018 * s
    const e = 1 + 0.05 * s
    o.buste.scale.set(e, 1 + 0.03 * s, e)
    o.tete.rotation.set(0.2 + 0.08 * s, 0.05 * tremble, 0.06 * tremble)
    o.oG.rotation.z = -0.75 - 0.08 * s
    o.oD.rotation.z = 0.75 + 0.08 * s
    o.q1.rotation.set(1.1, 0.1 * tremble, 0)
    // Les mains vont aux yeux, un peu devant (sinon elles entrent dans la tête) et vers le bord extérieur.
    const R = repere()
    for (const [nom, y] of [['D', R.yD], ['G', R.yG]]) {
      const cible = y.clone().addScaledVector(R.av, 0.055).addScaledVector(R.ha, -0.012)
      o['ep' + nom].rotation.set(-1.6, 0, nom === 'D' ? 0.5 : -0.5)
      o['co' + nom].rotation.x = -1.6
      ik(nom, cible)
    }
    return { sanglot: s }
  },
  // Fumer : la main droite porte la cigarette à la bouche, il aspire (la tête se relève, le buste se gonfle), elle
  // redescend, il souffle une grosse bouffée vers le haut.
  fume(c, t, d) {
    const u = (t / d) % 1
    const o = c.o
    const a = Math.sin(TOUR * u)
    plante(c, t, d)
    const monte = lisse(borne(u, 0.06, 0.26)) * (1 - lisse(borne(u, 0.48, 0.64)))
    const aspire = lisse(borne(u, 0.24, 0.34)) * (1 - lisse(borne(u, 0.42, 0.52)))
    const souffle = lisse(borne(u, 0.6, 0.68)) * (1 - lisse(borne(u, 0.8, 0.98)))
    o.buste.rotation.set(0.36 - 0.1 * aspire + 0.04 * souffle + 0.01 * a, 0, 0.06)
    const e = 1 + 0.06 * aspire
    o.buste.scale.set(e, 1, e)
    // Il relève la tête vers sa main, puis la renverse en arrière pour souffler vers le ciel.
    o.tete.rotation.set(0.42 - 0.18 * monte - 0.12 * aspire - 0.55 * souffle, 0.06 * monte, 0.1 - 0.06 * souffle)
    o.oG.rotation.z = -0.55 + 0.1 * aspire
    o.oD.rotation.z = 0.55 - 0.1 * aspire
    // Main gauche posée sur le genou.
    o.epG.rotation.set(-0.35, 0, -0.1)
    o.coG.rotation.x = -0.35
    const R = repere()
    const cote = plat(R.dr).negate()
    const avant = plat(R.av)
    // Au repos, la main droite est levée à côté de la joue et la cigarette se tient droite : elle se détache sur le
    // fond, pas sur le kimono. À la bouche, le filtre touche les lèvres et la cigarette sort sur le côté, presque à
    // l'horizontale : vue de 30° au-dessus, elle garde toute sa longueur.
    const mainRepos = R.te.clone().addScaledVector(cote, 0.2).addScaledVector(HAUT, -0.13).addScaledVector(avant, 0.08)
    const dRepos = HAUT.clone().multiplyScalar(0.9).addScaledVector(cote, 0.3).addScaledVector(avant, 0.15).normalize()
    // (Vers l'avant, elle viendrait vers la caméra : raccourcie, cachée par la patte — témoin du 04/11.)
    const dBouche = cote.clone().multiplyScalar(0.85).addScaledVector(avant, 0.15).addScaledVector(HAUT, 0.5).normalize()
    const fBouche = R.bouche.clone().addScaledVector(R.av, 0.012)
    // La patte pince la cigarette par en dessous : elle ne la cache pas.
    const mainBouche = fBouche.clone().addScaledVector(dBouche, 0.07).addScaledVector(HAUT, -0.05)
    o.epD.rotation.set(-1.4, 0, 0.6)
    o.coD.rotation.x = -1.8
    ik('D', mainRepos.clone().lerp(mainBouche, monte))
    const M = main('D').p
    const dc = dRepos.clone().lerp(dBouche, monte).normalize()
    const f = M.clone().addScaledVector(HAUT, 0.035).addScaledVector(dc, -0.03).lerp(fBouche, monte)
    OBJETS.clope = { f, d: dc }
    return { monte, aspire, souffle }
  },
  // Boire : avachi en arrière, il tangue d'un côté à l'autre ; la bouteille monte à la bouche, il renverse la tête
  // et boit une longue gorgée, puis la bouteille redescend sur le genou.
  boit(c, t, d) {
    const u = (t / d) % 1
    const o = c.o
    const a = Math.sin(TOUR * u)
    const b = Math.sin(TOUR * u + 1.1)
    plante(c, t, d)
    assoir(c, 0.62, 0.6)
    const monte = lisse(borne(u, 0.1, 0.3)) * (1 - lisse(borne(u, 0.6, 0.8)))
    const gorgee = lisse(borne(u, 0.28, 0.38)) * (1 - lisse(borne(u, 0.52, 0.62)))
    // Avachi : le buste part en arrière et roule d'un côté à l'autre (il tangue), la tête suit en retard.
    // Le tangage s'amortit pendant qu'il boit : ajouté à la tête tournée vers la bouteille, il sortait l'oreille
    // gauche de la découpe (images 7-8 du premier rendu).
    const roule = 1 - 0.6 * monte
    o.buste.rotation.set(0.06 - 0.1 * gorgee, 0.06 * a, 0.16 * a * roule)
    o.hanches.rotation.set(0, 0, 0.05 * a)
    o.tete.rotation.set(0.18 - 0.24 * monte - 0.32 * gorgee, 0.08 * b, 0.2 * b * roule - 0.1 * gorgee * a)
    // Les bras sont courts (≈ .22 de l'épaule à la main) et la bouche était à .28 : pour boire, il tourne le buste
    // et la tête vers la bouteille et se penche dessus. Réglage cherché sur les 4 animaux : la main tient la
    // bouteille à 1,4 cm au plus (il en manquait 8 à 10), et la tête penchée de côté (≤ .25) laisse l'oreille dans
    // la découpe avec 4 px de marge (cadre-pose.py ; à .4 elle sortait de 3 à 8 px).
    o.buste.rotation.x += 0.3 * monte
    o.buste.rotation.y -= 0.5 * monte
    o.buste.rotation.z -= 0.15 * monte
    o.tete.rotation.x += 0.1 * monte
    o.tete.rotation.y -= 0.55 * monte
    o.tete.rotation.z -= 0.1 * monte + 0.15 * gorgee
    o.oG.rotation.z = -0.5 - 0.12 * b
    o.oD.rotation.z = 0.5 - 0.12 * b
    o.q1.rotation.set(1.15, 0.2 * a, 0)
    // Main gauche ballante sur la cuisse, main droite qui tient la bouteille posée sur le genou.
    o.epG.rotation.set(-0.25, 0, -0.32 - 0.06 * a)
    o.coG.rotation.x = -0.3
    o.epD.rotation.set(-0.6, 0, 0.5)
    o.coD.rotation.x = -0.75
    const R = repere()
    const cote = plat(R.dr).negate()
    const avant = plat(R.av)
    const Mr = main('D').p
    // À la bouche : le cul de la bouteille en l'air, devant et sur le côté droit (elle se détache sur le fond), le
    // goulot plongé dans la bouche — la silhouette de celui qui boit au goulot. Le goulot est à .17 × 1,2 du milieu
    // (cf. sprite5-plante.py) ; les bras sont courts, la main la tient par l'épaule, près de la bouche.
    // Presque perpendiculaire à la caméra (30° au-dessus, devant) : avec une part « avant », on la voyait par le
    // cul, une cible ronde sur le visage (témoin du 04/11).
    const vers = cote.clone().multiplyScalar(0.8).addScaledVector(HAUT, 0.55).addScaledVector(avant, -0.1).normalize()
    // La main saisit la bouteille au point de son axe le plus proche de l'épaule : quand il renverse la tête, la
    // bouche s'éloigne et une prise fixe sortait de portée (le goulot restait à 10 cm de la bouche).
    const epaule = c.o.epD.getWorldPosition(new THREE.Vector3())
    const s = Math.max(0.06, Math.min(0.2, epaule.clone().sub(R.bouche).dot(vers)))
    const prise = R.bouche.clone().addScaledVector(vers, s)
    if (monte > 0) {
      o.epD.rotation.set(-1.8, 0, 0.45)
      o.coD.rotation.x = -1.5
      ik('D', Mr.clone().lerp(prise, monte))
    }
    const M = main('D').p
    const uRepos = HAUT.clone().addScaledVector(avant, 0.15).addScaledVector(R.dr, 0.12 * a).normalize()
    // Au repos debout au-dessus de la main ; à la bouche, le goulot y entre de 1,5 cm. Entre les deux, la bouteille
    // passe de l'un à l'autre en même temps que la main.
    const cBoire = R.bouche.clone().addScaledVector(vers, 0.17 * 1.2 - 0.015)
    const cb = M.clone().addScaledVector(HAUT, 0.03).lerp(cBoire, monte)
    const ub = uRepos.clone().lerp(vers.clone().negate(), monte).normalize()
    OBJETS.bouteille = { c: cb, u: ub, main: M.distanceTo(prise) }
    return { monte, gorgee, tangue: a }
  }
}

const [sortie, geste, tt, dd] = process.argv.slice(2)
api.poseMarche(c, 0.25, 0)
c.o.buste.rotation.set(0.02, 0, 0)
c.o.tete.rotation.set(-0.04, 0, 0)
c.o.coG.rotation.x = -0.22
c.o.coD.rotation.x = -0.22
const t = Number(tt ?? 0), d = Number(dd ?? 1)
const ph = POSES[geste](c, t, d)
const R = repere()
const n = T.g.attributes.position.count
const P = new Float32Array(n * 3)
const v = new THREE.Vector3()
for (let i = 0; i < n; i++) {
  c.m.getVertexPosition(i, v)
  P[i * 3] = v.x
  P[i * 3 + 1] = v.y
  P[i * 3 + 2] = v.z
}
writeFileSync(sortie, Buffer.from(P.buffer))
const mD = main('D'), mG = main('G')
const tab = (x) => x.toArray().map((u) => Math.round(u * 1e5) / 1e5)
const J = {
  D: { p: tab(mD.p), a: tab(mD.a) },
  G: { p: tab(mG.p), a: tab(mG.a) },
  tete: { p: tab(R.te), dr: tab(R.dr), ha: tab(R.ha), av: tab(R.av) },
  yD: tab(R.yD),
  yG: tab(R.yG),
  bouche: tab(R.bouche),
  phase: (t / d) % 1,
  ph,
  objets: Object.fromEntries(
    Object.entries(OBJETS).map(([k, v]) => [k, Object.fromEntries(Object.entries(v).map(([n, x]) => [n, typeof x === 'number' ? x : tab(x)]))])
  )
}
writeFileSync(sortie + '.json', JSON.stringify(J))
if (process.env.SONDE) console.log(JSON.stringify(J))
