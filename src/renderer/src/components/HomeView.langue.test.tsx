// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { HomeView } from './HomeView'
import { HOME_WIDGET_TITLES } from './home-layout'
import { appliquerLangue } from '../langue'
import { TEXTES_FR } from '../textes-ecrans/accueil'

/**
 * L'ACCUEIL SUIT LA LANGUE (traduction anglaise, conv-1170, lot « Accueil »). Entrée qui doit faire
 * échouer ce test : un libellé de l'accueil ou d'un de ses widgets (Interlocuteurs, Transcription,
 * Jarvis) laissé en dur, un écran qui ne se redessine pas quand la langue change, ou un retour au
 * français qui ne rend pas le texte d'origine mot pour mot.
 */
beforeAll(() => {
  ;(globalThis as never as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
})

// Horloge figée, comme `HomeView.test.tsx` : « dans 12 min » ne dépend pas de l'heure du test.
const HORLOGE = new Date(2026, 7, 22, 10, 0, 0)
const MAINTENANT = HORLOGE.getTime()

let root: Root | null = null
let hote: HTMLDivElement | null = null

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(HORLOGE)
  // Sans `outlookSnapshot` : les widgets Interlocuteurs et Agenda disent la panne (texte traduit).
  ;(window as unknown as { api: unknown }).api = {
    taskManagerSnapshot: vi.fn(async () => ({
      tasks: [
        { id: 't-matin', title: 'Rapport', enabled: true, nextRunAt: MAINTENANT + 12 * 60_000 },
        { id: 't-off', title: 'Nettoyage', enabled: false, nextRunAt: MAINTENANT + 3_600_000 }
      ],
      alerts: [
        {
          id: 'al-1',
          taskId: 't-matin',
          kind: 'missed' as const,
          message: 'départ manqué',
          createdAt: MAINTENANT - 60_000
        }
      ]
    }))
  }
})

afterEach(async () => {
  await act(async () => root?.unmount())
  hote?.remove()
  root = null
  hote = null
  appliquerLangue('fr')
  window.localStorage.clear()
  vi.useRealTimers()
})

async function monter(): Promise<HTMLDivElement> {
  hote = document.createElement('div')
  document.body.appendChild(hote)
  root = createRoot(hote)
  await act(async () => root!.render(createElement(HomeView, { active: true })))
  return hote
}

const tuile = (ecran: HTMLElement, id: string): string =>
  ecran.querySelector(`[data-testid="home-widget-${id}"]`)?.textContent ?? ''

describe('écran Accueil — langue', () => {
  it('bascule en anglais sans être remonté, puis revient au français mot pour mot', async () => {
    const ecran = await monter()
    const francais = ecran.textContent
    const reglages = () =>
      ecran.querySelector('[aria-label="Réglages de l’accueil"], [aria-label="Home settings"]')
    expect(tuile(ecran, 'agenda')).toContain('Agenda')
    expect(tuile(ecran, 'routines')).toContain('dans 12 min')
    expect(tuile(ecran, 'jarvis')).toContain('Activer l’écoute')
    expect(reglages()?.getAttribute('aria-label')).toBe('Réglages de l’accueil')

    await act(async () => appliquerLangue('en'))
    // HomeView : titres des tuiles, routines, remontées, bouton des réglages.
    expect(tuile(ecran, 'agenda')).toContain('Calendar')
    expect(tuile(ecran, 'notifications')).toContain('Agent reports')
    expect(tuile(ecran, 'notifications')).toContain('missed run')
    // La croix d'acquittement n'a plus de mot visible (conv-1225) : son nom accessible se traduit.
    expect(
      ecran.querySelector('[data-testid="home-widget-notifications"] .home-notices__acquitter')
        ?.getAttribute('aria-label')
    ).toBe('Acknowledge')
    expect(tuile(ecran, 'routines')).toContain('in 12 min')
    expect(tuile(ecran, 'routines')).toContain('turned off')
    expect(reglages()?.getAttribute('aria-label')).toBe('Home settings')
    // Interlocuteurs : la panne d'Outlook et le bouton d'actualisation.
    expect(tuile(ecran, 'mails')).toContain('Contacts')
    expect(tuile(ecran, 'mails')).toContain('Outlook unreachable:')
    expect(tuile(ecran, 'mails')).toContain('Refresh')
    // Transcription (Enregistrements) et Jarvis.
    expect(tuile(ecran, 'enregistrements')).toContain('⏺ Record')
    expect(tuile(ecran, 'enregistrements')).toContain('Audio settings')
    expect(tuile(ecran, 'jarvis')).toContain('Start listening')
    expect(tuile(ecran, 'jarvis')).toContain('Assistant settings')
    for (const reste of ['Actualiser', 'Acquitter', 'Activer l’écoute', 'Paramètres audio']) {
      expect(ecran.textContent).not.toContain(reste)
    }

    await act(async () => appliquerLangue('fr'))
    expect(ecran.textContent).toBe(francais)
  })

  it('le titre français de chaque tuile est celui de `HOME_WIDGET_TITLES`, mot pour mot', () => {
    // La table de l'accueil recopie ces titres pour les traduire : elle ne doit jamais en dériver.
    const titres = TEXTES_FR as Readonly<Record<string, string>>
    for (const [id, titre] of Object.entries(HOME_WIDGET_TITLES)) {
      if (id === 'jarvis') continue // le nom de l'assistant, choisi par l'utilisateur, pas un texte
      expect(titres[`tuile.${id}`]).toBe(titre)
    }
  })
})
