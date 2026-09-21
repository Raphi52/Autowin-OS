#!/usr/bin/env node
// Correcteur du banc arenagame, serie t2 : `node check.mjs <racine du projet du bras>`.
// Rend la part AUTOMATIQUE de la note JEU /100 (52 points) ; les 48 points de juge restent
// « non mesure » ici (barème 0-3, deux juges, voir skills/arenagame/SKILL.md § 3).
//   socle 5 (build 3, lint 2) · regles 20 (cas caches 15, simulation 5) · equilibrage 10 ·
//   multijoueur auto 4 · visuels auto 7 (images 4, modeles 3) · boutique auto 6
// Sortie : JSON. Code 0 = critere atteint (auto >= 30/52), 1 sinon, 2 = usage.
// Serie t1 (85 points, regles seules) : check-t1.mjs.
import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdtempSync, rmSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ICI = dirname(fileURLToPath(import.meta.url))
// Binaires REELS epingles (pas les raccourcis rokit, qui exigent un rokit.toml dans le dossier courant).
const STOCK = process.env.ROKIT_STORAGE ?? join(homedir(), '.rokit', 'tool-storage')
const OUTILS = { rojo: 'rojo-rbx/rojo/7.7.0', selene: 'kampfkarren/selene/0.31.0', lune: 'lune-org/lune/0.10.5' }
const exe = (nom) => join(STOCK, ...OUTILS[nom].split('/'), process.platform === 'win32' ? `${nom}.exe` : nom)
const SEUIL = 30

const racine = process.argv[2] && resolve(process.argv[2])
if (!racine || !existsSync(racine)) {
  console.error('usage : node check.mjs <racine du projet>')
  process.exit(2)
}

function lancer(cmd, args, cwd, timeoutMs) {
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8', timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 })
  return { code: r.status, sortie: `${r.stdout ?? ''}${r.stderr ?? ''}`, expire: r.error?.code === 'ETIMEDOUT' }
}

const arrondi = (v) => Math.round(v * 10) / 10
const tmp = mkdtempSync(join(tmpdir(), 'arenagame-'))
const rbxl = join(tmp, 'jeu.rbxl')
const note = { racine, socle: 0, regles: 0, equilibrage: 0, multijoueur: 0, visuels: 0, boutique: 0, details: {},
  juge: { multijoueur: 6, visuels: 8, menus: 10, boutique: 4, gameplay: 10, progression: 5, publier: 5, statut: 'non mesure (juge sur captures, bareme 0-3)' } }
const fichiers = (dir) => existsSync(dir) ? readdirSync(dir, { recursive: true }).map((f) => join(dir, String(f))).filter((f) => statSync(f).isFile() && /\.luau?$/.test(f)) : []
try {
  // Socle : rojo build (3) + selene (2)
  const b = lancer(exe('rojo'), ['build', racine, '-o', rbxl], racine, 120_000)
  const build = b.code === 0 ? 3 : 0
  let lint = 0, lintD = 'src absent'
  const src = join(racine, 'src')
  if (existsSync(src)) {
    const l = lancer(exe('selene'), ['--config', join(ICI, 'modele', 'selene.toml'), '--display-style', 'quiet', src], racine, 120_000)
    const erreurs = (l.sortie.match(/: error/g) ?? []).length
    const avert = (l.sortie.match(/: warning/g) ?? []).length
    lint = erreurs > 0 || l.code === null ? 0 : Math.max(0, 2 - 0.2 * avert)
    lintD = { erreurs, avertissements: avert }
  }
  note.socle = arrondi(build + lint)
  note.details.socle = { build: b.code === 0 ? 'ok' : b.sortie.slice(-600), lint: lintD }

  // Multijoueur (lecture statique, 4) : serveur qui revalide, client qui n'envoie qu'une intention
  const client = fichiers(join(racine, 'src', 'client')).map((f) => readFileSync(f, 'utf8')).join('\n')
  const serveur = fichiers(join(racine, 'src', 'server')).map((f) => readFileSync(f, 'utf8')).join('\n')
  const mj = { serveurValide: /OnServerEvent/.test(serveur) && /:jouer\s*\(/.test(serveur), clientIntention: /FireServer/.test(client), clientSansJouer: /FireServer/.test(client) && !/:jouer\s*\(/.test(client) }
  note.multijoueur = arrondi((4 * Object.values(mj).filter(Boolean).length) / 3)
  note.details.multijoueur = mj

  const shared = join(racine, 'src', 'shared')
  if (existsSync(join(shared, 'Partie.luau')) || existsSync(join(shared, 'Partie.lua'))) {
    cpSync(shared, join(tmp, 'shared'), { recursive: true })
    for (const f of ['regles', 'simulation', 'equilibrage', 'boutique', 'visuels']) cpSync(join(ICI, 'cache', f + '.luau'), join(tmp, f + '.luau'))

    const r = lancer(exe('lune'), ['run', 'regles.luau'], tmp, 180_000)
    const ok = (r.sortie.match(/^CAS ok /gm) ?? []).length
    const ko = r.sortie.match(/^CAS ko .*$/gm) ?? []
    const total = Number(r.sortie.match(/^SCORE \d+\/(\d+)/m)?.[1] ?? 28)
    const s = lancer(exe('lune'), ['run', 'simulation.luau'], tmp, 300_000)
    const saines = (s.sortie.match(/^PARTIE ok /gm) ?? []).length
    note.regles = arrondi((15 * ok) / total + (5 * saines) / 200)
    note.details.regles = { ok, total, echecs: ko.map((x) => x.slice(7)), expire: r.expire, erreur: r.sortie.match(/^SCORE/m) ? undefined : r.sortie.slice(-600) }
    note.details.simulation = { saines, total: 200, exemples: (s.sortie.match(/^PARTIE ko .*$/gm) ?? []).slice(0, 5), expire: s.expire }

    const e = lancer(exe('lune'), ['run', 'equilibrage.luau'], tmp, 600_000)
    const es = e.sortie.match(/^EQUI SCORE ([\d.]+) ([\d.]+) ([\d.]+)/m)
    note.equilibrage = es ? arrondi(6 * es[1] + 2 * es[2] + 2 * es[3]) : 0
    note.details.equilibrage = { lignes: e.sortie.match(/^EQUI .*$/gm) ?? [], expire: e.expire, erreur: es ? undefined : e.sortie.slice(-400) }

    const bo = lancer(exe('lune'), ['run', 'boutique.luau'], tmp, 120_000)
    const bok = (bo.sortie.match(/^CAS ok /gm) ?? []).length
    const btot = Number(bo.sortie.match(/^SCORE \d+\/(\d+)/m)?.[1] ?? 13)
    note.boutique = arrondi((6 * bok) / btot)
    note.details.boutique = { ok: bok, total: btot, echecs: (bo.sortie.match(/^CAS ko .*$/gm) ?? []).map((x) => x.slice(7)) }

    const v = lancer(exe('lune'), ['run', 'visuels.luau', rbxl], tmp, 120_000)
    const vs = v.sortie.match(/^VIS SCORE ([\d.]+) ([\d.]+)/m)
    note.visuels = vs ? arrondi(4 * vs[1] + 3 * vs[2]) : 0
    note.details.visuels = { lignes: v.sortie.match(/^VIS .*$/gm) ?? [], erreur: vs ? undefined : v.sortie.slice(-400) }
  } else {
    note.details.regles = 'src/shared/Partie.luau absent'
  }
} finally {
  rmSync(tmp, { recursive: true, force: true })
}

note.auto = arrondi(note.socle + note.regles + note.equilibrage + note.multijoueur + note.visuels + note.boutique)
note.autoSur = 52
note.critere = note.auto >= SEUIL
console.log(JSON.stringify(note, null, 2))
process.exit(note.critere ? 0 : 1)
