import { describe, expect, it } from 'vitest'
import { ACTIONS_LOG_MAX, createChatTurn, reduceChatTurn, bornerJournalDActions } from './chat-turn'
import { ligneDErreurDAction } from './erreur-d-action'
import { reduceAssistantPilotEvent } from '../renderer/src/components/chat-view-model'
import { actionsDuTour } from '../renderer/src/components/thinking-block-corps'

/**
 * PLAFOND MUET n°6 (conv-1228, 2026-10-28) : le journal du bloc Actions gardait les 500 DERNIÈRES
 * lignes, chacune coupée à 300 caractères, sans le dire. Même défaut que le raisonnement : sur un
 * long tour, les premières actions disparaissaient du bloc pendant qu'on le lisait, et une commande
 * ou un message d'erreur long était amputé. Les bornes restent (un tour enregistré ne doit pas
 * gonfler sans fin), mais plus hautes, et toute coupe est ÉCRITE dans le journal.
 */
type Message = Parameters<typeof reduceAssistantPilotEvent>[0]
type Evenement = Parameters<typeof reduceAssistantPilotEvent>[1]

describe('le journal d’actions ne perd plus rien en silence', () => {
  it('une ligne de 1 000 caractères est gardée entière dans le tour enregistré', () => {
    const ligne = `Bash · ${'echo un-argument-long '.repeat(45)}`
    expect(ligne.length).toBeGreaterThan(300)
    const tour = reduceChatTurn(createChatTurn('t1'), { kind: 'actions-log', lines: [ligne] })
    expect(tour.actionsLog).toEqual([ligne.trim()])
  })

  it('une ligne démesurée est coupée EN LE DISANT', () => {
    const tour = reduceChatTurn(createChatTurn('t1'), {
      kind: 'actions-log',
      lines: [`Bash · ${'x'.repeat(50_000)}`]
    })
    expect(tour.actionsLog?.[0]).toMatch(/caractères coupés\]$/)
  })

  it('au-delà de la borne, une ligne de tête dit combien d’actions anciennes manquent', () => {
    const lignes = Array.from({ length: ACTIONS_LOG_MAX + 25 }, (_, i) => `Read · fichier-${i}.ts`)
    const borne = bornerJournalDActions(lignes)
    expect(borne).toHaveLength(ACTIONS_LOG_MAX + 1)
    expect(borne[0]).toMatch(/^… 25 lignes plus anciennes non gardées/)
    expect(borne.at(-1)).toBe(`Read · fichier-${ACTIONS_LOG_MAX + 24}.ts`)
    // Re-borner un journal déjà borné CUMULE le compte au lieu d'empiler les marques.
    const encore = bornerJournalDActions([...borne, 'Read · un-de-plus.ts'])
    expect(encore[0]).toMatch(/^… 26 lignes plus anciennes non gardées/)
    expect(encore.filter((l) => l.startsWith('… '))).toHaveLength(1)
  })

  it('le direct borne de la même façon, en le disant', () => {
    let message = { turnId: 't1', parts: [], done: false } as unknown as Message
    for (let i = 0; i < ACTIONS_LOG_MAX + 3; i++)
      message = reduceAssistantPilotEvent(message, {
        kind: 'provider-status',
        text: `Read · f${i}.ts`,
        turnId: 't1'
      } as Evenement)
    expect(message.providerStatusLog?.[0]).toMatch(/^… 3 lignes plus anciennes non gardées/)
    expect(message.providerStatusLog?.at(-1)).toBe(`Read · f${ACTIONS_LOG_MAX + 2}.ts`)
  })

  it('la ligne de coupe s’affiche comme une ligne terminée, pas comme une action en cours', () => {
    const actions = actionsDuTour(
      [
        '… 3 lignes plus anciennes non gardées (journal borné)',
        'Read · a.ts',
        'Read terminé - 1 s'
      ],
      undefined,
      false
    )
    expect(actions[0]?.texte).toMatch(/^… 3 lignes/)
    expect(actions[0]?.etat).toBe('ok')
  })

  it('le message d’erreur d’une action garde bien plus que 300 caractères', () => {
    const sortie = `Exit code 1\n${'AssertionError: attendu 1, reçu 2. '.repeat(20)}`
    const ligne = ligneDErreurDAction('Bash', sortie)!
    expect(ligne.length).toBeGreaterThan(300)
    expect(ligne.endsWith('…')).toBe(false)
  })
})
