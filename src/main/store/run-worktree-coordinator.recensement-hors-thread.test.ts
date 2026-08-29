import { describe, expect, it } from 'vitest'
import { RunWorktreeCoordinator } from './run-worktree-coordinator'

/**
 * LE GEL DE 14 SECONDES DU CHEMIN CHAUD.
 *
 * Mesure du 2026-08-29 (detecteur de gel, conv-1511) : `ipc:worktree:activity (sync)` a bloque la
 * boucle main 14 403 ms — pas deduit, mesure. La chaine est `worktree:activity` → `activity()` →
 * `travauxNonPubliesCaches()` → recensement git ENTIEREMENT SYNCHRONE (`execFileSync`, une
 * commande par branche). Supprimer la TTL a supprime le gel PERIODIQUE ; il reste le gel A FROID :
 * au premier affichage, le cache est vide, donc le recensement se paie sur le thread main.
 *
 * Contrat verrouille ici : quand le manager sait recenser HORS thread main
 * (`recensementNonPubliesAsync`), le chemin chaud ne doit JAMAIS appeler les variantes synchrones.
 * Il rend ce qu'il sait (rien), puis rafraichit en fond et RE-EMET l'activite.
 *
 * Entree qui ferait echouer ce test si la correction etait fausse : un cache FROID (aucun
 * `activity()` prealable) — c'est exactement l'etat au demarrage, celui qui a produit les 14 s.
 * Un correctif qui se contenterait de differer (setTimeout) sans sortir du thread garderait le gel
 * et serait pris par l'assertion « aucun appel synchrone ».
 */
describe('recensement des travaux non publies — hors du thread main', () => {
  function coordinateur(appelsSync: string[], onActivity: (a: unknown[]) => void) {
    const manager = {
      listAgentIds: () => ['run-fini'],
      hasActiveProcesses: () => false,
      reconcileResidues: () => ({ cleaned: 0, recovered: [], blocked: [], swept: [] }),
      operationsAreIsolated: () => true,
      changedFiles: () => [],
      describe: () => {
        throw new Error('copie absente')
      },
      travauxNonPublies: () => {
        appelsSync.push('travauxNonPublies')
        return ['run-fini']
      },
      apercuTravauxNonPublies: () => {
        appelsSync.push('apercuTravauxNonPublies')
        return [{ agentId: 'run-fini', date: '2026-08-29', fichiers: ['a.txt'] }]
      },
      recensementNonPubliesAsync: async () => ({
        ids: ['run-fini'],
        apercu: [{ agentId: 'run-fini', date: '2026-08-29', fichiers: ['a.txt'] }]
      })
    }
    const stateStore = { list: () => [], get: () => undefined, save: () => {}, remove: () => {} }
    return new RunWorktreeCoordinator({
      manager: manager as never,
      stateStore: stateStore as never,
      onActivity
    } as never)
  }

  it('cache FROID : activity() ne paie aucun git synchrone', () => {
    const appelsSync: string[] = []
    const c = coordinateur(appelsSync, () => {})
    c.activity()
    expect(appelsSync).toEqual([])
  })

  it('le releve arrive ensuite, hors thread, et l’activite est re-emise', async () => {
    const appelsSync: string[] = []
    const emissions: unknown[][] = []
    const c = coordinateur(appelsSync, (a) => emissions.push(a))
    c.activity()
    await new Promise((r) => setTimeout(r, 10))
    expect(appelsSync).toEqual([])
    expect(emissions.length).toBeGreaterThan(0)
    expect(c.travauxNonPubliesBornes().map((e) => e.agentId)).toContain('run-fini')
  })
})
