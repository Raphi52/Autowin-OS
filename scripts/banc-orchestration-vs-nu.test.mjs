// fix-ok: cause mesuree - l'en-tete du banc (et la lecon capitalisee) affirmaient qu'une tache simple
// "ne declenche pas orchestrate" ; lu dans src/main/agent-pilot.ts:1066-1083, seule une phase tapee
// explicitement (/scout, /build...) part en orchestration, la difficulte n'entre pas dans la decision
// (detection auto "verbe + cible" retiree, 25% de justesse sur 251 messages). Le test ci-dessous
// interdit la reapparition de cette phrase : reinjectee -> 1 echec, retiree -> 5 passes, code 0.
import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { existsSync, writeFileSync, rmSync, readFileSync } from 'node:fs'
import path from 'node:path'
import {
  COMMIT_CORRECTIF,
  FICHIERS_CODE,
  FICHIERS_ORACLE,
  ENONCE,
  patchDuCorrectif
} from './banc-orchestration-vs-nu.mjs'

const racine = process.cwd()

describe('banc orchestration vs appel nu — la premisse du banc', () => {
  it('le defaut se resseme encore sur HEAD (patch du correctif annulable sans conflit)', () => {
    const f = path.join(racine, `.banc-test-${process.pid}.patch`)
    writeFileSync(f, patchDuCorrectif(racine))
    try {
      execFileSync('git', ['-C', racine, 'apply', '-R', '--check', f], { encoding: 'utf8' })
    } finally {
      rmSync(f, { force: true })
    }
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
