// @vitest-environment happy-dom
/**
 * B3-γ + L4 tranchés par l'utilisateur (conv-1536) :
 *  - B3-γ : la TEINTE de statut est portée par la CARTE (fond + bord teintés par `data-state`),
 *    pas seulement par le point.
 *  - L4 : un LIEN entre deux étapes consécutives porte la RAISON de l'enchaînement, DÉRIVÉE du
 *    couple (verdict précédent → étape suivante). Aucune raison dérivable ⇒ aucune étiquette.
 *
 * Entrées qui feraient échouer une correction fausse :
 *  - `scout → frame` (les deux réussis) ne doit porter AUCUN lien : une implémentation qui étiquette
 *    tous les intervalles passerait un test ne regardant que la paire en échec ;
 *  - `build échoué → build` doit dire « 2ᵉ TENTATIVE » et NON « REPRISE APRÈS ÉCHEC » : une règle
 *    qui ne regarde que le verdict précédent, sans comparer la phase, échouerait ici ;
 *  - la 1ʳᵉ carte ne doit jamais porter de lien (aucune étape avant elle).
 */
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { RunProgress } from './RunProgress'
import type { OrchStep } from './chat-view-model'

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

const step = (phase: string, failed = false): OrchStep =>
  ({
    step: 'exec',
    role: phase,
    detail: `phase ${phase}`,
    status: failed ? 'failed' : 'completed',
    ...(failed ? { error: '⛔ Bloqué : vitest introuvable' } : { text: 'ok' })
  }) as OrchStep

const items = (): HTMLLIElement[] =>
  Array.from(container.querySelectorAll<HTMLLIElement>('li.run-progress__item'))

const lien = (i: number): string | null =>
  items()[i]?.querySelector('[data-testid="run-progress-link"]')?.textContent ?? null

describe('RunProgress — B3-γ (teinte portée par la carte)', () => {
  it('rend chaque carte avec son statut, et la feuille teinte la CARTE, pas le seul point', () => {
    act(() => root.render(createElement(RunProgress, { steps: [step('scout'), step('build', true)] })))
    const cartes = Array.from(
      container.querySelectorAll<HTMLElement>('[data-testid="run-progress-step"]')
    )
    expect(cartes.map((c) => c.dataset.state)).toEqual(['done', 'failed'])

    const css = readFileSync('src/renderer/src/components/RunProgress.css', 'utf8')
    // La règle doit viser la CARTE elle-même (pas un descendant `__dot`), en fond ET en bord.
    const regleEchec = css.match(
      /\.run-progress__step\[data-state='failed'\]\s*\{[^}]*\}/s
    )?.[0]
    expect(regleEchec).toBeTruthy()
    expect(regleEchec).toMatch(/background/)
    expect(regleEchec).toMatch(/border/)
    const regleCarte = css.match(/\.run-progress__step\s*\{[^}]*\}/s)?.[0]
    expect(regleCarte).toMatch(/border-left/)
  })
})

describe('RunProgress — L4 (lien avec raison dérivée)', () => {
  it('n’étiquette pas un enchaînement nominal ni la première carte', () => {
    act(() => root.render(createElement(RunProgress, { steps: [step('scout'), step('frame')] })))
    expect(lien(0)).toBeNull()
    expect(lien(1)).toBeNull()
  })

  it('dit « 2ᵉ TENTATIVE » quand la MÊME phase est rejouée après un échec', () => {
    act(() => root.render(createElement(RunProgress, { steps: [step('build', true), step('build')] })))
    expect(lien(1)).toBe('2ᵉ TENTATIVE')
  })

  it('dit « REPRISE APRÈS ÉCHEC » quand une AUTRE phase suit un échec', () => {
    act(() => root.render(createElement(RunProgress, { steps: [step('build', true), step('judge')] })))
    expect(lien(1)).toBe('REPRISE APRÈS ÉCHEC')
  })

  it('dit « VÉRIFICATION » quand le juge suit un build réussi', () => {
    act(() => root.render(createElement(RunProgress, { steps: [step('build'), step('judge')] })))
    expect(lien(1)).toBe('VÉRIFICATION')
  })
})
