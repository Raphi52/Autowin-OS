import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { INTERVALLE_BALAYAGE_MS } from './repechage-automatique'
import { RunWorktreeCoordinator } from './run-worktree-coordinator'

/**
 * UNE INSTANCE DE TEST NE RÉCUPÈRE RIEN (bulletin de maintenance du 2026-10-31, conv-1048).
 *
 * Vécu deux fois : `lot5nav` le 29/10 à 19:26 et `sonde-fondu-conv-1322` le 30/10 à 14:00. Une
 * instance a son propre dossier de données, mais elle partage le `.git` du vrai dépôt. Sa
 * récupération de démarrage y a donc adopté les branches `autowin/recovery/*` (« Agent récupéré »),
 * puis le balayage automatique a appelé `retryRunAsync` → `git worktree add` sur le VRAI dépôt, sans
 * aucun clic. Résultat : une copie du vrai dépôt enregistrée dans le dossier jetable de l'instance.
 *
 * Le test attrape un correctif qui ne couperait qu'un des deux chemins : le recensement au démarrage
 * ET le balayage périodique doivent rester muets, sinon le défaut revient à la minute suivante.
 */
describe('instance de test isolée — aucune récupération sur le dépôt partagé', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  const coordinateur = (
    sansRecuperation?: boolean
  ): {
    c: RunWorktreeCoordinator
    gestes: string[]
    balayage: ReturnType<typeof vi.spyOn>
  } => {
    const gestes: string[] = []
    const manager = {
      listAgentIds: () => ['run-du-vrai-depot'],
      hasActiveProcesses: () => false,
      operationsAreIsolated: () => true,
      recoveryInventoryAsync: () => {
        gestes.push('recensement')
        return new Promise(() => {})
      }
    }
    const stateStore = { list: () => [], get: () => undefined, save: () => {}, remove: () => {} }
    const balayage = vi
      .spyOn(RunWorktreeCoordinator.prototype as never, 'repecherLesTravauxEnAttente' as never)
      .mockResolvedValue(undefined as never)
    const c = new RunWorktreeCoordinator({
      manager: manager as never,
      stateStore: stateStore as never,
      onActivity: () => {},
      sansRecuperation
    } as never)
    return { c, gestes, balayage }
  }

  it('sansRecuperation : ni recensement au démarrage, ni balayage ensuite', async () => {
    const { c, gestes, balayage } = coordinateur(true)
    await vi.advanceTimersByTimeAsync(INTERVALLE_BALAYAGE_MS * 3)
    c.arreterLeBalayageAutomatique()
    expect(gestes).toEqual([])
    expect(balayage).not.toHaveBeenCalled()
  })

  it('la vraie app garde sa récupération et son balayage', async () => {
    const { c, gestes, balayage } = coordinateur()
    await vi.advanceTimersByTimeAsync(INTERVALLE_BALAYAGE_MS * 3)
    c.arreterLeBalayageAutomatique()
    expect(gestes).toEqual(['recensement'])
    expect(balayage).toHaveBeenCalled()
  })

  it('os.ts branche bien le réglage sur le mode de lancement réel', () => {
    const source = readFileSync(join(__dirname, '..', 'os.ts'), 'utf8')
    expect(source).toMatch(
      /sansRecuperation:\s*resolveAutomationInstanceMode\(process\.argv, process\.env, app\.isPackaged\)\s*\.isolated/
    )
  })
})
