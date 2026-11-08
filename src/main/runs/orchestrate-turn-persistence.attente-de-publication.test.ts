import { describe, expect, it } from 'vitest'
import { ConversationStore } from '../store/conversations'
import { createOrchestrateTurnPersistence } from './orchestrate-turn-persistence'

/**
 * UN RUN REPRIS QUI ATTEND SEULEMENT SA PUBLICATION NE FAIT PAS ÉCHOUER LE TOUR.
 *
 * Au redémarrage, le run repris se clôt par `succeed`. Sa règle (`gateBlocked` ⇒ échec) marquait le
 * tour entier « failed » et la carte de l'action en échec sur un run VERT dont la publication attend
 * qu'une opération git de l'arbre principal finisse : la reprise automatique la publiera seule.
 * Le témoin (conflit de contenu) reste un échec : personne ne le lève à la place de l'utilisateur.
 */
const raisons = (code: string): string[] => [
  'intégration locale non terminée',
  `blocage d’intégration: ${code} — cause: L’index utilisateur a changé pendant la publication. — fichiers en cause: src/a.ts`
]

function tourReprisClosPar(code: string) {
  let t = 1000
  const store = new ConversationStore(() => t++)
  const id = store.create({ title: 'Reprise', provider: 'codex' }).id
  store.beginTurn(id, { content: 'regroupe les doublons' }, { turnId: 'turn-repris' })
  store.applyTurnEvent(id, 'turn-repris', {
    kind: 'command',
    actionId: 'origine',
    name: 'orchestrate',
    args: { task: 'regroupe les doublons' }
  })
  store.applyTurnEvent(id, 'turn-repris', { kind: 'interrupted' })
  const tour = createOrchestrateTurnPersistence({
    conversations: store,
    conversationId: id,
    turnId: 'turn-repris',
    resumeExisting: true
  })
  tour.begin('regroupe les doublons')
  tour.succeed({
    result: 'Regroupement fait, tests verts.',
    valid: false,
    gateBlocked: true,
    gateReasons: raisons(code)
  })
  const message = store.get(id)!.messages[1]
  const action = message.parts?.find((p) => p.kind === 'action' && p.actionId === 'origine') as
    { ok?: boolean } | undefined
  return { statut: message.status, ok: action?.ok }
}

describe('reprise d’un run vert qui attend la base', () => {
  it('le tour finit sans échec et l’action n’est pas marquée en échec', () => {
    expect(tourReprisClosPar('base-in-progress')).toEqual({ statut: 'completed', ok: true })
  })

  it('témoin : un conflit de contenu fait toujours échouer le tour', () => {
    expect(tourReprisClosPar('conflict')).toEqual({ statut: 'failed', ok: false })
  })
})
