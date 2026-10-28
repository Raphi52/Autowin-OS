import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { ConversationStore } from '../store/conversations'
import { createRunPilotChat, type RunPilotChatDeps } from './run-pilot-chat'

/**
 * FIN DE TOUR : UNE ORIENTATION DÉJÀ REMISE N'EST PAS ORPHELINE (conv-1241, 2026-10-28).
 *
 * Depuis c1736619, le contrôle lancé avant chaque outil du CLI remet au modèle une orientation
 * en plein appel (conv-1240, tour 2e218711-cf9d-4a92-b161-b7840f791264, saisie ts 1793225455947).
 * Elle reste pourtant dans la file en mémoire tant que la boucle ne l'a pas relue. Si le tour
 * s'arrête avant (Stop, erreur), le `finally` la rendait à l'écran : renvoyée comme un tour de plus,
 * alors que le modèle l'avait déjà lue. Le `finally` passe donc la file par le journal (`rendue`).
 */
const solde = vi.hoisted(() => ({
  appels: [] as Array<{ fil: string; textes: string[]; par: string }>
}))
vi.mock('../orientations-en-cours-app', () => ({
  solderOrientationsDuFil: (fil: string, textes: string[], par: string) => {
    solde.appels.push({ fil, textes: [...textes], par })
    return textes.filter((t) => t !== 'déjà remise par le contrôle')
  }
}))
vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => [] },
  app: { getPath: () => '', isPackaged: false, getVersion: () => '0.0.0' }
}))
vi.mock('../renderer-emit', () => ({ emitToLiveWindows: () => {} }))

function souple(): never {
  const fn = (): unknown => souple()
  return new Proxy(fn, {
    get: (_cible, cle) => {
      if (cle === 'then') return undefined
      if (cle === Symbol.iterator) return () => [][Symbol.iterator]()
      if (cle === Symbol.toPrimitive) return () => ''
      return souple()
    },
    apply: () => souple()
  }) as never
}

const avecRepli = <T extends object>(propres: T): T =>
  new Proxy(propres, {
    get: (cible, cle) => (cle in cible ? cible[cle as keyof T] : souple())
  })

describe('fin de tour — orientations déjà remises par le contrôle', () => {
  it('ne rend à l’écran que celles que le modèle n’a jamais lues', async () => {
    let t = 1000
    const store = new ConversationStore(() => t++)
    const fil = store.create({ title: 'B', provider: 'codex' })
    const pendingDirectives = new Map<string, string[]>()
    const pilot = {
      chat: vi.fn(async (_messages: unknown, surEvenement: (e: unknown) => void) => {
        // Deux orientations arrivent pendant l'appel ; le contrôle a remis la première.
        pendingDirectives.set(fil.id, ['déjà remise par le contrôle', 'jamais lue'])
        surEvenement({ kind: 'done', text: 'fini' })
        return { text: 'fini' }
      })
    }
    const os = avecRepli({
      waitUntilReady: async () => {},
      roles: { getBinding: () => ({ provider: 'codex', model: 'modele-test' }) },
      conversations: store,
      executionSupervisor: { currentSignal: () => undefined },
      runChatTurn: async (_contenu: string, _signal: AbortSignal, lancer: () => unknown) => lancer()
    })
    const broadcast = vi.fn()
    const deps = avecRepli({
      os,
      pilot,
      pendingDirectives,
      turnJournalRoot: mkdtempSync(join(tmpdir(), 'autowin-orient-remises-')),
      isolatedTestInstance: false,
      broadcast,
      drainPendingDirectives: () => [],
      askModelQuestion: vi.fn(),
      notifyWatchdogWorkflowIncident: vi.fn(),
      watchdogEngine: () => undefined
    }) as unknown as RunPilotChatDeps

    await createRunPilotChat(deps)(undefined, [{ role: 'user', content: 'go' }], fil.id)

    expect(solde.appels).toEqual([
      { fil: fil.id, textes: ['déjà remise par le contrôle', 'jamais lue'], par: 'rendue' }
    ])
    const orphelines = broadcast.mock.calls
      .map(([e]) => e as { type: string; textes?: string[] })
      .filter((e) => e.type === 'directives-orphelines')
    expect(orphelines).toEqual([
      { type: 'directives-orphelines', convId: fil.id, textes: ['jamais lue'] }
    ])
    expect(pendingDirectives.has(fil.id)).toBe(false)
  })
})
