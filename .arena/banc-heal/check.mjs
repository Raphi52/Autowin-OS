#!/usr/bin/env node
/**
 * Critere de succes DETERMINISTE du banc /arena /heal.
 * Usage : node <ce fichier> <racine du depot a verifier>
 * Copie le test-critere NEUF dans la cible, le joue, le retire, puis confronte chaque assertion.
 * Exit 0 = critere atteint.
 */
import { copyFileSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ici = path.dirname(fileURLToPath(import.meta.url))
const cible = path.resolve(process.argv[2] || process.cwd())
const rel = 'src/main/activity/arena-heal-critere.test.ts'
const dest = path.join(cible, rel)
const rapport = path.join(cible, 'arena-heal-critere.rapport.json')
const results = []
const check = (nom, fn) => {
  try {
    const d = fn()
    results.push({ nom, ok: d === true, detail: d === true ? 'ok' : String(d) })
  } catch (e) {
    results.push({ nom, ok: false, detail: e.message })
  }
}

if (!existsSync(path.join(cible, 'src/main/activity/orchestration-observability.ts'))) {
  console.log('RATE cible invalide : ' + cible)
  process.exit(1)
}
copyFileSync(path.join(ici, 'critere.test.ts'), dest)
const r = spawnSync(
  'npx',
  ['vitest', 'run', rel, '--reporter=json', '--outputFile', rapport, '--reporter=basic'],
  { cwd: cible, encoding: 'utf8', shell: true, timeout: 600000 }
)
rmSync(dest, { force: true })
let cas = []
try {
  const j = JSON.parse(readFileSync(rapport, 'utf8'))
  cas = j.testResults.flatMap((f) => f.assertionResults)
} catch (e) {
  console.log(`${r.stdout || ''}${r.stderr || ''}`.trim())
  console.log('RATE rapport de test illisible : ' + e.message)
  process.exit(1)
}
rmSync(rapport, { force: true })
const etat = (fragment) => {
  const t = cas.find((c) => c.title.startsWith(fragment))
  if (!t) return `assertion ${fragment} absente du rapport`
  return t.status === 'passed' ? true : (t.failureMessages?.[0] ?? 'echec').split('\n')[0]
}

check('C1 charge : un pas ne lit pas la liste des evenements plus de 2 fois', () => etat('C1'))
check('C2 non-regression : le parent reste le premier du groupe', () => etat('C2'))
check('C3 non-regression : une dependance l_emporte sur le groupe', () => etat('C3'))
check('C4 cas limite : liste vide, aucun plantage, aucun parent', () => etat('C4'))
check('C5 cas limite : un autre tour et un autre run ne polluent pas le parent', () => etat('C5'))

const ok = results.every((x) => x.ok) && r.status === 0
for (const x of results) console.log(`${x.ok ? 'OK  ' : 'RATE'} ${x.nom} — ${x.detail}`)
console.log(ok ? 'CRITERE ATTEINT' : `CRITERE NON ATTEINT (exit ${r.status})`)
process.exit(ok ? 0 : 1)
