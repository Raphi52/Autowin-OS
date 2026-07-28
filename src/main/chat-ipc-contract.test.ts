import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const LEGACY_CHAT_MARKERS = [
  "ipcMain.handle('chat:send'",
  "ipcRenderer.invoke('chat:send'",
  "ipcRenderer.on('chat:delta'",
  'guardMessages',
  'listProviders',
  'chat:providers',
  'router:delete-credential'
] as const

function findLegacyChatMarkers(sources: Record<string, string>): string[] {
  return LEGACY_CHAT_MARKERS.filter((marker) =>
    Object.values(sources).some((source) => source.includes(marker))
  )
}

function readChatContractSources(): Record<string, string> {
  return {
    main: readFileSync(new URL('./index.ts', import.meta.url), 'utf8'),
    preload: readFileSync(new URL('../preload/index.ts', import.meta.url), 'utf8'),
    preloadTypes: readFileSync(new URL('../preload/index.d.ts', import.meta.url), 'utf8')
  }
}

describe('renderer chat IPC contract', () => {
  it('detects the legacy direct-chat discriminant', () => {
    expect(
      findLegacyChatMarkers({ fixture: "ipcMain.handle('chat:send', () => undefined)" })
    ).toEqual(["ipcMain.handle('chat:send'"])
  })

  it('keeps AgentPilot as the renderer chat path without legacy IPC surfaces', () => {
    const sources = readChatContractSources()

    expect(sources.preload).toContain('pilotChat: (')
    expect(sources.preload).toContain("ipcRenderer.invoke('os:pilotChat'")
    expect(sources.preloadTypes).toContain('pilotChat: (')
    expect(sources.main).toMatch(/ipcMain\.handle\(\s*'os:pilotChat'/)
    expect(findLegacyChatMarkers(sources)).toEqual([])
  })

  it('serves the cached model catalog immediately, then notifies the renderer after boot refresh', () => {
    const sources = readChatContractSources()
    const modelHandler = sources.main.slice(
      sources.main.indexOf("ipcMain.handle('os:models:list'"),
      sources.main.indexOf('// Page Routeur')
    )
    const catalogSetup = sources.main.slice(
      sources.main.indexOf('const modelCatalog ='),
      sources.main.indexOf('const agentModelsReady =')
    )

    expect(modelHandler).toContain('serveModelCatalog(modelCatalog, force)')
    expect(sources.preload).toContain("ipcRenderer.invoke('os:models:list', force)")
    expect(catalogSetup).toContain("broadcast({ type: 'refresh', scope: 'roles' })")
  })

  it('exposes a guarded conversation-routing preflight before pilotChat', () => {
    const sources = readChatContractSources()

    expect(sources.preload).toContain('routeConversationMessage: (')
    expect(sources.preload).toMatch(/ipcRenderer\.invoke\(\s*'os:conversations:routeMessage'/)
    expect(sources.preloadTypes).toContain('routeConversationMessage: (')
    const handler = sources.main.slice(
      sources.main.indexOf("'os:conversations:routeMessage'"),
      sources.main.indexOf("'os:conversations:rename'")
    )
    expect(handler).toContain("assertTrustedRendererSender(event, 'Conversation route')")
    expect(handler).toContain('conversationRouteCoordinator.route(')
    expect(handler).toContain("kind: 'conversation-route'")
    expect(handler).toContain('inputTokens: decision.usage?.inputTokens')
    expect(handler).toContain("name: 'conversation_route'")
  })

  it('does not let a live directive outlive the chat turn that accepted it', () => {
    const { main } = readChatContractSources()
    const drain = main.slice(
      main.indexOf('function drainPendingDirectives'),
      main.indexOf('const questionWindows')
    )
    const handler = main.slice(main.indexOf("ipcMain.handle('os:pilotChat:inject'"))
    const activeTurnGuard = handler.indexOf('if (!activeChatTurns.get(conversationId))')
    const pendingDirectiveWrite = handler.indexOf('pendingDirectives.set(conversationId, queued)')
    const turnCleanup = main.indexOf('activeChatTurns.delete(conversationId, controller)')
    const staleDirectiveCleanup = main.indexOf(
      'pendingDirectives.delete(conversationId)',
      turnCleanup
    )

    expect(drain).toMatch(/pendingDirectives\.delete\(conversationId\)[\s\S]*?return queued/)
    expect(activeTurnGuard).toBeGreaterThanOrEqual(0)
    expect(pendingDirectiveWrite).toBeGreaterThan(activeTurnGuard)
    expect(turnCleanup).toBeGreaterThanOrEqual(0)
    expect(staleDirectiveCleanup).toBeGreaterThan(turnCleanup)
  })

  it('acknowledges a live directive immediately after enqueueing it', () => {
    const { main } = readChatContractSources()
    const drain = main.slice(
      main.indexOf('function drainPendingDirectives'),
      main.indexOf('const questionWindows')
    )
    const turnCleanup = main.slice(
      main.indexOf('activeChatTurns.delete(conversationId, controller)'),
      main.indexOf('resolveCompletion()')
    )
    const handler = main.slice(main.indexOf("ipcMain.handle('os:pilotChat:inject'"))

    expect(drain).not.toContain('.resolve(')
    expect(turnCleanup).not.toContain('.resolve(')
    expect(handler).toMatch(
      /pendingDirectives\.set\(conversationId, queued\)[\s\S]*?return \{ ok: true \}/
    )
    expect(handler).not.toContain('return new Promise')
  })

  it('propage l’autorité de création et rafraîchit la liste des conversations', () => {
    const sources = readChatContractSources()

    expect(sources.preload).toContain("authorityMode?: 'plan' | 'ask' | 'auto'")
    expect(sources.preloadTypes).toContain("authorityMode?: 'plan' | 'ask' | 'auto'")
    expect(sources.main).toMatch(
      /'os:conversations:create'[\s\S]*?os\.conversations\.create\(p\)[\s\S]*?scope: 'conversations'/
    )
    expect(sources.main).toMatch(
      /'os:conversations:remove'[\s\S]*?os\.conversations\.remove\(id\)[\s\S]*?scope: 'conversations'/
    )
    expect(sources.main).toMatch(
      /activeChatTurns\.delete\(conversationId, controller\)[\s\S]*?scope: 'conversations'/
    )
  })
})
