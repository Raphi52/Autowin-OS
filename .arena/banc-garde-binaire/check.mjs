#!/usr/bin/env node
/**
 * Critère du banc /arena « garde binaire » — défaut : `scripts/cdp-knowledge-circular-proof.mjs:91`
 * appelle `statSync(executable)` sans garde, donc quand le paquet de bureau n'est pas construit la
 * sonde plante en trace brute (`node:fs`, ENOENT, exit 1) au lieu de dire « binaire absent » et de
 * sortir 2 comme ses quatre frères (`scripts/verifier-chemin-critique.mjs:47-52`).
 *
 * Usage : node check.mjs <racine-de-la-copie>
 * Exit 0 = critère atteint · 1 = au moins une assertion RATE.
 *
 * Limite nommée : le chemin « binaire présent » n'est pas testable sans un build (~292 s) — hors critère.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

const racine = path.resolve(process.argv[2] ?? '.')
const sonde = path.join(racine, 'scripts', 'cdp-knowledge-circular-proof.mjs')
const binaire = path.join(racine, 'dist', 'win-unpacked', 'autowin-os.exe')
let rates = 0
const check = (libelle, fn) => {
  let ok = false
  let detail = ''
  try {
    const r = fn()
    ok = r === true
    if (!ok) detail = ` — ${r}`
  } catch (e) {
    detail = ` — assertion en erreur : ${e.message}`
  }
  if (!ok) rates++
  console.log(`${ok ? 'OK  ' : 'RATE'} ${libelle}${detail}`)
}

let sortie = ''
let statut = null
if (existsSync(sonde)) {
  const r = spawnSync(process.execPath, [sonde], {
    cwd: racine,
    encoding: 'utf8',
    timeout: 300000,
    maxBuffer: 20 * 1024 * 1024
  })
  statut = r.status
  sortie = String(r.stdout || '') + String(r.stderr || '')
}

check('précondition — le paquet de bureau est bien ABSENT (sinon ce critère ne mesure rien)', () =>
  existsSync(binaire) ? `${binaire} existe : le cas mesuré n'est pas celui du défaut` : true
)

check('(a) paquet absent : la sonde sort exactement 2 (comme ses quatre frères)', () => {
  if (!existsSync(sonde)) return `${sonde} introuvable — une sonde supprimée n'est pas une sonde verte`
  return statut === 2 ? true : `exit ${statut}`
})

check('(b) la sortie DIT « binaire absent » et ne déverse aucune trace brute', () => {
  if (!/binaire absent/i.test(sortie)) return `aucun message « binaire absent » : ${sortie.trim().slice(-200)}`
  const fuites = ['node:fs', 'at statSync'].filter((s) => sortie.includes(s))
  return fuites.length ? `trace brute encore présente : ${fuites.join(', ')}` : true
})

check('(c) cas limite — la preuve n’est pas neutralisée (statSync et control Start toujours là)', () => {
  if (!existsSync(sonde)) return 'sonde introuvable'
  const src = readFileSync(sonde, 'utf8')
  const manquants = ['statSync(executable)', "control('Start')"].filter((s) => !src.includes(s))
  return manquants.length ? `retiré de la sonde : ${manquants.join(', ')}` : true
})

console.log(rates === 0 ? 'CRITERE ATTEINT' : `CRITERE RATE (${rates})`)
process.exit(rates === 0 ? 0 : 1)
