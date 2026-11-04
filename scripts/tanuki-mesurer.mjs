#!/usr/bin/env node
/**
 * MESURE DES TANUKIS D'AUTOWIN (conv-1562, lot 1 du plan conv-1558).
 *
 * Pourquoi : la fiche skills/tanuki/reference.json doit porter des valeurs LUES sur les images du
 * Quartier, pas des valeurs écrites de mémoire. Ce script relit l'atlas du tanuki (celui qu'affiche
 * l'accueil, src/renderer/src/quartier/quartier-scene.ts → assets/quartier/atlas.avif) et en tire
 * proportions, palette, oreilles, queue et masque.
 *
 * Usage : node scripts/tanuki-mesurer.mjs [--atlas <chemin>] [--sortie <reference.json>]
 * Le décodage de l'AVIF passe par Python + Pillow (aucune bibliothèque d'image dans node_modules).
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const RACINE = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OPAQUE = 128

export function hex([r, g, b]) {
  return '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')
}
const lum = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b
const px = (im, x, y) => {
  const i = (y * im.w + x) * 4
  return [im.d[i], im.d[i + 1], im.d[i + 2], im.d[i + 3]]
}
const mediane = (t) => {
  const s = [...t].sort((a, b) => a - b)
  return s.length ? s[Math.floor(s.length / 2)] : NaN
}
const arrondi = (v, n = 3) => Math.round(v * 10 ** n) / 10 ** n

/**
 * Les plages opaques d'une rangée de la case : [[début, fin], …] en coordonnées de case.
 * Une plage de moins de 2 px est un poil isolé (moustache, frange du rendu) : on l'ignore, sinon il
 * élargit la tête ou se compte comme une oreille (mesuré sur l'atlas, rangée 54 de la case 0).
 */
function plages(im, x0, y, cw, min = 2) {
  const res = []
  let debut = -1
  for (let u = 0; u <= cw; u++) {
    const o = u < cw && px(im, x0 + u, y)[3] >= OPAQUE
    if (o && debut < 0) debut = u
    if (!o && debut >= 0) {
      if (u - debut >= min) res.push([debut, u - 1])
      debut = -1
    }
  }
  return res
}

/** Une zone de la tête : part, couleur moyenne et boîte (fractions de la largeur de case / hauteur de tête). */
function zone(pixels, total, cw, haut, teteH) {
  if (!pixels.length) return { partDeLaTete: 0, couleur: null, boite: null }
  const moy = (k) => pixels.reduce((s, e) => s + e[k], 0) / pixels.length
  const bx = pixels.reduce(
    (b, [u, y]) => [Math.min(b[0], u), Math.min(b[1], y), Math.max(b[2], u), Math.max(b[3], y)],
    [Infinity, Infinity, -Infinity, -Infinity]
  )
  return {
    partDeLaTete: pixels.length / total,
    couleur: hex([moy(2), moy(3), moy(4)]),
    boite: [bx[0] / cw, (bx[1] - haut) / teteH, (bx[2] + 1) / cw, (bx[3] + 1 - haut) / teteH]
  }
}

/**
 * Mesure une case vue de FACE : haut/bas de la silhouette, cou, rapport tête/hauteur, largeur
 * tête/corps, oreilles, masque (face claire, et yeux + truffe sombres).
 */
export function mesurerCase(im, x0, y0, cw, ch) {
  const rangees = []
  for (let v = 0; v < ch; v++) rangees.push(plages(im, x0, y0 + v, cw))
  const pleines = rangees.map((p, v) => (p.length ? v : -1)).filter((v) => v >= 0)
  if (!pleines.length) throw new Error('case vide : aucune silhouette à mesurer')
  const haut = pleines[0]
  const bas = pleines[pleines.length - 1]
  const hauteur = bas - haut + 1
  const compte = (p) => p.reduce((s, [a, b]) => s + b - a + 1, 0)
  const etendue = (p) => (p.length ? p[p.length - 1][1] - p[0][0] + 1 : 0)

  // Le cou n'est pas la rangée la plus étroite (ce serait la pointe d'une oreille) : c'est le plus fort
  // RESSERREMENT sous la tête — la tête la plus large au-dessus, moins la largeur de la rangée.
  let cou = -1
  let pince = -Infinity
  let maxDessus = 0
  for (let v = haut; v <= haut + Math.floor(hauteur * 0.65); v++) {
    const e = etendue(rangees[v])
    if (v >= haut + Math.floor(hauteur * 0.25) && maxDessus - e > pince)
      [pince, cou] = [maxDessus - e, v]
    maxDessus = Math.max(maxDessus, e)
  }
  const teteH = cou - haut
  let largeurTete = 0
  let largeurCorps = 0
  for (let v = haut; v < cou; v++) largeurTete = Math.max(largeurTete, etendue(rangees[v]))
  for (let v = cou; v <= bas; v++) largeurCorps = Math.max(largeurCorps, etendue(rangees[v]))

  // Les oreilles : du haut jusqu'à la DERNIÈRE rangée coupée en deux dans le haut de la tête. Une
  // oreille peut commencer plus haut que l'autre (atlas : 2 rangées d'écart), d'où « dernière ».
  const ecarts = []
  const nombres = []
  let finOreilles = haut - 1
  for (let v = haut; v < haut + teteH / 2; v++)
    if (rangees[v].length >= 2) {
      finOreilles = v
      nombres.push(rangees[v].length)
      ecarts.push(rangees[v][1][0] - rangees[v][0][1] - 1)
    }
  const hauteurOreilles = finOreilles - haut + 1
  const base = rangees[finOreilles] ?? []
  const largeurOreille = base.length ? compte(base) / base.length : 0

  // Le masque : la face nettement plus claire que la teinte médiane de la tête, et les yeux + la
  // truffe, nettement plus sombres.
  const tete = []
  for (let y = haut; y < cou; y++)
    for (const [a, b] of rangees[y])
      for (let u = a; u <= b; u++) {
        const [r, g, bl] = px(im, x0 + u, y0 + y)
        tete.push([u, y, r, g, bl, lum(r, g, bl)])
      }
  const med = mediane(tete.map((t) => t[5]))
  const sombres = tete.filter((t) => t[5] < 0.45 * med)
  const clairs = tete.filter((t) => t[5] > 1.2 * med)

  return {
    haut,
    bas,
    cou,
    teteSurHauteur: teteH / hauteur,
    largeurTeteSurCorps: largeurTete / (largeurCorps || 1),
    hauteurSurLargeurCorps: hauteur / (largeurCorps || 1),
    oreilles: {
      nombre: nombres.length ? mediane(nombres) : 0,
      hauteurSurTete: nombres.length ? hauteurOreilles / (teteH || 1) : 0,
      ecartSurTete: ecarts.length ? mediane(ecarts) / (largeurTete || 1) : 0,
      largeurBaseSurTete: largeurOreille / (largeurTete || 1)
    },
    masque: {
      clair: zone(clairs, tete.length || 1, cw, haut, teteH || 1),
      sombre: zone(sombres, tete.length || 1, cw, haut, teteH || 1)
    }
  }
}

/**
 * Mesure la queue d'une case vue de PROFIL : les colonnes opaques hors du corps (colonnes pleines à
 * plus de 40 % de la plus pleine), du côté où il y en a le plus, puis les anneaux sombres le long.
 */
export function mesurerQueue(im, x0, y0, cw, ch) {
  const cols = []
  for (let u = 0; u < cw; u++) {
    const ps = []
    for (let v = 0; v < ch; v++) {
      const p = px(im, x0 + u, y0 + v)
      if (p[3] >= OPAQUE) ps.push(p)
    }
    cols.push(ps)
  }
  const max = Math.max(...cols.map((c) => c.length))
  if (!max) throw new Error('case vide : aucune queue à mesurer')
  const corps = cols.map((c, u) => (c.length >= 0.4 * max ? u : -1)).filter((u) => u >= 0)
  const g = corps[0]
  const d = corps[corps.length - 1]
  const cote = (de, a, pas) => {
    const t = []
    for (let u = de; u !== a && cols[u].length; u += pas) t.push(u)
    return t
  }
  const gauche = cote(g - 1, -1, -1)
  const droite = cote(d + 1, cw, 1)
  const queue = gauche.length >= droite.length ? gauche.reverse() : droite
  let haut = ch
  let bas = -1
  for (let u = 0; u < cw; u++)
    for (let v = 0; v < ch; v++)
      if (px(im, x0 + u, y0 + v)[3] >= OPAQUE) {
        haut = Math.min(haut, v)
        bas = Math.max(bas, v)
      }
  const l = queue.map((u) => mediane(cols[u].map(([r, gg, b]) => lum(r, gg, b))))
  const mi = (Math.min(...l) + Math.max(...l)) / 2
  let anneaux = 0
  let suite = 0
  const sombres = []
  const clairs = []
  queue.forEach((u, k) => {
    const s = l[k] < mi
    ;(s ? sombres : clairs).push(...cols[u])
    if (s) suite++
    if (!s || k === queue.length - 1) {
      if (suite >= 2) anneaux++
      suite = 0
    }
  })
  const moyC = (t) =>
    t.length ? hex([0, 1, 2].map((k) => t.reduce((s, p) => s + p[k], 0) / t.length)) : null
  return {
    longueurSurHauteur: queue.length / (bas - haut + 1),
    anneauxSombres: anneaux,
    couleurSombre: moyC(sombres),
    couleurClaire: moyC(clairs)
  }
}

/** K-moyennes déterministes (départ : la couleur la plus fréquente, puis la plus éloignée). */
export function paletteKMoyennes(pixels, k, tours = 25) {
  const freq = new Map()
  for (const p of pixels) {
    const cle = (p[0] >> 3) * 1024 + (p[1] >> 3) * 32 + (p[2] >> 3)
    freq.set(cle, (freq.get(cle) ?? 0) + 1)
  }
  const [cle0] = [...freq.entries()].sort((a, b) => b[1] - a[1])[0]
  const centres = [
    pixels.find((p) => (p[0] >> 3) * 1024 + (p[1] >> 3) * 32 + (p[2] >> 3) === cle0).slice(0, 3)
  ]
  const d2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2
  while (centres.length < k) {
    let loin = pixels[0]
    let dl = -1
    for (const p of pixels) {
      const dm = Math.min(...centres.map((c) => d2(p, c)))
      if (dm > dl) [dl, loin] = [dm, p]
    }
    centres.push(loin.slice(0, 3))
  }
  let affect = new Int32Array(pixels.length)
  for (let t = 0; t < tours; t++) {
    const somme = centres.map(() => [0, 0, 0, 0])
    pixels.forEach((p, i) => {
      let m = 0
      for (let c = 1; c < k; c++) if (d2(p, centres[c]) < d2(p, centres[m])) m = c
      affect[i] = m
      const s = somme[m]
      s[0] += p[0]
      s[1] += p[1]
      s[2] += p[2]
      s[3]++
    })
    somme.forEach((s, c) => {
      if (s[3]) centres[c] = [s[0] / s[3], s[1] / s[3], s[2] / s[3]]
    })
  }
  const parts = centres.map((_, c) => affect.filter((a) => a === c).length / pixels.length)
  return centres
    .map((c, i) => ({ hex: hex(c), part: arrondi(parts[i]) }))
    .filter((c) => c.part > 0)
    .sort((a, b) => b.part - a.part)
}

/** Décode une image (AVIF compris) en RGBA brut, par Pillow. */
export function decoder(chemin) {
  const brut = execFileSync(
    'python',
    [
      '-I',
      '-c',
      "import sys;from PIL import Image;im=Image.open(sys.argv[1]).convert('RGBA');" +
        "sys.stdout.buffer.write(b'%d %d\\n'%im.size);sys.stdout.buffer.write(im.tobytes())",
      chemin
    ],
    { maxBuffer: 1 << 28 }
  )
  const nl = brut.indexOf(10)
  const [w, h] = brut.subarray(0, nl).toString().split(' ').map(Number)
  return { w, h, d: new Uint8ClampedArray(brut.subarray(nl + 1)) }
}

function caseVide(im, x0, y0, cw, ch) {
  for (let v = 0; v < ch; v += 2)
    for (let u = 0; u < cw; u += 2) if (px(im, x0 + u, y0 + v)[3] >= OPAQUE) return false
  return true
}

/** Toutes les mesures d'un atlas : rangée 0 = face, rangée 2 = profil (lues sur la planche, conv-1562). */
export function mesurerAtlas(
  im,
  { cw, ch, rangeeFace = 0, rangeeProfil = 2, rangeesPalette = [0, 1, 2, 3] }
) {
  const colonnes = Math.floor(im.w / cw)
  const cases = (r) =>
    [...Array(colonnes).keys()].filter((c) => !caseVide(im, c * cw, r * ch, cw, ch))
  const faces = cases(rangeeFace).map((c) => mesurerCase(im, c * cw, rangeeFace * ch, cw, ch))
  const queues = cases(rangeeProfil).map((c) => mesurerQueue(im, c * cw, rangeeProfil * ch, cw, ch))
  const med = (f) => arrondi(mediane(faces.map(f)))
  const pixels = []
  const zones = { tete: [], corps: [] }
  let bords = 0
  let semi = 0
  for (const r of rangeesPalette)
    for (const c of cases(r))
      for (let v = 0; v < ch; v++)
        for (let u = 0; u < cw; u++) {
          const p = px(im, c * cw + u, r * ch + v)
          if (p[3] > 0 && p[3] < 255) semi++
          if (p[3] > 0) bords++
          if (p[3] >= 250 && (u + v) % 3 === 0) pixels.push(p)
        }
  cases(rangeeFace).forEach((c, i) => {
    for (let v = faces[i].haut; v <= faces[i].bas; v += 2)
      for (let u = 0; u < cw; u += 2) {
        const p = px(im, c * cw + u, rangeeFace * ch + v)
        if (p[3] >= 250) (v < faces[i].cou ? zones.tete : zones.corps).push(p)
      }
  })
  return {
    cases: { face: faces.length, profil: queues.length, palette: rangeesPalette.length },
    proportions: {
      teteSurHauteur: med((m) => m.teteSurHauteur),
      largeurTeteSurCorps: med((m) => m.largeurTeteSurCorps),
      hauteurSurLargeurCorps: med((m) => m.hauteurSurLargeurCorps),
      hauteurEnPixelsDeCase: med((m) => m.bas - m.haut + 1)
    },
    oreilles: {
      nombre: med((m) => m.oreilles.nombre),
      hauteurSurTete: med((m) => m.oreilles.hauteurSurTete),
      ecartSurTete: med((m) => m.oreilles.ecartSurTete),
      largeurBaseSurTete: med((m) => m.oreilles.largeurBaseSurTete)
    },
    masque: Object.fromEntries(
      ['clair', 'sombre'].map((n) => {
        const z = faces.map((m) => m.masque[n]).filter((x) => x.couleur)
        return [
          n,
          {
            partDeLaTete: arrondi(mediane(z.map((x) => x.partDeLaTete))),
            couleur: z.map((x) => x.couleur).sort()[Math.floor(z.length / 2)] ?? null,
            boiteDansLaTete: [0, 1, 2, 3].map((k) => arrondi(mediane(z.map((x) => x.boite[k]))))
          }
        ]
      })
    ),
    queue: {
      longueurSurHauteur: arrondi(mediane(queues.map((q) => q.longueurSurHauteur))),
      anneauxSombres: mediane(queues.map((q) => q.anneauxSombres)),
      couleurSombre: queues.map((q) => q.couleurSombre).sort()[Math.floor(queues.length / 2)],
      couleurClaire: queues.map((q) => q.couleurClaire).sort()[Math.floor(queues.length / 2)]
    },
    palette: {
      ensemble: paletteKMoyennes(pixels, 8),
      tete: paletteKMoyennes(zones.tete, 4),
      corps: paletteKMoyennes(zones.corps, 6)
    },
    style: { partDeBordAdouci: arrondi(semi / (bords || 1)) }
  }
}

function principal() {
  const arg = (n, d) => {
    const i = process.argv.indexOf(n)
    return i > 0 ? process.argv[i + 1] : d
  }
  const atlas = resolve(arg('--atlas', join(RACINE, 'src/renderer/src/assets/quartier/atlas.avif')))
  const sortie = arg('--sortie', null)
  const donnees = JSON.parse(
    readFileSync(join(RACINE, 'src/renderer/src/assets/quartier/donnees.json'), 'utf8')
  )
  const { cw, ch } = donnees.an
  const im = decoder(atlas)
  const mesures = mesurerAtlas(im, { cw, ch })
  const res = {
    source: {
      image: relative(RACINE, atlas).replaceAll('\\', '/'),
      sha256: createHash('sha256').update(readFileSync(atlas)).digest('hex'),
      taille: [im.w, im.h],
      caseEnPixels: [cw, ch],
      script: 'scripts/tanuki-mesurer.mjs'
    },
    ...mesures
  }
  // Le style mesurable (bord adouci) vient de l'image ; la matière, elle, ne se lit pas sur des pixels :
  // on recopie la première ligne de la sculpture d'origine (Brain, conv-1446), avec son chemin.
  const sculpture = 'D:/AutoWinOS/.autowin-tmp/conv-1421/gen/d3/tanuki.py'
  try {
    const ligne = readFileSync(sculpture, 'utf8').split('\n')[0].replace(/^#\s*/, '')
    res.style.sculpture = { origine: sculpture + ':1', texte: ligne }
  } catch {
    res.style.sculpture = { origine: sculpture, texte: null, absente: true }
  }
  const texte = JSON.stringify(res, null, 2) + '\n'
  if (sortie) writeFileSync(sortie, texte)
  process.stdout.write(texte)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) principal()
