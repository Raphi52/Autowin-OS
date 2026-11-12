#!/usr/bin/env node
/**
 * Rend une scène three.js D'EXPORT en images numérotées (`f-001.png` …), fond transparent, pour
 * `scripts/mascotte-panda-planches.py`, qui les colle en planches pour la mascotte du bureau.
 *
 * Pourquoi : la fenêtre de la mascotte n'admet aucun script (`mascotte.ts`), la 3D y est rejouée en
 * CSS image par image. Le panda boss est modelé en three.js (le brouillon /draft où il a été choisi) :
 * ce script le photographie dans le MÊME moteur, au lieu de le refaire dans un autre outil.
 *
 * La scène d'export pose `window.exporter` :
 *   { gestes: string[], images: number, taille: number,
 *     rendre(n) -> dataURL PNG de l'image n (0 … gestes × images - 1),
 *     medaillon(n) -> { x, y, r } : l'écran du médaillon dans l'image n, en pixels (facultatif) }
 * Elle lit `THREE` et `OrbitControls` en globales, comme une scène ```threejs du fil.
 *
 * Chrome sans fenêtre (Playwright, canal « chrome ») : rien ne s'ouvre à l'écran, jamais Edge.
 *
 * Usage : node scripts/mascotte-panda-rendu.mjs <scene-export.js> [--sortie <dossier>]
 * Sortie JSON : { sortie, images, medaillon: { <geste>: { x, y, r, ecart } } } ; code 1 si la scène
 * lève une erreur ou si une image est vide.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildSync } from 'esbuild'
import { chromium } from 'playwright-core'

const racine = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const fichier = process.argv[2]
if (!fichier || fichier.startsWith('--')) {
  console.error(
    'Usage : node scripts/mascotte-panda-rendu.mjs <scene-export.js> [--sortie <dossier>]'
  )
  process.exit(2)
}
const i = process.argv.indexOf('--sortie')
const sortie = resolve(
  i > 0 ? process.argv[i + 1] : join(racine, '.autowin-tmp', 'mascotte-panda-rendu')
)
mkdirSync(sortie, { recursive: true })

const scene = readFileSync(resolve(fichier), 'utf8')
if (/<\/script/iu.test(scene)) {
  console.error('la scène contient « </script » : elle couperait la page')
  process.exit(2)
}
// Le moteur du paquet installé, avec les contrôles d'orbite que la scène nomme.
const moteur = buildSync({
  stdin: {
    contents:
      "import * as THREE from 'three'\nimport { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'\n" +
      'globalThis.THREE = THREE\nglobalThis.OrbitControls = OrbitControls\n',
    resolveDir: racine
  },
  bundle: true,
  format: 'iife',
  platform: 'browser',
  write: false
}).outputFiles[0].text

const navigateur = await chromium.launch({ channel: 'chrome', headless: true })
const erreurs = []
try {
  const page = await navigateur.newPage({ viewport: { width: 420, height: 420 } })
  page.on('pageerror', (e) => erreurs.push(String(e)))
  page.on('console', (m) => m.type() === 'error' && erreurs.push(m.text()))
  await page.setContent(
    `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0">` +
      `<script>${moteur}</script><script>${scene}</script></body></html>`
  )
  await page.waitForFunction(() => window.exporter, null, { timeout: 60_000 }).catch(() => {})
  const infos = await page.evaluate(() =>
    window.exporter
      ? {
          gestes: window.exporter.gestes,
          images: window.exporter.images,
          medaillon: !!window.exporter.medaillon
        }
      : null
  )
  if (!infos)
    throw new Error(`window.exporter absent — ${erreurs.join(' | ') || 'aucune erreur lue'}`)
  const total = infos.gestes.length * infos.images
  const reperes = {}
  for (let n = 0; n < total; n++) {
    const url = await page.evaluate((k) => window.exporter.rendre(k), n)
    const octets = Buffer.from(url.slice(url.indexOf(',') + 1), 'base64')
    // Une image PNG de quelques centaines d'octets est vide : rien n'a été dessiné.
    if (octets.length < 2000) throw new Error(`image ${n + 1} vide (${octets.length} octets)`)
    writeFileSync(join(sortie, `f-${String(n + 1).padStart(3, '0')}.png`), octets)
    if (infos.medaillon) {
      const geste = infos.gestes[Math.floor(n / infos.images)]
      ;(reperes[geste] ??= []).push(await page.evaluate((k) => window.exporter.medaillon(k), n))
    }
  }
  if (erreurs.length) throw new Error(erreurs.join(' | '))
  // Par geste : la position moyenne de l'écran du médaillon, son plus grand écart (il se balance, le panda
  // sautille), et sa position IMAGE PAR IMAGE, en part de l'image (0 à 1) : la page de la mascotte en tire
  // l'animation du chiffre, pour qu'il reste posé sur le médaillon.
  const taille = await page.evaluate(() => window.exporter.taille)
  const medaillon = Object.fromEntries(
    Object.entries(reperes).map(([geste, points]) => {
      const moy = (cle) => points.reduce((s, p) => s + p[cle], 0) / points.length
      const x = moy('x'),
        y = moy('y'),
        r = moy('r')
      const ecart = Math.max(...points.map((p) => Math.hypot(p.x - x, p.y - y)))
      const arrondi = (v, k = 10) => Math.round(v * k) / k
      const images = points.map((p) => [arrondi(p.x / taille, 1e4), arrondi(p.y / taille, 1e4)])
      return [geste, { x: arrondi(x), y: arrondi(y), r: arrondi(r), ecart: arrondi(ecart), images }]
    })
  )
  writeFileSync(join(sortie, 'medaillon.json'), JSON.stringify(medaillon, null, 2))
  console.log(JSON.stringify({ sortie, images: total, medaillon }, null, 2))
} catch (erreur) {
  console.error(String(erreur))
  process.exitCode = 1
} finally {
  await navigateur.close()
}
