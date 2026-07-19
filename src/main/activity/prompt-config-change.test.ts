import { describe, expect, it } from 'vitest'
import { promptConfigChange } from './prompt-config-change'

describe('prompt configuration change', () => {
  it('conserve le diff exact et son moment d’activation', () => {
    const before = [
      { id: 'file', label: 'file', description: '', enabled: true, mutable: true },
      { id: 'web', label: 'web', description: '', enabled: false, mutable: true }
    ]
    const after = before.map((item) => ({ ...item, enabled: item.id === 'web' }))
    expect(promptConfigChange('tools', before, after)).toEqual({
      kind: 'tools',
      actor: 'human-ui',
      before: ['file'],
      after: ['web'],
      enabled: ['web'],
      disabled: ['file'],
      activation: 'next-session'
    })
  })
})
