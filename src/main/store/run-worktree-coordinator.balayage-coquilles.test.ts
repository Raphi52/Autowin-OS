import { describe, expect, it, vi } from 'vitest'
import { RunWorktreeCoordinator } from './run-worktree-coordinator'

/**
 * LE BALAYAGE EST-IL REELLEMENT APPELE ?
 *
 * La decision est testee a cote (`coquilles-vides.test.ts`), la garde a la source aussi
 * (`worktree-manager.coquille-apres-remove.test.ts`). Ce test-ci verifie la seule chose que ni
 * l'une ni l'autre n'etablit : que quelqu'un APPELLE le balayage au demarrage. Une capacite
 * atteignable mais jamais appelee est du theatre — le defaut le plus couteux de ce depot.
 *
 * ET L'ORDRE COMPTE. Les coquilles MENTENT a tout ce qui les mesure : un `git status` lance dans
 * l'une d'elles ne repond pas « vide », git remonte l'arborescence et rapporte l'etat du depot
 * PARENT. Mesure le 2026-08-25 : douze coquilles ont ainsi paru porter exactement les memes six
 * fichiers modifies — ceux de la session en cours. Reconcilier AVANT de les retirer, c'est
 * reconcilier sur douze faux rapports. Le test verifie donc aussi la sequence.
 */
function coordinateurAvecManagerEspion(): { appels: string[] } {
  const appels: string[] = []
  const manager = {
    balayerLesCoquilles: vi.fn(() => {
      appels.push('balayage')
      return ['agent__coquille']
    }),
    reconcileResiduesAsync: vi.fn(async () => {
      appels.push('reconciliation')
      return { cleaned: 0, blocked: [] }
    }),
    list: () => [],
    travauxNonPublies: () => [],
    apercuTravauxNonPublies: () => []
  }
  let liberer: () => void = () => {}
  const garde = new Promise<void>((resolve) => {
    liberer = resolve
  })
  new RunWorktreeCoordinator({
    manager: manager as never,
    deferRecoveryUntil: garde
  } as never)
  liberer()
  return { appels }
}

describe('démarrage — les coquilles sont balayées avant toute mesure', () => {
  it('le balayage est APPELÉ, et AVANT la réconciliation', async () => {
    const { appels } = coordinateurAvecManagerEspion()

    // Laisser la chaîne de promesses du constructeur se dérouler.
    await new Promise((resolve) => setImmediate(resolve))

    expect(appels).toContain('balayage')
    // L'entrée qui ferait échouer un câblage pose au mauvais endroit : balayer APRÈS aurait
    // laissé la réconciliation lire douze faux rapports.
    expect(appels.indexOf('balayage')).toBeLessThan(appels.indexOf('reconciliation'))
  })
})
