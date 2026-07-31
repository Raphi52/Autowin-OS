import { describe, expect, it } from 'vitest'
import { ConversationStore } from '../store/conversations'
import { createOrchestrateTurnPersistence } from './orchestrate-turn-persistence'

/**
 * Le bouton « Reprendre » du fil ne peut relancer une tache que s'il connait sa CHAINE EXACTE : le
 * handler `os:orchestrate` retrouve l'acquis via `resumableOrchestrationForTask(task, conversationId)`
 * — la tache est la CLE de reprise. Le composant la lit dans `args.task` de l'action interrompue
 * (`interruptedTask`, ChatView.parts.tsx).
 *
 * DEFAUT CONSTATE le 2026-07-30 : les cartes d'etape n'emportaient que `{ agent, detail }`. La tache
 * n'etait ecrite QUE dans le message utilisateur du tour (via `begin`). Donc dans le scenario meme pour
 * lequel le bouton existe — app fermee en plein run, reouverte — l'action etait bien marquee
 * interrompue, mais `interruptedTask` rendait `undefined` et le bouton ne s'affichait JAMAIS.
 *
 * Le test qui couvrait le composant fabriquait `args: { task }` a la main : une forme que la
 * production ne produisait pas. Il restait donc vert alors que la fonctionnalite etait morte.
 */
const clock = (start = 1000): (() => number) => {
  let t = start
  return () => t++
}

function openedTurn(task: string): {
  store: ConversationStore
  conversationId: string
  turnId: string
} {
  const store = new ConversationStore(clock())
  const conv = store.create({ title: 'Reprise', category: 'native', provider: 'codex' })
  const turnId = 'turn-resume-1'
  const turn = createOrchestrateTurnPersistence({
    conversations: store,
    conversationId: conv.id,
    turnId,
    runtime: { provider: 'codex', model: 'gpt-test' }
  })
  turn.begin(task)
  turn.step({ step: 'exec', role: 'scout', provider: 'codex', model: 'gpt-test' })
  return { store, conversationId: conv.id, turnId }
}

describe('cartes d’étape — la tâche doit voyager avec l’action', () => {
  it('chaque carte `command` porte la TÂCHE, clé de reprise du bouton', () => {
    const task = 'Reprendre la migration des factures'
    const { store, conversationId, turnId } = openedTurn(task)

    const turn = store.get(conversationId)?.messages.find((m) => m.turnId === turnId)
    const commands = (turn?.parts ?? []).filter(
      (part): part is { kind: 'action'; name: string; args?: { task?: string } } =>
        part.kind === 'action'
    )
    expect(commands.length).toBeGreaterThan(0)
    // La tache est presente TELLE QUELLE : `resumableOrchestrationForTask` fait une correspondance sur
    // cette chaine, donc la moindre alteration (troncature, prefixe) casserait la reprise.
    expect(commands[0].args?.task).toBe(task)
  })

  it('l’action interrompue reste relançable : la tâche survit sans le message utilisateur', () => {
    // On ne s'appuie PAS sur le message utilisateur du tour : le composant ne recoit que les actions.
    // C'est precisement ce couplage manquant qui rendait le bouton invisible.
    const task = 'Auditer les paiements en double'
    const { store, conversationId, turnId } = openedTurn(task)

    const parts = store.get(conversationId)?.messages.find((m) => m.turnId === turnId)?.parts ?? []
    const actionsOnly = parts.filter((part) => part.kind === 'action') as Array<{
      args?: { task?: string }
    }>
    const found = actionsOnly.map((action) => action.args?.task).find((value) => Boolean(value))
    expect(found).toBe(task)
  })
})
