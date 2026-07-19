import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { appendConvActivity, extractScreenshotEvidence, loadConvActivity } from './conv-activity'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('conversation activity', () => {
  it('extracts and deduplicates locally cited screenshot paths', () => {
    expect(
      extractScreenshotEvidence('Vu C:\\Audit\\proof.png puis C:\\Audit\\proof.png et D:/shot.webp')
    ).toEqual(['C:\\Audit\\proof.png', 'D:/shot.webp'])
  })

  it('preserves the exact configuration change while capping ordinary excerpts', () => {
    const root = mkdtempSync(join(tmpdir(), 'autowin-activity-'))
    roots.push(root)
    const longText = 'x'.repeat(900)

    appendConvActivity('conv-1', { kind: 'configuration-change', label: 'config', text: longText }, root)
    appendConvActivity('conv-1', { kind: 'chat', label: 'chat', text: longText }, root)

    const entries = loadConvActivity('conv-1', root)
    expect(entries[0]?.text).toBe(longText)
    expect(entries[1]?.text).toHaveLength(600)
    expect(readFileSync(join(root, 'conv-1.jsonl'), 'utf8')).toContain(longText)
  })
})
