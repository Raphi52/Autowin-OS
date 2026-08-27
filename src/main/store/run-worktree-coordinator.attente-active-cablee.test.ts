import { describe, expect, it } from 'vitest'
import { RunWorktreeCoordinator } from './run-worktree-coordinator'
import { ESSAIS_AUTOMATIQUES_MAX } from './repechage-automatique'

/**
 * L'ATTENTE ACTIVE EST-ELLE REELLEMENT ALIMENTEE ?
 *
 * Le tri sait attendre (`repechage-attente-active.test.ts`), mais un tri qui sait et qu'on n'appelle
 * pas ne change rien : c'est le defaut « expose mais jamais alimente », deja paye plusieurs fois dans
 * ce depot (le bouton « Reprendre » sans appelant automatique, quatorze travaux dormants). Cette
 * suite verifie le CABLAGE : le balayage interroge bien l'etat reel de la base, et il en tire les
 * deux conclusions opposees.
 *
 * Le cas vecu qu'il faut couvrir (conv-1450) : un `base-dirty` dont le fichier reste sale des heures
 * parce qu'une autre session l'edite. Avant, trois essais a l'aveugle puis un echec definitif.
 */
describe('balayage — l attente active est cablee sur l etat REEL de la base', () => {
  const coordinateur = (
    salesDeLaBase: string[],
    fichiersDuRun: string[],
    essaisDejaFaits = 0
  ): { c: RunWorktreeCoordinator; reprises: string[] } => {
    const runId = 'run-bloque'
    const reprises: string[] = []
    const manager = {
      listAgentIds: () => [runId],
      hasActiveProcesses: () => false,
      reconcileResidues: () => ({ cleaned: 0, recovered: [], blocked: [], swept: [] }),
      operationsAreIsolated: () => false,
      describe: () => {
        throw new Error('copie absente')
      },
      changedFiles: () => [],
      baseDirtyFiles: () => salesDeLaBase,
      finalize: () => ({ outcome: 'blocked', agentId: runId, files: fichiersDuRun, reason: 'base-dirty' })
    }
    const stateStore = {
      list: () => [
        {
          version: 1,
          repoId: 'depot',
          runId,
          agentName: 'Agent bloque',
          worktreePath: 'C:/absent/agent__' + runId,
          publication: 'blocked',
          attentionReason: 'base-dirty',
          verdict: 'unknown',
          files: fichiersDuRun.map((path) => ({ path, kind: 'mod' })),
          sourceSha: null,
          publishedSha: null
        }
      ],
      get: () => undefined,
      save: () => {},
      remove: () => {}
    }
    const c = new RunWorktreeCoordinator({
      manager: manager as never,
      stateStore: stateStore as never
    } as never)
    // La reprise elle-meme n'est pas le sujet : on observe QUI le balayage decide de retenter.
    ;(c as unknown as { retryRunAsync: (id: string) => Promise<void> }).retryRunAsync = async (
      id: string
    ) => {
      reprises.push(id)
    }
    if (essaisDejaFaits > 0) {
      ;(c as unknown as { essaisAutomatiques: Map<string, number> }).essaisAutomatiques.set(
        'run-bloque',
        essaisDejaFaits
      )
    }
    return { c, reprises }
  }

  it('le fichier en cause est TOUJOURS sale → aucune tentative, et aucun essai brule', async () => {
    const { c, reprises } = coordinateur(['src/main/agent-pilot.ts'], ['src/main/agent-pilot.ts'])

    const tentes = await c.repecherLesTravauxEnAttente()

    expect(tentes).toEqual([])
    expect(reprises).toEqual([])
  })

  it('le fichier est redevenu propre → on retente, MEME au-dela du plafond', async () => {
    const { c, reprises } = coordinateur(
      ['un/autre/fichier.ts'],
      ['src/main/agent-pilot.ts'],
      ESSAIS_AUTOMATIQUES_MAX + 2
    )

    const tentes = await c.repecherLesTravauxEnAttente()

    expect(tentes).toEqual(['run-bloque'])
    expect(reprises).toEqual(['run-bloque'])
  })

  it('une base sale sur un fichier SANS RAPPORT ne fait pas attendre ce run', async () => {
    // Le piege symetrique de l'attente : si on regardait « la base est-elle sale ? » au lieu de
    // « MES fichiers sont-ils sales ? », ce run attendrait indefiniment pour rien.
    const { c, reprises } = coordinateur(['docs/notes.md'], ['src/main/agent-pilot.ts'])

    expect(await c.repecherLesTravauxEnAttente()).toEqual(['run-bloque'])
    expect(reprises).toEqual(['run-bloque'])
  })
})
