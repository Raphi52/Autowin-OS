// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach, beforeAll } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { RunBilanCard } from './RunBilanCard'
import { copierBilanEnImage } from './run-bilan-copie'
import { bilanDepuisResume } from './run-bilan'

beforeAll(() => {
  // Sans ce drapeau, React n'applique pas les mises à jour d'état dans `act` : le bouton
  // resterait figé alors que le composant a bien changé d'état (convention des tests App.*).
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

let root: Root | undefined
let hote: HTMLDivElement | undefined

afterEach(() => {
  act(() => root?.unmount())
  hote?.remove()
  root = undefined
  hote = undefined
})

function monter(verdictSource: { status: string; defauts: number }): HTMLElement {
  hote = document.createElement('div')
  document.body.append(hote)
  const bilan = bilanDepuisResume(
    { dodChecked: 2, dodTotal: 3, journalEvents: 7, ...verdictSource },
    'poser la jauge'
  )
  root = createRoot(hote)
  act(() => root!.render(<RunBilanCard bilan={bilan} />))
  return hote
}

describe('carte bilan de run', () => {
  it('affiche le titre, le verdict et une ligne par repère', () => {
    const el = monter({ status: 'green', defauts: 0 })
    expect(el.textContent).toContain('poser la jauge')
    expect(el.querySelector('[data-testid="run-bilan-verdict"]')?.textContent).toBe('vert')
    expect(el.querySelectorAll('[data-testid="run-bilan-ligne"]').length).toBe(3)
  })

  it('porte le verdict rouge sur la carte elle-même, pour le style', () => {
    const el = monter({ status: 'red', defauts: 1 })
    expect(el.querySelector('[data-testid="run-bilan"]')?.getAttribute('data-verdict')).toBe(
      'rouge'
    )
  })

  it('DIT que la copie a échoué au lieu de prétendre avoir copié', async () => {
    // happy-dom n'a ni canvas peint ni presse-papiers image : c'est exactement le cas « refusé ».
    const ok = await copierBilanEnImage(
      bilanDepuisResume({
        status: 'green',
        dodChecked: 1,
        dodTotal: 1,
        journalEvents: 0,
        defauts: 0
      })
    )
    expect(ok).toBe(false)
  })

  it('le bouton bascule sur « Copie refusée » quand le presse-papiers refuse', async () => {
    const el = monter({ status: 'green', defauts: 0 })
    const bouton = el.querySelector('[data-testid="run-bilan-copier"]') as HTMLButtonElement
    expect(bouton.textContent).toBe("Copier l'image")
    act(() => bouton.click())
    await vi.waitFor(() => expect(bouton.textContent).not.toBe("Copier l'image"), {
      timeout: 8000
    })
    expect(bouton.textContent).toBe('Copie refusée')
  })
})
