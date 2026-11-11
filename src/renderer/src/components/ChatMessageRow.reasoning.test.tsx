// @vitest-environment happy-dom
/**
 * La bulle du fil PORTE le raisonnement, dans un bloc « Réflexion » repliable (`ThinkingBlock`).
 *
 * INVERSION ASSUMEE (2026-08-31). Ce fichier verrouillait la decision inverse — « le raisonnement
 * vit dans le panneau dedie, jamais dans la bulle ». Ce panneau lateral a ete RETIRE : le
 * raisonnement etait alors accumule par `chat-view-model` et rendu NULLE PART, donc la pensee
 * existait et restait invisible. `ThinkingBlock` la ramene dans la bulle (cf. son en-tete).
 * L'ancien oracle ne decrivait plus aucune intention : il faisait echouer toute edition du chat.
 *
 * Entree qui ferait echouer une correction fausse : un message EN COURS (`done: false`) avec
 * `reasoning` et zero `parts` — le bloc doit etre OUVERT tant que le tour n'est pas termine,
 * un rendu qui se contenterait de le monter replie laisserait la pensee invisible comme avant.
 */
import { describe, expect, it } from 'vitest'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { ChatMessageRow } from './ChatMessageRow'
import type { Msg } from './chat-view-types'

// fix-ok: cause mesurée — sans ce drapeau, React écrit « not configured to support act(...) » à
// chaque act() : 6 avertissements dans ce fichier avant ce réglage (relevés par vitest).
;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

describe('ChatMessageRow', () => {
  it('affiche le raisonnement dans un bloc Réflexion, plié par défaut', async () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    const message = {
      role: 'assistant',
      content: '',
      parts: [],
      done: false,
      reasoning: 'raisonnement en cours'
    } as unknown as Msg
    await act(async () => {
      root.render(createElement(ChatMessageRow, { message, index: 0 } as never))
    })
    const bloc = host.querySelector<HTMLDetailsElement>('[data-testid="thinking-block"]')
    expect(bloc, 'le raisonnement doit être rendu dans un bloc « Réflexion »').not.toBeNull()
    // PLIÉ par défaut depuis le 2026-09-01 (« pareil pour reflexion ») : ce que cet oracle protège,
    // c'est que le bloc EXISTE et PORTE la pensée — le défaut d'origine était son absence totale.
    expect(bloc!.open).toBe(false)
    expect(host.querySelector('[data-testid="thinking-block-body"]')?.textContent).toBe(
      'raisonnement en cours'
    )
    await act(async () => root.unmount())
    host.remove()
  })

  it('le décodage de l’image a son PROPRE bloc, à côté du Raisonnement, sans rien lui prendre', async () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    const message = {
      role: 'assistant',
      content: '',
      parts: [],
      done: false,
      reasoning: 'pensée générale',
      lookDecode: 'The cube is red.'
    } as unknown as Msg
    await act(async () => {
      root.render(createElement(ChatMessageRow, { message, index: 0 } as never))
    })
    expect(host.querySelector('[data-testid="look-decode-block-body"]')?.textContent).toBe(
      'The cube is red.'
    )
    // Le bloc Raisonnement garde SA pensée, et le décodage n'y entre pas.
    expect(host.querySelector('[data-testid="thinking-block-body"]')?.textContent).toBe(
      'pensée générale'
    )
    expect(host.querySelector('[data-testid="thinking-block"]')?.textContent).not.toContain(
      'The cube is red.'
    )
    // Et il vient APRÈS le raisonnement dans le fil : l'ordre DOM prouve « à côté », pas « à sa place ».
    const bloc = host.querySelector('[data-testid="thinking-block"]')
    const decodage = host.querySelector('[data-testid="look-decode-block"]')
    expect(bloc, 'le bloc Raisonnement doit exister').not.toBeNull()
    expect(decodage, 'le bloc du décodage doit exister').not.toBeNull()
    expect(bloc!.compareDocumentPosition(decodage!) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0)
    await act(async () => root.unmount())
    host.remove()
  })

  it('sans raisonnement, un décodage seul s’affiche sans bloc Raisonnement', async () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    const message = {
      role: 'assistant',
      content: 'Réponse finale.',
      parts: [{ kind: 'text', text: 'Réponse finale.' }],
      done: true,
      status: 'completed',
      lookDecode: 'The cube is red.'
    } as unknown as Msg
    await act(async () => {
      root.render(createElement(ChatMessageRow, { message, index: 0 } as never))
    })
    expect(host.querySelector('[data-testid="look-decode-block-body"]')?.textContent).toBe(
      'The cube is red.'
    )
    expect(host.querySelector('[data-testid="thinking-block"]')).toBeNull()
    await act(async () => root.unmount())
    host.remove()
  })
})
