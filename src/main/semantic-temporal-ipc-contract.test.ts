import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('semantic temporal IPC contract', () => {
  it('expose une projection dérivée gardée sans écrire dans le Brain canonique', () => {
    const main = readFileSync(join(__dirname, 'index.ts'), 'utf8')
    const start = main.indexOf("ipcMain.handle('os:semanticTimeline'")
    const end = main.indexOf('ipcMain.handle(', start + 20)
    const handler = main.slice(start, end)
    const preload = readFileSync(join(__dirname, '../preload/index.ts'), 'utf8')

    expect(start).toBeGreaterThan(0)
    expect(handler).toContain("assertTrustedRendererSender(event, 'Semantic timeline')")
    expect(handler).toContain('causalTrace.readConversationBestEffort(conversationId)')
    expect(handler).toContain('brainRoot: amitelBrainRoot()')
    expect(preload).toContain("ipcRenderer.invoke('os:semanticTimeline', conversationId)")
  })
})
