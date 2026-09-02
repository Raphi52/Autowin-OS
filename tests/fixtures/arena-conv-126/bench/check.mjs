#!/usr/bin/env node
/**
 * arena-bench-check — critere de succes DETERMINISTE du banc /arena.
 * Usage : node scripts/arena-bench-check.mjs <chemin/vers/scout-rendement.mjs>
 * Exit 0 = critere atteint. Exit 1 = rate. Lecture seule sur les donnees reelles.
 */
import { execFileSync } from 'node:child_process'
import path from 'node:path'

const SCRIPT = path.resolve(process.argv[2] || 'scripts/scout-rendement.mjs')
const DATA = 'D:/AutoWinOS/.autowin-data/autowin-os'
const run = (args) => {
  try {
    const out = execFileSync(process.execPath, [SCRIPT, '--data', DATA, ...args], {
      encoding: 'utf8', timeout: 120000, stdio: ['ignore', 'pipe', 'pipe']
    })
    return { code: 0, out }
  } catch (e) {
    return { code: e.status ?? 1, out: String(e.stdout || ''), err: String(e.stderr || '') }
  }
}
const results = []
const check = (nom, fn) => {
  try { const d = fn(); results.push({ nom, ok: d === true, detail: d === true ? 'ok' : String(d) }) }
  catch (e) { results.push({ nom, ok: false, detail: e.message }) }
}

check('C1 sans option : exit 0, 109 conversations, 7 reprises (non-regression)', () => {
  const r = run(['--json'])
  if (r.code !== 0) return `exit ${r.code}`
  const j = JSON.parse(r.out)
  if (j.summary.conversations !== 109) return `conversations=${j.summary.conversations}`
  if (j.summary.reprises !== 7) return `reprises=${j.summary.reprises}`
  return true
})
check('C2 --depuis 2026-09-02 : 21 conversations', () => {
  const r = run(['--json', '--depuis', '2026-09-02'])
  if (r.code !== 0) return `exit ${r.code} ${r.err || ''}`.slice(0, 200)
  const j = JSON.parse(r.out)
  return j.summary.conversations === 21 ? true : `conversations=${j.summary.conversations}`
})
check('C3 --depuis 2026-08-31 : 109 conversations', () => {
  const r = run(['--json', '--depuis', '2026-08-31'])
  if (r.code !== 0) return `exit ${r.code}`
  const j = JSON.parse(r.out)
  return j.summary.conversations === 109 ? true : `conversations=${j.summary.conversations}`
})
check('C4 --depuis 2099-01-01 : pas de plantage (exit 0 ou 2, aucune stack)', () => {
  const r = run(['--json', '--depuis', '2099-01-01'])
  if (![0, 2].includes(r.code)) return `exit ${r.code}`
  if (/ {4}at |TypeError|ReferenceError/.test(r.err || '')) return 'stack trace'
  return true
})
check('C5 rapport Markdown avec --depuis : exit 0 et la date apparait', () => {
  const r = run(['--depuis', '2026-09-02'])
  if (r.code !== 0) return `exit ${r.code}`
  return r.out.includes('2026-09-02') ? true : 'la date filtrante n_apparait pas dans le rapport'
})

const ok = results.every((r) => r.ok)
for (const r of results) console.log(`${r.ok ? 'OK  ' : 'RATE'} ${r.nom} — ${r.detail}`)
console.log(ok ? 'CRITERE ATTEINT' : 'CRITERE NON ATTEINT')
process.exit(ok ? 0 : 1)
