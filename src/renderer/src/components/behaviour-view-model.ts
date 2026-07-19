export type BehaviourEngine = 'codex' | 'claude' | 'hermes'
export type BehaviourScope = 'global' | 'workspace' | 'project' | 'skill'
export type BehaviourState = 'active' | 'conditional' | 'shadowed' | 'declared' | 'injected'

export interface BehaviourFileItem {
  id: string
  label: string
  path: string
  engine: BehaviourEngine
  scope: BehaviourScope
  state: BehaviourState
  reason: string
  injectedAt: string
  injectedInto: string
  active: boolean
  size: number
}

export interface BehaviourGroup {
  engine: BehaviourEngine
  files: BehaviourFileItem[]
}

const ENGINE_ORDER: readonly BehaviourEngine[] = ['codex', 'claude', 'hermes']

export function applicableBehaviourFiles(files: readonly BehaviourFileItem[]): BehaviourFileItem[] {
  return files.filter((file) => file.active)
}

/** Sources utiles au lecteur : les déclarées sont visibles, les masquées non. */
export function visibleBehaviourFiles(files: readonly BehaviourFileItem[]): BehaviourFileItem[] {
  return files.filter((file) => file.state !== 'shadowed')
}

export function visibleBehaviourSelection(
  files: readonly BehaviourFileItem[],
  selectedId: string
): BehaviourFileItem | undefined {
  return files.find((file) => file.id === selectedId) ?? files[0]
}

export function filterBehaviourFiles(
  files: readonly BehaviourFileItem[],
  query: string,
  engine: 'all' | BehaviourEngine,
  state: 'all' | BehaviourState
): BehaviourFileItem[] {
  const needle = query.trim().toLocaleLowerCase('fr')
  return files.filter((file) => {
    if (engine !== 'all' && file.engine !== engine) return false
    if (state !== 'all' && file.state !== state) return false
    if (!needle) return true
    return `${file.label} ${file.path} ${file.reason} ${file.injectedAt} ${file.injectedInto}`
      .toLocaleLowerCase('fr')
      .includes(needle)
  })
}

export function groupBehaviourFiles(files: readonly BehaviourFileItem[]): BehaviourGroup[] {
  return ENGINE_ORDER.map((engine) => ({
    engine,
    files: files.filter((file) => file.engine === engine)
  }))
}

export function preferredBehaviourFileId(files: readonly BehaviourFileItem[]): string {
  return (
    (
      files.find((file) => file.active && file.scope === 'project') ??
      files.find((file) => file.active && file.scope === 'workspace') ??
      files.find((file) => file.active) ??
      files[0]
    )?.id ?? ''
  )
}
