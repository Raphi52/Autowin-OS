/**
 * DÉCOUPE DE LA VRAIE PEINTURE DU QUARTIER, pour une maquette /draft (conv-1642, 2026-11-06).
 *
 * Pourquoi : un /draft sur le fond de l'Accueil (eau de l'onsen, vapeur, gong…) doit se jouer sur la
 * peinture réelle, pas sur une imitation. Elle est en AVIF de 2688 × 1536 (peinture 1344 × 768 à
 * l'échelle 2) et la scène d'un carrousel est sans réseau : il lui faut des `data:`. Ce script découpe
 * un cadre en coordonnées de PEINTURE (celles de donnees.json : bassin, postes, niv) et, au besoin, des
 * cases de l'atlas d'un animal (rang:colonne, cases de 252 × 340), en WebP data: prêtes à coller.
 *
 * Décodage par Chrome (playwright-core) : Node ne lit pas l'AVIF seul.
 *
 * Usage : node scripts/quartier-decoupe.mjs --x 168 --y 562 --l 368 --h 206
 *           [--atlas 9:0,9:3] [--animal tanuki|renard|panda|panda-roux] [--qualite 0.78]
 *           [--out .autowin-tmp/decoupe]
 * Sortie : <out>/fond.txt (+ fond.png à LIRE), <out>/atlas-<rang>-<col>.txt (+ .png), et un JSON
 * sur stdout (tailles, poids). Code 0 = fait ; 2 = usage ; 1 = erreur (Chrome, image).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const RACINE = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const ASSETS = join(RACINE, 'src/renderer/src/assets/quartier')
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const ATLAS = {
  tanuki: 'atlas.avif',
  renard: 'atlas-renard.avif',
  panda: 'atlas-panda.avif',
  'panda-roux': 'atlas-panda-roux.avif'
}

const arg = (nom, defaut) => {
  const i = process.argv.indexOf(nom)
  return i > 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : defaut
}
const cadre = ['--x', '--y', '--l', '--h'].map((n) => Number(arg(n, NaN)))
if (cadre.some((v) => !Number.isFinite(v)) || cadre[2] <= 0 || cadre[3] <= 0) {
  process.stderr.write(
    'usage : node scripts/quartier-decoupe.mjs --x <px> --y <px> --l <px> --h <px> [--atlas 9:0,9:3] [--animal tanuki] [--qualite 0.78] [--out <dossier>]\n'
  )
  process.exit(2)
}
const cases = String(arg('--atlas', ''))
  .split(',')
  .filter(Boolean)
  .map((c) => c.split(':').map(Number))
if (cases.some((c) => c.length !== 2 || c.some((v) => !Number.isInteger(v) || v < 0))) {
  process.stderr.write('--atlas : des cases rang:colonne, par exemple 9:0,9:3\n')
  process.exit(2)
}
const animal = arg('--animal', 'tanuki')
if (!ATLAS[animal]) {
  process.stderr.write(`--animal : ${Object.keys(ATLAS).join(', ')}\n`)
  process.exit(2)
}
const qualite = Number(arg('--qualite', '0.78'))
const out = resolve(arg('--out', join(RACINE, '.autowin-tmp/decoupe')))
mkdirSync(out, { recursive: true })

const dataAvif = (f) => 'data:image/avif;base64,' + readFileSync(join(ASSETS, f)).toString('base64')

let navigateur
try {
  const { chromium } = await import('playwright-core')
  navigateur = await chromium.launch({ executablePath: CHROME, headless: true })
  const page = await navigateur.newPage()
  const r = await page.evaluate(
    async ({ fal, atl, cadre, cases, qualite }) => {
      const charge = async (s) => {
        const i = new Image()
        i.src = s
        await i.decode()
        return i
      }
      const F = await charge(fal)
      const S = F.naturalWidth / 1344
      const [x, y, l, h] = cadre
      const c = document.createElement('canvas')
      c.width = Math.round(l * S)
      c.height = Math.round(h * S)
      c.getContext('2d').drawImage(F, -x * S, -y * S)
      const res = {
        S,
        fond: {
          webp: c.toDataURL('image/webp', qualite),
          png: c.toDataURL('image/png'),
          l: c.width,
          h: c.height
        },
        cases: []
      }
      if (cases.length) {
        const T = await charge(atl)
        const cw = T.naturalWidth / 12
        const ch = cw * (340 / 252)
        for (const [rg, col] of cases) {
          const t = document.createElement('canvas')
          t.width = cw
          t.height = ch
          t.getContext('2d').drawImage(T, -col * cw, -rg * ch)
          res.cases.push({
            rg,
            col,
            webp: t.toDataURL('image/webp', 0.85),
            png: t.toDataURL('image/png'),
            l: cw,
            h: ch
          })
        }
      }
      return res
    },
    {
      fal: dataAvif('falaise.avif'),
      atl: cases.length ? dataAvif(ATLAS[animal]) : '',
      cadre,
      cases,
      qualite
    }
  )
  const png = (d) => Buffer.from(d.split(',')[1], 'base64')
  writeFileSync(join(out, 'fond.txt'), r.fond.webp)
  writeFileSync(join(out, 'fond.png'), png(r.fond.png))
  const fichiers = [
    {
      fichier: join(out, 'fond.txt'),
      l: r.fond.l,
      h: r.fond.h,
      ko: Math.round(r.fond.webp.length / 1024)
    }
  ]
  for (const c of r.cases) {
    const base = join(out, `atlas-${c.rg}-${c.col}`)
    writeFileSync(base + '.txt', c.webp)
    writeFileSync(base + '.png', png(c.png))
    fichiers.push({ fichier: base + '.txt', l: c.l, h: c.h, ko: Math.round(c.webp.length / 1024) })
  }
  process.stdout.write(
    JSON.stringify({ ok: true, echelle: r.S, cadre, animal, fichiers }, null, 2) + '\n'
  )
} catch (e) {
  process.stdout.write(JSON.stringify({ ok: false, erreur: String(e?.message ?? e) }) + '\n')
  process.exitCode = 1
} finally {
  await navigateur?.close()
}
