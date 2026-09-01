// @vitest-environment happy-dom
/**
 * DEPLIER doit rendre la TRACE COMPLETE du tour, pas seulement sa derniere ligne.
 *
 * Constat utilisateur du 2026-09-01 : « quand je déplie le bloc reflexion ca doit m'écrire toutes
 * les lignes de reflexion pas seulement la derniere ». Le signe de vie du fournisseur REMPLACE le
 * precedent (c'est correct pour l'en-tete repliee) — mais le corps deplie doit, lui, montrer tout.
 *
 * Entree qui ferait echouer une correction fausse : trois lignes dont deux identiques a la suite.
 * Le corps doit porter les trois lignes DISTINCTES dans l'ordre, et l'en-tete la derniere seule.
 */
import { describe, expect, it } from 'vitest'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { ThinkingBlock, corpsDuBloc } from './ThinkingBlock'
import { reduceAssistantPilotEvent } from './chat-view-model'

const base = { turnId: 't1', parts: [], done: false } as unknown as Parameters<
  typeof reduceAssistantPilotEvent
>[0]
const statut = (text: string): Parameters<typeof reduceAssistantPilotEvent>[1] =>
  ({ kind: 'provider-status', text, turnId: 't1' }) as Parameters<
    typeof reduceAssistantPilotEvent
  >[1]

describe('bloc Réflexion — historique des lignes', () => {
  it('accumule toutes les lignes distinctes, sans dupliquer un battement répété', () => {
    let etat = reduceAssistantPilotEvent(base, statut('Bash en cours - 30 s'))
    etat = reduceAssistantPilotEvent(etat, statut('Bash en cours - 30 s'))
    etat = reduceAssistantPilotEvent(etat, statut('Bash en cours - 1 min'))
    etat = reduceAssistantPilotEvent(etat, statut('tache de fond terminee'))

    expect(etat.providerStatusLog).toEqual([
      'Bash en cours - 30 s',
      'Bash en cours - 1 min',
      'tache de fond terminee'
    ])
    // L'en-tête, elle, ne montre toujours QUE la dernière.
    expect(etat.providerStatus).toBe('tache de fond terminee')
  })

  it('écrit toutes les lignes dans le corps du bloc, la pensée en tête', () => {
    expect(corpsDuBloc('je pense', ['une', 'deux', 'trois'], 'trois', false)).toBe(
      'je pense\nune\ndeux\ntrois'
    )
  })

  it('rend les lignes dans le corps du bloc affiché', async () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    await act(async () => {
      root.render(
        createElement(ThinkingBlock, {
          text: '',
          done: false,
          status: 'trois',
          statusLog: ['une', 'deux', 'trois']
        })
      )
    })
    expect(host.querySelector('[data-testid="thinking-body"]')?.textContent).toBe(
      'une\ndeux\ntrois'
    )
    // Repliée, l'en-tête reste sur une seule ligne : la dernière.
    expect(host.querySelector('[data-testid="thinking-status"]')?.textContent).toBe('trois')
    await act(async () => root.unmount())
    host.remove()
  })
})
