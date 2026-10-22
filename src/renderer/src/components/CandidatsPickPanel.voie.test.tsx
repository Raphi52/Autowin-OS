// @vitest-environment happy-dom
/**
 * DEUX VOIES DANS LE PANNEAU DES CANDIDATS SCOUT (conv-1080) : « Corriger directement » et « Lancer le
 * workflow complet ». La recommandation suit les cases cochées ; les boutons ne changent pas de place,
 * seul l'accent passe de l'un à l'autre. Le clic automatique prend la voie recommandée.
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CandidatsPickPanel } from './CandidatsPickPanel'
import type { CandidatAffiche } from './veille-candidats-message'

;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

const CORRECTION: CandidatAffiche = {
  titre: 'Compteur jamais remis à zéro',
  type: 'fix',
  effort: 'g',
  url: 'src/main/compteur.ts:42'
}
const AJOUT: CandidatAffiche = { titre: 'Vue des coûts', type: 'new', url: 'src/main/index.ts:1' }

describe('CandidatsPickPanel — la voie recommandée', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  const bouton = (id: string): HTMLButtonElement =>
    container.querySelector<HTMLButtonElement>(`[data-testid="${id}"]`)!
  const voie = (): string =>
    container.querySelector('[data-testid="cpick-voie"]')?.textContent ?? ''

  it('une correction localisée : « Corriger directement » est recommandé et envoie /build', () => {
    const onPick = vi.fn()
    act(() => root.render(<CandidatsPickPanel candidats={[CORRECTION]} onPick={onPick} />))

    expect(voie()).toContain('correction directe')
    expect(bouton('cpick-direct').classList.contains('btn-accent')).toBe(true)
    expect(bouton('cpick-lancer').classList.contains('btn-accent')).toBe(false)

    act(() => bouton('cpick-direct').click())
    expect(onPick).toHaveBeenCalledOnce()
    expect(String(onPick.mock.calls[0]![0]).split('\n')[0]).toBe('/build')
  })

  it('le workflow complet reste à un clic, même quand le direct est recommandé', () => {
    const onPick = vi.fn()
    act(() => root.render(<CandidatsPickPanel candidats={[CORRECTION]} onPick={onPick} />))
    act(() => bouton('cpick-lancer').click())
    expect(String(onPick.mock.calls[0]![0])).toContain('PIPELINE complet')
    expect(String(onPick.mock.calls[0]![0])).not.toMatch(/^\/build/u)
  })

  it('cocher un ajout bascule la recommandation vers le complet, sans déplacer les boutons', () => {
    act(() => root.render(<CandidatsPickPanel candidats={[CORRECTION, AJOUT]} />))
    // Tout est coché par défaut : l'ajout impose le complet.
    expect(voie()).toContain('workflow complet')
    expect(bouton('cpick-lancer').classList.contains('btn-accent')).toBe(true)
    const ordre = (): string[] =>
      Array.from(container.querySelectorAll('.cpick-actions button')).map(
        (b) => b.getAttribute('data-testid') ?? ''
      )
    const avant = ordre()

    const cases = container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')
    act(() => cases[2]!.click()) // décoche l'ajout
    expect(voie()).toContain('correction directe')
    expect(bouton('cpick-direct').classList.contains('btn-accent')).toBe(true)
    expect(ordre()).toEqual(avant)
  })

  it('rien de coché : aucune recommandation, les deux boutons désactivés', () => {
    act(() => root.render(<CandidatsPickPanel candidats={[CORRECTION]} />))
    act(() => container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')[1]!.click())
    expect(container.querySelector('[data-testid="cpick-voie"]')).toBeNull()
    expect(bouton('cpick-direct').disabled).toBe(true)
    expect(bouton('cpick-lancer').disabled).toBe(true)
  })

  it('mode auto : le choix du scout part sur SA voie recommandée — direct pour une correction', () => {
    const onPick = vi.fn()
    act(() =>
      root.render(
        <CandidatsPickPanel
          candidats={[AJOUT, CORRECTION]}
          texteScout="CIBLE: 2"
          autoLancer
          onPick={onPick}
        />
      )
    )
    expect(onPick).toHaveBeenCalledOnce()
    const envoye = String(onPick.mock.calls[0]![0])
    expect(envoye.split('\n')[0]).toBe('/build')
    expect(envoye).toContain('Compteur jamais remis à zéro')
    expect(envoye).not.toContain('Vue des coûts')
    expect(container.querySelector('[data-testid="cpick-auto"]')?.textContent).toContain(
      'en correction directe'
    )
  })

  it('mode auto : un ajout choisi part en workflow complet', () => {
    const onPick = vi.fn()
    act(() =>
      root.render(
        <CandidatsPickPanel
          candidats={[AJOUT, CORRECTION]}
          texteScout="CIBLE: 1"
          autoLancer
          onPick={onPick}
        />
      )
    )
    expect(onPick).toHaveBeenCalledOnce()
    expect(String(onPick.mock.calls[0]![0])).toContain('PIPELINE complet')
  })
})
