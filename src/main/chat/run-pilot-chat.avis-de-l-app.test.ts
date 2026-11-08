import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { ConversationStore } from '../store/conversations'
import { createRunPilotChat, type RunPilotChatDeps } from './run-pilot-chat'

/**
 * L'AVIS DE L'APP EST MARQUÉ DANS L'HISTORIQUE DU TOUR (2026-11-06).
 *
 * La carte « GIT : rien publié » posée sous une réponse a été lue comme le dernier message de
 * l'agent par la ligne compréhension (`deux-lectures.ts`). Le renderer ne transmet pas `turnId` :
 * seul le store sait qu'un message de l'agent sans tour est un avis. Ce test passe par le vrai store
 * et la vraie préparation du tour, et lit l'historique remis au pilote.
 */
vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => [] },
  app: { getPath: () => '', isPackaged: false, getVersion: () => '0.0.0' }
}))
vi.mock('../app/renderer-emit', () => ({ emitToLiveWindows: () => {} }))

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

const CARTE_GIT =
  '```html-render\n<div class="aw-kicker">GIT : rien publié</div>\n<div><b>Publication auto arrêtée</b></div>\n```'
const REPONSE = 'Oui. Le plus sérieux, c’est Google Gemini, gratuit avec quota.'

describe('historique du tour — avis de l’app marqués', () => {
  it('la carte Git porte avisDeLApp, la réponse du tour non', async () => {
    let t = 1000
    const store = new ConversationStore(() => t++)
    const fil = store.create({ title: 'voix', provider: 'codex' })
    store.beginTurn(fil.id, { content: 'ya des concurrents gratuits?' }, { turnId: 'tour-1' })
    store.append(fil.id, { role: 'assistant', content: CARTE_GIT })
    let historique: Array<Record<string, unknown>> = []
    const pilot = {
      chat: vi.fn(async (messages: unknown, surEvenement: (e: unknown) => void) => {
        historique = messages as Array<Record<string, unknown>>
        surEvenement({ kind: 'done', text: 'fini' })
        return { text: 'fini' }
      })
    }
    const os = avecRepli({
      waitUntilReady: async () => {},
      roles: { bindingDesPetitesTaches: () => ({ provider: 'claude', model: 'claude-haiku-5-5' }), routageChatLectureSeuleActif: () => false, getBinding: () => ({ provider: 'codex', model: 'modele-test' }) },
      conversations: store,
      executionSupervisor: { currentSignal: () => undefined },
      runChatTurn: async (_contenu: string, _signal: AbortSignal, lancer: () => unknown) => lancer()
    })
    const deps = avecRepli({
      os,
      pilot,
      pendingDirectives: new Map<string, string[]>(),
      turnJournalRoot: mkdtempSync(join(tmpdir(), 'autowin-avis-app-')),
      isolatedTestInstance: false,
      broadcast: vi.fn(),
      drainPendingDirectives: () => [],
      askModelQuestion: vi.fn(),
      notifyWatchdogWorkflowIncident: vi.fn(),
      watchdogEngine: () => undefined
    }) as unknown as RunPilotChatDeps

    await createRunPilotChat(deps)(
      undefined,
      [
        { role: 'user', content: 'ya des concurrents gratuits?' },
        { role: 'assistant', content: REPONSE },
        { role: 'assistant', content: CARTE_GIT },
        { role: 'user', content: 'ya des concurrents gratuits?' }
      ],
      fil.id
    )

    const carte = historique.find((m) => m.content === CARTE_GIT)
    const reponse = historique.find((m) => m.content === REPONSE)
    expect(carte?.avisDeLApp).toBe(true)
    expect(reponse).toBeDefined()
    expect(reponse?.avisDeLApp).toBeUndefined()
  })
})
