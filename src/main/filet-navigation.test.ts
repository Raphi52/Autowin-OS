import { describe, expect, it, vi } from 'vitest'
import { navigationPerdue, surveillerNavigation } from './filet-navigation'

function horloge() {
  const rappels: Array<() => void> = []
  return {
    planifier: (rappel: () => void) => {
      rappels.push(rappel)
      return rappels.length
    },
    annuler: vi.fn(),
    avancer: () => rappels.shift()?.()
  }
}

describe('navigationPerdue', () => {
  it('reconnaît une page qui n’a rien engagé ou qui est restée sur l’attente', () => {
    expect(navigationPerdue('')).toBe(true)
    expect(navigationPerdue('about:blank')).toBe(true)
    expect(navigationPerdue('file:///C:/Users/x/AppData/Local/Temp/autowin-boot.html')).toBe(true)
  })

  it('laisse tranquille une interface engagée, même lente', () => {
    expect(navigationPerdue('http://localhost:5173/')).toBe(false)
    expect(navigationPerdue('http://localhost:5173/?instance=test#/chat')).toBe(false)
    expect(navigationPerdue('file:///D:/Autowin/out/renderer/index.html')).toBe(false)
  })
})

describe('surveillerNavigation', () => {
  it('redemande l’interface quand la navigation est morte avec le service réseau (19/10)', () => {
    const h = horloge()
    let url = ''
    const redemander = vi.fn(() => {
      url = 'http://localhost:5173/'
    })
    surveillerNavigation({ page: { getURL: () => url }, redemander, delaiMs: 20_000, essaisMax: 3, ...h })
    h.avancer()
    expect(redemander).toHaveBeenCalledTimes(1)
    h.avancer()
    expect(redemander).toHaveBeenCalledTimes(1)
  })

  it('ne relance jamais une interface engagée', () => {
    const h = horloge()
    const redemander = vi.fn()
    surveillerNavigation({
      page: { getURL: () => 'http://localhost:5173/' },
      redemander,
      delaiMs: 20_000,
      essaisMax: 3,
      ...h
    })
    h.avancer()
    expect(redemander).not.toHaveBeenCalled()
  })

  it('s’arrête après le nombre d’essais', () => {
    const h = horloge()
    const redemander = vi.fn()
    surveillerNavigation({ page: { getURL: () => '' }, redemander, delaiMs: 1, essaisMax: 3, ...h })
    for (let i = 0; i < 10; i++) h.avancer()
    expect(redemander).toHaveBeenCalledTimes(3)
  })

  it('désarmé à did-finish-load, il ne fait plus rien', () => {
    const h = horloge()
    const redemander = vi.fn()
    const desarmer = surveillerNavigation({
      page: { getURL: () => '' },
      redemander,
      delaiMs: 1,
      essaisMax: 3,
      ...h
    })
    desarmer()
    h.avancer()
    expect(redemander).not.toHaveBeenCalled()
    expect(h.annuler).toHaveBeenCalled()
  })
})
