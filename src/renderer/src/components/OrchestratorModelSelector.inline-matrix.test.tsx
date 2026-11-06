// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { OrchestratorModelSelector } from './OrchestratorModelSelector'

/**
 * La popup du chat doit exposer la matrice MODEL × EFFORT **par provider, en ligne** :
 * plus de parcours en 2 temps (option → sous-menu d'efforts) ni de modale séparée
 * ouverte par un bouton « MODEL × EFFORT ».
 *
 * Entrée qui doit faire ÉCHOUER ce test si l'implémentation est fausse : les deux modèles
 * ci-dessous portent des échelles NON comparables (`max` chez claude, `xhigh` chez codex).
 * Une matrice à échelle unique afficherait `max` dans le groupe codex — le test tombe.
 */
const MODELS = [
  {
    id: 'claude:opus',
    provider: 'claude',
    model: 'opus',
    label: 'Opus',
    reasoningEfforts: ['medium', 'high', 'max'],
    defaultReasoningEffort: 'high'
  },
  {
    id: 'codex:gpt',
    provider: 'codex',
    model: 'gpt',
    label: 'GPT',
    reasoningEfforts: ['medium', 'high', 'xhigh'],
    defaultReasoningEffort: 'medium'
  }
]

describe('OrchestratorModelSelector — matrice par provider dans la popup', () => {
  beforeAll(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
  })

  let root: Root | null = null
  let host: HTMLDivElement | null = null

  const monter = async (props: Record<string, unknown>): Promise<HTMLElement> => {
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    await act(async () => {
      root?.render(
        createElement(OrchestratorModelSelector, {
          busy: false,
          catalogLoaded: true,
          models: MODELS,
          pending: false,
          error: null,
          ...props
        } as never)
      )
    })
    /*
     * Le menu est une fenetre FLOTTANTE (portail vers `document.body`), montee seulement apres
     * l'evenement `toggle` qui mesure sa position. On l'ouvre donc ici, et on rend la PAGE :
     * chercher dans l'hote ne trouverait plus rien.
     */
    const details = host.querySelector('details') as HTMLDetailsElement
    await act(async () => {
      details.open = true
      details.dispatchEvent(new Event('toggle'))
    })
    return document.body
  }

  afterEach(async () => {
    if (root) await act(async () => root?.unmount())
    host?.remove()
    root = null
    host = null
  })

  /*
   * ONGLETS PAR FOURNISSEUR (8fb688c1, 2026-11-04) : la matrice ne montre plus qu'UN
   * groupe à la fois, celui de l'onglet ouvert (par défaut, le fournisseur du modèle actif). Les
   * tests ci-dessous ouvrent donc l'onglet codex avant de le lire, au lieu d'attendre tous les
   * groupes côte à côte.
   */
  const ouvrirOnglet = async (view: HTMLElement, provider: string): Promise<void> => {
    const onglet = view.querySelector(
      `[data-testid="effort-matrix-onglet-${provider}"]`
    ) as HTMLElement
    expect(onglet).not.toBeNull()
    await act(async () => onglet.click())
  }

  const echellesAffichees = (view: HTMLElement): Record<string, (string | null)[]> =>
    Object.fromEntries(
      [
        ...view.querySelectorAll<HTMLElement>('[data-testid="effort-matrix"] .effort-matrix-group')
      ].map((g) => [
        g.dataset.provider,
        [...g.querySelectorAll('.effort-matrix-columns span')].map((n) => n.textContent)
      ])
    )

  it('rend la matrice EN LIGNE dans le menu, une échelle par provider, sans modale ni sous-menu', async () => {
    const view = await monter({
      binding: { provider: 'claude', model: 'opus', reasoningEffort: 'high' },
      onSelect: vi.fn()
    })

    const menu = view.querySelector('.model-select-menu') as HTMLElement
    const matrice = menu.querySelector('[data-testid="effort-matrix"]') as HTMLElement
    expect(matrice).not.toBeNull()
    // en ligne : pas d'overlay modal, pas de bouton d'ouverture, pas de sous-menu d'efforts
    expect(view.querySelector('.effort-matrix-overlay')).toBeNull()
    expect(view.querySelector('.model-select-matrix-open')).toBeNull()
    expect(view.querySelector('.model-effort-menu')).toBeNull()

    // un onglet PAR provider (l'ordre suit les groupes du catalogue, hors de ce test), celui du
    // modèle actif ouvert d'office
    expect([...matrice.querySelectorAll('[role="tab"]')].map((n) => n.textContent).sort()).toEqual([
      'ChatGPT',
      'Claude'
    ])
    expect(matrice.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe('Claude')
    // une échelle PAR provider : `max` ne doit jamais apparaître chez codex, ni `xhigh` chez claude
    expect(echellesAffichees(view)).toEqual({ claude: ['', 'medium', 'high', 'max'] })
    await ouvrirOnglet(view, 'codex')
    expect(echellesAffichees(view)).toEqual({ codex: ['', 'medium', 'high', 'xhigh'] })
  })

  it('un clic sur un cran sélectionne le couple (modèle, effort) et referme la popup', async () => {
    const onSelect = vi.fn()
    const view = await monter({
      binding: { provider: 'claude', model: 'opus', reasoningEffort: 'high' },
      onSelect
    })
    const details = view.querySelector('details') as HTMLDetailsElement
    details.open = true
    await ouvrirOnglet(view, 'codex')
    // changer d'onglet ne referme pas la popup : la fermeture vérifiée plus bas vient bien du cran
    expect(details.open).toBe(true)

    const groupeCodex = view.querySelector(
      '.effort-matrix-group[data-provider="codex"]'
    ) as HTMLElement
    const crans = [...groupeCodex.querySelectorAll<HTMLButtonElement>('[role="radio"]')]
    await act(async () => crans[2].click())

    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'codex', model: 'gpt', reasoningEffort: 'xhigh' })
    )
    expect(details.open).toBe(false)
  })

  it('un provider expiré reste visible mais aucun de ses crans ne sélectionne', async () => {
    const onSelect = vi.fn()
    const view = await monter({
      statuses: [
        { provider: 'claude', status: 'authenticated' },
        { provider: 'codex', status: 'expired' }
      ],
      binding: { provider: 'claude', model: 'opus', reasoningEffort: 'high' },
      onSelect
    })
    await ouvrirOnglet(view, 'codex')

    const ligne = view.querySelector('.effort-matrix-row[data-row="codex:gpt"]') as HTMLElement
    expect(ligne).not.toBeNull()
    expect(ligne.className).toContain('is-blocked')
    const cran = ligne.querySelector<HTMLButtonElement>('[role="radio"]') as HTMLButtonElement
    expect(cran.getAttribute('aria-disabled')).toBe('true')
    await act(async () => cran.click())
    expect(onSelect).not.toHaveBeenCalled()
  })
})
