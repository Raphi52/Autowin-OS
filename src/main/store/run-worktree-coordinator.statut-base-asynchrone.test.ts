import { describe, expect, it } from 'vitest'
import { RunWorktreeCoordinator } from './run-worktree-coordinator'
import { ESSAIS_AUTOMATIQUES_MAX } from './repechage-automatique'

/**
 * LA VÉRIFICATION DE FOND NE TIENT PLUS LA FENÊTRE (conv-1055).
 *
 * Mesuré le 2026-10-21 à 20:14 (`gels.jsonl`) : un `execFileSync git status` de la base a figé la
 * fenêtre 60,1 s. Sa pile remontait à `baseDirtyFiles` (worktree-manager), dont le seul appelant
 * de production est `repecherLesTravauxEnAttente` — minuterie de 5 min, un appel PAR candidat.
 *
 * Contrat vérifié ici : UN seul `git status`, ASYNCHRONE, pour tout le lot ; aucun quand personne
 * n'attend une base propre ; et une base illisible laisse le travail au plafond, sans le relancer.
 */
describe('balayage — un seul git status asynchrone pour tout le lot', () => {
  const coordinateur = (
    runs: Array<{ runId: string; fichiers: string[]; raison?: string; verdict?: string }>,
    statutAsynchrone: () => Promise<string[] | undefined>,
    essaisDejaFaits = 0
  ): {
    c: RunWorktreeCoordinator
    reprises: string[]
    appels: { sync: number; async: number }
  } => {
    const reprises: string[] = []
    const appels = { sync: 0, async: 0 }
    const manager = {
      listAgentIds: () => runs.map((r) => r.runId),
      hasActiveProcesses: () => false,
      reconcileResidues: () => ({ cleaned: 0, recovered: [], blocked: [], swept: [] }),
      operationsAreIsolated: () => false,
      describe: () => {
        throw new Error('copie absente')
      },
      changedFiles: () => [],
      // Le chemin SYNCHRONE ne doit plus être pris par le balayage : il compte et il jette.
      baseDirtyFiles: () => {
        appels.sync += 1
        throw new Error('git status synchrone appelé depuis le balayage')
      },
      baseDirtyFilesAsync: async () => {
        appels.async += 1
        return statutAsynchrone()
      }
    }
    const stateStore = {
      list: () =>
        runs.map((r) => ({
          version: 1,
          repoId: 'depot',
          runId: r.runId,
          agentName: 'Agent ' + r.runId,
          worktreePath: 'C:/absent/agent__' + r.runId,
          publication: 'blocked',
          attentionReason: r.raison ?? 'base-dirty',
          verdict: r.verdict ?? 'unknown',
          files: r.fichiers.map((path) => ({ path, kind: 'mod' })),
          sourceSha: null,
          publishedSha: null
        })),
      get: () => undefined,
      save: () => {},
      remove: () => {}
    }
    const c = new RunWorktreeCoordinator({
      manager: manager as never,
      stateStore: stateStore as never
    } as never)
    ;(c as unknown as { retryRunAsync: (id: string) => Promise<void> }).retryRunAsync = async (
      id: string
    ) => {
      reprises.push(id)
    }
    if (essaisDejaFaits > 0) {
      for (const r of runs) {
        ;(c as unknown as { essaisAutomatiques: Map<string, number> }).essaisAutomatiques.set(
          r.runId,
          essaisDejaFaits
        )
      }
    }
    return { c, reprises, appels }
  }

  it('trois candidats bloqués par la base → UN seul git status, asynchrone', async () => {
    const { c, reprises, appels } = coordinateur(
      [
        { runId: 'a', fichiers: ['src/a.ts'] },
        { runId: 'b', fichiers: ['src/b.ts'] },
        { runId: 'c', fichiers: ['src/c.ts'] }
      ],
      async () => ['src/b.ts']
    )

    const tentes = await c.repecherLesTravauxEnAttente()

    expect(appels).toEqual({ sync: 0, async: 1 })
    // `b` reste en attente (son fichier est toujours sale) ; `a` et `c` repartent.
    expect(tentes.sort()).toEqual(['a', 'c'])
    expect(reprises.sort()).toEqual(['a', 'c'])
  })

  it('aucun candidat n’attend une base propre → aucun git status du tout', async () => {
    const { c, appels } = coordinateur(
      [{ runId: 'a', fichiers: ['src/a.ts'], raison: 'merge-failed' }],
      async () => []
    )

    await c.repecherLesTravauxEnAttente()

    expect(appels).toEqual({ sync: 0, async: 0 })
  })

  it('un candidat NON repêchable (jugé rouge) ne déclenche aucun git status', async () => {
    const { c, appels } = coordinateur(
      [{ runId: 'a', fichiers: ['src/a.ts'], verdict: 'red' }],
      async () => []
    )

    await c.repecherLesTravauxEnAttente()

    expect(appels).toEqual({ sync: 0, async: 0 })
  })

  it('une lecture qui JETTE ne fige pas le lot : retour au plafond + délai, le reste continue', async () => {
    const { c, reprises } = coordinateur(
      [
        { runId: 'base', fichiers: ['src/a.ts'] },
        { runId: 'fusion', fichiers: ['src/b.ts'], raison: 'merge-failed' }
      ],
      async () => {
        throw new Error('git introuvable')
      }
    )

    // Avant : le rejet sortait du balayage entier, sans rien repêcher.
    await expect(c.repecherLesTravauxEnAttente()).resolves.toEqual(
      expect.arrayContaining(['base', 'fusion'])
    )
    // `base` repart au titre du plafond (premier essai), `fusion` n'a rien à voir avec la base.
    expect(reprises.sort()).toEqual(['base', 'fusion'])
  })

  it('base ILLISIBLE → le travail reste au plafond, il ne repart pas comme si tout était propre', async () => {
    // Avant : la liste vide d'une base illisible se lisait « plus rien de sale » et relançait le
    // travail même au-delà du plafond d'essais.
    const { c, reprises } = coordinateur(
      [{ runId: 'a', fichiers: ['src/a.ts'] }],
      async () => undefined,
      ESSAIS_AUTOMATIQUES_MAX
    )

    expect(await c.repecherLesTravauxEnAttente()).toEqual([])
    expect(reprises).toEqual([])
  })
})
