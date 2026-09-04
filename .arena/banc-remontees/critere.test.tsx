// @vitest-environment happy-dom
/**
 * CRITÈRE DU BANC /arena — « le compteur du widget Remontées des agents ».
 * Fichier DÉPOSÉ puis RETIRÉ par check.mjs : il ne fait pas partie du dépôt.
 * Il rend la vraie page d'accueil et lit la pastille RÉELLEMENT affichée.
 */
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { HomeView } from './HomeView'

;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

const CLOCK = new Date(2026, 7, 22, 10, 0, 0)
const NOW = CLOCK.getTime()
const montees: Array<{ root: ReturnType<typeof createRoot>; container: HTMLDivElement }> = []

type Alerte = {
  id: string
  taskId: string
  kind: 'missed' | 'failed'
  message: string
  createdAt: number
  acknowledgedAt?: number
}

/** `total` remontées, dont les `acquittees` premières sont déjà lues. */
function alertes(total: number, acquittees: number): Alerte[] {
  return Array.from({ length: total }, (_, i) => ({
    id: `al-${i}`,
    taskId: 't-matin',
    kind: 'failed' as const,
    message: `remontee numero ${i}`,
    createdAt: NOW - i * 1000,
    ...(i < acquittees ? { acknowledgedAt: NOW } : {})
  }))
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(CLOCK)
})

afterEach(async () => {
  for (const item of montees.splice(0)) {
    await act(async () => item.root.unmount())
    item.container.remove()
  }
  window.localStorage.clear()
  vi.useRealTimers()
})

async function tuile(alerts: Alerte[]): Promise<HTMLElement> {
  ;(window as unknown as { api: unknown }).api = {
    taskManagerSnapshot: vi.fn(async () => ({
      tasks: [
        { id: 't-matin', title: 'Rapport du matin', enabled: true, nextRunAt: NOW + 60_000 }
      ],
      alerts
    }))
  }
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  montees.push({ root, container })
  await act(async () => {
    root.render(createElement(HomeView, { active: true }))
  })
  return container.querySelector('[data-testid="home-widget-notifications"]') as HTMLElement
}

const compteur = (el: HTMLElement): string | null =>
  el.querySelector('.home-tile__count')?.textContent ?? null
const lignes = (el: HTMLElement): number => el.querySelectorAll('.home-notices > li').length

it('nominal : 3 remontées dont 2 non lues, la pastille affiche 2', async () => {
  const el = await tuile(alertes(3, 1))
  expect(compteur(el)).toBe('2')
})

it('cas limite — 31 non lues pour 30 lignes affichables : la pastille doit dire 31, jamais 30', async () => {
  const el = await tuile(alertes(31, 0))
  expect(compteur(el)).toBe('31')
})

it('cas limite — aucune remontée : liste vide, aucune pastille, aucun plantage', async () => {
  const el = await tuile(alertes(0, 0))
  expect(compteur(el)).toBeNull()
  expect(el.textContent).toContain('Rien à signaler')
})

it('cas limite — zéro non lue parmi 40 déjà acquittées : aucune pastille', async () => {
  const el = await tuile(alertes(40, 40))
  expect(compteur(el)).toBeNull()
})

it('cas limite — 100 non lues : pastille exacte ET liste toujours bornée à 30 lignes', async () => {
  const el = await tuile(alertes(100, 0))
  expect(compteur(el)).toBe('100')
  expect(lignes(el)).toBeLessThanOrEqual(30)
})
