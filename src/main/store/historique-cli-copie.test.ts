import { describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, existsSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  encoderCheminCli,
  planHistoriqueCliASupprimer,
  racinesHistoriqueCliPour,
  supprimerHistoriqueCli
} from './historique-cli-copie'

/* Antislash par son CODE : ce depot a deja fige un defaut sur un antislash ecrit a la main
   dans un patch (voir `ANTISLASH` dans worktree-manager.ts). */
const A = String.fromCharCode(92)
const COPIE = `D:${A}AutoWinOS${A}.autowin-data${A}autowin-os${A}worktrees${A}arena-a`
const ENCODE = 'D--AutoWinOS--autowin-data-autowin-os-worktrees-arena-a'

describe('encoderCheminCli', () => {
  it('reproduit le nom observé sur le disque réel', () => {
    expect(encoderCheminCli(COPIE)).toBe(ENCODE)
  })
})

describe('planHistoriqueCliASupprimer', () => {
  it('prend le dossier de la copie et ses descendants', () => {
    const plan = planHistoriqueCliASupprimer(COPIE, [
      ENCODE,
      `${ENCODE}-agent--run-8ce6524a505f-1`,
      'D--RigV3Desktop'
    ])
    expect(plan).toEqual([ENCODE, `${ENCODE}-agent--run-8ce6524a505f-1`])
  })

  it("ne touche pas l'historique d'une copie voisine dont le nom commence pareil", () => {
    const voisine = `${COPIE}-r1`
    const plan = planHistoriqueCliASupprimer(
      COPIE,
      [ENCODE, `${ENCODE}-r1`, `${ENCODE}-r1-agent--run-x-1`],
      [voisine]
    )
    expect(plan).toEqual([ENCODE])
  })

  it('ne se protège pas contre elle-même si la copie est listée comme vivante', () => {
    expect(planHistoriqueCliASupprimer(COPIE, [ENCODE], [COPIE])).toEqual([ENCODE])
  })

  it('rend une liste vide sur un chemin vide plutôt que de tout revendiquer', () => {
    expect(planHistoriqueCliASupprimer('', [ENCODE])).toEqual([])
  })
})

describe('racinesHistoriqueCliPour', () => {
  it('déduit les comptes dédiés de la racine de données portée par le chemin', () => {
    const base = mkdtempSync(join(tmpdir(), 'autowin-hist-'))
    mkdirSync(join(base, 'claude-accounts', 'compte-3'), { recursive: true })
    const racines = racinesHistoriqueCliPour(join(base, 'worktrees', 'arena-a'))
    expect(racines).toContain(join(base, 'claude-accounts', 'compte-3', 'projects'))
  })
})

describe('supprimerHistoriqueCli', () => {
  it('efface les dossiers revendiqués et laisse les autres intacts', () => {
    const racine = mkdtempSync(join(tmpdir(), 'autowin-proj-'))
    const cible = join(racine, ENCODE)
    const descendant = join(racine, `${ENCODE}-agent--run-x-1`)
    const etranger = join(racine, 'D--RigV3Desktop')
    for (const d of [cible, descendant, etranger]) {
      mkdirSync(d, { recursive: true })
      writeFileSync(join(d, 'session.jsonl'), '{}')
    }
    const supprimes = supprimerHistoriqueCli(COPIE, [], [racine])
    expect(supprimes.sort()).toEqual([cible, descendant].sort())
    expect(existsSync(etranger)).toBe(true)
    expect(existsSync(cible)).toBe(false)
  })

  it('ignore une racine absente sans lever', () => {
    expect(supprimerHistoriqueCli(COPIE, [], [join(tmpdir(), 'autowin-inexistant-xyz')])).toEqual(
      []
    )
  })
})
