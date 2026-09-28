// fix-ok: cause mesuree - l'en-tete du banc (et la lecon capitalisee) affirmaient qu'une tache simple
// "ne declenche pas orchestrate" ; lu dans src/main/agent-pilot.ts:1066-1083, seule une phase tapee
// explicitement (/scout, /build...) part en orchestration, la difficulte n'entre pas dans la decision
// (detection auto "verbe + cible" retiree, 25% de justesse sur 251 messages). Le test ci-dessous
// interdit la reapparition de cette phrase : reinjectee -> 1 echec, retiree -> 5 passes, code 0.
import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { existsSync, writeFileSync, rmSync, readFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  BASE,
  COMMIT_CORRECTIF,
  FICHIERS_CODE,
  FICHIERS_ORACLE,
  ENONCE,
  patchDuCorrectif,
  preparer
} from './banc-orchestration-vs-nu.mjs'

const racine = process.cwd()
const gitDans = (dossier, args, options = {}) =>
  execFileSync('git', ['-C', dossier, ...args], { encoding: 'utf8', ...options })

describe('banc orchestration vs appel nu — la premisse du banc', () => {
  /*
   * La premisse porte sur la BASE FIGEE du bras, plus sur HEAD (choix utilisateur, conv-770,
   * 2026-09-28) : depuis b94b6ce6 (2026-09-18) le correctif ne s'annulait plus sur la tete, et ce
   * test l'a signale pendant dix jours. Controle dans un index JETABLE : l'arbre de travail de
   * l'utilisateur n'est ni lu ni ecrit.
   */
  it('le defaut se resseme sur la base figee du bras (patch du correctif annulable sans conflit)', () => {
    expect(BASE).toBe(COMMIT_CORRECTIF)
    const f = path.join(tmpdir(), `banc-test-${process.pid}.patch`)
    const index = path.join(tmpdir(), `banc-index-${process.pid}`)
    const env = { ...process.env, GIT_INDEX_FILE: index }
    writeFileSync(f, patchDuCorrectif(racine))
    try {
      gitDans(racine, ['read-tree', BASE], { env })
      gitDans(racine, ['apply', '-R', '--cached', '--check', f], { env })
    } finally {
      rmSync(f, { force: true })
      rmSync(index, { force: true })
    }
  })

  it('preparer pose une copie propre sur la base, y resseme le defaut et cache l oracle', () => {
    // Un VRAI bras, dans un clone jetable partageant les objets du depot : rien n'est copie ni
    // touche cote utilisateur, et la preuve porte sur le geste reel, pas sur une description.
    const copie = mkdtempSync(path.join(tmpdir(), 'banc-bras-'))
    try {
      gitDans(racine, ['clone', '--quiet', '--shared', racine, copie])
      writeFileSync(path.join(copie, 'travail-local.txt'), 'x')
      expect(() => preparer(copie)).toThrow(/travail local/)
      rmSync(path.join(copie, 'travail-local.txt'))

      expect(preparer(copie).base).toBe(BASE)
      expect(gitDans(copie, ['rev-parse', 'HEAD']).trim()).toBe(
        gitDans(racine, ['rev-parse', BASE]).trim()
      )
      for (const f of FICHIERS_CODE)
        expect(readFileSync(path.join(copie, f), 'utf8'), f).toBe(
          gitDans(racine, ['show', `${BASE}^:${f}`], { maxBuffer: 64 * 1024 * 1024 })
        )
      for (const f of FICHIERS_ORACLE) expect(existsSync(path.join(copie, f)), f).toBe(false)
      expect(readFileSync(path.join(copie, 'TACHE.md'), 'utf8')).toBe(`${ENONCE}\n`)
    } finally {
      rmSync(copie, { recursive: true, force: true })
    }
  }, 180_000)

  it('refuse de preparer le depot principal', () => {
    // Le refus tombe AVANT tout geste : seul `git rev-parse` a tourne.
    expect(() => preparer(racine)).toThrow(/jamais le depot principal/)
  })

  it('l en-tete du banc n attribue pas le declenchement de l orchestration a la difficulte', () => {
    // Lu dans src/main/agent-pilot.ts (~l.1078) : SEULE une phase nommee explicitement
    // (`/scout`, `/build`...) court-circuite vers `orchestrate`. La difficulte de la tache
    // n entre pas dans la decision ; l ancienne heuristique « verbe + cible » est RETIREE.
    const entete = readFileSync(path.join(racine, 'scripts/banc-orchestration-vs-nu.mjs'), 'utf8')
    expect(entete).not.toMatch(/au-dela du trivial/i)
    expect(entete).not.toMatch(/ne d[ée]clenche pas[^.]{0,30}orchestr/i)
  })

  it('la tache traverse plusieurs fichiers de code — une tache triviale rend la comparaison vide', () => {
    expect(FICHIERS_CODE.length).toBeGreaterThanOrEqual(3)
    for (const f of FICHIERS_CODE) expect(existsSync(path.join(racine, f))).toBe(true)
  })

  it('l oracle existe, est distinct du code, et n est pas donne au bras', () => {
    expect(FICHIERS_ORACLE.length).toBeGreaterThan(0)
    for (const f of FICHIERS_ORACLE) {
      expect(existsSync(path.join(racine, f))).toBe(true)
      expect(FICHIERS_CODE).not.toContain(f)
      expect(ENONCE).not.toContain(path.basename(f))
    }
  })

  it('le commit reseme est un vrai commit du depot', () => {
    const type = execFileSync('git', ['-C', racine, 'cat-file', '-t', COMMIT_CORRECTIF], {
      encoding: 'utf8'
    }).trim()
    expect(type).toBe('commit')
  })
})
