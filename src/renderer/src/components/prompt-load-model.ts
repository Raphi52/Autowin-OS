export type PromptLoadPreset = 'minimal' | 'standard' | 'full' | 'custom'

export interface PromptLoadTool {
  id: string
  enabled: boolean
}

const MINIMAL_TOOLSETS = [
  'terminal',
  'file',
  'skills',
  'todo',
  'memory',
  'session_search',
  'clarify'
] as const

const STANDARD_TOOLSETS = [
  'web',
  'terminal',
  'file',
  'code_execution',
  'vision',
  'skills',
  'todo',
  'memory',
  'session_search',
  'clarify',
  'delegation'
] as const

export function targetToolIds(
  preset: Exclude<PromptLoadPreset, 'custom'>,
  catalogue: readonly string[]
): string[] {
  if (preset === 'full') return [...catalogue]
  const requested = preset === 'minimal' ? MINIMAL_TOOLSETS : STANDARD_TOOLSETS
  const requestedSet = new Set<string>(requested)
  return catalogue.filter((id) => requestedSet.has(id))
}

function sameIds(actual: readonly string[], expected: readonly string[]): boolean {
  if (actual.length !== expected.length) return false
  const expectedSet = new Set(expected)
  return actual.every((id) => expectedSet.has(id))
}

export function detectPromptLoadPreset(tools: readonly PromptLoadTool[]): PromptLoadPreset {
  const catalogue = tools.map((tool) => tool.id)
  const enabled = tools.filter((tool) => tool.enabled).map((tool) => tool.id)
  for (const preset of ['minimal', 'standard', 'full'] as const) {
    if (sameIds(enabled, targetToolIds(preset, catalogue))) return preset
  }
  return 'custom'
}

export function promptLoadSummary(tools: readonly PromptLoadTool[]): {
  active: number
  total: number
  ratio: number
  percent: number
} {
  const active = tools.filter((tool) => tool.enabled).length
  const total = tools.length
  const ratio = total === 0 ? 0 : active / total
  return { active, total, ratio, percent: Math.round(ratio * 100) }
}
