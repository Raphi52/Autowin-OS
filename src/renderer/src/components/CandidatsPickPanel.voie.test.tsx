// @vitest-environment happy-dom
/**
 * LE WORKFLOW INTELLIGENT DU PANNEAU DES CANDIDATS SCOUT (conv-1080) : « ça doit retenir les
 * candidats puis lancer le workflow intelligent », puis « fais le truc parfait ». UN seul bouton garde
 * les cases cochées ; chaque ligne porte SA voie (direct / à cadrer) et sa raison ; le plan découpe la
 * sélection en lots par voie, 3 pistes au plus, envoyés l'un après l'autre. Le clic automatique suit
 * le même plan.
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
const ajout = (n: number): CandidatAffiche => ({ titre: `Ajout ${n}`, type: 'new' })

describe('CandidatsPickPanel — le workflow intelligent', () => {
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

  const lancer = (): HTMLButtonElement =>
    container.querySelector<HTMLButtonElement>('[data-testid="cpick-lancer"]')!
  const voie = (): string =>
    container.querySelector('[data-testid="cpick-voie"]')?.textContent ?? ''
  const cases = (): NodeListOf<HTMLInputElement> =>
    container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')
  const pastilles = (): HTMLElement[] =>
    Array.from(container.querySelectorAll<HTMLElement>('[data-testid="cpick-voie-piste"]'))

  it('un SEUL bouton : plus de choix à faire entre deux voies', () => {
    act(() => root.render(<CandidatsPickPanel candidats={[CORRECTION]} />))
    const boutons = Array.from(container.querySelectorAll('.cpick-actions button'))
    expect(boutons).toHaveLength(1)
    expect(boutons[0]!.textContent).toBe('Lancer le workflow intelligent')
  })

  it('chaque ligne porte SA voie, en mot et avec sa raison — pas la couleur seule', () => {
    act(() => root.render(<CandidatsPickPanel candidats={[CORRECTION, AJOUT]} />))
    const [direct, aCadrer] = pastilles()
    expect(direct!.textContent).toBe('direct')
    expect(direct!.dataset.voie).toBe('directe')
    expect(direct!.title).toContain('correction localisée')
    expect(aCadrer!.textContent).toBe('à cadrer')
    expect(aCadrer!.getAttribute('aria-label')).toContain('ajout')
  })

  it('une correction localisée part en correction directe (/build) et le dit avant le clic', () => {
    const onPick = vi.fn()
    act(() => root.render(<CandidatsPickPanel candidats={[CORRECTION]} onPick={onPick} />))

    expect(voie()).toContain('Le workflow intelligent jouera : correction directe')
    expect(lancer().dataset.voie).toBe('directe')

    act(() => lancer().click())
    expect(onPick).toHaveBeenCalledOnce()
    // Un seul lot : aucune suite, le message part seul.
    expect(onPick.mock.calls[0]).toHaveLength(1)
    const envoye = String(onPick.mock.calls[0]![0])
    expect(envoye.split('\n')[0]).toBe('/build')
    expect(envoye).toContain('Compteur jamais remis à zéro')
  })

  it('un ajout part en workflow complet, sans /build, et le motif le nomme', () => {
    const onPick = vi.fn()
    act(() => root.render(<CandidatsPickPanel candidats={[AJOUT]} onPick={onPick} />))

    expect(voie()).toContain('workflow complet')
    expect(voie()).toContain('« Vue des coûts » : un ajout')
    act(() => lancer().click())
    const envoye = String(onPick.mock.calls[0]![0])
    expect(envoye).toContain('PIPELINE complet')
    expect(envoye).not.toMatch(/^\/build/u)
  })

  it('une sélection MIXTE : la correction part en direct, l’ajout en complet, l’un après l’autre', () => {
    const onPick = vi.fn()
    act(() => root.render(<CandidatsPickPanel candidats={[AJOUT, CORRECTION]} onPick={onPick} />))

    expect(voie()).toContain('2 lots à la suite')
    const lots = Array.from(container.querySelectorAll<HTMLElement>('[data-testid="cpick-lot"]'))
    expect(lots.map((lot) => lot.dataset.voie)).toEqual(['directe', 'complete'])
    // Les numéros sont ceux des LIGNES du panneau : la correction est la ligne 2.
    expect(lots[0]!.textContent).toContain('piste 2')
    expect(lots[1]!.textContent).toContain('piste 1')
    expect(lancer().dataset.voie).toBe('mixte')
    expect(lancer().textContent).toBe('Lancer le workflow intelligent (2 lots)')

    act(() => lancer().click())
    expect(onPick).toHaveBeenCalledOnce()
    const [premier, suite] = onPick.mock.calls[0]! as [string, string[]]
    expect(premier.split('\n')[0]).toBe('/build')
    expect(premier).toContain('Compteur jamais remis à zéro')
    expect(premier).not.toContain('Vue des coûts')
    expect(suite).toHaveLength(1)
    expect(suite[0]).toContain('Vue des coûts')
    expect(suite[0]).toContain('Lot 2 sur 2 de la sélection')
  })

  it('une grosse sélection part en lots de 3 au plus', () => {
    const onPick = vi.fn()
    const sept = [1, 2, 3, 4, 5, 6, 7].map(ajout)
    act(() => root.render(<CandidatsPickPanel candidats={sept} onPick={onPick} />))
    act(() => lancer().click())
    const [premier, suite] = onPick.mock.calls[0]! as [string, string[]]
    const messages = [premier, ...suite]
    expect(messages).toHaveLength(3)
    expect(messages.map((m) => (m.match(/^\s+Type : new$/gmu) ?? []).length)).toEqual([3, 2, 2])
  })

  it('le plan suit les cases : décocher l’ajout ne laisse qu’un lot direct', () => {
    const onPick = vi.fn()
    act(() => root.render(<CandidatsPickPanel candidats={[CORRECTION, AJOUT]} onPick={onPick} />))
    expect(container.querySelectorAll('[data-testid="cpick-lot"]')).toHaveLength(2)

    act(() => cases()[2]!.click()) // décoche l'ajout
    expect(voie()).toContain('correction directe')
    expect(lancer().dataset.voie).toBe('directe')

    act(() => lancer().click())
    expect(onPick.mock.calls[0]).toHaveLength(1)
    const envoye = String(onPick.mock.calls[0]![0])
    expect(envoye.split('\n')[0]).toBe('/build')
    // RETENIR LES CANDIDATS : seule la sélection cochée part, la piste décochée reste hors du run.
    expect(envoye).not.toContain('Vue des coûts')
  })

  it('rien de coché : aucun plan annoncé, le bouton est désactivé', () => {
    act(() => root.render(<CandidatsPickPanel candidats={[CORRECTION]} />))
    act(() => cases()[1]!.click())
    expect(container.querySelector('[data-testid="cpick-voie"]')).toBeNull()
    expect(lancer().disabled).toBe(true)
  })

  it('mode auto : le choix du scout part sur le plan du workflow intelligent — direct ici', () => {
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
      'lancé automatiquement en correction directe'
    )
  })

  it('mode auto : un choix mixte part en lots, le bandeau le dit', () => {
    const onPick = vi.fn()
    act(() =>
      root.render(
        <CandidatsPickPanel
          candidats={[AJOUT, CORRECTION]}
          texteScout="CIBLES: 1, 2"
          autoLancer
          onPick={onPick}
        />
      )
    )
    expect(onPick).toHaveBeenCalledOnce()
    const [, suite] = onPick.mock.calls[0]! as [string, string[]]
    expect(suite[0]).toContain('PIPELINE complet')
    expect(container.querySelector('[data-testid="cpick-auto"]')?.textContent).toContain(
      'en 2 lots à la suite'
    )
  })
})
