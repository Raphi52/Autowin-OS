// @vitest-environment happy-dom
/**
 * conv-528 : petite TV du bureau caché. Cas limites exigés : aucun bureau actif, plusieurs
 * bureaux, bureau fermé pendant qu'on regarde, capture unie.
 */
import { describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { HdeskTv, type HdeskTvApi } from './HdeskTv'
import type { BureauTv, ImageTv } from '../../../main/hdesk-tv'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function faux(etat: {
  bureaux: BureauTv[]
  image: (id: string) => ImageTv
}): HdeskTvApi & { arret: ReturnType<typeof vi.fn> } {
  const arret = vi.fn(async () => undefined)
  return {
    hdeskTvBureaux: vi.fn(async () => etat.bureaux),
    hdeskTvImage: vi.fn(async (id: string) => etat.image(id)),
    hdeskTvArreter: arret,
    arret
  }
}

const ok = (id: string): ImageTv => ({
  statut: 'ok',
  id,
  dataUrl: 'data:image/png;base64,AA',
  width: 1,
  height: 1
})

async function monter(api: HdeskTvApi): Promise<{ host: HTMLElement; tick: () => Promise<void> }> {
  vi.useFakeTimers()
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  await act(async () => {
    root.render(createElement(HdeskTv, { conversationId: 'conv-1', api, intervalleMs: 1000 }))
  })
  const tick = async (): Promise<void> => {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
  }
  return { host, tick }
}

describe('HdeskTv — place dans le fil', () => {
  it('est un bloc DÉDIÉ du fil de messages (même rangée qu’un message agent), pas un panneau sous le fil', async () => {
    const { host } = await monter(faux({ bureaux: [{ id: 'a', travail: 'Roblox' }], image: ok }))
    const bloc = host.querySelector('[data-testid="hdesk-tv"]')
    expect(bloc?.classList.contains('msg')).toBe(true)
    expect(bloc?.classList.contains('assistant')).toBe(true)
    expect(bloc?.querySelector('.msg-meta .msg-role')?.textContent).toBe('Bureau caché')
    vi.useRealTimers()
  })

  it('ChatView la monte DANS la zone qui défile, juste après les messages', () => {
    const src = readFileSync(join(__dirname, 'ChatView.tsx'), 'utf8')
    const fil = src.indexOf('{filRendu}')
    const tv = src.indexOf('<HdeskTv ')
    const finZone = src.indexOf('</div>', fil)
    expect(fil).toBeGreaterThan(0)
    expect(tv).toBeGreaterThan(fil)
    expect(tv).toBeLessThan(finZone)
    expect(src.split('<HdeskTv ').length).toBe(2)
  })
})

describe('HdeskTv', () => {
  it('aucun bureau actif : rien ne s’affiche', async () => {
    const { host } = await monter(faux({ bureaux: [], image: ok }))
    expect(host.querySelector('[data-testid="hdesk-tv"]')).toBeNull()
    vi.useRealTimers()
  })

  it('plusieurs bureaux : un onglet par travail, l’image suit l’onglet choisi', async () => {
    const api = faux({
      bureaux: [
        { id: 'a', travail: 'Roblox' },
        { id: 'b', travail: 'Excel' }
      ],
      image: ok
    })
    const { host, tick } = await monter(api)
    const onglets = [...host.querySelectorAll('[data-testid="hdesk-tv-onglet"]')]
    expect(onglets.map((o) => o.textContent)).toEqual(['Roblox', 'Excel'])
    expect(host.querySelector('img')?.getAttribute('alt')).toContain('Roblox')
    await act(async () => (onglets[1] as HTMLButtonElement).click())
    await tick()
    expect(api.hdeskTvImage).toHaveBeenLastCalledWith('b')
    expect(host.querySelector('img')?.getAttribute('alt')).toContain('Excel')
    vi.useRealTimers()
  })

  it('bureau fermé pendant qu’on regarde : dit « fermé » et bascule sur le suivant', async () => {
    const etat = {
      bureaux: [
        { id: 'a', travail: 'Roblox' },
        { id: 'b', travail: 'Excel' }
      ],
      image: ok
    }
    const { host, tick } = await monter(faux(etat))
    etat.bureaux = [{ id: 'b', travail: 'Excel' }]
    await tick()
    expect(host.querySelector('[data-testid="hdesk-tv-ferme"]')?.textContent).toContain('Roblox')
    expect(host.querySelector('img')?.getAttribute('alt')).toContain('Excel')
    etat.bureaux = []
    etat.image = (id) => ({ statut: 'ferme', id })
    await tick()
    expect(host.querySelector('[data-testid="hdesk-tv-ferme"]')?.textContent).toContain('Excel')
    expect(host.querySelector('img')).toBeNull()
    vi.useRealTimers()
  })

  it('bureau disparu entre la liste et la capture : état fermé, pas d’image figée', async () => {
    const { host } = await monter(
      faux({ bureaux: [{ id: 'a', travail: 'Roblox' }], image: (id) => ({ statut: 'ferme', id }) })
    )
    expect(host.querySelector('[data-testid="hdesk-tv-ferme"]')?.textContent).toContain('Roblox')
    expect(host.querySelector('img')).toBeNull()
    vi.useRealTimers()
  })

  it('capture unie : signalée, jamais présentée comme une observation', async () => {
    const { host } = await monter(
      faux({
        bureaux: [{ id: 'a', travail: 'Jeu' }],
        image: (id) => ({ statut: 'uni', id, dataUrl: 'data:image/png;base64,AA' })
      })
    )
    expect(host.querySelector('[data-testid="hdesk-tv-uni"]')).not.toBeNull()
    vi.useRealTimers()
  })

  it('fermer la TV arrête le processus de capture et le rythme', async () => {
    const api = faux({ bureaux: [{ id: 'a', travail: 'Jeu' }], image: ok })
    const { host, tick } = await monter(api)
    await act(async () =>
      (host.querySelector('[data-testid="hdesk-tv-fermer"]') as HTMLButtonElement).click()
    )
    const appels = (api.hdeskTvBureaux as ReturnType<typeof vi.fn>).mock.calls.length
    await tick()
    await tick()
    expect(api.arret).toHaveBeenCalled()
    expect((api.hdeskTvBureaux as ReturnType<typeof vi.fn>).mock.calls.length).toBe(appels)
    expect(host.querySelector('[data-testid="hdesk-tv"]')).toBeNull()
    vi.useRealTimers()
  })

  it('reste masquée après un remontage (nouveau message), et revient pour un bureau NOUVEAU', async () => {
    const etat = { bureaux: [{ id: 'a', travail: 'Jeu' }] as BureauTv[], image: ok }
    const api = faux(etat)
    vi.useFakeTimers()
    const host = document.createElement('div')
    document.body.appendChild(host)
    let root = createRoot(host)
    const rendre = async (): Promise<void> =>
      act(async () => {
        root.render(createElement(HdeskTv, { conversationId: 'conv-remonte', api, intervalleMs: 1000 }))
      })
    await rendre()
    await act(async () =>
      (host.querySelector('[data-testid="hdesk-tv-fermer"]') as HTMLButtonElement).click()
    )
    expect(host.querySelector('[data-testid="hdesk-tv"]')).toBeNull()
    // Remontage complet, comme a l'envoi d'un message.
    act(() => root.unmount())
    root = createRoot(host)
    await rendre()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6000)
    })
    expect(host.querySelector('[data-testid="hdesk-tv"]')).toBeNull()
    // Un bureau jamais masque arrive : la TV revient.
    etat.bureaux = [...etat.bureaux, { id: 'b', travail: 'Autre' }]
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6000)
    })
    expect(host.querySelector('[data-testid="hdesk-tv"]')).not.toBeNull()
    act(() => root.unmount())
    vi.useRealTimers()
  })
})
