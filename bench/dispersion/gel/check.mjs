#!/usr/bin/env node
/**
 * CRITERE BINAIRE du banc `arena-dispersion`.
 * Usage : node bench/dispersion/check.mjs <racine du depot a verifier>
 * Exit 0 = CRITERE ATTEINT (8/8) · 1 = non atteint · 2 = cible invalide.
 * Les journaux d essai sont FABRIQUES ICI, avec un facteur tire au hasard a chaque lancement :
 * aucune valeur attendue ne peut donc etre mise en dur dans le livrable du bras.
 */
import { existsSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import path from 'node:path'

const cible = path.resolve(process.argv[2] || process.cwd())
const SCRIPT = 'scripts/banc-dispersion.mjs'
if (!existsSync(path.join(cible, 'package.json'))) {
  console.log(`RATE cible invalide : package.json absent de ${cible}`)
  process.exit(2)
}
const bac = mkdtempSync(path.join(tmpdir(), 'arena-disp-'))
const r = 1 + Math.round(Math.random() * 900) / 100
const arrondi = (x) => Math.round(x * 1e6) / 1e6
const proche = (a, b, tol = 1e-3) =>
  typeof a === 'number' && Number.isFinite(a) && Math.abs(a - b) <= tol * Math.max(1, Math.abs(b))

let n = 0
const journal = (lignes) => {
  const f = path.join(bac, `j${++n}.jsonl`)
  writeFileSync(f, lignes.map((l) => (typeof l === 'string' ? l : JSON.stringify(l))).join('\n') + '\n')
  return f
}
const duel = (banc, bras, coutUsd, dureeMs, verdict = 'perdant') => ({
  schema: 'autowin.arena-duel/v1',
  ts: '2026-09-17T10:00:00.000Z',
  tache: 'banc dispersion',
  workflow: `wf-${bras}`,
  banc,
  bras,
  dureeMs,
  coutUsd,
  verdict
})
const lancer = (fichier, banc) =>
  spawnSync(process.execPath, [path.join(cible, SCRIPT), '--journal', fichier, '--banc', banc, '--json'], {
    encoding: 'utf8',
    cwd: cible,
    timeout: 120000
  })
const json = (res) => {
  try {
    return JSON.parse(res.stdout)
  } catch {
    return null
  }
}
const parBras = (o, b) => (o?.bras ?? []).find((x) => x.bras === b)

const resultats = []
const check = (nom, fn) => {
  try {
    const d = fn()
    resultats.push({ nom, ok: d === true, detail: d === true ? 'ok' : String(d) })
  } catch (e) {
    resultats.push({ nom, ok: false, detail: e.message })
  }
}

check('G0 le fichier scripts/banc-dispersion.mjs existe', () =>
  existsSync(path.join(cible, SCRIPT)) ? true : `${SCRIPT} absent`
)

const f1 = journal([
  duel('v1', 'a', 1.0 * r, 100000),
  duel('v1', 'a', 1.1 * r, 120000),
  duel('v1', 'c', 1.02 * r, 101000),
  duel('v1', 'c', 1.03 * r, 102000)
])
let o1 = null
check('G1 nominal : sortie JSON valide, code 0', () => {
  const res = lancer(f1, 'v1')
  o1 = json(res)
  if (res.status !== 0) return `code ${res.status} — ${(res.stderr || '').slice(0, 200)}`
  if (!o1) return `stdout non JSON : ${(res.stdout || '').slice(0, 200)}`
  return o1.banc === 'v1' && Array.isArray(o1.bras) && o1.bras.length === 2
    ? true
    : `forme inattendue : ${res.stdout.slice(0, 200)}`
})
check('G2 chiffres recomputables : moyenne et ecart intra du bras a', () => {
  const a = parBras(o1, 'a')
  if (!a) return 'bras a absent'
  const attMoy = arrondi((1.0 * r + 1.1 * r) / 2)
  if (a.repliques !== 2) return `repliques=${a.repliques} attendu 2`
  if (!proche(a.coutUsd?.moyenne, attMoy)) return `coutUsd.moyenne=${a.coutUsd?.moyenne} attendu ~${attMoy}`
  if (!proche(a.coutUsd?.ecartRelatif, 0.1)) return `coutUsd.ecartRelatif=${a.coutUsd?.ecartRelatif} attendu ~0.1`
  if (!proche(a.dureeMs?.ecartRelatif, 0.2)) return `dureeMs.ecartRelatif=${a.dureeMs?.ecartRelatif} attendu ~0.2`
  return true
})
check('G3 cas limite : ecart inter < dispersion intra => departage false', () => {
  const c = o1?.comparaison
  if (!c) return 'comparaison absente'
  if (c.meilleur !== 'c') return `meilleur=${c.meilleur} attendu c`
  if (c.departage !== false) return `departage=${c.departage} attendu false`
  if (!proche(c.ecartRelatifCout, (1.05 - 1.025) / 1.025, 5e-2)) return `ecartRelatifCout=${c.ecartRelatifCout}`
  return typeof c.motif === 'string' && c.motif.trim().length > 0 ? true : 'motif vide'
})
check('G4 nominal : ecart inter >> dispersion intra => departage true', () => {
  const f2 = journal([
    duel('v2', 'a', 1.0 * r, 100000),
    duel('v2', 'a', 1.01 * r, 101000),
    duel('v2', 'b', 5.0 * r, 500000),
    duel('v2', 'b', 5.05 * r, 505000)
  ])
  const o = json(lancer(f2, 'v2'))
  if (!o) return 'sortie non JSON'
  if (o.comparaison?.meilleur !== 'a') return `meilleur=${o.comparaison?.meilleur} attendu a`
  if (o.comparaison?.departage !== true) return `departage=${o.comparaison?.departage} attendu true`
  return proche(o.comparaison?.ecartRelatifCout, (5.025 - 1.005) / 1.005, 5e-2)
    ? true
    : `ecartRelatifCout=${o.comparaison?.ecartRelatifCout}`
})
check('G5 cas limite : une seule replique => ecartRelatif null et departage refuse', () => {
  const f3 = journal([
    duel('v3', 'a', 1.0 * r, 100000),
    duel('v3', 'b', 9.0 * r, 900000),
    duel('v3', 'b', 9.1 * r, 910000)
  ])
  const o = json(lancer(f3, 'v3'))
  if (!o) return 'sortie non JSON'
  const a = parBras(o, 'a')
  if (!a) return 'bras a absent'
  if (a.repliques !== 1) return `repliques=${a.repliques} attendu 1`
  if (a.coutUsd?.ecartRelatif !== null)
    return `ecartRelatif=${JSON.stringify(a.coutUsd?.ecartRelatif)} attendu null`
  if (o.comparaison?.departage !== false) return `departage=${o.comparaison?.departage} attendu false`
  return true
})
check('G6 cas limite : lignes illisibles ignorees et comptees', () => {
  const f4 = journal([
    '{ceci n est pas du json',
    duel('v4', 'a', 1.0 * r, 100000),
    JSON.stringify({ banc: 'v4', bras: 'a' }),
    duel('v4', 'a', 1.2 * r, 120000),
    'null',
    duel('v4', 'b', 2.0 * r, 200000),
    duel('v4', 'b', 2.1 * r, 210000)
  ])
  const res = lancer(f4, 'v4')
  const o = json(res)
  if (res.status !== 0) return `code ${res.status} attendu 0 — ${(res.stderr || '').slice(0, 150)}`
  if (!o) return 'sortie non JSON'
  if (o.lignesIgnorees !== 3) return `lignesIgnorees=${o.lignesIgnorees} attendu 3`
  return parBras(o, 'a')?.repliques === 2
    ? true
    : `bras a repliques=${parBras(o, 'a')?.repliques} attendu 2`
})
check('G7 cas limite : banc sans aucune ligne => code de sortie 2', () => {
  const f5 = journal([duel('v5', 'a', 1.0 * r, 100000)])
  const res = lancer(f5, 'banc-qui-n-existe-pas')
  if (res.status !== 2) return `code ${res.status} attendu 2`
  return (res.stderr || '').trim().length > 0 ? true : 'aucun message sur la sortie d erreur'
})

rmSync(bac, { recursive: true, force: true })
const rates = resultats.filter((x) => !x.ok)
for (const x of resultats) console.log(`${x.ok ? 'OK  ' : 'RATE'} ${x.nom}${x.ok ? '' : ` — ${x.detail}`}`)
console.log(`\nscore ${resultats.length - rates.length}/${resultats.length}`)
console.log(rates.length === 0 ? 'CRITERE ATTEINT' : 'CRITERE NON ATTEINT')
process.exit(rates.length === 0 ? 0 : 1)
