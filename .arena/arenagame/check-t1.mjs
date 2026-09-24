#!/usr/bin/env node
// Correcteur du banc arenagame : `node check.mjs <racine du projet du bras>`.
// Rend la note JEU automatique sur 85 (le point « jouable », 15, reste au juge sur capture).
//   10 rojo build · 10 selene · 50 regles cachees (lune) · 15 simulation 200 parties (lune)
// Sortie : JSON sur stdout. Code 0 = critere atteint (>= 60/85), 1 sinon, 2 = usage.
import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdtempSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ICI = dirname(fileURLToPath(import.meta.url))
// Binaires REELS epingles (pas les raccourcis rokit, qui exigent un rokit.toml dans le dossier courant).
const STOCK = process.env.ROKIT_STORAGE ?? join(homedir(), '.rokit', 'tool-storage')
const OUTILS = { rojo: 'rojo-rbx/rojo/7.7.0', selene: 'kampfkarren/selene/0.31.0', lune: 'lune-org/lune/0.10.5' }
const exe = (nom) => join(STOCK, ...OUTILS[nom].split('/'), process.platform === 'win32' ? `${nom}.exe` : nom)
const SEUIL = 60

const racine = process.argv[2] && resolve(process.argv[2])
if (!racine || !existsSync(racine)) {
  console.error('usage : node check.mjs <racine du projet>')
  process.exit(2)
}

function lancer(cmd, args, cwd, timeoutMs) {
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8', timeout: timeoutMs, windowsHide: true, maxBuffer: 64 * 1024 * 1024 })
  return { code: r.status, sortie: `${r.stdout ?? ''}${r.stderr ?? ''}`, expire: r.error?.code === 'ETIMEDOUT' }
}

const tmp = mkdtempSync(join(tmpdir(), 'arenagame-'))
const note = { racine, build: 0, lint: 0, regles: 0, simulation: 0, jouable: 'non mesure (juge sur capture)', details: {} }
try {
  // 1. rojo build
  const b = lancer(exe('rojo'), ['build', racine, '-o', join(tmp, 'jeu.rbxl')], racine, 120_000)
  note.build = b.code === 0 ? 10 : 0
  note.details.build = b.code === 0 ? 'ok' : b.sortie.slice(-600)

  // 2. selene
  const src = join(racine, 'src')
  if (existsSync(src)) {
    const l = lancer(exe('selene'), ['--config', join(ICI, 'modele', 'selene.toml'), '--display-style', 'quiet', src], racine, 120_000)
    const erreurs = (l.sortie.match(/: error/g) ?? []).length
    const avert = (l.sortie.match(/: warning/g) ?? []).length
    note.lint = erreurs > 0 || l.code === null ? 0 : Math.max(0, 10 - avert)
    note.details.lint = { erreurs, avertissements: avert }
  }

  // 3 et 4. lune sur une COPIE de src/shared + les tests caches
  const shared = join(racine, 'src', 'shared')
  if (existsSync(join(shared, 'Partie.luau')) || existsSync(join(shared, 'Partie.lua'))) {
    cpSync(shared, join(tmp, 'shared'), { recursive: true })
    cpSync(join(ICI, 'cache', 'regles.luau'), join(tmp, 'regles.luau'))
    cpSync(join(ICI, 'cache', 'simulation.luau'), join(tmp, 'simulation.luau'))

    const r = lancer(exe('lune'), ['run', 'regles.luau'], tmp, 180_000)
    const ok = (r.sortie.match(/^CAS ok /gm) ?? []).length
    const ko = r.sortie.match(/^CAS ko .*$/gm) ?? []
    const total = Number(r.sortie.match(/^SCORE \d+\/(\d+)/m)?.[1] ?? 27)
    note.regles = Math.round((50 * ok) / total * 10) / 10
    note.details.regles = { ok, total, echecs: ko.map((s) => s.slice(7)), expire: r.expire, erreur: r.sortie.match(/^SCORE/m) ? undefined : r.sortie.slice(-600) }

    const s = lancer(exe('lune'), ['run', 'simulation.luau'], tmp, 300_000)
    const saines = (s.sortie.match(/^PARTIE ok /gm) ?? []).length
    const premiers = (s.sortie.match(/^PARTIE ko .*$/gm) ?? []).slice(0, 5)
    note.simulation = Math.round((15 * saines) / 200 * 10) / 10
    note.details.simulation = { saines, total: 200, exemples: premiers, expire: s.expire }
  } else {
    note.details.regles = 'src/shared/Partie.luau absent'
  }
} finally {
  rmSync(tmp, { recursive: true, force: true })
}

note.total = Math.round((note.build + note.lint + note.regles + note.simulation) * 10) / 10
note.sur = 85
note.critere = note.total >= SEUIL
console.log(JSON.stringify(note, null, 2))
process.exit(note.critere ? 0 : 1)
