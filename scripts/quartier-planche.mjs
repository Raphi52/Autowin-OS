#!/usr/bin/env node
// Planche de preuve des atlas du Quartier : une case par rangée demandée, pour chaque animal, dans sa
// tenue d'origine puis dans chaque couleur de tenue demandée. Née de conv-1554 (/grow) : la même planche
// avait été improvisée deux fois (conv-1546, conv-1554), la seconde dessinée en Python, donc seulement
// « à peu près » comme la scène — le juge l'avait relevé. Elle posait le foulard des collègues ; le foulard
// est retiré en conv-1633 (« vire le foulard »), remplacé par la couleur de tenue choisie dans les réglages.
// Fidélité : `masqueDeTenue`, `caseDeTenue`, `FENETRES_DE_TENUE` et `TEINTE_DES_TENUES` sont ceux de
// src/renderer/src/quartier/quartier-tenue.ts, empaquetés TELS QUELS pour Chrome, et la planche rejoue les
// gestes de `poserTenue` (quartier-scene.ts) : planche de base filtrée comme `peindreAtlas`, case teinte
// posée en mode « color ».
// Chrome, jamais Edge : règle de l'utilisateur pour le navigateur des agents (scout conv-1576, lot conv-1590).
//
// Usage : node scripts/quartier-planche.mjs --rangees 0,4 [--colonne 0] [--tenues rouge,bleu]
//         [--sortie .autowin-tmp/planche.png] [--animaux tanuki,renard,panda,panda-roux]
//         (`--tenues` : toutes par défaut ; la colonne « origine » est toujours la première)
// Sortie JSON : { sortie, atlas: {animal: {largeur, hauteur, rangees}}, tenue: {animal: {rangee: part}} }
//   `part` = la part des pixels opaques de la case comptés dans la tenue (0 à 1), `null` hors atlas.
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildSync } from 'esbuild'
import { chromium } from 'playwright-core'

const racine = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = Object.fromEntries(
  process.argv
    .slice(2)
    .reduce((acc, a, i, t) => (a.startsWith('--') ? [...acc, [a.slice(2), t[i + 1]]] : acc), [])
)
const rangees = String(args.rangees ?? '')
  .split(',')
  .filter(Boolean)
  .map(Number)
if (!rangees.length || rangees.some((r) => !Number.isInteger(r) || r < 0)) {
  console.error('Usage : --rangees 0,4 (entiers ≥ 0)')
  process.exit(2)
}
const colonne = Number(args.colonne ?? 0)
const sortie = resolve(racine, args.sortie ?? '.autowin-tmp/quartier-planche.png')
const FICHIERS = {
  tanuki: 'atlas.avif',
  renard: 'atlas-renard.avif',
  panda: 'atlas-panda.avif',
  'panda-roux': 'atlas-panda-roux.avif'
}
const animaux = String(args.animaux ?? Object.keys(FICHIERS).join(',')).split(',')
const dossier = resolve(racine, 'src/renderer/src/assets/quartier')
const { an } = JSON.parse(readFileSync(resolve(dossier, 'donnees.json'), 'utf8'))

// Le code de la scène, pas une copie : le module de la tenue, empaqueté pour la page.
const paquet = buildSync({
  entryPoints: [resolve(racine, 'src/renderer/src/quartier/quartier-tenue.ts')],
  bundle: true,
  format: 'iife',
  globalName: 'Tenue',
  platform: 'browser',
  write: false
})
const codeTenue = paquet.outputFiles[0].text
const connues = Object.keys(new Function(`${codeTenue}; return Tenue`)().TEINTE_DES_TENUES ?? {})
const tenues = String(args.tenues ?? connues.join(','))
  .split(',')
  .filter(Boolean)
const inconnue = tenues.find((t) => !connues.includes(t))
if (inconnue) {
  console.error(`tenue inconnue : ${inconnue} (connues : ${connues.join(', ')})`)
  process.exit(2)
}

const atlas = Object.fromEntries(
  animaux.map((a) => {
    if (!FICHIERS[a]) throw new Error(`animal inconnu : ${a}`)
    return [
      a,
      'data:image/avif;base64,' + readFileSync(resolve(dossier, FICHIERS[a])).toString('base64')
    ]
  })
)

const navigateur = await chromium.launch({ channel: 'chrome', headless: true })
try {
  const page = await navigateur.newPage()
  await page.setContent('<body style="margin:0;background:#2b2b33"></body>') // couleur-fixe: fond neutre de la planche de preuve
  const resultat = await page.evaluate(
    async ({ codeTenue, atlas, rangees, colonne, tenues, an }) => {
      const { masqueDeTenue, caseDeTenue, FENETRES_DE_TENUE } = new Function(
        `${codeTenue}; return Tenue`
      )()
      const charger = (src) =>
        new Promise((ok, ko) => {
          const i = new Image()
          i.onload = () => ok(i)
          i.onerror = ko
          i.src = src
        })
      const noms = Object.keys(atlas)
      const colonnes = ['origine', ...tenues]
      const marge = 8,
        entete = 18,
        gauche = 120
      const planche = document.createElement('canvas')
      planche.width = gauche + colonnes.length * (an.cw + marge)
      planche.height = entete + noms.length * rangees.length * (an.ch + marge) + marge
      const p = planche.getContext('2d')
      p.fillStyle = '#2b2b33'
      p.fillRect(0, 0, planche.width, planche.height)
      p.fillStyle = '#ddd'
      p.font = '12px monospace'
      colonnes.forEach((t, k) => p.fillText(t, gauche + k * (an.cw + marge), 13))
      const infos = {},
        parts = {}
      let ligne = 0
      for (const nom of noms) {
        const A = await charger(atlas[nom])
        // Comme `peindreAtlas` puis le niveau `base` de la scène : filtre de saturation, puis la planche
        // ramenée à la grille de `donnees.json` en lissage « low » (le tanuki v3 est livré en ×2).
        const t = document.createElement('canvas')
        t.width = 12 * an.cw
        t.height = Math.round((A.height * t.width) / A.width)
        const tc = t.getContext('2d', { willReadFrequently: true })
        tc.imageSmoothingEnabled = true
        tc.imageSmoothingQuality = 'low'
        tc.filter = 'saturate(1.06)'
        tc.drawImage(A, 0, 0, t.width, t.height)
        tc.filter = 'none'
        const nbRangees = Math.floor(t.height / an.ch)
        infos[nom] = { largeur: A.width, hauteur: A.height, rangees: nbRangees }
        const rgba = tc.getImageData(0, 0, t.width, t.height).data
        const masque = masqueDeTenue(rgba, FENETRES_DE_TENUE[nom])
        parts[nom] = {}
        for (const r of rangees) {
          const y0 = entete + ligne * (an.ch + marge)
          ligne++
          p.fillStyle = '#ddd'
          p.fillText(`${nom} r${r}`, 6, y0 + an.ch / 2)
          if (r >= nbRangees) {
            parts[nom][r] = null
            p.fillText('hors atlas', gauche + 20, y0 + an.ch / 2)
            continue
          }
          let opaques = 0,
            tenue = 0
          for (let y = 0; y < an.ch; y++)
            for (let x = 0; x < an.cw; x++) {
              const i = (r * an.ch + y) * t.width + colonne * an.cw + x
              if (rgba[i * 4 + 3] > 128) {
                opaques++
                if (masque[i] > 128) tenue++
              }
            }
          parts[nom][r] = opaques ? Math.round((tenue / opaques) * 1000) / 1000 : 0
          for (const [k, couleur] of colonnes.entries()) {
            const ox = gauche + k * (an.cw + marge)
            p.globalCompositeOperation = 'source-over'
            p.drawImage(t, colonne * an.cw, r * an.ch, an.cw, an.ch, ox, y0, an.cw, an.ch)
            if (couleur === 'origine') continue
            // Mêmes gestes que poserTenue (quartier-scene.ts).
            const k2 = caseDeTenue(masque, t.width, colonne, r, an.cw, an.ch, couleur)
            p.globalCompositeOperation = 'color'
            p.drawImage(k2, ox, y0, an.cw, an.ch)
          }
          p.globalCompositeOperation = 'source-over'
        }
      }
      return { png: planche.toDataURL('image/png'), infos, parts }
    },
    { codeTenue, atlas, rangees, colonne, tenues, an }
  )
  const { writeFileSync, mkdirSync } = await import('node:fs')
  mkdirSync(dirname(sortie), { recursive: true })
  writeFileSync(sortie, Buffer.from(resultat.png.split(',')[1], 'base64'))
  console.log(JSON.stringify({ sortie, atlas: resultat.infos, tenue: resultat.parts }, null, 1))
} finally {
  await navigateur.close()
}
