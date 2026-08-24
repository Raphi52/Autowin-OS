import { describe, expect, it } from 'vitest'
import { RunWorktreeCoordinator } from './run-worktree-coordinator'

/**
 * LE DÉFAUT, mesuré sur l'application réelle le 2026-08-24 : vingt-et-une copies occupaient le
 * disque et polluaient le Hub, TOUTES refusées pour la même raison — « La copie ne descend pas du
 * SHA de départ autorisé. »
 *
 * Vérifié à la main que la garde a RAISON, ce n'est pas un faux positif à contourner :
 * `git merge-base --is-ancestor <baseSha> <HEAD de la copie>` échoue réellement sur
 * `agent__command-edit-04789dcc-...`. Aucun réessai ne rendra jamais cette copie descendante de sa
 * base.
 *
 * Ce qui clochait n'était donc pas le verdict, mais ce qu'on en faisait : rien. Le système
 * connaissait le refus à chaque tentative, gardait la copie, et la RESTAURAIT même au démarrage.
 *
 * Ces tests tiennent les deux bords : ranger ce qui est condamné pour de bon, et ne PAS toucher à ce
 * qui peut encore se réparer.
 */

type Appels = { preserves: string[] }

const coordinateur = (
  validation: { ok: false; detail: string; definitif?: true } | { ok: true }
): { co: RunWorktreeCoordinator; appels: Appels } => {
  const appels: Appels = { preserves: [] }
  const co = new RunWorktreeCoordinator({
    manager: {
      workspacePath: '/repo',
      describe: () => ({ workspacePath: '/repo', baseBranch: 'main', baseSha: 'a'.repeat(40) }),
      acquire: (id: string) => `/wt/${id}`,
      finalize: () => ({ outcome: 'merged' }),
      changedFiles: () => [],
      listAgentIds: () => [],
      hasActiveProcesses: () => false,
      remove: () => {},
      validateRecoveryContext: () => validation,
      preserverEtLiberer: (id: string) => {
        appels.preserves.push(id)
        return { outcome: 'libere' }
      }
    } as never,
    nowFn: () => 1
  } as never)
  co.arreterLeBalayageAutomatique()
  return { co, appels }
}

/** Un run déjà terminé, dont on tente la reprise — le cas des vingt-et-une copies. */
const aReprendre = (co: RunWorktreeCoordinator, runId: string): void => {
  const runs = (co as unknown as { runs: Map<string, unknown> }).runs
  runs.set(runId, {
    runId,
    agentName: runId,
    state: 'blocked',
    files: [],
    startedAtMs: 0,
    isMutation: true,
    // `blocked` comme les vingt-et-une copies reelles : `pending` est refuse par une garde
    // ANTERIEURE (« publication pending deja engagee »), donc le test ne prouverait rien.
    publication: 'blocked',
    attentionReason: 'merge-failed',
    worktreePath: `/wt/${runId}`,
    baseBranch: 'main',
    baseSha: 'a'.repeat(40)
  })
}

const tenterLaReprise = (co: RunWorktreeCoordinator, runId: string): void => {
  try {
    co.begin(runId, 'Builder', true, { resumeExisting: true } as never)
  } catch {
    // Le refus est ATTENDU : la reprise a genuinement échoué. Ce qui nous intéresse est ce que le
    // système fait de la copie au passage.
  }
}

describe('une copie que la garde condamne pour de bon', () => {
  it('est rangée, travail préservé, au lieu d’occuper le disque pour rien', () => {
    const { co, appels } = coordinateur({
      ok: false,
      detail: 'La copie ne descend pas du SHA de départ autorisé.',
      definitif: true
    })
    aReprendre(co, 'condamne')

    tenterLaReprise(co, 'condamne')

    expect(appels.preserves).toEqual(['condamne'])
  })

  it('N’est PAS rangée quand le refus peut encore se réparer', () => {
    // L'entrée qui doit faire échouer un rangement trop large : un refus SANS `definitif`. Marquer
    // trop large libérerait une copie encore publiable — pire que le défaut qu'on corrige.
    const { co, appels } = coordinateur({
      ok: false,
      detail: 'des processus utilisent encore cette copie'
    })
    aReprendre(co, 'reparable')

    tenterLaReprise(co, 'reparable')

    expect(appels.preserves).toEqual([])
  })

  it('ne range rien quand la reprise est ACCEPTÉE', () => {
    const { co, appels } = coordinateur({ ok: true })
    aReprendre(co, 'accepte')

    tenterLaReprise(co, 'accepte')

    expect(appels.preserves).toEqual([])
  })
})
