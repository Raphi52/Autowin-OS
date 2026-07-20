import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { OmniRouteMigrationStore } from './omniroute-migration'
import type { Role, RoleBinding } from './roles'
import type { AgentTopology } from './topology'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function directConfiguration() {
  const roles: Record<Role, RoleBinding> = {
    orchestrator: { provider: 'claude', model: 'claude-opus', reasoningEffort: 'high' },
    subagent: { provider: 'claude', model: 'claude-fable', reasoningEffort: 'medium' },
    judge: { provider: 'codex', model: 'gpt-judge', reasoningEffort: 'high' },
    scout: { provider: 'codex', model: 'gpt-scout', reasoningEffort: 'low' }
  }
  const topology: AgentTopology = {
    version: 1,
    orchestrator: {
      slotId: 'orchestrator',
      provider: 'claude',
      modelId: 'claude/opus',
      reasoningEffort: 'high'
    },
    subagents: [],
    panels: { scout: [], judge: [] }
  }
  return { roles, topology }
}

describe('OmniRoute migration transaction', () => {
  it('persists activation once and restores the exact direct snapshot on rollback', () => {
    const root = mkdtempSync(join(tmpdir(), 'autowin-omniroute-migration-'))
    roots.push(root)
    const path = join(root, 'migration.json')
    const store = new OmniRouteMigrationStore(path, () => '2026-07-20T10:00:00.000Z')
    const direct = directConfiguration()
    const active = store.activate('auto/coding', direct)
    expect(active).toEqual(
      expect.objectContaining({ mode: 'omniroute', routeModel: 'auto/coding' })
    )
    expect(new OmniRouteMigrationStore(path).load().mode).toBe('omniroute')

    const different = directConfiguration()
    different.roles.orchestrator = { provider: 'kimi', model: 'other' }
    expect(store.activate('auto/cheap', different)).toEqual(
      expect.objectContaining({
        mode: 'omniroute',
        routeModel: 'auto/cheap',
        directSnapshot: direct
      })
    )

    const rollback = store.rollback()
    expect(rollback.restore).toEqual(direct)
    expect(rollback.state.mode).toBe('direct')
    expect(new OmniRouteMigrationStore(path).load()).toEqual(rollback.state)
    expect(JSON.parse(readFileSync(path, 'utf8')).directSnapshot).toBeUndefined()
  })

  it('fails closed on invalid route models and corrupted persisted state', () => {
    const root = mkdtempSync(join(tmpdir(), 'autowin-omniroute-migration-'))
    roots.push(root)
    const path = join(root, 'migration.json')
    const store = new OmniRouteMigrationStore(path)
    expect(() => store.activate('../intrus', directConfiguration())).toThrow(/route/i)
    expect(store.load()).toEqual(expect.objectContaining({ mode: 'direct' }))
  })
})
