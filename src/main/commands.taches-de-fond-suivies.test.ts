import { afterEach, describe, expect, it } from 'vitest'
import { AppCommandBus } from './commands'
import {
  noterTacheRelancee,
  noterTacheRendue,
  viderTachesDeFondSuivies
} from './providers/taches-de-fond-suivies'

/**
 * LE MODÈLE DOIT SAVOIR QU'AUTOWIN SURVEILLE ENCORE SA TÂCHE DE FOND.
 *
 * conv-253, tour bdfe38d3-5ba5-4693-bad2-f70b39bc845e (« ? », saisie ts 1791731223359) : à la
 * reprise de session, le CLI dit au modèle que sa surveillance `bmaye5d39` s'est arrêtée « before
 * the previous session ended ». Son raisonnement : « The background watcher process ended with the
 * session, so I should decide whether to relaunch one » — il en relance une seconde (`biiy5js9b`).
 * La copie d'Autowin (lot 6cb0f6b4, bash 24564) tournait pourtant toujours. Rien dans l'état
 * poussé au modèle ne le disait : seul le CLI parlait, et il parlait de SA copie.
 */
const os = {
  executionWorkspace: process.cwd(),
  conversations: { list: () => [] },
  registry: { ids: () => ['claude'] },
  roles: { all: () => ({}), getBinding: () => undefined },
  runsWithGate: async () => [],
  budget: () => ({ pricedSpendUsd: 0 }),
  getWorktreeActivity: () => [],
  travauxNonPubliesBornes: () => []
} as unknown as ConstructorParameters<typeof AppCommandBus>[0]

afterEach(() => viderTachesDeFondSuivies())

describe('état poussé au modèle — tâches de fond suivies par Autowin', () => {
  it('liste la tâche relancée qui tourne, avec sa conversation et la consigne de ne pas la relancer', async () => {
    noterTacheRelancee({
      conversationId: 'conv-253',
      tache: 'bmaye5d39',
      commande: 'while head -1 "$R" | grep -q "status: open"; do sleep 30; done',
      depuis: Date.parse('2026-10-11T14:45:48Z')
    })
    const etat = await new AppCommandBus(os, () => undefined).snapshotForPrompt()
    const suivies = etat.tachesDeFondSuiviesParAutowin
    expect(suivies?.taches).toHaveLength(1)
    expect(suivies?.taches[0]).toMatchObject({ conversationId: 'conv-253', tache: 'bmaye5d39' })
    expect(suivies?.taches[0]?.commande).toContain('status: open')
    expect(suivies?.consigne).toMatch(/ne la relance pas/i)
  })

  it('absent quand rien ne tourne : aucun caractère payé pour rien', async () => {
    noterTacheRelancee({ conversationId: 'c', tache: 't1', commande: 'x', depuis: 1 })
    noterTacheRendue('t1')
    const etat = await new AppCommandBus(os, () => undefined).snapshotForPrompt()
    expect('tachesDeFondSuiviesParAutowin' in etat).toBe(false)
  })
})
