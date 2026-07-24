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
    const staleDirectiveCleanup = main.indexOf('pendingDirectives.delete(conversationId)', turnCleanup)

    expect(drain).toMatch(
      /pendingDirectives\.delete\(conversationId\)[\s\S]*?return queued/
    )
    expect(activeTurnGuard).toBeGreaterThanOrEqual(0)
    expect(pendingDirectiveWrite).toBeGreaterThan(activeTurnGuard)
    expect(turnCleanup).toBeGreaterThanOrEqual(0)
    expect(staleDirectiveCleanup).toBeGreaterThan(turnCleanup)
  })
})
