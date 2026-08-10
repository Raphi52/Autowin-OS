import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ConversationStore } from './conversations'
import { loadConversations, saveConversations } from './conversations-disk'

describe('filiation des conversations Auto-Kaizen', () => {
  it('survit à une sauvegarde et un redémarrage du store', () => {
    const root = mkdtempSync(join(tmpdir(), 'autowin-auto-kaizen-conversation-'))
    const path = join(root, 'conversations.json')
    try {
      const store = new ConversationStore(() => 42)
      const created = store.create({
        title: 'Auto-Kaizen — erreur provider',
        category: 'codex',
        provider: 'codex',
        autoKaizen: {
          incidentId: 'ak-1',
          sourceConversationId: 'conv-source',
          role: 'analysis',
          rootIncidentId: 'ak-1',
          depth: 0
        }
      })
      saveConversations(store.list(), path)

      const reloaded = new ConversationStore()
      reloaded.hydrate(loadConversations(path))

      expect(reloaded.get(created.id)?.autoKaizen).toEqual({
        incidentId: 'ak-1',
        sourceConversationId: 'conv-source',
        role: 'analysis',
        rootIncidentId: 'ak-1',
        depth: 0
      })
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
