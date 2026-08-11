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

function extractIpcHandler(source: string, channel: string): string {
  const channelIndex = source.indexOf(`'${channel}'`)
  if (channelIndex < 0) throw new Error(`IPC handler absent: ${channel}`)
  const handlerStart = source.lastIndexOf('ipcMain.handle', channelIndex)
  const nextHandler = source.indexOf('ipcMain.handle', channelIndex + channel.length + 2)
  return source.slice(handlerStart, nextHandler < 0 ? undefined : nextHandler)
}

describe('renderer chat IPC contract', () => {
  it('keeps conversation lists lightweight and loads one history on demand', () => {
    const sources = readChatContractSources()
    expect(sources.main).toMatch(/'os:conversations'[\s\S]*?listSummaries\(\)/)
    expect(sources.main).toMatch(/'os:conversation'[\s\S]*?conversations\.get/)
    expect(sources.preload).toMatch(/conversation:\s*\(id: string\)[\s\S]*?'os:conversation'/)
  })

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

  it('persiste les reglements tardifs du superviseur sur le chemin de chat renderer', () => {
    const { main } = readChatContractSources()
    const pilotChat = main.slice(
      main.indexOf('const runPilotChat = async'),
      main.indexOf("ipcMain.handle('os:pilotChat'")
    )

    expect(main).toContain("from './activity/chat-usage-settlement'")
    expect(pilotChat).toContain('persistChatUsageSettlement({')
    expect(pilotChat).toMatch(/os\.runChatTurn\([\s\S]*?onSupervisedUsageSettlement/)
    expect(pilotChat).toMatch(
      /pilotEvent\.kind === 'prompt-call'[\s\S]{0,900}executionSupervisor\.currentSnapshot\(\)[\s\S]{0,300}persistSupervisedChatUsage/
    )
    expect(pilotChat).toContain('os.executionSupervisor.currentSignal()')
    expect(pilotChat).toContain(
      'const watchdogReadOnlyProfile = policy?.readOnly && policy.background'
    )
    expect(pilotChat).toContain("systemProfile: 'watchdog-read-only' as const")
    expect(pilotChat).toContain("broadcast({ type: 'refresh', scope: 'workflows' })")
  })

  it('journalise les pieces jointes de commande sans les exposer au renderer', () => {
    const { main } = readChatContractSources()
    const pilotChat = main.slice(
      main.indexOf('const runPilotChat = async'),
      main.indexOf("ipcMain.handle('os:pilotChat'")
    )

    expect(pilotChat).toContain('guardAttachments(pilotEvent.attachments)')
    expect(pilotChat.match(/delete\s+\w+\.attachments/g)).toHaveLength(2)
  })

  it('conserve le checkpoint et persiste le règlement tardif sur os:orchestrate', () => {
    const { main } = readChatContractSources()
    const directRun = main.slice(
      main.indexOf("ipcMain.handle('os:orchestrate'"),
      main.indexOf("ipcMain.handle('os:behaviourComposition'")
    )
    const runTaskAt = directRun.indexOf('os.runTask(')
    const lifecycleAt = directRun.indexOf('(lifecycle) =>')
    const forgetAt = directRun.indexOf('os.forgetResumableOrchestration')

    expect(runTaskAt).toBeGreaterThanOrEqual(0)
    expect(lifecycleAt).toBeGreaterThan(runTaskAt)
    expect(forgetAt).toBeGreaterThan(lifecycleAt)
    expect(directRun).toContain('reconcileLateRunLifecycle(')
    expect(directRun).toContain("broadcast({ type: 'orchestrate-usage', convId: conversationId })")
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

    expect(modelHandler).toContain('if (!force) return agentModels')
    expect(catalogSetup).toContain('applyFabricSummaries(')
    expect(modelHandler).toContain('const refresh = modelCatalog.refresh(true)')
    expect(modelHandler).toContain('os.setTaskReadiness(')
    expect(sources.preload).toContain("ipcRenderer.invoke('os:models:list', force)")
    expect(catalogSetup).toContain("broadcast({ type: 'refresh', scope: 'roles' })")
  })

  it('transporte le refus du workflow actif jusqu’au chat au lieu de le laisser dans la console', () => {
    const { main, preload, preloadTypes } = readChatContractSources()
    const applyActive = main.slice(
      main.indexOf('const appliquerWorkflowActif'),
      main.indexOf("ipcMain.handle('os:workflowProfiles:get'")
    )

    expect(applyActive).toMatch(
      /broadcast\(\{[\s\S]*?type: 'toast',[\s\S]*?text: refus\.message,[\s\S]*?noticeId:/
    )
    expect(main).toContain("ipcMain.handle('os:workflowProfiles:notice'")
    expect(main).toContain("ipcMain.handle('os:workflowProfiles:acknowledgeNotice'")
    expect(preload).toContain("ipcRenderer.invoke('os:workflowProfiles:notice')")
    expect(preloadTypes).toContain('workflowProfileNotice')
    expect(preloadTypes).toContain('workflowProfileAcknowledgeNotice')
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
    const handler = extractIpcHandler(main, 'os:pilotChat:inject')
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
    const handler = extractIpcHandler(main, 'os:pilotChat:inject')

    expect(drain).not.toContain('.resolve(')
    expect(turnCleanup).not.toContain('.resolve(')
    expect(handler).toMatch(
      /pendingDirectives\.set\(conversationId, queued\)[\s\S]*?return \{ ok: true \}/
    )
    expect(handler).not.toContain('return new Promise')
  })

  it('crée sans mode d’autorité et rafraîchit la liste des conversations', () => {
    const sources = readChatContractSources()

    expect(sources.preload).not.toContain('authorityMode')
    expect(sources.preloadTypes).not.toContain('authorityMode')
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
