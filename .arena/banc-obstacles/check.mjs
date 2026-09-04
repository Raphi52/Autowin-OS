#!/usr/bin/env node
/**
 * Critère de succès du banc « obstacles dédupliqués » du widget de remontée des agents.
 * Usage : node check.mjs <racine-du-depot>
 * 1 cas nominal + 3 cas limites. Code de sortie 0 = critère atteint.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'
import { resolve, join } from 'node:path'

const NLJ = String.fromCharCode(10)
const racine = resolve(process.argv[2] ?? '.')
const modele = join(racine, 'src/renderer/src/components/run-progress-model.ts')
if (!existsSync(modele)) {
  console.log(`RATE cible absente : ${modele}`)
  console.log('\nCRITÈRE NON ATTEINT (1 RATE)')
  process.exit(1)
}

const sonde = `
import { buildRunProgress } from ${JSON.stringify(pathToFileURL(modele).href)}
const NL = String.fromCharCode(10)
const B = '⛔ Bloqué : le worktree refuse la publication'
const A = '⚠️ Non résolu : le test de bord reste rouge'
const cas = {
  nominal: buildRunProgress([{ step: 'x', status: 'ok', detail: 'phase build', text: B + NL + 'ligne calme' + NL + A }]),
  doublonTexteRaisonnement: buildRunProgress([{ step: 'x', status: 'ok', detail: 'phase build', text: B, thinking: B }]),
  doublonErreurTexte: buildRunProgress([{ step: 'x', status: 'failed', error: B, detail: 'phase build', text: B }]),
  doublonInterne: buildRunProgress([{ step: 'x', status: 'ok', detail: 'phase build', text: B + NL + B + NL + '   ' + NL + B }])
}
const out = {}
for (const [k, v] of Object.entries(cas)) out[k] = { obstacles: v.entries[0].obstacles, count: v.obstacleCount, substeps: v.entries[0].substeps.map(s => s.label) }
process.stdout.write('---JSON---' + JSON.stringify(out))
`

const fichierSonde = join(tmpdir(), `arena-sonde-${process.pid}.mts`)
writeFileSync(fichierSonde, sonde, 'utf8')
const r = spawnSync(`npx tsx ${JSON.stringify(fichierSonde)}`, {
  cwd: racine,
  encoding: 'utf8',
  shell: true
})
try {
  rmSync(fichierSonde, { force: true })
} catch {}
const brut = (r.stdout ?? '') + (r.stderr ?? '')
const marque = brut.indexOf('---JSON---')
if (marque < 0) {
  console.log('RATE la sonde n a pas pu charger le modèle :')
  console.log(brut.trim().split('\n').slice(-12).join('\n'))
  console.log('\nCRITÈRE NON ATTEINT (1 RATE)')
  process.exit(1)
}
const o = JSON.parse(brut.slice(marque + 10))

const B = '⛔ Bloqué : le worktree refuse la publication'
const A = '⚠️ Non résolu : le test de bord reste rouge'
const verifs = [
  [
    'nominal : deux obstacles DISTINCTS conservés, dans l ordre de première apparition',
    () => JSON.stringify(o.nominal.obstacles) === JSON.stringify([B, A]) && o.nominal.count === 2,
    () => `obstacles=${JSON.stringify(o.nominal.obstacles)} count=${o.nominal.count}`
  ],
  [
    'cas limite : ligne identique dans texte ET raisonnement comptée UNE fois',
    () => o.doublonTexteRaisonnement.obstacles.length === 1 && o.doublonTexteRaisonnement.count === 1,
    () => `obstacles=${JSON.stringify(o.doublonTexteRaisonnement.obstacles)} count=${o.doublonTexteRaisonnement.count}`
  ],
  [
    'cas limite : erreur de l étape identique à une ligne du texte comptée UNE fois, et non dupliquée dans les sous-étapes',
    () => o.doublonErreurTexte.obstacles.length === 1 && o.doublonErreurTexte.count === 1 && o.doublonErreurTexte.substeps.filter((l) => l === B).length === 1,
    () => `obstacles=${JSON.stringify(o.doublonErreurTexte.obstacles)} count=${o.doublonErreurTexte.count} substeps=${JSON.stringify(o.doublonErreurTexte.substeps)}`
  ],
  [
    'cas limite : même ligne répétée 3 fois dans un seul texte (+ ligne vide) comptée UNE fois',
    () => o.doublonInterne.obstacles.length === 1 && o.doublonInterne.count === 1,
    () => `obstacles=${JSON.stringify(o.doublonInterne.obstacles)} count=${o.doublonInterne.count}`
  ]
]

let rates = 0
for (const [nom, ok, detail] of verifs) {
  let bon = false
  try { bon = ok() } catch { bon = false }
  if (bon) console.log(`OK   ${nom}`)
  else { rates++; console.log(`RATE ${nom} — ${detail()}`) }
}
console.log(rates === 0 ? '\nCRITÈRE ATTEINT (4 OK)' : `\nCRITÈRE NON ATTEINT (${rates} RATE)`)
process.exit(rates === 0 ? 0 : 1)
