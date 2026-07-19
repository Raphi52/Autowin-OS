import { describe, expect, it } from 'vitest'
import {
  detectPromptLoadPreset,
  promptLoadSummary,
  targetToolIds,
  type PromptLoadTool
} from './prompt-load-model'

const catalogue = [
  'web',
  'browser',
  'terminal',
  'file',
  'code_execution',
  'vision',
  'skills',
  'todo',
  'memory',
  'session_search',
  'clarify',
  'delegation',
  'cronjob'
]

function tools(enabled: string[]): PromptLoadTool[] {
  return catalogue.map((id) => ({ id, enabled: enabled.includes(id) }))
}

describe('prompt load presets', () => {
  it('keeps only discovered essential toolsets in minimal mode', () => {
    expect(targetToolIds('minimal', catalogue)).toEqual([
      'terminal',
      'file',
      'skills',
      'todo',
      'memory',
      'session_search',
      'clarify'
    ])
  })

  it('uses the complete discovered catalogue in full mode', () => {
    expect(targetToolIds('full', catalogue)).toEqual(catalogue)
  })

  it('recognizes presets and marks manual combinations as custom', () => {
    const standard = targetToolIds('standard', catalogue)
    expect(detectPromptLoadPreset(tools(standard))).toBe('standard')
    expect(detectPromptLoadPreset(tools([...standard, 'cronjob']))).toBe('custom')
  })

  it('reports relative schema load without claiming token precision', () => {
    expect(promptLoadSummary(tools(['terminal', 'file', 'skills']))).toEqual({
      active: 3,
      total: 13,
      ratio: 3 / 13,
      percent: 23
    })
  })
})
