import { describe, expect, it, vi } from 'vitest'
import { registerGreffeActionsIpc } from './greffe-actions-ipc'

const registre = (): {
  handlers: Map<string, (event: unknown, ...args: unknown[]) => unknown>
  ipc: { handle: (c: string, l: (event: unknown, ...args: unknown[]) => unknown) => void }
} => {
  const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>()
  return { handlers, ipc: { handle: (c, l) => handlers.set(c, l) } }
}

const greffes = async () => [{ server: 'SQL-PROD\\PROD', database: 'RIG_AMIENS' }]

describe('canal des actions des utilisateurs', () => {
  it('refuse un greffe absent du catalogue', async () => {
    const { handlers, ipc } = registre()
    const lire = vi.fn()
    registerGreffeActionsIpc({ ipc, assertTrusted: () => {}, listerGreffes: greffes, lire })
    const resultat = await handlers.get('greffe:actions:lire')!({}, { database: 'RIG_MAQUETTE' })
    expect(resultat).toMatchObject({ ok: false })
    expect(lire).not.toHaveBeenCalled()
  })

  it('reprend le serveur du catalogue et jamais celui du message', async () => {
    const { handlers, ipc } = registre()
    const lire = vi.fn(async (cible: { server: string; database: string }) => ({
      ok: true,
      greffe: cible.database,
      source: {},
      actions: []
    }))
    registerGreffeActionsIpc({
      ipc,
      assertTrusted: () => {},
      listerGreffes: greffes,
      lire: lire as never
    })
    await handlers.get('greffe:actions:lire')!(
      {},
      { database: 'rig_amiens', server: 'SERVEUR-PIRATE' }
    )
    expect(lire.mock.calls[0][0]).toEqual({ server: 'SQL-PROD\\PROD', database: 'RIG_AMIENS' })
  })

  it('exige un expéditeur de confiance', async () => {
    const { handlers, ipc } = registre()
    const assertTrusted = vi.fn(() => {
      throw new Error('refusé')
    })
    registerGreffeActionsIpc({ ipc, assertTrusted, listerGreffes: greffes, lire: vi.fn() as never })
    await expect(handlers.get('greffe:actions:liste')!({})).rejects.toThrow('refusé')
  })
})
