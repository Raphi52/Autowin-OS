import { describe, expect, it, vi } from 'vitest'
import type { OutcomeCurationV1 } from '../shared/run-learning'
import { compensateOutcomeCuration } from './outcome-learning-curation'

const base: OutcomeCurationV1 = {
  schema: 'autowin.learning/v1',
  eventId: 'curation:1',
  createdAt: '2026-08-11T00:00:00.000Z',
  action: 'supersede',
  knowledgeId: 'knowledge/a.md',
  targetId: 'knowledge/b.md',
  rollbackId: '.trash/a.md',
  actor: 'user'
}

describe('compensation de curation', () => {
  it('annule une supersession sans retirer la fiche de remplacement préexistante', () => {
    const restore = vi.fn(() => ({
      ok: true as const,
      from: '.trash/a.md',
      to: 'knowledge/a-2.md'
    }))
    const retract = vi.fn()

    const compensation = compensateOutcomeCuration(base, { restore, retract })

    expect(restore).toHaveBeenCalledWith('.trash/a.md')
    expect(retract).not.toHaveBeenCalled()
    expect(compensation).toMatchObject({
      action: 'restore',
      knowledgeId: 'knowledge/a.md',
      targetId: 'knowledge/a-2.md',
      previousEventId: 'curation:1'
    })
  })
})
