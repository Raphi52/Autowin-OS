import { readFileSync } from 'node:fs'
import { sourceProcessPrincipal } from './source-process-principal.test-helpers'
import { describe, expect, it } from 'vitest'

describe('IPC des artefacts du chat', () => {
  it('n’accepte que des identités de conversation/tour/artefact et vérifie le renderer', () => {
    // Les canaux ont quitte `index.ts` pour `ipc/chat-artifacts.ts` le 2026-09-02 : on lit la ZONE
    // du process principal, et on borne par le canal SUIVANT quel qu'il soit -- un voisin nomme
    // demenage, la garde ne doit pas dependre de lui.
    const main = sourceProcessPrincipal()
    const start = main.indexOf("'os:chatArtifact:read'")
    const suivant = main.indexOf('ipcMain.handle(', start)
    const end = suivant < 0 ? main.length : suivant
    const handler = main.slice(start, end)

    expect(start).toBeGreaterThan(-1)
    expect(end).toBeGreaterThan(start)
    expect(handler).toContain("assertTrustedRendererSender(event, 'Chat artifact')")
    expect(handler).toContain("guardString(rawConversationId, 'conversationId')")
    expect(handler).toContain("guardString(rawTurnId, 'turnId')")
    expect(handler).toContain("guardString(rawArtifactId, 'artifactId')")
    expect(handler).not.toContain('rawPath')
    expect(handler).toContain('readConversationArtifact(')
    expect(handler).toContain('os.conversations.get(conversationId)')
    expect(handler).toContain('const artifactBudgetId = `${turnId}\\u0000${artifactId}`')
    expect(handler).toContain('chatArtifactPreviewBudget.remaining(scope, artifactBudgetId)')
    expect(handler).toContain('chatArtifactPreviewBudget.reserve(scope, artifactBudgetId')
  })

  it('expose uniquement le triplet d’identité dans le preload', () => {
    const preload = readFileSync(new URL('../preload/index.ts', import.meta.url), 'utf8')
    const start = preload.indexOf('readChatArtifact:')
    const end = preload.indexOf('revealChatArtifact:', start)
    const bridge = preload.slice(start, end)

    expect(bridge).toContain('conversationId: string')
    expect(bridge).toContain('turnId: string')
    expect(bridge).toContain('artifactId: string')
    expect(bridge).not.toContain('path: string')
  })
})
