import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { WebContents } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import type { ImportedModel } from '../modeles/models'
import type { RoleBinding } from '../profil/roles'
import { ConversationStore } from '../store/conversations'
import { createRunPilotChat, type RunPilotChatDeps } from './run-pilot-chat'

/**
 * « ULTRATHINK » DANS LE MESSAGE MONTE LA RÉFLEXION DE CE TOUR SEUL.
 *
 * Le vrai tour de chat tourne sur le vrai stockage, avec un faux modèle qui note le réglage reçu :
 * c'est ce réglage qui part au moteur, et celui que le fil enregistre pour le tour.
 * Entrée qui doit faire échouer ce test : un tour qui ignore le mot-clé, qui garde la réflexion
 * montée au message suivant, ou qui envoie une question « ultrathink » au modèle des petites tâches.
 */
vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => [] },
  app: { getPath: () => '', isPackaged: false, getVersion: () => '0.0.0' }
}))
vi.mock('../app/renderer-emit', () => ({ emitToLiveWindows: () => undefined }))

/** Accepte tout appel : les dépendances que ce test n'observe pas (traces, coûts, tâches). */
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

const FENETRE = {} as WebContents
const CHAT: RoleBinding = { provider: 'claude', model: 'opus-test', reasoningEffort: 'medium' }
const PETITES_TACHES: RoleBinding = { provider: 'claude', model: 'claude-haiku-5-5' }
const CATALOGUE = [
  {
    id: 'claude/opus-test',
    provider: 'claude',
    model: 'opus-test',
    label: 'Opus test',
    reasoningEfforts: ['low', 'medium', 'high', 'xhigh', 'max'],
    defaultReasoningEffort: 'medium'
  }
] as unknown as ImportedModel[]

/** Position du réglage du tour dans l'appel au pilote (`turnPilot.chat`, run-pilot-chat.ts). */
const RANG_DU_REGLAGE = 9

function banc(): {
  store: ConversationStore
  filId: string
  lancer: ReturnType<typeof createRunPilotChat>
  reglagesRecus: () => RoleBinding[]
} {
  const store = new ConversationStore(() => Date.parse('2026-11-10T10:00:00+01:00'))
  const fil = store.create({ title: 'U', provider: 'claude' })
  const chat = vi.fn(async (..._args: unknown[]) => ({ text: 'fait' }))
  const os = avecRepli({
    waitUntilReady: async () => {},
    roles: {
      bindingDesPetitesTaches: () => PETITES_TACHES,
      // Routage des questions ALLUMÉ : sans le mot-clé, une question part sur les petites tâches.
      routageChatLectureSeuleActif: () => true,
      getBinding: () => CHAT,
      getCatalog: () => CATALOGUE
    },
    conversations: store,
    executionSupervisor: { currentSignal: () => undefined },
    runChatTurn: async (_contenu: string, _signal: AbortSignal, lancer: () => unknown) => lancer()
  })
  const deps = avecRepli({
    os,
    pilot: { chat },
    pendingDirectives: new Map<string, string[]>(),
    turnJournalRoot: mkdtempSync(join(tmpdir(), 'autowin-ultrathink-')),
    isolatedTestInstance: false,
    broadcast: vi.fn(),
    drainPendingDirectives: () => [],
    notifyWatchdogWorkflowIncident: vi.fn(),
    watchdogEngine: () => undefined
  }) as unknown as RunPilotChatDeps
  return {
    store,
    filId: fil.id,
    lancer: createRunPilotChat(deps),
    reglagesRecus: () => chat.mock.calls.map((appel) => appel[RANG_DU_REGLAGE] as RoleBinding)
  }
}

const message = (content: string): [{ role: 'user'; content: string }] => [
  { role: 'user', content }
]

describe('ultrathink dans un tour de chat', () => {
  it('le tour part à xhigh, et le fil l’enregistre', async () => {
    const { store, filId, lancer, reglagesRecus } = banc()
    await lancer(FENETRE, message('ultrathink corrige a.ts'), filId)
    expect(reglagesRecus()).toEqual([{ ...CHAT, reasoningEffort: 'xhigh' }])
    expect(store.messagesOf(filId).at(-1)?.runtime?.reasoningEffort).toBe('xhigh')
  })

  it('jumeau : le même message sans le mot-clé garde le réglage du chat', async () => {
    const { store, filId, lancer, reglagesRecus } = banc()
    await lancer(FENETRE, message('corrige a.ts'), filId)
    expect(reglagesRecus()).toEqual([CHAT])
    expect(store.messagesOf(filId).at(-1)?.runtime?.reasoningEffort).toBe('medium')
  })

  it('le message suivant, sans le mot-clé, repart au réglage du chat', async () => {
    const { filId, lancer, reglagesRecus } = banc()
    await lancer(FENETRE, message('ultrathink corrige a.ts'), filId)
    await lancer(
      FENETRE,
      [
        ...message('ultrathink corrige a.ts'),
        { role: 'assistant', content: 'fait' },
        { role: 'user', content: 'corrige aussi b.ts' }
      ],
      filId
    )
    expect(reglagesRecus().map((reglage) => reglage.reasoningEffort)).toEqual(['xhigh', 'medium'])
  })

  it('une question « ultrathink » garde le modèle du chat au lieu des petites tâches', async () => {
    const { filId, lancer, reglagesRecus } = banc()
    await lancer(FENETRE, message('pourquoi ce test échoue ? ultrathink'), filId)
    expect(reglagesRecus()).toEqual([{ ...CHAT, reasoningEffort: 'xhigh' }])
  })

  it('jumeau : la même question sans le mot-clé part sur les petites tâches', async () => {
    const { filId, lancer, reglagesRecus } = banc()
    await lancer(FENETRE, message('pourquoi ce test échoue ?'), filId)
    expect(reglagesRecus()).toEqual([PETITES_TACHES])
  })
})
