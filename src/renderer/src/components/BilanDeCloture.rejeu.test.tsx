// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BilanDeCloture } from './BilanDeCloture'
import type { AgentGantt } from './observatory-agent-gantt'

/**
 * « REJOUER CE RUN » (conv-981, 2026-10-15) : depuis le bilan du run, le déroulé par agent — le
 * MÊME diagramme que la Chronologie de l'Observatory — se rejoue en 10 s, chaque étape s'allumant à
 * son heure. Bornes du cadrage : run en cours ou sans déroulé = pas de bouton ; un second clic
 * repart du début, sans doublon.
 *
 * fix-ok: conv-981 - le bilan ne recevait aucune étape (BilanDeCloture ne passait que `closure`).
 * Fichier écrit UNE seule fois dans run-52d36e67e4de-1 ; le contrôle des causes en comptait 3 (même
 * écriture sous son chemin complet et son chemin court, plus le relevé de fin d'étape).
 */
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

const T0 = Date.parse('2026-10-15T10:00:00.000Z')
const gantt: AgentGantt = {
  start: T0,
  end: T0 + 100_000,
  ticks: [],
  lanes: [
    {
      key: 'scout:subagent',
      phase: 'scout',
      label: 'Scout',
      spans: [
        {
          id: 's1',
          eventId: 's1',
          start: T0,
          end: T0 + 40_000,
          durationMs: 40_000,
          status: 'ok',
          actions: 3,
          summary: 'cible'
        }
      ]
    },
    {
      key: 'judge:subagent',
      phase: 'judge',
      label: 'Juge',
      spans: [
        {
          id: 'j1',
          eventId: 'j1',
          start: T0 + 60_000,
          end: T0 + 100_000,
          durationMs: 40_000,
          status: 'ok',
          actions: 1,
          summary: 'vert'
        }
      ]
    }
  ]
}

function rendre(
  statut: 'green' | 'open',
  avecGantt = true,
  onVoirDansObservatory?: () => void
): void {
  act(() =>
    root.render(
      createElement(BilanDeCloture, {
        closure: { status: statut, totalDurationMs: 100_000, totalCostUsd: 1.2 },
        runs: [],
        onOuvrirRunMd: () => undefined,
        ...(avecGantt ? { gantt } : {}),
        ...(onVoirDansObservatory ? { onVoirDansObservatory } : {})
      })
    )
  )
}
const bouton = (): HTMLButtonElement | null =>
  container.querySelector('[data-testid="run-rejeu-bouton"]')
const diagramme = (): HTMLElement | null =>
  container.querySelector('[data-testid="observatory-agent-gantt"]')

describe('Rejouer ce run, depuis le bilan', () => {
  it('montre le déroulé du run et un bouton pour le rejouer', () => {
    rendre('green')
    expect(bouton()?.textContent).toBe('Rejouer ce run')
    expect(diagramme()).not.toBeNull()
    expect(diagramme()?.hasAttribute('data-rejeu')).toBe(false)
  })

  it('le clic rejoue : chaque barre s’allume à son heure, à l’échelle de 10 s', () => {
    rendre('green')
    act(() => bouton()?.click())
    expect(diagramme()?.getAttribute('data-rejeu')).toBe('1')
    const barres = [
      ...container.querySelectorAll<HTMLElement>('[data-testid="observatory-gantt-bar"]')
    ]
    expect(barres.map((b) => b.style.getPropertyValue('--rejeu-delai'))).toEqual(['0ms', '6000ms'])
    expect(barres.map((b) => b.style.getPropertyValue('--rejeu-duree'))).toEqual([
      '4000ms',
      '4000ms'
    ])
  })

  it('un second clic repart du début, sans doublon', () => {
    rendre('green')
    act(() => bouton()?.click())
    const premier = diagramme()
    act(() => bouton()?.click())
    expect(container.querySelectorAll('[data-testid="observatory-agent-gantt"]')).toHaveLength(1)
    expect(diagramme()).not.toBe(premier)
    expect(diagramme()?.getAttribute('data-rejeu')).toBe('2')
  })

  it('run en cours : pas de bouton (jumeau)', () => {
    rendre('open')
    expect(bouton()).toBeNull()
  })

  it('aucun déroulé tracé : ni bouton ni diagramme', () => {
    rendre('green', false)
    expect(bouton()).toBeNull()
    expect(diagramme()).toBeNull()
  })

  it('renvoie vers l’Observatory pour la version complète du déroulé (conv-981)', () => {
    const voir = vi.fn()
    rendre('green', true, voir)
    const lien = container.querySelector<HTMLButtonElement>('[data-testid="run-voir-observatory"]')
    expect(lien?.textContent).toContain('Observatory')
    act(() => lien?.click())
    expect(voir).toHaveBeenCalledTimes(1)
  })

  it('sans moyen d’ouvrir l’Observatory, aucun lien mort (jumeau)', () => {
    rendre('green')
    expect(container.querySelector('[data-testid="run-voir-observatory"]')).toBeNull()
    expect(bouton()).not.toBeNull()
  })
})
