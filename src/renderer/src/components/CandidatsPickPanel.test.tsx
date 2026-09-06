// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CandidatsPickPanel } from './CandidatsPickPanel'

;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

describe('CandidatsPickPanel', () => {
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

  it('envoie au workflow uniquement les candidats cochés et expose les trois détails', () => {
    const onPick = vi.fn()
    act(() =>
      root.render(
        <CandidatsPickPanel
          candidats={[
            {
              type: 'ajout',
              titre: 'Cockpit',
              url: 'src/main/index.ts:1',
              what: 'Affiche les coûts.',
              why: 'Les coûts sont relus à la main.',
              how: 'Ajouter une vue dédiée.'
            },
            { type: 'correction', titre: 'Retry', url: 'src/main/retry.ts:2' }
          ]}
          onPick={onPick}
        />
      )
    )

    const cases = container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')
    expect(cases).toHaveLength(3)
    act(() => cases[2].click())
    expect(container.querySelector('.cpick-compte')?.textContent).toContain('1/2')

    const deplier = container.querySelector<HTMLButtonElement>('[data-testid="cpick-deplier"]')
    act(() => deplier?.click())
    expect(container.querySelector('[data-testid="cpick-details"]')?.textContent).toContain(
      'Quoi ?Affiche les coûts.Pourquoi ?Les coûts sont relus à la main.Comment ?Ajouter une vue dédiée.'
    )

    const lancer = container.querySelector<HTMLButtonElement>('[data-testid="cpick-lancer"]')
    act(() => lancer?.click())
    expect(onPick).toHaveBeenCalledOnce()
    expect(onPick.mock.calls[0][0]).toContain('Cockpit')
    expect(onPick.mock.calls[0][0]).toContain('Quoi : Affiche les coûts.')
    expect(onPick.mock.calls[0][0]).toContain('Pourquoi : Les coûts sont relus à la main.')
    expect(onPick.mock.calls[0][0]).toContain('Comment : Ajouter une vue dédiée.')
    expect(onPick.mock.calls[0][0]).not.toContain('Retry')
  })

  /**
   * Defaut nomme le 2026-09-06 : l'agent decidait des candidats dans son texte (`CIBLES:`) mais les
   * cases restaient toutes cochees — le clic partait donc sur des lignes que personne n'avait
   * choisies. Le choix ECRIT doit piloter les cases, et rester VISIBLE.
   */
  it('le choix declare par le scout pre-coche les cases et s’affiche', () => {
    const onPick = vi.fn()
    act(() =>
      root.render(
        <CandidatsPickPanel
          candidats={[{ titre: 'Cockpit' }, { titre: 'Retry' }, { titre: 'Journal' }]}
          texteScout={['Trois pistes.', 'CIBLES: 2, 3'].join(String.fromCharCode(10))}
          onPick={onPick}
        />
      )
    )

    expect(container.querySelector('.cpick-compte')?.textContent).toContain('2/3')
    expect(container.querySelector('[data-testid="cpick-auto"]')?.textContent).toContain(
      'Choix du scout : 2 candidats sur 3'
    )
    act(() => container.querySelector<HTMLButtonElement>('[data-testid="cpick-lancer"]')?.click())
    expect(onPick.mock.calls[0][0]).not.toContain('Cockpit')
    expect(onPick.mock.calls[0][0]).toContain('Retry')
    expect(onPick.mock.calls[0][0]).toContain('Journal')
  })
  /**
   * La demande du 2026-09-06 : l'orchestrateur DECIDE puis CLIQUE. Le pre-cochage seul laissait le
   * geste payant a l'utilisateur — donc la moitie de la demande non faite.
   */
  it('mode auto : le panneau appuie lui-meme sur le bouton avec la selection du scout', () => {
    const onPick = vi.fn()
    act(() =>
      root.render(
        <CandidatsPickPanel
          candidats={[{ titre: 'Cockpit' }, { titre: 'Retry' }, { titre: 'Journal' }]}
          texteScout={['## Cible', '2, 3'].join(String.fromCharCode(10))}
          autoLancer
          onPick={onPick}
        />
      )
    )
    expect(onPick).toHaveBeenCalledOnce()
    expect(onPick.mock.calls[0][0]).not.toContain('Cockpit')
    expect(onPick.mock.calls[0][0]).toContain('Retry')
    expect(onPick.mock.calls[0][0]).toContain('Journal')
    expect(container.querySelector('[data-testid="cpick-auto"]')?.textContent).toContain(
      'lance automatiquement'.replace('lance', 'lancé')
    )
  })

  it('mode auto SANS choix ecrit du scout : rien ne part tout seul', () => {
    const onPick = vi.fn()
    act(() =>
      root.render(
        <CandidatsPickPanel
          candidats={[{ titre: 'Cockpit' }, { titre: 'Retry' }]}
          texteScout={'Deux pistes, a toi de voir.'}
          autoLancer
          onPick={onPick}
        />
      )
    )
    expect(onPick).not.toHaveBeenCalled()
  })

  it('mode auto et « CIBLE: aucune » : rien ne part non plus', () => {
    const onPick = vi.fn()
    act(() =>
      root.render(
        <CandidatsPickPanel
          candidats={[{ titre: 'Cockpit' }, { titre: 'Retry' }]}
          texteScout={'CIBLE: aucune'}
          autoLancer
          onPick={onPick}
        />
      )
    )
    expect(onPick).not.toHaveBeenCalled()
  })
})
