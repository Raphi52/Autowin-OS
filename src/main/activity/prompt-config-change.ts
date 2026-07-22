import type { CapabilityItem, CapabilityKind } from '../capability-controls'

export interface PromptConfigChange {
  kind: CapabilityKind
  actor: 'human-ui'
  before: string[]
  after: string[]
  enabled: string[]
  disabled: string[]
  activation: 'next-session' | 'restart'
}

export function promptConfigChange(
  kind: CapabilityKind,
  beforeItems: readonly CapabilityItem[],
  afterItems: readonly CapabilityItem[]
): PromptConfigChange {
  const before = beforeItems.filter((item) => item.enabled).map((item) => item.id)
  const after = afterItems.filter((item) => item.enabled).map((item) => item.id)
  const beforeSet = new Set(before)
  const afterSet = new Set(after)
  return {
    kind,
    actor: 'human-ui',
    before,
    after,
    enabled: after.filter((id) => !beforeSet.has(id)),
    disabled: before.filter((id) => !afterSet.has(id)),
    activation: kind === 'plugins' ? 'restart' : 'next-session'
  }
}
