import { describe, expect, it } from 'vitest'
import { mergeActivityEntries } from './activity-pane-model'

describe('fusion activite globale et conversation', () => {
  it('deduplique la projection du meme changement', () => {
    const local = { ts: '2026-07-19T10:00:00.010Z', kind: 'configuration-change', label: 'Prompt', text: '{"x":1}' }
    const global = { ...local, ts: '2026-07-19T10:00:00.000Z' }
    expect(mergeActivityEntries([local], [global])).toHaveLength(1)
  })
})
