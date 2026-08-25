import { describe, expect, it } from 'vitest'
import { reduceChatTurn, type ChatTurnState } from './chat-turn'

/**
 * SIGNAL DE VIE D'UNE ACTION EN COURS.
 *
 * DÉFAUT VÉCU le 2026-08-25 (conv-1400). Un tour lance `verify`, qui rejoue la suite unitaire. Le
 * fil affiche « 1 action en cours » et PLUS RIEN pendant dix minutes, jusqu'au plafond. Rien ne
 * distingue, à l'œil, une suite qui travaille d'une suite bloquée — ni d'une app plantée. La
 * question réelle de l'utilisateur, ce jour-là, était « je crois que c'est bon mais il le sait pas
 * lui-même » : il ne pouvait pas savoir, parce que rien ne remontait.
 *
 * Ce que ces tests exigent : une action non résolue peut porter une ligne d'avancement, remplacée à
 * chaque battement — et cette ligne ne doit JAMAIS survivre au verdict ni ressusciter une action
 * déjà close.
 */
function enCours(): ChatTurnState {
  return reduceChatTurn(
    { turnId: 't1', status: 'streaming', parts: [] },
    { kind: 'command', actionId: '0:0', name: 'verify' }
  )
}

describe('reduceChatTurn — avancement d’une action en cours', () => {
  it('pose la ligne d’avancement sur l’action non résolue', () => {
    const etat = reduceChatTurn(enCours(), {
      kind: 'progress',
      actionId: '0:0',
      text: '412 tests · 3 min 20 s'
    })

    const action = etat.parts.find((p) => p.kind === 'action')
    expect(action).toMatchObject({ name: 'verify', progress: '412 tests · 3 min 20 s' })
    // L'action reste EN COURS : un signe de vie n'est pas un verdict.
    expect(action && 'ok' in action ? action.ok : undefined).toBeUndefined()
  })

  it('chaque battement REMPLACE le précédent, il ne s’accumule pas', () => {
    let etat = enCours()
    etat = reduceChatTurn(etat, { kind: 'progress', actionId: '0:0', text: 'premier' })
    etat = reduceChatTurn(etat, { kind: 'progress', actionId: '0:0', text: 'second' })

    const action = etat.parts.find((p) => p.kind === 'action')
    expect(action).toMatchObject({ progress: 'second' })
    expect(etat.parts.filter((p) => p.kind === 'action')).toHaveLength(1)
  })

  it('le verdict EFFACE le signe de vie — sinon le fil garde un compteur mort sous un résultat', () => {
    let etat = enCours()
    etat = reduceChatTurn(etat, { kind: 'progress', actionId: '0:0', text: '412 tests' })
    etat = reduceChatTurn(etat, { kind: 'result', actionId: '0:0', name: 'verify', ok: true })

    const action = etat.parts.find((p) => p.kind === 'action')
    expect(action).toMatchObject({ ok: true })
    expect(action && 'progress' in action ? action.progress : undefined).toBeUndefined()
  })

  it('un avancement en retard ne RESSUSCITE pas une action déjà close', () => {
    let etat = enCours()
    etat = reduceChatTurn(etat, { kind: 'result', actionId: '0:0', name: 'verify', ok: false })
    etat = reduceChatTurn(etat, { kind: 'progress', actionId: '0:0', text: 'trop tard' })

    const action = etat.parts.find((p) => p.kind === 'action')
    expect(action).toMatchObject({ ok: false })
    expect(action && 'progress' in action ? action.progress : undefined).toBeUndefined()
  })

  it('un avancement pour un actionId inconnu ne crée rien', () => {
    const etat = reduceChatTurn(enCours(), {
      kind: 'progress',
      actionId: 'fantome',
      text: 'personne'
    })

    expect(etat.parts.filter((p) => p.kind === 'action')).toHaveLength(1)
    const action = etat.parts.find((p) => p.kind === 'action')
    expect(action && 'progress' in action ? action.progress : undefined).toBeUndefined()
  })
})
