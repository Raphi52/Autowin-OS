import { describe, expect, it } from 'vitest'
import {
  createChatTurn,
  flattenChatParts,
  reduceChatTurn,
  sanitizePersistedValue
} from './chat-turn'

describe('chat turn reducer', () => {
  it('preserves text/action/text order and resolves the matching action', () => {
    let turn = createChatTurn('turn-1')
    turn = reduceChatTurn(turn, { kind: 'delta', streamId: '0:0', text: 'Bonjour ' })
    turn = reduceChatTurn(turn, { kind: 'delta', streamId: '0:0', text: 'Raphaël.' })
    turn = reduceChatTurn(turn, {
      kind: 'command',
      actionId: 'action-1',
      name: 'get_state',
      args: { target: 'chat' }
    })
    turn = reduceChatTurn(turn, {
      kind: 'result',
      actionId: 'action-1',
      name: 'get_state',
      ok: true,
      data: { tab: 'chat' }
    })
    turn = reduceChatTurn(turn, { kind: 'delta', streamId: '1:0', text: ' Terminé.' })
    turn = reduceChatTurn(turn, { kind: 'done' })

    expect(turn.status).toBe('completed')
    expect(turn.parts).toEqual([
      { kind: 'text', streamId: '0:0', text: 'Bonjour Raphaël.' },
      {
        kind: 'action',
        actionId: 'action-1',
        name: 'get_state',
        args: { target: 'chat' },
        ok: true,
        data: { tab: 'chat' }
      },
      { kind: 'text', streamId: '1:0', text: ' Terminé.' }
    ])
    /*
      L'ORDRE des textes reste la garantie de ce test — c'était son intention, et elle tient. Ce qui
      change : l'étiquette d'une action RÉUSSIE ne s'intercale plus entre eux. Mesuré le 2026-08-15,
      36 conversations sur 39 commençaient par « [a exécuté …] », et l'utilisateur a tranché — « c'est
      pas du tout l'expérience utilisateur que je veux offrir ».

      L'étiquette reste un DERNIER RECOURS : sans aucun texte, elle réapparaît, sinon la bulle serait
      vide — un défaut plus ancien et pire (`conv-1141`). Les deux garanties tiennent ensemble.
    */
    expect(flattenChatParts(turn.parts)).toBe('Bonjour Raphaël.\n Terminé.')
    expect(flattenChatParts(turn.parts.filter((part) => part.kind === 'action'))).toContain(
      'get_state'
    )
  })

  it('removes only the failed retry stream', () => {
    let turn = createChatTurn('turn-2')
    turn = reduceChatTurn(turn, { kind: 'delta', streamId: '0:0', text: 'Réponse perdue' })
    turn = reduceChatTurn(turn, { kind: 'stream-reset', streamId: '0:0' })
    turn = reduceChatTurn(turn, { kind: 'delta', streamId: '0:1', text: 'Réponse valide' })

    expect(turn.parts).toEqual([{ kind: 'text', streamId: '0:1', text: 'Réponse valide' }])
  })

  it.each([
    ['failed', { kind: 'failed', error: 'provider indisponible' } as const],
    ['cancelled', { kind: 'cancelled' } as const],
    ['interrupted', { kind: 'interrupted' } as const]
  ])('records the honest %s terminal state', (status, event) => {
    const turn = reduceChatTurn(createChatTurn('turn-terminal'), event)
    expect(turn.status).toBe(status)
  })

  it('redacts sensitive keys while preserving ordinary action evidence', () => {
    expect(
      sanitizePersistedValue({ target: 'chat', token: 'secret', nested: { password: 'hidden' } })
    ).toEqual({ target: 'chat', token: '[masqué]', nested: { password: '[masqué]' } })
  })

  it('persists generated artifacts as first-class turn parts and deduplicates retries', () => {
    const artifact = {
      id: 'artifact-capture',
      name: 'capture.png',
      mimeType: 'image/png',
      kind: 'image' as const,
      size: 3,
      createdAt: 123,
      encoding: 'base64' as const,
      content: 'YWJj',
      source: { provider: 'codex' }
    }
    const withArtifact = reduceChatTurn(createChatTurn('turn-artifact'), {
      kind: 'artifact',
      artifact
    })
    const retried = reduceChatTurn(withArtifact, { kind: 'artifact', artifact })

    expect(retried.parts).toEqual([{ kind: 'artifact', artifact }])
    expect(flattenChatParts(retried.parts)).toBe('[artefact capture.png]')
  })
})

/**
 * ZOMBIE APRÈS INTERRUPTION. Un tour clos par `interrupted` (l'app a été fermée) laissait ses
 * actions sans résultat en `ok === undefined` — c'est-à-dire « encore en cours ». Toutes les
 * surfaces qui lisent ces parts (fil de chat, graphe d'exécution) affichaient donc indéfiniment
 * une étape active dont l'issue n'arrivera jamais. La branche `failed` réglait déjà ce cas ; la
 * branche `interrupted`, non.
 */
describe('clôture « interrompu » d’un tour', () => {
  it('règle les actions restées sans résultat au lieu de les laisser « en cours »', () => {
    const enCours = reduceChatTurn(
      reduceChatTurn(createChatTurn('turn-zombie'), {
        kind: 'command',
        actionId: '0:orchestrate',
        name: 'orchestrate'
      }),
      { kind: 'command', actionId: '1:gate', name: 'gate' }
    )
    const regle = reduceChatTurn(
      reduceChatTurn(enCours, { kind: 'result', actionId: '1:gate', name: 'gate', ok: true }),
      { kind: 'interrupted' }
    )

    expect(regle.status).toBe('interrupted')
    const actions = regle.parts.filter((part) => part.kind === 'action')
    // L'action jamais résolue est INTERROMPUE : son issue ne viendra jamais.
    expect(actions[0]).toMatchObject({ name: 'orchestrate', interrupted: true })
    // Discriminant : une action déjà résolue n'est pas réécrite en interrompue.
    expect(actions[1]).toMatchObject({ name: 'gate', ok: true })
    expect(actions[1]).not.toHaveProperty('interrupted')
  })
})
