/**
 * Supprimer un fil dont un RUN de développement tourne doit l'ARRÊTER, comme le bouton Stop
 * (conv-1060, 2026-10-22).
 *
 * Le défaut : `os:pilotChat:cancel` (Stop) coupe le run (`abortOrchestration`) ET le tour ; les deux
 * canaux de suppression ne coupaient que le tour. Or le run n'écoute QUE son propre interrupteur
 * (`commands.ts`, `runTask(…, abortController.signal)`), et le tour l'attend sans écouter le sien
 * (`agent-pilot.ts`, `execCommandTolerante`). Le run allait donc au bout, et la suppression attendait
 * sa fin : le fil restait affiché tant que le run tournait.
 *
 * Le modèle ci-dessous reproduit exactement cette dépendance : un tour dont la fin n'arrive QUE quand
 * le run est coupé. Une version fausse laisse la suppression en attente ; le test le voit au bout de
 * 300 ms au lieu de pendre.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { ConversationStore } from '../store/conversations'
import { ActiveChatTurns } from '../active-chat-turns'

const handlers = new Map<string, (...args: unknown[]) => unknown>()
vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: (...args: unknown[]) => unknown) => handlers.set(channel, fn)
  }
}))
vi.mock('../ipc-senders', () => ({ assertTrustedRendererSender: () => undefined }))
// Les satellites disque ne sont pas le sujet : rien ne doit être effacé hors du test.
vi.mock('../store/chat-artifact-store', () => ({ removeConversationArtifacts: () => undefined }))
vi.mock('../runs/turn-journal', () => ({ removeConversationTurnJournals: () => true }))
vi.mock('../activity/conv-activity', () => ({ removeConvActivity: () => undefined }))
vi.mock('../activity/prompt-observability', () => ({ deletePromptCalls: () => undefined }))

import { registerConversationsIpc } from './conversations'

const store = new ConversationStore(() => 1)
const tours = new ActiveChatTurns()
/** Les runs en vol, par fil : ce que tient `AppCommandBus.activeOrchestrations`. */
const runs = new Map<string, AbortController>()
const coupes: Array<{ id: string; motif: string }> = []

beforeAll(() => {
  registerConversationsIpc({
    os: { conversations: store } as never,
    activeChatTurns: tours,
    causalTrace: { deleteConversation: () => undefined } as never,
    turnJournalRoot: 'inutilise',
    broadcast: () => undefined,
    couperLeRun: (id: string, motif: string) => {
      coupes.push({ id, motif })
      const run = runs.get(id)
      run?.abort(motif)
      return Boolean(run)
    }
  } as never)
})

afterEach(() => {
  // Libère un tour resté pendu par une version fausse : le test suivant part propre.
  for (const run of runs.values()) run.abort('fin du test')
  runs.clear()
  coupes.length = 0
})

const appeler = (canal: string, ...args: unknown[]): Promise<unknown> => {
  const handler = handlers.get(canal)
  if (!handler) throw new Error(`canal absent : ${canal}`)
  return Promise.resolve(handler({}, ...args))
}

/** Un fil, son run en vol, et le tour de chat qui attend ce run sans écouter son propre arrêt. */
function filAvecRunEnCours(titre: string): {
  id: string
  run: AbortController
  tour: AbortController
} {
  const { id } = store.create({ title: titre, provider: 'claude' })
  const run = new AbortController()
  runs.set(id, run)
  const tour = new AbortController()
  const finDuTour = new Promise<void>((resolve) =>
    run.signal.addEventListener('abort', () => resolve(), { once: true })
  )
  tours.set(id, tour, finDuTour)
  return { id, run, tour }
}

const issueEn300ms = (suppression: Promise<unknown>): Promise<string> =>
  Promise.race([
    suppression.then(() => 'supprimée'),
    new Promise<string>((resolve) => setTimeout(() => resolve('toujours en attente'), 300))
  ])

describe('supprimer un fil arrête son run, comme le bouton Stop', () => {
  it('os:conversations:remove coupe le run ET le tour, puis supprime', async () => {
    const { id, run, tour } = filAvecRunEnCours('run en cours')

    expect(await issueEn300ms(appeler('os:conversations:remove', id))).toBe('supprimée')

    expect(run.signal.aborted).toBe(true)
    expect(run.signal.reason).toBe('conversation-deleted')
    expect(tour.signal.aborted).toBe(true)
    expect(store.get(id)).toBeUndefined()
    // Un arrêt voulu : la fin rouge du run coupé ne doit pas devenir un incident.
    expect(tours.wasDeliberatelyStopped(id)).toBe(true)
  })

  it('os:conversations:removeMany coupe le run de CHAQUE fil du lot, et seulement eux', async () => {
    const a = filAvecRunEnCours('lot a')
    const b = filAvecRunEnCours('lot b')
    const temoin = filAvecRunEnCours('hors du lot')

    expect(await issueEn300ms(appeler('os:conversations:removeMany', [a.id, b.id]))).toBe(
      'supprimée'
    )

    expect(a.run.signal.aborted && b.run.signal.aborted).toBe(true)
    expect(store.get(a.id) ?? store.get(b.id)).toBeUndefined()
    // Le fil non nommé garde son run et son tour.
    expect(temoin.run.signal.aborted).toBe(false)
    expect(temoin.tour.signal.aborted).toBe(false)
    expect(store.get(temoin.id)).toBeDefined()
  })

  it('un lot trop grand est refusé AVANT de couper quoi que ce soit', async () => {
    const { id, run } = filAvecRunEnCours('refus du lot')
    const tropGrand = [id, ...Array.from({ length: 200 }, (_, i) => `absente-${i}`)]

    await expect(appeler('os:conversations:removeMany', tropGrand)).rejects.toThrow(/trop grand/)

    expect(run.signal.aborted).toBe(false)
    expect(coupes).toEqual([])
    expect(store.get(id)).toBeDefined()
  })
})
