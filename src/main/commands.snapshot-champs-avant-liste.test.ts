import { describe, expect, it } from 'vitest'
import { AppCommandBus } from './commands'
import { bornerResultatDeCommande } from './resultat-de-commande-borne'

/**
 * DÉFAUT MESURÉ le 2026-10-22 (conv-1048, passe /maintenance). `get_state` rendait les 908
 * conversations AVANT tout le reste : la sortie dépassait le plafond de 120 000 caractères
 * (`resultat-de-commande-borne.ts`) et la coupe emportait `travauxNonPublies`, placé en dernier.
 * Le modèle ne lisait donc JAMAIS le champ que la description de l'outil lui ordonne de consulter
 * avant « rien à fusionner » — et l'avis de coupe lui demandait de « relancer plus étroit » une
 * commande qui n'a aucun paramètre.
 *
 * La liste des conversations est la seule qui grandit sans borne : elle passe EN DERNIER, pour que
 * la coupe ne retire que les fils les plus anciens, jamais les champs courts.
 */

type OsDouble = ConstructorParameters<typeof AppCommandBus>[0]

const TRAVAIL = { agentId: 'run-temoin-1', date: '2026-10-21', fichiers: ['src/x.ts'] }

const os = (nombre: number): OsDouble =>
  ({
    executionWorkspace: process.cwd(),
    conversations: {
      list: () =>
        Array.from({ length: nombre }, (_, i) => ({
          id: `conv-${i}`,
          title: `une conversation au titre assez long pour peser son poids réel ${i}`,
          provider: 'claude',
          updatedAt: 1792650600000 - i,
          messages: []
        }))
    },
    registry: { ids: () => ['claude'] },
    roles: { all: () => ({}), getBinding: () => undefined },
    runsWithGate: async () => [],
    budget: () => ({ pricedSpendUsd: 0 }),
    getWorktreeActivity: () => [{ workspacePath: 'D:/copie-temoin', state: 'idle' }],
    travauxNonPublies: () => [TRAVAIL],
    travauxNonPubliesBornes: () => [TRAVAIL]
  }) as unknown as OsDouble

describe('get_state : la coupe à 120 000 caractères n’emporte jamais les champs courts', () => {
  it('avec 2 000 conversations, travauxNonPublies et worktrees restent lisibles', async () => {
    const etat = await new AppCommandBus(os(2000), () => {}).snapshot()
    const rendu = bornerResultatDeCommande('get_state', `get_state → ${JSON.stringify(etat)}`)

    expect(rendu).toContain('[RESULTAT TRONQUE PAR L')
    expect(rendu).toContain('"travauxNonPublies":[{"agentId":"run-temoin-1"')
    expect(rendu).toContain('"worktrees":[{"workspacePath":"D:/copie-temoin"')
  })

  it('la coupe retire les conversations les plus anciennes, jamais les plus récentes', async () => {
    const etat = await new AppCommandBus(os(2000), () => {}).snapshot()
    const rendu = bornerResultatDeCommande('get_state', `get_state → ${JSON.stringify(etat)}`)

    expect(rendu).toContain('"id":"conv-0"')
    expect(rendu).not.toContain('"id":"conv-1999"')
  })
})
