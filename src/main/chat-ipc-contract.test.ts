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
})
