#!/usr/bin/env node
/**
 * CRITERE BINAIRE — D1 : la donnee du test `scout-residus.angle-mort` ne doit plus dependre
 * d un dossier qui EXISTE sur la machine de l essai.
 *
 * Usage : node bench/check-d1.mjs <racine du depot a verifier>
 * Exit 0 = CRITERE ATTEINT · 1 = non atteint · 2 = cible invalide.
 *
 * Pourquoi ces gardes et pas seulement « le test passe » : le raccourci evident est de
 * supprimer l assertion de la ligne 60, ou de neutraliser la sonde. Les deux rendent le vert
 * sans rien prouver. G4 est donc un ORACLE INDEPENDANT : ce fichier fabrique lui-meme un
 * `runner.ps1` portant une racine Windows tiree au hasard (donc absente partout), lance la
 * sonde de la cible et exige qu elle la signale. Une sonde neutralisee echoue la, quoi que
 * disent les tests de la copie.
 */
import { existsSync, readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { spawnSync, execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import path from 'node:path'

const cible = path.resolve(process.argv[2] || process.cwd())
const TEST = 'scripts/scout-residus.angle-mort.test.mjs'
const SONDE = 'scripts/scout-residus.mjs'
const resultats = []
const garde = (nom, fn) => {
  try {
    const d = fn()
    resultats.push({ nom, ok: d === true, detail: d === true ? 'ok' : String(d) })
  } catch (e) {
    resultats.push({ nom, ok: false, detail: e.message })
  }
}

for (const f of [TEST, SONDE, 'package.json']) {
  if (!existsSync(path.join(cible, f))) {
    console.log(`RATE cible invalide : ${f} absent de ${cible}`)
    process.exit(2)
  }
}
const src = readFileSync(path.join(cible, TEST), 'utf8')

garde('G1 le test passe (exit 0)', () => {
  const r = spawnSync('npx', ['vitest', 'run', TEST], {
    cwd: cible,
    encoding: 'utf8',
    shell: true,
    timeout: 600000
  })
  if (r.status === 0) return true
  const sortie = `${r.stdout || ''}${r.stderr || ''}`
  const echec = sortie.split('\n').find((l) => /FAIL|AssertionError/.test(l)) || `exit ${r.status}`
  return `exit ${r.status} — ${echec.trim().slice(0, 200)}`
})

garde('G2 aucune donnee de test liee a un dossier qui existe ici', () => {
  if (/Amitel/i.test(src)) return 'le chemin machine-dependant `Amitel` est toujours dans le test'
  const litteraux = [...src.matchAll(/['"`]([A-Za-z]:[/][^'"`\n]{2,})['"`]/g)].map((m) => m[1])
  const vivants = litteraux.filter((p) => existsSync(p))
  return vivants.length === 0 ? true : `chemin(s) EXISTANT(s) en dur dans le test : ${vivants.join(', ')}`
})

garde('G3 aucune assertion retiree ni desactivee', () => {
  const its = (src.match(/\bit\(/g) || []).length
  const expects = (src.match(/expect\(/g) || []).length
  if (/\b(it|describe|test)\.(skip|todo|only)\b/.test(src)) return 'un cas est skip/todo/only'
  if (its < 12) return `${its} cas au lieu de 12 au minimum`
  if (expects < 16) return `${expects} assertions au lieu de 16 au minimum`
  return true
})

garde('G4 oracle independant : la sonde signale encore une racine absente (tiree au hasard)', () => {
  const bs = String.fromCharCode(92)
  const bac = mkdtempSync(path.join(tmpdir(), 'check-d1-'))
  try {
    const racine = `C:${bs}autowin-absent-${Math.random().toString(36).slice(2, 10)}${bs}cible`
    writeFileSync(path.join(bac, 'runner.ps1'), `param([string]$Root = '${racine}')\n`, 'utf8')
    const rapport = execFileSync(process.execPath, [SONDE, bac], { cwd: cible, encoding: 'utf8' })
    if (!/runner\.ps1:1/.test(rapport)) return 'la sonde ne signale plus le fichier .ps1 fautif'
    if (!rapport.includes(racine)) return 'la sonde signale le fichier mais pas la racine morte'
    return true
  } finally {
    rmSync(bac, { recursive: true, force: true })
  }
})

garde('G5 la section « 0 bis » de la sonde est toujours produite', () => {
  const sonde = readFileSync(path.join(cible, SONDE), 'utf8')
  return /## 0 bis\. Chemins absolus morts/.test(sonde) ? true : 'la section 0 bis a disparu de la sonde'
})

const ok = resultats.every((x) => x.ok)
for (const x of resultats) console.log(`${x.ok ? 'OK  ' : 'RATE'} ${x.nom} — ${x.detail}`)
console.log(ok ? 'CRITERE ATTEINT' : 'CRITERE NON ATTEINT')
process.exit(ok ? 0 : 1)
