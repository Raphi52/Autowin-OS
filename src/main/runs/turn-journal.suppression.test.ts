import { mkdtempSync, existsSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { removeConversationTurnJournals } from './turn-journal'

describe('removeConversationTurnJournals', () => {
  it('emporte le dossier de la conversation et laisse les autres', () => {
    const root = mkdtempSync(join(tmpdir(), 'tj-'))
    for (const id of ['conv-1', 'conv-2']) {
      mkdirSync(join(root, id), { recursive: true })
      writeFileSync(join(root, id, 'turn-a.jsonl'), '{}\n')
    }

    expect(removeConversationTurnJournals(root, 'conv-1')).toBe(true)
    expect(existsSync(join(root, 'conv-1'))).toBe(false)
    expect(existsSync(join(root, 'conv-2', 'turn-a.jsonl'))).toBe(true)
    expect(removeConversationTurnJournals(root, 'conv-absente')).toBe(false)
  })
})
