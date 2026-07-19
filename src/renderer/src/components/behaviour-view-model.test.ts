import { describe, expect, it } from 'vitest'
import {
  filterBehaviourFiles,
  groupBehaviourFiles,
  preferredBehaviourFileId,
  type BehaviourFileItem
} from './behaviour-view-model'

const files: BehaviourFileItem[] = [
  {
    id: 'claude-global',
    label: 'CLAUDE.md',
    path: 'C:/Users/test/.claude/CLAUDE.md',
    engine: 'claude',
    scope: 'global',
    state: 'active',
    reason: 'Mémoire utilisateur',
    injectedAt: 'Session',
    injectedInto: 'Claude',
    active: true,
    size: 12
  },
  {
    id: 'codex-project',
    label: 'AGENTS.md',
    path: 'C:/work/project/AGENTS.md',
    engine: 'codex',
    scope: 'project',
    state: 'conditional',
    reason: 'Actif dans project',
    injectedAt: 'Contexte project',
    injectedInto: 'Codex',
    active: false,
    size: 18
  },
  {
    id: 'hermes-skill',
    label: 'clean',
    path: 'C:/hermes/skills/clean/SKILL.md',
    engine: 'hermes',
    scope: 'skill',
    state: 'conditional',
    reason: 'À l’invocation',
    injectedAt: 'Invocation',
    injectedInto: 'Hermes',
    active: false,
    size: 20
  }
]

describe('behaviour view model', () => {
  it('groups files in Codex, Claude, Hermes order without losing empty engines', () => {
    expect(groupBehaviourFiles(files).map((group) => [group.engine, group.files.length])).toEqual([
      ['codex', 1],
      ['claude', 1],
      ['hermes', 1]
    ])
  })

  it('filters by engine, activation and searchable reason/path', () => {
    expect(
      filterBehaviourFiles(files, 'mémoire', 'claude', 'active').map((file) => file.id)
    ).toEqual(['claude-global'])
    expect(
      filterBehaviourFiles(files, 'project', 'all', 'conditional').map((file) => file.id)
    ).toEqual(['codex-project'])
  })

  it('selects the closest active project instruction before workspace and global files', () => {
    const project = {
      ...files[1],
      id: 'codex-active-project',
      state: 'active' as const,
      active: true
    }
    expect(preferredBehaviourFileId([...files, project])).toBe('codex-active-project')
  })
})
