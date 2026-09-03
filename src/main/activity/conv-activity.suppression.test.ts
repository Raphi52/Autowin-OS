import { describe, expect, it } from 'vitest'
import { mkdtempSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { appendConvActivity, loadConvActivity, removeConvActivity } from './conv-activity'

describe('removeConvActivity', () => {
  it('supprime le journal de la conversation nommée et laisse les autres intacts', () => {
    const root = mkdtempSync(join(tmpdir(), 'conv-activity-suppr-'))
    appendConvActivity('conv-1', { kind: 'tool', label: 'a' }, root)
    appendConvActivity('conv-2', { kind: 'tool', label: 'b' }, root)

    expect(removeConvActivity('conv-1', root)).toBe(true)
    expect(existsSync(join(root, 'conv-1.jsonl'))).toBe(false)
    expect(loadConvActivity('conv-1', root)).toEqual([])
    expect(loadConvActivity('conv-2', root)).toHaveLength(1)
    expect(removeConvActivity('conv-absente', root)).toBe(false)
  })
})
