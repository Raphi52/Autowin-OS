#!/usr/bin/env node
/**
 * BANC — la mémoire du moteur graphique quand le décor d'accueil s'ouvre et se ferme.
 *
 * Pourquoi un banc à part : la mémoire du processus GPU de l'app ouverte bouge de plusieurs
 * centaines de Mo d'une minute à l'autre (autres vues, aperçus, agents). On ne peut pas y lire
 * l'effet d'un seul geste. Ici, une fenêtre Electron CACHÉE (rien sur l'écran de l'utilisateur,
 * profil jetable) monte le VRAI décor (`src/renderer/src/components/home-decor-scene.ts`), le dessine,
 * le ferme, et recommence ; après chaque fermeture on relève la mémoire de son processus GPU.
 *
 * Deux variantes du même code, compilées à la volée :
 *  - `apres` : le décor tel qu'il est dans le dépôt ;
 *  - `avant` : la libération réduite à `dispose()` seul (l'état d'avant `libererMoteur3d`),
 *    pour mesurer ce que la perte forcée du contexte rend vraiment.
 *
 * Usage : node scripts/banc-memoire-decor.mjs [--cycles 10] [--largeur 1920] [--hauteur 1080]
 *         [--variante avant|apres|les-deux] [--json]
 * Code de sortie : 0 mesure faite, 1 mesure impossible (WebGL absent, Electron introuvable).
 */
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const racine = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)

/** Lit `--nom valeur`, ou rend `defaut`. */
function option(argv, nom, defaut) {
  const i = argv.indexOf(nom)
  if (i < 0 || argv[i + 1] === undefined) return defaut
  return argv[i + 1]
}

/**
 * Résume les relevés d'une variante, en Mo. `depart` = avant le premier décor, `pic` = le plus
 * haut après une fermeture, `fin` = 3 s après la dernière : ce qui reste quand l'utilisateur a
 * quitté l'accueil. Les contextes perdus disent si la perte forcée a bien eu lieu.
 */
export function resumerReleves(releves) {
  const mo = (ko) => Math.round(ko / 1024)
  const apresFermeture = releves.filter((r) => typeof r.cycle === 'number' && r.cycle > 0)
  const depart = releves.find((r) => r.cycle === 0)
  const fin = releves.find((r) => r.cycle === 'fin')
  return {
    departMo: mo(depart.prive),
    picMo: mo(Math.max(...apresFermeture.map((r) => r.prive))),
    finMo: mo(fin.prive),
    monteeMo: mo(fin.prive - depart.prive),
    contextesPerdus: apresFermeture.filter((r) => r.contextePerdu === true).length,
    cycles: apresFermeture.length
  }
}

const ENTREE = (cheminDecor) => `
import { createDecorScene } from ${JSON.stringify(cheminDecor)}
const attendre = (ms) => new Promise((r) => setTimeout(r, ms))
window.lancerUnCycle = async (largeur, hauteur) => {
  const scene = createDecorScene()
  if (!scene) return { erreur: 'WebGL indisponible dans la fenêtre cachée' }
  document.body.appendChild(scene.canvas)
  scene.resize(largeur, hauteur)
  for (let image = 0; image < 20; image++) {
    scene.render(image / 60, { x: 0, y: 0 })
    await attendre(16)
  }
  const canvas = scene.canvas
  scene.dispose()
  await attendre(50)
  // Relu sans garder la référence : la retenir empêcherait le ramasse-miettes de la variante avant.
  return { contextePerdu: canvas.getContext('webgl2')?.isContextLost() ?? null }
}
`

const PRINCIPAL = `
const { app, BrowserWindow } = require('electron')
const [page, cyclesTexte, largeurTexte, hauteurTexte, profil] = process.argv.slice(-5)
const cycles = Number(cyclesTexte), largeur = Number(largeurTexte), hauteur = Number(hauteurTexte)
app.setPath('userData', profil)
const attendre = (ms) => new Promise((r) => setTimeout(r, ms))
const gpu = () => {
  const p = app.getAppMetrics().find((m) => m.type === 'GPU')
  return p ? { prive: p.memory.privateBytes ?? p.memory.workingSetSize, travail: p.memory.workingSetSize } : null
}
app.whenReady().then(async () => {
  const fenetre = new BrowserWindow({
    show: false, width: largeur, height: hauteur,
    webPreferences: { backgroundThrottling: false }
  })
  await fenetre.loadFile(page)
  await attendre(1500)
  const releves = [{ cycle: 0, ...gpu() }]
  for (let cycle = 1; cycle <= cycles; cycle++) {
    const r = await fenetre.webContents.executeJavaScript('lancerUnCycle(' + largeur + ',' + hauteur + ')')
    if (r.erreur) { process.stdout.write(JSON.stringify({ erreur: r.erreur })); app.exit(1); return }
    await attendre(300)
    releves.push({ cycle, contextePerdu: r.contextePerdu, ...gpu() })
  }
  await attendre(3000)
  releves.push({ cycle: 'fin', ...gpu() })
  process.stdout.write(JSON.stringify({ releves }))
  app.exit(0)
})
`

/** Compile le décor pour une variante, le joue dans Electron caché, rend ses relevés. */
async function mesurer(variante, { cycles, largeur, hauteur, travail }) {
  const { build } = await import('esbuild')
  const dossier = join(travail, variante)
  const cheminDecor = join(racine, 'src', 'renderer', 'src', 'components', 'home-decor-scene.ts')
  const sansPerte = join(dossier, 'liberation-dispose-seul.mjs')
  const plugins = []
  if (variante === 'avant') {
    writeFileSync(sansPerte, 'export function libererMoteur3d(m) { if (m) m.dispose() }\n', {
      flag: 'w'
    })
    plugins.push({
      name: 'liberation-avant',
      setup(b) {
        b.onResolve({ filter: /moteur-3d-liberation$/ }, () => ({ path: sansPerte }))
      }
    })
  }
  await build({
    stdin: { contents: ENTREE(cheminDecor.replace(/\\/g, '/')), resolveDir: racine, loader: 'js' },
    bundle: true,
    format: 'iife',
    platform: 'browser',
    outfile: join(dossier, 'banc.js'),
    define: { 'import.meta.env': '{}' },
    logLevel: 'error',
    plugins
  })
  writeFileSync(
    join(dossier, 'banc.html'),
    '<!doctype html><meta charset="utf-8"><body style="margin:0"><script src="banc.js"></script>'
  )
  writeFileSync(join(dossier, 'principal.cjs'), PRINCIPAL)
  const electron = require('electron')
  // Un agent lancé par l'app hérite d'ELECTRON_RUN_AS_NODE : Electron démarrerait alors en simple
  // node, sans fenêtre ni GPU. Même vide, la variable compte : il faut la retirer.
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  const sortie = spawnSync(
    electron,
    [
      join(dossier, 'principal.cjs'),
      join(dossier, 'banc.html'),
      String(cycles),
      String(largeur),
      String(hauteur),
      join(dossier, 'profil')
    ],
    { encoding: 'utf8', timeout: 180000, env }
  )
  const json = (sortie.stdout ?? '')
    .trim()
    .split('\n')
    .reverse()
    .find((l) => l.startsWith('{'))
  if (!json) throw new Error(`Electron n'a rien rendu (code ${sortie.status}) : ${sortie.stderr}`)
  const resultat = JSON.parse(json)
  if (resultat.erreur) throw new Error(resultat.erreur)
  return resultat.releves
}

async function principal(argv) {
  const cycles = Number(option(argv, '--cycles', '10'))
  const largeur = Number(option(argv, '--largeur', '1920'))
  const hauteur = Number(option(argv, '--hauteur', '1080'))
  const choix = option(argv, '--variante', 'les-deux')
  const variantes = choix === 'les-deux' ? ['avant', 'apres'] : [choix]
  const travail = mkdtempSync(join(tmpdir(), 'banc-memoire-decor-'))
  try {
    const resultats = {}
    for (const variante of variantes) {
      mkdirSync(join(travail, variante), { recursive: true })
      const releves = await mesurer(variante, { cycles, largeur, hauteur, travail })
      resultats[variante] = { ...resumerReleves(releves), releves }
    }
    if (argv.includes('--json')) {
      process.stdout.write(JSON.stringify(resultats, null, 2) + '\n')
    } else {
      console.log(
        `Décor ${largeur}×${hauteur}, ${cycles} ouvertures/fermetures, mémoire privée du processus GPU :`
      )
      for (const [variante, r] of Object.entries(resultats)) {
        console.log(
          `  ${variante.padEnd(6)} départ ${r.departMo} Mo · pic ${r.picMo} Mo · fin ${r.finMo} Mo` +
            ` · reste ${r.monteeMo >= 0 ? '+' : ''}${r.monteeMo} Mo · contextes rendus ${r.contextesPerdus}/${r.cycles}`
        )
      }
    }
    return 0
  } catch (erreur) {
    console.error(`Mesure impossible : ${erreur.message}`)
    return 1
  } finally {
    rmSync(travail, { recursive: true, force: true })
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await principal(process.argv.slice(2))
}
