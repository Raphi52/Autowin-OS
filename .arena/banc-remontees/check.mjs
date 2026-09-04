#!/usr/bin/env node
/**
 * Critère du banc /arena « compteur du widget Remontées des agents ».
 * Usage : node check.mjs <racine-du-depot>
 * Exit 0 = critère atteint · 1 = au moins une assertion RATE · 2 = critère inexécutable.
 *
 * Il DÉPOSE `critere.test.tsx` dans le dépôt visé, joue vitest dessus, puis le RETIRE.
 * Rien n'est laissé derrière : le critère ne doit pas devenir un fichier du dépôt.
 */
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'

const racine = path.resolve(process.argv[2] ?? '.')
const BANC = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
const REL = path.join('src', 'renderer', 'src', 'components', 'arena-critere-remontees.test.tsx')
const cible = path.join(racine, REL)
const vitest = path.join(racine, 'node_modules', 'vitest', 'vitest.mjs')

let resultats = new Map()
let panne = null

if (!existsSync(vitest)) {
  panne = `vitest introuvable (${vitest}) : dépôt sans dépendances installées`
} else {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'arena-remontees-'))
  const rapport = path.join(tmp, 'vitest.json')
  try {
    copyFileSync(path.join(BANC, 'critere.test.tsx'), cible)
    const r = spawnSync(
      process.execPath,
      [vitest, 'run', REL.split(path.sep).join('/'), '--reporter=json', `--outputFile=${rapport}`],
      { cwd: racine, encoding: 'utf8', timeout: 300000 }
    )
    if (!existsSync(rapport)) {
      panne = `vitest n'a produit aucun rapport (code ${r.status})\n${(r.stderr ?? '').slice(-1500)}`
    } else {
      const json = JSON.parse(readFileSync(rapport, 'utf8'))
      for (const fichier of json.testResults ?? []) {
        for (const a of fichier.assertionResults ?? []) {
          resultats.set(a.title, {
            ok: a.status === 'passed',
            why: (a.failureMessages ?? []).join(' ').split('\n')[0] ?? a.status
          })
        }
      }
      if (resultats.size === 0) panne = `aucune assertion jouée (code ${r.status})`
    }
  } finally {
    rmSync(cible, { force: true })
    rmSync(tmp, { recursive: true, force: true })
  }
}

let rates = 0
const check = (libelle) => {
  let ok = false
  let detail = ''
  if (panne) detail = ` — critère inexécutable : ${panne}`
  else {
    const r = resultats.get(libelle)
    if (!r) detail = ' — assertion absente du rapport vitest'
    else {
      ok = r.ok
      if (!ok) detail = ` — ${r.why}`
    }
  }
  if (!ok) rates++
  console.log(`${ok ? 'OK  ' : 'RATE'} ${libelle}${detail}`)
}

check('nominal : 3 remontées dont 2 non lues, la pastille affiche 2')
check('cas limite — 31 non lues pour 30 lignes affichables : la pastille doit dire 31, jamais 30')
check('cas limite — aucune remontée : liste vide, aucune pastille, aucun plantage')
check('cas limite — zéro non lue parmi 40 déjà acquittées : aucune pastille')
check('cas limite — 100 non lues : pastille exacte ET liste toujours bornée à 30 lignes')

console.log(rates === 0 ? '\nCRITÈRE ATTEINT' : `\nCRITÈRE NON ATTEINT (${rates} RATE)`)
process.exit(panne ? 2 : rates === 0 ? 0 : 1)
