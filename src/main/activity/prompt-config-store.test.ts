import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { appendPromptConfigActivity, loadPromptConfigActivity } from './prompt-config-store'

describe('journal global Prompt Load', () => {
  it('persiste et recharge sans conversation active', () => {
    const root = mkdtempSync(join(tmpdir(), 'autowin-config-'))
    appendPromptConfigActivity('Prompt Load · toolset browser', { disabled: ['browser'], activation: 'next-session' }, root)
    expect(loadPromptConfigActivity(root)[0].text).toContain('next-session')
  })
})
