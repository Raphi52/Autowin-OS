import { describe, expect, it, vi } from 'vitest'
import { installerCaptureSonSysteme, reponseCaptureSonSysteme } from './audio-loopback'

const ecrans = async (): Promise<Array<{ id: string; name: string }>> => [
  { id: 'screen:0', name: 'Écran 1' }
]

describe('capture du son du système', () => {
  it('repond avec le mode loopback sous Windows', async () => {
    expect(await reponseCaptureSonSysteme({ sources: ecrans, plateforme: 'win32' })).toEqual({
      video: { id: 'screen:0', name: 'Écran 1' },
      audio: 'loopback'
    })
  })

  it('REFUSE hors Windows plutot que de rendre un flux muet', async () => {
    expect(await reponseCaptureSonSysteme({ sources: ecrans, plateforme: 'darwin' })).toBeNull()
  })

  it('REFUSE quand aucun ecran n est capturable', async () => {
    expect(
      await reponseCaptureSonSysteme({ sources: async () => [], plateforme: 'win32' })
    ).toBeNull()
  })

  it('installe un gestionnaire qui repond TOUJOURS, meme quand l enumeration echoue', async () => {
    const captes: Array<(demande: unknown, cb: (r: Record<string, unknown>) => void) => void> = []
    installerCaptureSonSysteme(
      { setDisplayMediaRequestHandler: (h) => captes.push(h as never) },
      {
        sources: async () => {
          throw new Error('capturer indisponible')
        },
        plateforme: 'win32'
      }
    )
    const rappel = vi.fn()
    captes[0]?.({}, rappel)
    await new Promise((r) => setTimeout(r, 0))
    expect(rappel).toHaveBeenCalledWith({})
  })
})
