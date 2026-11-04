#!/usr/bin/env node
// Planche de preuve des atlas du Quartier : une case par rangée demandée, pour chaque animal, avec le
// foulard posé par la mesure du cou de la scène. Née de conv-1554 (/grow) : la même planche avait été
// improvisée deux fois (conv-1546, conv-1554), la seconde dessinée en Python, donc seulement « à peu près »
// comme la scène — le juge l'avait relevé.
// Fidélité : `cousDeLAtlas` et `COU` sont lus TELS QUELS dans quartier-scene.ts (source extraite puis
// dépouillée de ses types), et le dessin rejoue dans Edge les mêmes gestes de canvas que `poserFoulard`.
//
// Usage : node scripts/quartier-planche.mjs --rangees 23,24,25 [--colonne 0] [--couleur #c0392b]
//         [--sortie .autowin-tmp/planche.png] [--animaux tanuki,renard,panda,panda-roux]
// Sortie JSON : { sortie, atlas: {animal: {largeur, hauteur, rangees}}, cous: {animal: {rangee: [x,y,demi]|null}} }
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { transformSync } from 'esbuild'
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
  console.error('Usage : --rangees 23,24,25 (entiers ≥ 0)')
  process.exit(2)
}
const colonne = Number(args.colonne ?? 0)
const couleur = args.couleur ?? '#c0392b'
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

// Le code de la scène, pas une copie : on découpe la constante et la fonction dans le fichier.
const scene = readFileSync(resolve(racine, 'src/renderer/src/quartier/quartier-scene.ts'), 'utf8')
const cou = scene.match(/^const COU = [^\n]+$/m)
const debut = scene.indexOf('export function cousDeLAtlas(')
const fin = scene.indexOf('\n}\n', debut)
if (!cou || debut < 0 || fin < 0) {
  console.error(
    'cousDeLAtlas ou COU introuvable dans quartier-scene.ts : le script est à remettre à jour.'
  )
  process.exit(3)
}
const codeCous = transformSync(`${cou[0]}\n${scene.slice(debut, fin + 2).replace('export ', '')}`, {
  loader: 'ts'
}).code

const atlas = Object.fromEntries(
  animaux.map((a) => {
    if (!FICHIERS[a]) throw new Error(`animal inconnu : ${a}`)
    return [
      a,
      'data:image/avif;base64,' + readFileSync(resolve(dossier, FICHIERS[a])).toString('base64')
    ]
  })
)

const navigateur = await chromium.launch({ channel: 'msedge', headless: true })
try {
  const page = await navigateur.newPage()
  await page.setContent('<body style="margin:0;background:#2b2b33"></body>') // couleur-fixe: fond neutre de la planche de preuve
  const resultat = await page.evaluate(
    async ({ codeCous, atlas, rangees, colonne, couleur, an }) => {
      const cousDeLAtlas = new Function(`${codeCous}; return cousDeLAtlas`)()
      const charger = (src) =>
        new Promise((ok, ko) => {
          const i = new Image()
          i.onload = () => ok(i)
          i.onerror = ko
          i.src = src
        })
      const noms = Object.keys(atlas)
      const marge = 8,
        entete = 18
      const planche = document.createElement('canvas')
      planche.width = marge + rangees.length * (an.cw + marge) + 90
      planche.height = entete + noms.length * (an.ch + marge) + marge
      const p = planche.getContext('2d')
      p.fillStyle = '#2b2b33'
      p.fillRect(0, 0, planche.width, planche.height)
      p.fillStyle = '#ddd'
      p.font = '12px monospace'
      rangees.forEach((r, k) => p.fillText(`rangée ${r}`, 90 + marge + k * (an.cw + marge), 13))
      const infos = {},
        cousSortis = {}
      const etoffe = document.createElement('canvas')
      etoffe.width = an.cw
      etoffe.height = an.ch
      for (const [n, nom] of noms.entries()) {
        const A = await charger(atlas[nom])
        const t = document.createElement('canvas')
        t.width = A.width
        t.height = A.height
        const tc = t.getContext('2d')
        tc.drawImage(A, 0, 0)
        const colonnes = Math.floor(A.width / an.cw),
          nbRangees = Math.floor(A.height / an.ch)
        infos[nom] = { largeur: A.width, hauteur: A.height, rangees: nbRangees }
        const cous = cousDeLAtlas(
          tc.getImageData(0, 0, A.width, A.height).data,
          A.width,
          an.cw,
          an.ch,
          colonnes,
          nbRangees
        )
        cousSortis[nom] = {}
        const y0 = entete + n * (an.ch + marge)
        p.fillStyle = '#ddd'
        p.fillText(nom, 6, y0 + an.ch / 2)
        for (const [k, r] of rangees.entries()) {
          const ox = 90 + marge + k * (an.cw + marge)
          if (r >= nbRangees) {
            cousSortis[nom][r] = 'hors atlas'
            p.fillText('hors atlas', ox + 20, y0 + an.ch / 2)
            continue
          }
          p.drawImage(t, colonne * an.cw, r * an.ch, an.cw, an.ch, ox, y0, an.cw, an.ch)
          const i = (r * colonnes + colonne) * 3,
            cx = cous[i]
          if (!Number.isFinite(cx)) {
            cousSortis[nom][r] = null
            continue
          }
          const cy = cous[i + 1]
          cousSortis[nom][r] = [cx, cy, cous[i + 2]]
          // Mêmes gestes que poserFoulard (quartier-scene.ts).
          const rx = Math.max(9, Math.min(20, cous[i + 2] * 0.8)),
            ry = 7.5
          const g = etoffe.getContext('2d')
          g.globalCompositeOperation = 'source-over'
          g.clearRect(0, 0, an.cw, an.ch)
          g.fillStyle = couleur
          g.beginPath()
          g.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2)
          g.fill()
          g.beginPath()
          g.moveTo(cx - rx * 0.45, cy + ry * 0.4)
          g.lineTo(cx + rx * 0.45, cy + ry * 0.4)
          g.lineTo(cx, cy + ry * 2.1)
          g.closePath()
          g.fill()
          const d = g.createLinearGradient(0, cy - ry, 0, cy + ry * 2.1)
          d.addColorStop(0, 'rgba(255,255,255,.2)')
          d.addColorStop(0.45, 'rgba(0,0,0,0)')
          d.addColorStop(1, 'rgba(0,0,0,.34)')
          g.globalCompositeOperation = 'source-atop'
          g.fillStyle = d
          g.fillRect(0, cy - ry, an.cw, ry * 3.2)
          g.globalCompositeOperation = 'destination-in'
          g.drawImage(t, colonne * an.cw, r * an.ch, an.cw, an.ch, 0, 0, an.cw, an.ch)
          p.drawImage(etoffe, ox, y0)
        }
      }
      return { png: planche.toDataURL('image/png'), infos, cous: cousSortis }
    },
    { codeCous, atlas, rangees, colonne, couleur, an }
  )
  const { writeFileSync, mkdirSync } = await import('node:fs')
  mkdirSync(dirname(sortie), { recursive: true })
  writeFileSync(sortie, Buffer.from(resultat.png.split(',')[1], 'base64'))
  console.log(JSON.stringify({ sortie, atlas: resultat.infos, cous: resultat.cous }, null, 1))
} finally {
  await navigateur.close()
}
