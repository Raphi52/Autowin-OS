// @vitest-environment happy-dom
/**
 * conv-528 : petite TV du bureau caché. Cas limites exigés : aucun bureau actif, plusieurs
 * bureaux, bureau fermé pendant qu'on regarde, capture unie.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { HdeskTv, type HdeskTvApi } from './HdeskTv'
import { toucheTv } from './hdesk-tv-touches'
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

// fix-ok: cause mesurée — trois défauts distincts reproduits en rouge avant correctif : clic ignoré sur image unie, frappe propagée au chat, gestes chevauchés.
describe('HdeskTv — TV interactive (conv-35)', () => {
  // Le test précédent masque la TV de conv-1 (mémorisé en sessionStorage).
  beforeEach(() => sessionStorage.clear())
  it('un clic sur l’image appelle hdeskTvAct aux coordonnées de la capture, puis la frappe rejoue ce point', async () => {
    const act$ = vi.fn(async () => ({ ok: true as const }))
    const api = {
      ...faux({
        bureaux: [{ id: 'a', travail: 'Gmail' }],
        image: (id: string): ImageTv => ({ statut: 'ok', id, dataUrl: 'data:image/png;base64,AA', width: 1600, height: 900 })
      }),
      hdeskTvAct: act$
    }
    const { host, tick } = await monter(api)
    await tick()
    const img = host.querySelector('[data-testid="hdesk-tv-image"]') as HTMLImageElement
    expect(img).not.toBeNull()
    img.getBoundingClientRect = () =>
      ({ left: 10, top: 20, width: 400, height: 225, right: 410, bottom: 245, x: 10, y: 20, toJSON: () => ({}) }) as DOMRect
    await act(async () => {
      img.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 110, clientY: 70 }))
    })
    expect(act$).toHaveBeenCalledWith({ id: 'a', x: 400, y: 200 })
    const champ = host.querySelector('[data-testid="hdesk-tv-texte"]') as HTMLInputElement
    expect(champ.disabled).toBe(false)
    await act(async () => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      set.call(champ, 'CXC8')
      champ.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => {
      ;(host.querySelector('[data-testid="hdesk-tv-saisie"]') as HTMLFormElement).requestSubmit()
    })
    expect(act$).toHaveBeenLastCalledWith({ id: 'a', x: 400, y: 200, texte: 'CXC8', entree: true, sansClic: true })
    vi.useRealTimers()
  })

  it('critère 1 du cadrage : clic au centre d’une capture 800×600 affichée à 400 px → (400, 300)', async () => {
    const act$ = vi.fn(async () => ({ ok: true as const }))
    const api = {
      ...faux({
        bureaux: [{ id: 'a', travail: 'Gmail' }],
        image: (id: string): ImageTv => ({ statut: 'ok', id, dataUrl: 'data:image/png;base64,AA', width: 800, height: 600 })
      }),
      hdeskTvAct: act$
    }
    const { host, tick } = await monter(api)
    await tick()
    const img = host.querySelector('[data-testid="hdesk-tv-image"]') as HTMLImageElement
    img.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 400, height: 300, right: 400, bottom: 300, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect
    await act(async () => {
      img.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 200, clientY: 150 }))
    })
    expect(act$).toHaveBeenCalledWith({ id: 'a', x: 400, y: 300 })
  })
  it('image unie (page web, cas Gmail) : le clic reste actif, à l’échelle de naturalWidth', async () => {
    const act$ = vi.fn(async () => ({ ok: true as const }))
    const api = {
      ...faux({
        bureaux: [{ id: 'a', travail: 'Gmail' }],
        image: (id: string): ImageTv => ({ statut: 'uni', id, dataUrl: 'data:image/png;base64,AA' })
      }),
      hdeskTvAct: act$
    }
    const { host, tick } = await monter(api)
    await tick()
    const img = host.querySelector('[data-testid="hdesk-tv-image"]') as HTMLImageElement
    Object.defineProperty(img, 'naturalWidth', { value: 1600 })
    Object.defineProperty(img, 'naturalHeight', { value: 900 })
    img.getBoundingClientRect = () =>
      ({ left: 10, top: 20, width: 400, height: 225, right: 410, bottom: 245, x: 10, y: 20, toJSON: () => ({}) }) as DOMRect
    await act(async () => {
      img.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 110, clientY: 70 }))
    })
    expect(act$).toHaveBeenCalledWith({ id: 'a', x: 400, y: 200 })
    expect(host.querySelector('[data-testid="hdesk-tv-saisie"]')).not.toBeNull()
  })

  it('la frappe dans le champ de la TV ne remonte pas aux raccourcis globaux du chat (Ctrl+K, Ctrl+F…)', async () => {
    const act$ = vi.fn(async () => ({ ok: true as const }))
    const api = {
      ...faux({ bureaux: [{ id: 'a', travail: 'Gmail' }], image: (id: string): ImageTv => ({ statut: 'ok', id, dataUrl: 'data:image/png;base64,AA', width: 1600, height: 900 }) }),
      hdeskTvAct: act$
    }
    const { host, tick } = await monter(api)
    await tick()
    const recu = vi.fn()
    document.addEventListener('keydown', recu)
    window.addEventListener('keydown', recu)
    const champ = host.querySelector('[data-testid="hdesk-tv-texte"]') as HTMLInputElement
    await act(async () => {
      champ.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }))
      champ.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }))
    })
    document.removeEventListener('keydown', recu)
    window.removeEventListener('keydown', recu)
    expect(recu).not.toHaveBeenCalled()
    vi.useRealTimers()
  })

  it('deux gestes rapprochés ne se chevauchent pas : le second attend la fin du premier', async () => {
    const ordre: string[] = []
    let finir: (() => void) | null = null
    const act$ = vi.fn((g: { x: number }) => {
      ordre.push(`debut ${g.x}`)
      return new Promise<{ ok: true }>((r) => {
        finir = () => {
          ordre.push(`fin ${g.x}`)
          r({ ok: true })
        }
      })
    })
    const api = {
      ...faux({ bureaux: [{ id: 'a', travail: 'Gmail' }], image: (id: string): ImageTv => ({ statut: 'ok', id, dataUrl: 'data:image/png;base64,AA', width: 400, height: 225 }) }),
      hdeskTvAct: act$
    }
    const { host, tick } = await monter(api)
    await tick()
    const img = host.querySelector('[data-testid="hdesk-tv-image"]') as HTMLImageElement
    img.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 400, height: 225, right: 400, bottom: 225, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect
    await act(async () => {
      img.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 1, clientY: 1 }))
      img.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 2, clientY: 1 }))
    })
    expect(ordre).toEqual(['debut 1'])
    await act(async () => {
      finir!()
    })
    expect(ordre).toEqual(['debut 1', 'fin 1', 'debut 2'])
    await act(async () => {
      finir!()
    })
    vi.useRealTimers()
  })

  it('sans hdeskTvAct, la TV reste en lecture seule (pas de champ de saisie)', async () => {
    const { host, tick } = await monter(faux({ bureaux: [{ id: 'a', travail: 'X' }], image: ok }))
    await tick()
    expect(host.querySelector('[data-testid="hdesk-tv-image"]')).not.toBeNull()
    expect(host.querySelector('[data-testid="hdesk-tv-saisie"]')).toBeNull()
    vi.useRealTimers()
  })
})

describe('HdeskTv — bascule de l’écran réel (option conv-35)', () => {
  beforeEach(() => sessionStorage.clear())
  const monterAvec = async (confirme: boolean) => {
    const bas = vi.fn(async () => ({ ok: true }))
    vi.spyOn(window, 'confirm').mockReturnValue(confirme)
    const api = { ...faux({ bureaux: [{ id: 'a', travail: 'Gmail' }], image: ok }), hdeskTvBasculer: bas }
    const { host, tick } = await monter(api)
    await tick()
    const btn = host.querySelector('[data-testid="hdesk-tv-basculer"]') as HTMLButtonElement
    expect(btn).not.toBeNull()
    await act(async () => btn.click())
    return bas
  }
  it('sans confirmation, rien ne bascule', async () => {
    expect(await monterAvec(false)).not.toHaveBeenCalled()
    vi.restoreAllMocks()
    vi.useRealTimers()
  })
  it('confirmée, la bascule vise le bureau affiché', async () => {
    expect(await monterAvec(true)).toHaveBeenCalledWith('a')
    vi.restoreAllMocks()
    vi.useRealTimers()
  })
  it('sans hdeskTvBasculer, pas de bouton', async () => {
    const { host, tick } = await monter(faux({ bureaux: [{ id: 'a', travail: 'X' }], image: ok }))
    await tick()
    expect(host.querySelector('[data-testid="hdesk-tv-basculer"]')).toBeNull()
    vi.useRealTimers()
  })
})

describe('HdeskTv — touches, molette, rafraîchissement (conv-35)', () => {
  beforeEach(() => sessionStorage.clear())
  it('toucheTv : touches spéciales, Ctrl seulement champ vide, édition locale sinon', () => {
    expect(toucheTv({ key: 'Tab' })).toBe('Tab')
    expect(toucheTv({ key: 'Escape' }, false)).toBe('Echap')
    expect(toucheTv({ key: 'Backspace' })).toBe('Retour')
    expect(toucheTv({ key: 'Backspace' }, false)).toBeNull()
    expect(toucheTv({ key: 'ArrowLeft' }, false)).toBeNull()
    expect(toucheTv({ key: 'ArrowDown' }, false)).toBe('Bas')
    expect(toucheTv({ key: 'v', ctrlKey: true })).toBe('CtrlV')
    expect(toucheTv({ key: 'v', ctrlKey: true }, false)).toBeNull()
    expect(toucheTv({ key: 'q' })).toBeNull()
    expect(toucheTv({ key: 'Enter' })).toBeNull()
  })
  const monterInteractive = async () => {
    const act$ = vi.fn(async () => ({ ok: true as const }))
    let images = 0
    const api = {
      ...faux({ bureaux: [{ id: 'a', travail: 'Gmail' }], image: (id: string): ImageTv => (images++, { statut: 'ok', id, dataUrl: 'data:image/png;base64,AA', width: 400, height: 300 }) }),
      hdeskTvAct: act$
    }
    const { host, tick } = await monter(api)
    await tick()
    const img = host.querySelector('[data-testid="hdesk-tv-image"]') as HTMLImageElement
    img.getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height: 300, right: 400, bottom: 300, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect
    await act(async () => img.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 50, clientY: 60 })))
    return { host, img, act$, images: () => images }
  }
  it('une touche spéciale dans le champ part vers le point cliqué, sans reclic', async () => {
    const { host, act$ } = await monterInteractive()
    const champ = host.querySelector('[data-testid="hdesk-tv-texte"]') as HTMLInputElement
    await act(async () => champ.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true })))
    expect(act$).toHaveBeenLastCalledWith({ id: 'a', x: 50, y: 60, touche: 'Tab', sansClic: true })
    vi.useRealTimers()
  })
  it('la molette sur l’image envoie des crans au point survolé (bas = négatif)', async () => {
    const { img, act$ } = await monterInteractive()
    // jsdom ne recopie pas clientX/clientY d'un WheelEvent : on les pose comme le ferait Chromium.
    const roue = new WheelEvent('wheel', { bubbles: true, deltaY: 300 })
    Object.defineProperty(roue, 'clientX', { value: 10 })
    Object.defineProperty(roue, 'clientY', { value: 20 })
    await act(async () => img.dispatchEvent(roue))
    expect(act$).toHaveBeenLastCalledWith({ id: 'a', x: 10, y: 20, molette: -3 })
    vi.useRealTimers()
  })
  it('après un geste, la capture est redemandée aussitôt sans attendre la boucle', async () => {
    const { img, images } = await monterInteractive()
    const avant = images()
    await act(async () => img.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 5, clientY: 5 })))
    await act(async () => { await Promise.resolve() })
    expect(images()).toBeGreaterThan(avant)
    vi.useRealTimers()
  })
})
