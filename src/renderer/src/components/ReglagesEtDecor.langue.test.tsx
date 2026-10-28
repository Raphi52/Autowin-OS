// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { InterfaceView } from './InterfaceView'
import { repairAffordance } from './preflight-repair-affordance'
import { describeAutoModeCost } from './ticket-auto-mode'
import { appliquerLangue } from '../langue'

/**
 * SETTINGS · INTERFACE SUIT LA LANGUE : la liste des thèmes et le réglage de la mascotte (traduction
 * anglaise, conv-1170, lot « Noms des thèmes, mascotte, décors de l’accueil et derniers fichiers »).
 * Entrée qui doit faire échouer ce test : un texte de la mascotte laissé en dur, un nom de thème
 * affiché sans passer par la langue, un composant qui ne se redessine pas quand elle change, ou un
 * français modifié par la traduction.
 */
beforeAll(() => {
  ;(globalThis as never as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
})

let root: Root | null = null
let hote: HTMLDivElement | null = null

async function monter(): Promise<HTMLDivElement> {
  ;(window as unknown as { api: unknown }).api = {
    mascotteAffichee: vi.fn(async () => true),
    afficherMascotte: vi.fn(async (oui: boolean) => oui)
  }
  hote = document.createElement('div')
  document.body.appendChild(hote)
  root = createRoot(hote)
  await act(async () => root!.render(createElement(InterfaceView)))
  return hote
}

afterEach(async () => {
  await act(async () => root?.unmount())
  hote?.remove()
  root = null
  hote = null
  delete (window as unknown as { api?: unknown }).api
  appliquerLangue('fr')
})

describe('Settings · Interface — thèmes et mascotte, langue', () => {
  it('bascule en anglais sans être remonté, puis revient au français', async () => {
    const vue = await monter()
    const themes = (): (string | null)[] =>
      [...vue.querySelectorAll<HTMLOptionElement>('[data-testid="interface-theme"] option')].map(
        (o) => o.textContent
      )
    const mascotte = (): HTMLElement => vue.querySelector('[data-testid="interface-mascotte"]')!
    const interrupteur = (): HTMLElement =>
      vue.querySelector('[data-testid="interface-mascotte-switch"]')!

    expect(themes()).toContain('Holographique')
    expect(mascotte().querySelector('strong')?.textContent).toBe('Mascotte du bureau')
    expect(interrupteur().getAttribute('aria-label')).toBe('Afficher la mascotte du bureau')
    expect(interrupteur().textContent).toContain('Affichée')
    const descriptionFr = mascotte().querySelector('p')?.textContent

    await act(async () => appliquerLangue('en'))
    expect(themes()).toEqual(expect.arrayContaining(['Dark', 'Light', 'Holographic', 'Typewriter']))
    expect(mascotte().querySelector('strong')?.textContent).toBe('Desktop mascot')
    expect(interrupteur().getAttribute('aria-label')).toBe('Show the desktop mascot')
    expect(interrupteur().textContent).toContain('Shown')
    expect(mascotte().querySelector('p')?.textContent).toContain('marble')
    // Les mots en gras restent en gras dans l'autre langue.
    expect([...mascotte().querySelectorAll('p strong')].map((s) => s.textContent)).toContain(
      'rainbow edge'
    )

    await act(async () => interrupteur().click())
    expect(interrupteur().textContent).toContain('Hidden')

    await act(async () => appliquerLangue('fr'))
    expect(interrupteur().textContent).toContain('Masquée')
    expect(mascotte().querySelector('strong')?.textContent).toBe('Mascotte du bureau')
    // Le français affiché est exactement celui d'avant la traduction.
    expect(mascotte().querySelector('p')?.textContent).toBe(descriptionFr)
    expect(themes()).toContain('Holographique')
  })

  it('les boutons de réparation et le coût du mode auto des tickets suivent la langue', () => {
    appliquerLangue('en')
    expect(repairAffordance('brain')?.label).toBe('Start')
    expect(repairAffordance('claude-session')?.label).toBe('Sign in')
    expect(describeAutoModeCost({ concurrency: 2, capPerCycle: 3, maxRunsPerSession: 10 }, 5)).toBe(
      '5 run(s) to launch · 2 in parallel · max 3/cycle · session cap 10 paid run(s)'
    )

    appliquerLangue('fr')
    expect(repairAffordance('brain')?.label).toBe('Démarrer')
    expect(describeAutoModeCost({ concurrency: 2, capPerCycle: 3, maxRunsPerSession: 10 }, 5)).toBe(
      '5 run(s) à lancer · 2 en parallèle · max 3/cycle · plafond session 10 run(s) payants'
    )
  })
})
