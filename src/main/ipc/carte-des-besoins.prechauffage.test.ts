/**
 * LE BOARD CALCULÉ AVANT SA PREMIÈRE OUVERTURE (conv-1248, « accélère un max le loading du board »).
 *
 * Mesure du 2026-10-28 sur le poste : la première ouverture relisait 1 083 fils en 2,0 s (1,0 s après
 * le raccourci Markdown) pendant que la vue affichait « Chargement… », puis 18 ms aux suivantes. Le
 * calcul à froid part donc tout seul, une fois la fenêtre affichée et les archives dans le store.
 *
 * Ce qui fait échouer une version fausse : un calcul lancé AVANT les archives (il ne couvrirait que
 * les fils actifs), ou jamais lancé sans la vue.
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ ipcMain: { handle: () => undefined } }))
vi.mock('../ipc-senders', () => ({ assertTrustedRendererSender: () => undefined }))

import { registerCarteDesBesoinsIpc } from './carte-des-besoins'

const fil = {
  id: 'conv-1',
  title: 'Un fil',
  updatedAt: 10,
  messages: [{ role: 'user', content: 'fais X', ts: 1_000, messageId: 'u1' }]
}

function monter(prechauffageApres: Promise<unknown>): { lectures: () => number } {
  const list = vi.fn(() => [fil])
  registerCarteDesBesoinsIpc({
    os: {
      conversations: { list },
      runsWithGate: async () => [],
      executionWorkspace: undefined
    } as never,
    prechauffageApres
  })
  return { lectures: () => list.mock.calls.length }
}

const laisserTourner = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 20))

describe('Board — calcul à froid sans la vue', () => {
  it('attend le signal (fenêtre + archives), puis lit les fils sans que la vue ait rien demandé', async () => {
    let signaler: () => void = () => {}
    const { lectures } = monter(new Promise<void>((resolve) => (signaler = resolve)))
    await laisserTourner()
    // Avant les archives : aucun calcul, il ne couvrirait que les fils actifs.
    expect(lectures()).toBe(0)
    signaler()
    await laisserTourner()
    expect(lectures()).toBe(1)
  })

  it('un signal en échec ne lance rien et ne casse rien', async () => {
    const avertir = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const { lectures } = monter(Promise.reject(new Error('archives illisibles')))
    await laisserTourner()
    expect(lectures()).toBe(0)
    expect(avertir).toHaveBeenCalledWith(
      '[besoins] préchauffage du Board impossible :',
      expect.any(Error)
    )
    avertir.mockRestore()
  })
})
