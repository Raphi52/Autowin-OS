import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { appendConvActivity, loadConvActivity } from './conv-activity'

/**
 * Le journal d'activite disait « combien » et « quand », jamais « pour quel tour » ni « quelle
 * phase ». Le rapport /rendement devait donc rattacher les depenses au message utilisateur par
 * l'heure — une approximation. Ces deux champs rendent le rattachement EXACT quand il est connu.
 */
describe('journal de conversation — tour et phase', () => {
  it('persiste le tour et la phase quand ils sont fournis', () => {
    const root = mkdtempSync(join(tmpdir(), 'activity-'))
    appendConvActivity(
      'conv-71',
      { kind: 'exec', label: 'subagent', turnId: 'turn-7', phase: 'build' },
      root
    )
    const brut = JSON.parse(readFileSync(join(root, 'conv-71.jsonl'), 'utf8').trim())
    expect(brut.turnId).toBe('turn-7')
    expect(brut.phase).toBe('build')
    expect(loadConvActivity('conv-71', root)[0]).toMatchObject({ turnId: 'turn-7', phase: 'build' })
  })

  it('persiste le run d orchestration quand il est fourni', () => {
    const root = mkdtempSync(join(tmpdir(), 'activity-'))
    appendConvActivity(
      'conv-153',
      { kind: 'exec', label: 'subagent', runId: 'run-abc123', phase: 'build', costUsd: 0.42 },
      root
    )
    const brut = JSON.parse(readFileSync(join(root, 'conv-153.jsonl'), 'utf8').trim())
    expect(brut.runId).toBe('run-abc123')
    expect(brut.phase).toBe('build')
    expect(brut.costUsd).toBe(0.42)
    expect(loadConvActivity('conv-153', root)[0]).toMatchObject({
      runId: 'run-abc123',
      phase: 'build',
      costUsd: 0.42
    })
  })

  it('n invente rien quand ils sont inconnus', () => {
    const root = mkdtempSync(join(tmpdir(), 'activity-'))
    appendConvActivity('conv-1', { kind: 'chat', label: 'chat' }, root)
    const brut = JSON.parse(readFileSync(join(root, 'conv-1.jsonl'), 'utf8').trim())
    expect(brut.turnId).toBeUndefined()
    expect(brut.phase).toBeUndefined()
    expect(brut.runId).toBeUndefined()
  })
})
