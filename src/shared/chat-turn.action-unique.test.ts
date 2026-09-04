import { describe, expect, it } from 'vitest'
import { createChatTurn, reduceChatTurn } from './chat-turn'

/**
 * DEFAUT MESURE (capture du 2026-09-04, conv-262 puis conv-246 persistee) : le fil affichait DEUX
 * blocs « Orchestration » pour UNE seule action — meme `actionId`, meme cible —, l'un muet (aucun
 * detail, aucun chevron), l'autre portant l'issue. Cause : une commande RE-EMISE avec le meme
 * `actionId` (reprise d'un tour dont l'action n'etait pas resolue) etait AJOUTEE au lieu d'etre
 * retrouvee. `actionId` est l'identite de l'action : deux parts ne peuvent pas la partager.
 */
describe('reduceChatTurn — une action par actionId', () => {
  const commande = (args: Record<string, unknown>) =>
    ({ kind: 'command', actionId: '0:0', name: 'orchestrate', args }) as const

  it('ne cree pas un second bloc quand la meme commande est re-emise', () => {
    let state = reduceChatTurn(createChatTurn('t1'), commande({ task: '/clean' }))
    state = reduceChatTurn(state, commande({ task: '/clean' }))
    expect(state.parts.filter((part) => part.kind === 'action')).toHaveLength(1)
  })

  it('garde le plus riche : l’issue deja recue survit a la re-emission', () => {
    let state = reduceChatTurn(createChatTurn('t1'), commande({ task: '/clean' }))
    state = reduceChatTurn(state, {
      kind: 'result',
      actionId: '0:0',
      name: 'orchestrate',
      ok: false,
      data: 'échec : phase clean'
    })
    state = reduceChatTurn(state, commande({ task: '/clean' }))
    const actions = state.parts.filter((part) => part.kind === 'action')
    expect(actions).toHaveLength(1)
    expect(actions[0]).toMatchObject({ ok: false, data: 'échec : phase clean' })
  })

  it('deux actions d’identifiants DIFFERENTS restent deux blocs', () => {
    let state = reduceChatTurn(createChatTurn('t1'), commande({ task: '/clean' }))
    state = reduceChatTurn(state, {
      kind: 'command',
      actionId: '1:0',
      name: 'orchestrate',
      args: { task: '/clean' }
    })
    expect(state.parts.filter((part) => part.kind === 'action')).toHaveLength(2)
  })
})
