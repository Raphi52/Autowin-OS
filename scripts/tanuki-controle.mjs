#!/usr/bin/env node
// Contrôle qualité d'un rendu de tanuki (conv-1566, lot 3 du plan conv-1558).
// Compare un PNG vu de FACE à la fiche skills/tanuki/reference.json : silhouette et proportions,
// écart de palette, symétrie gauche/droite. Verdict chiffré en JSON ; code 0 si conforme, 1 sinon,
// 2 si l'image ou la fiche ne se lit pas.
//
// Usage : node scripts/tanuki-controle.mjs <rendu.png> [--reference <fiche.json>] [--json]
//
// Fond : un rendu Blender peut être transparent (on lit l'alpha) ou sur fond uni (on prend la
// couleur des quatre coins comme fond). Les tolérances sont PROVISOIRES (décision du chef,
// conv-1558) : elles sont dans TOLERANCES, et le foulard bleu, absent de la fiche, n'est pas
// pénalisé — l'écart de palette va de la fiche vers le rendu, une couleur EN PLUS ne coûte rien.
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { decoder, mesurerCase, paletteKMoyennes } from './tanuki-mesurer.mjs'

const RACINE = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OPAQUE = 128

export const TOLERANCES = {
  /** Écart relatif maximal d'une proportion (|mesure − réf| / réf). */
  proportion: 0.2,
  /** Distance RGB moyenne maximale (pondérée par la part de chaque couleur de la fiche). */
  palette: 45,
  /** Recouvrement minimal (IoU) silhouette/miroir. Les tanukis de l'atlas en marche tombent à 0,79 (conv-1566). */
  symetrie: 0.75
}

const arrondi = (v, n = 3) => Math.round(v * 10 ** n) / 10 ** n
const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])

/** Rend l'image avec un alpha fiable : si tout est opaque, le fond = couleur médiane des coins. */
export function detourer(im) {
  const { w, h, d } = im
  let transparent = false
  for (let i = 3; i < d.length; i += 4)
    if (d[i] < OPAQUE) {
      transparent = true
      break
    }
  if (transparent) return im
  const coins = [0, w - 1, (h - 1) * w, h * w - 1].map((p) => [
    d[p * 4],
    d[p * 4 + 1],
    d[p * 4 + 2]
  ])
  const fond = [0, 1, 2].map((k) => coins.map((c) => c[k]).sort((a, b) => a - b)[1])
  const out = new Uint8ClampedArray(d)
  for (let p = 0; p < w * h; p++) {
    const c = [d[p * 4], d[p * 4 + 1], d[p * 4 + 2]]
    out[p * 4 + 3] = dist(c, fond) > 40 ? 255 : 0
  }
  return { w, h, d: out }
}

/**
 * Symétrie : IoU de la silhouette et de son miroir autour de son centre de masse horizontal.
 * Pas le centre de la boîte : une queue qui dépasse d'un côté décale la boîte et faisait tomber les
 * tanukis de l'atlas eux-mêmes à 0,79 (mesuré conv-1566, cases 2 et 3).
 */
export function symetrie(im) {
  const { w, h, d } = im
  let sx = 0,
    n = 0
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (d[(y * w + x) * 4 + 3] >= OPAQUE) {
        sx += x
        n++
      }
  if (!n) return 0
  const axe2 = Math.round((2 * sx) / n)
  const opaque = (x, y) => x >= 0 && x < w && d[(y * w + x) * 4 + 3] >= OPAQUE
  let inter = 0,
    union = 0
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const a = opaque(x, y)
      const b = opaque(axe2 - x, y)
      if (a && b) inter++
      if (a || b) union++
    }
  return union ? inter / union : 0
}

/** Écart de palette : chaque couleur de la fiche cherche la plus proche du rendu, pondéré par sa part. */
export function ecartPalette(im, refPalette) {
  const pixels = []
  const { d } = im
  for (let i = 0; i < d.length; i += 4 * 3)
    if (d[i + 3] >= 250) pixels.push([d[i], d[i + 1], d[i + 2]])
  if (!pixels.length) return { distance: Infinity, rendu: [], detail: [] }
  const rendu = paletteKMoyennes(pixels, Math.min(10, pixels.length))
  const centres = rendu.map((c) => rgb(c.hex))
  let somme = 0,
    poids = 0
  const detail = refPalette.map(({ hex: h, part }) => {
    const r = rgb(h)
    let m = Infinity,
      proche = null
    centres.forEach((c, i) => {
      const e = dist(r, c)
      if (e < m) [m, proche] = [e, rendu[i].hex]
    })
    somme += m * part
    poids += part
    return { reference: h, part, plusProche: proche, distance: arrondi(m, 1) }
  })
  return { distance: arrondi(somme / (poids || 1), 1), rendu, detail }
}

/** Le verdict complet d'une image RGBA contre une fiche. */
export function controler(imBrute, ref, tol = TOLERANCES) {
  const im = detourer(imBrute)
  const ecarts = []
  const mesures = []
  let m
  try {
    m = mesurerCase(im, 0, 0, im.w, im.h)
  } catch (e) {
    return {
      conforme: false,
      ecarts: [{ critere: 'silhouette', message: String(e.message) }],
      mesures
    }
  }
  const proportions = [
    ['teteSurHauteur', m.teteSurHauteur, ref.proportions.teteSurHauteur],
    ['largeurTeteSurCorps', m.largeurTeteSurCorps, ref.proportions.largeurTeteSurCorps],
    ['hauteurSurLargeurCorps', m.hauteurSurLargeurCorps, ref.proportions.hauteurSurLargeurCorps]
  ]
  for (const [nom, val, attendu] of proportions) {
    const ecart = Math.abs(val - attendu) / attendu
    const ok = ecart <= tol.proportion
    mesures.push({
      critere: `proportion.${nom}`,
      mesure: arrondi(val),
      attendu,
      ecartRelatif: arrondi(ecart),
      seuil: tol.proportion,
      ok
    })
    if (!ok)
      ecarts.push({
        critere: `proportion.${nom}`,
        message: `${arrondi(val)} au lieu de ${attendu} (écart ${Math.round(ecart * 100)} % > ${tol.proportion * 100} %)`
      })
  }
  const oreillesOk = m.oreilles.nombre === ref.oreilles.nombre
  mesures.push({
    critere: 'oreilles.nombre',
    mesure: m.oreilles.nombre,
    attendu: ref.oreilles.nombre,
    ok: oreillesOk
  })
  if (!oreillesOk)
    ecarts.push({
      critere: 'oreilles.nombre',
      message: `${m.oreilles.nombre} oreille(s) vue(s), ${ref.oreilles.nombre} attendues`
    })

  const pal = ecartPalette(im, ref.palette.ensemble)
  const palOk = pal.distance <= tol.palette
  mesures.push({
    critere: 'palette',
    mesure: pal.distance,
    seuil: tol.palette,
    ok: palOk,
    detail: pal.detail
  })
  if (!palOk) {
    const pires = [...pal.detail].sort((a, b) => b.distance - a.distance).slice(0, 3)
    ecarts.push({
      critere: 'palette',
      message: `distance moyenne ${pal.distance} > ${tol.palette} ; pires : ${pires.map((p) => `${p.reference}→${p.plusProche} (${p.distance})`).join(', ')}`
    })
  }
  const sym = symetrie(im)
  const symOk = sym >= tol.symetrie
  mesures.push({ critere: 'symetrie', mesure: arrondi(sym), seuil: tol.symetrie, ok: symOk })
  if (!symOk)
    ecarts.push({
      critere: 'symetrie',
      message: `recouvrement miroir ${arrondi(sym)} < ${tol.symetrie}`
    })

  const score = arrondi(mesures.filter((x) => x.ok).length / mesures.length)
  return { conforme: ecarts.length === 0, score, ecarts, mesures }
}

function principal() {
  const args = process.argv.slice(2)
  const i = args.indexOf('--reference')
  const fiche = i >= 0 ? args[i + 1] : join(RACINE, 'skills/tanuki/reference.json')
  const image = args.find((a, k) => !a.startsWith('--') && args[k - 1] !== '--reference')
  if (!image) {
    console.error(
      'Usage : node scripts/tanuki-controle.mjs <rendu.png> [--reference <fiche.json>] [--json]'
    )
    process.exit(2)
  }
  let res
  try {
    res = controler(decoder(resolve(image)), JSON.parse(readFileSync(fiche, 'utf8')))
  } catch (e) {
    console.error(`Lecture impossible : ${e.message}`)
    process.exit(2)
  }
  if (args.includes('--json')) process.stdout.write(JSON.stringify(res, null, 2) + '\n')
  else {
    console.log(
      `${res.conforme ? 'CONFORME' : 'NON CONFORME'} — score ${res.score} (${res.mesures.filter((x) => x.ok).length}/${res.mesures.length} critères)`
    )
    for (const x of res.mesures)
      console.log(
        `  ${x.ok ? 'ok ' : 'KO '} ${x.critere} : ${x.mesure}${x.attendu !== undefined ? ` (attendu ${x.attendu})` : ''}${x.seuil !== undefined ? ` [seuil ${x.seuil}]` : ''}`
      )
    for (const e of res.ecarts) console.log(`  écart ${e.critere} : ${e.message}`)
  }
  process.exit(res.conforme ? 0 : 1)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) principal()
