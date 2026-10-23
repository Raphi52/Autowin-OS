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

  it('réécrit roles.json SANS perdre le modèle des petites tâches', () => {
    saveRoleBindings.mockClear()
    const petitesTaches = { provider: 'claude', model: 'claude-haiku-4-5' }
    const fake = { roles: new RoleModelConfig({ petitesTaches }) }
    AutowinOS.prototype.setRoles.call(
      fake as never,
      [['orchestrator', { provider: 'claude', model: 'opus' }]] as never
    )
    expect(saveRoleBindings).toHaveBeenCalledWith(expect.any(Object), petitesTaches, undefined)
  })

  // conv-1097 : l'interrupteur du build trivial sur Haiku vit dans le même fichier, réécrit en entier.
  it('réécrit roles.json SANS perdre l’interrupteur du build trivial', () => {
    saveRoleBindings.mockClear()
    const fake = { roles: new RoleModelConfig({ buildTrivialSurHaiku: false }) }
    AutowinOS.prototype.setRoles.call(
      fake as never,
      [['orchestrator', { provider: 'claude', model: 'opus' }]] as never
    )
    expect(saveRoleBindings).toHaveBeenCalledWith(expect.any(Object), undefined, false)
    AutowinOS.prototype.setPetitesTaches.call(fake as never, undefined)
    expect(saveRoleBindings).toHaveBeenLastCalledWith(expect.any(Object), undefined, false)
  })

  it('setPetitesTaches persiste puis applique, et undefined efface', () => {
    saveRoleBindings.mockClear()
    const fake = { roles: new RoleModelConfig(undefined) }
    const pose = AutowinOS.prototype.setPetitesTaches.call(fake as never, {
      provider: 'claude',
      model: 'claude-haiku-4-5'
    })
    expect(pose).toEqual({ provider: 'claude', model: 'claude-haiku-4-5' })
    expect(saveRoleBindings).toHaveBeenLastCalledWith(expect.any(Object), pose, undefined)
    expect(AutowinOS.prototype.setPetitesTaches.call(fake as never, undefined)).toBeUndefined()
    expect(saveRoleBindings).toHaveBeenLastCalledWith(expect.any(Object), undefined, undefined)
    expect(fake.roles.getPetitesTaches()).toBeUndefined()
  })

  it("n'écrit rien pour un lot vide", () => {
    saveRoleBindings.mockClear()
    const fake = { roles: new RoleModelConfig(undefined) }
    AutowinOS.prototype.setRoles.call(fake as never, [])
    expect(saveRoleBindings).not.toHaveBeenCalled()
  })
})
