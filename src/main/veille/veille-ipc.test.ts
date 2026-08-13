import { describe, expect, it, vi } from 'vitest'
import { registerVeilleIpc } from './veille-ipc'
import type { IpcMainInvokeEvent } from 'electron'

/**
 * Le canal « veille:generer » : la vue DÉCLENCHE une passe, elle n'écrit jamais un candidat.
 * Nés avec le bouton « En générer plus » (demande utilisateur du 2026-08-13).
 */
function harnais(genererInterne?: () => Promise<unknown>): {
  appeler: (canal: string) => unknown
} {
  const handlers = new Map<string, (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown>()
  registerVeilleIpc({
    ipc: { handle: (canal, listener) => handlers.set(canal, listener) },
    assertTrusted: () => {},
    chemin: 'C:/inexistant/stock.json',
    ...(genererInterne ? { genererInterne } : {})
  })
  return { appeler: (canal) => handlers.get(canal)!({} as IpcMainInvokeEvent) }
}

describe('veille:generer', () => {
  it('non câblé → une erreur NOMMÉE, pas un canal qui répond du vide', () => {
    const { appeler } = harnais()
    expect(() => appeler('veille:generer')).toThrow(/non câblée/)
  })

  it('délègue à la passe interne et rend son résultat', async () => {
    const generer = vi.fn(async () => ({ retenus: 2 }))
    const { appeler } = harnais(generer)
    await expect(appeler('veille:generer')).resolves.toEqual({ retenus: 2 })
    expect(generer).toHaveBeenCalledTimes(1)
  })

  it('deux clics pendant une génération ne paient qu’UN scout', async () => {
    let resoudre!: (v: unknown) => void
    const generer = vi.fn(() => new Promise((r) => (resoudre = r)))
    const { appeler } = harnais(generer)
    const premier = appeler('veille:generer') as Promise<unknown>
    const second = appeler('veille:generer') as Promise<unknown>
    resoudre({ retenus: 1 })
    await expect(premier).resolves.toEqual({ retenus: 1 })
    await expect(second).resolves.toEqual({ retenus: 1 })
    expect(generer).toHaveBeenCalledTimes(1)
  })

  it('après la fin d’une génération, un nouveau clic relance', async () => {
    const generer = vi.fn(async () => ({ retenus: 0 }))
    const { appeler } = harnais(generer)
    await appeler('veille:generer')
    await appeler('veille:generer')
    expect(generer).toHaveBeenCalledTimes(2)
  })
})
