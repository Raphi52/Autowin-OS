import { describe, expect, it, vi } from 'vitest'

const saveRoleBindings = vi.fn()
vi.mock('./role-store', () => ({ loadRoleBindings: () => undefined, saveRoleBindings }))

const { AutowinOS } = await import('./os')
const { RoleModelConfig } = await import('./roles')

describe('setRoles — une seule écriture de roles.json pour un lot de rôles', () => {
  it('persiste UNE fois pour N rôles et applique chaque binding', () => {
    const fake = { roles: new RoleModelConfig(undefined) }
    const lot = [
      ['orchestrator', { provider: 'claude', model: 'opus' }],
      ['subagent', { provider: 'claude', model: 'sonnet' }],
      ['judge', { provider: 'claude', model: 'haiku' }]
    ] as const
    const result = AutowinOS.prototype.setRoles.call(fake as never, lot as never)
    expect(saveRoleBindings).toHaveBeenCalledTimes(1)
    const persisted = saveRoleBindings.mock.calls[0][0]
    for (const [role, b] of lot) {
      expect(persisted[role].provider).toBe(b.provider)
      expect(result[role]).toEqual(persisted[role])
    }
  })

  it("n'écrit rien pour un lot vide", () => {
    saveRoleBindings.mockClear()
    const fake = { roles: new RoleModelConfig(undefined) }
    AutowinOS.prototype.setRoles.call(fake as never, [])
    expect(saveRoleBindings).not.toHaveBeenCalled()
  })
})
