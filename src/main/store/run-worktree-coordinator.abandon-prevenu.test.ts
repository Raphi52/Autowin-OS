import { describe, expect, it, vi } from 'vitest'
import { RunWorktreeCoordinator } from './run-worktree-coordinator'
import { ESSAIS_MAX } from './delai-de-reprise'

/**
 * LE DÉFAUT, vérifié le 2026-08-23 : il n'existe AUCUNE notification dans toute l'application
 * (`grep new Notification` sur `src/` : vide). Un travail abandonné après épuisement des reprises
 * ne « sonne » donc nulle part — il attend qu'on pense à ouvrir le bon panneau.
 *
 * C'est la même famille de défaut que celle corrigée plus tôt dans la journée : la machine SAIT et
 * se tait. Trois travaux terminés ont ainsi été perdus de vue le même jour.
 *
 * LE SEUIL EST DÉLIBÉRÉ : on prévient sur l'ABANDON, jamais sur un refus ordinaire. Les traces
 * comptent 1649 refus ; en notifier ne serait-ce qu'un dixième noierait le signal — et un bandeau
 * qu'on n'écoute plus est exactement le défaut que ce chantier combat.
 */
describe('un travail abandonné le fait savoir', () => {
  function coordinateur(onAbandon: (info: { runId: string; tache?: string }) => void) {
    const record = {
      version: 1,
      repoId: 'depot',
      runId: 'run-epuise',
      agentName: 'Agent',
      worktreePath: 'C:/absent/agent__run-epuise',
      publication: 'pending',
      attentionReason: 'retry-exhausted',
      retryCount: ESSAIS_MAX,
      verdict: 'unknown',
      task: 'corriger la vue chat',
      files: []
    }
    const manager = {
      listAgentIds: () => [],
      hasActiveProcesses: () => false,
      reconcileResidues: () => ({ cleaned: 0, recovered: [], blocked: [], swept: [] }),
      operationsAreIsolated: () => false,
      describe: () => {
        throw new Error('copie absente')
      },
      changedFiles: () => []
    }
    const stateStore = { list: () => [record], get: () => undefined, save: () => {}, remove: () => {} }
    return new RunWorktreeCoordinator({
      manager: manager as never,
      stateStore: stateStore as never,
      onAbandon
    } as never)
  }

  it('prévient quand un travail est abandonné après épuisement des reprises', () => {
    const prevenu = vi.fn()
    coordinateur(prevenu)
    expect(prevenu).toHaveBeenCalledTimes(1)
    expect(prevenu.mock.calls[0][0]).toMatchObject({ runId: 'run-epuise' })
  })

  it('dit de QUOI il s’agit, pas seulement un identifiant', () => {
    // « run-epuise » ne dit rien à personne ; la tâche, si. Même leçon que pour les branches de
    // secours, dont l'UUID était illisible.
    const prevenu = vi.fn()
    coordinateur(prevenu)
    expect(prevenu.mock.calls[0][0].tache).toBe('corriger la vue chat')
  })

  it('ne prévient pas pour un travail DÉJÀ abandonné — pas deux sonneries pour la même mort', () => {
    // L'abandon est persisté (`abandoned: true`). Au démarrage suivant, le record revient du disque
    // avec ce marqueur : la boucle doit le sauter, sinon chaque redémarrage re-sonnerait pour des
    // travaux morts depuis des jours.
    const prevenu = vi.fn()
    const dejaAbandonne = {
      version: 1,
      repoId: 'depot',
      runId: 'run-vieux',
      agentName: 'Agent',
      worktreePath: 'C:/absent/agent__run-vieux',
      publication: 'pending',
      attentionReason: 'retry-exhausted',
      retryCount: ESSAIS_MAX,
      verdict: 'unknown',
      abandoned: true,
      files: []
    }
    const manager = {
      listAgentIds: () => [],
      hasActiveProcesses: () => false,
      reconcileResidues: () => ({ cleaned: 0, recovered: [], blocked: [], swept: [] }),
      operationsAreIsolated: () => false,
      describe: () => {
        throw new Error('copie absente')
      },
      changedFiles: () => []
    }
    new RunWorktreeCoordinator({
      manager: manager as never,
      stateStore: {
        list: () => [dejaAbandonne],
        get: () => undefined,
        save: () => {},
        remove: () => {}
      } as never,
      onAbandon: prevenu
    } as never)
    expect(prevenu).not.toHaveBeenCalled()
  })

  it('ne jette pas quand personne n’écoute', () => {
    expect(() =>
      coordinateur(undefined as unknown as (info: { runId: string }) => void)
    ).not.toThrow()
  })
})
