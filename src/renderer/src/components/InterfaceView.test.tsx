// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SettingsView } from './SettingsView'
import { THEMES, THEME_MODE_STORAGE_KEY } from '../theme-mode'

vi.mock('./CapabilitiesView', () => ({ CapabilitiesView: () => null }))
vi.mock('./BehaviourView', () => ({ BehaviourView: () => null }))
vi.mock('./OrchestrationBudgetSettings', () => ({ OrchestrationBudgetSettings: () => null }))
vi.mock('./ShadowRoutingPilotSettings', () => ({ ShadowRoutingPilotSettings: () => null }))

;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

const mounted: Array<{ root: ReturnType<typeof createRoot>; container: HTMLDivElement }> = []

async function monter(section: 'interface' | 'behaviour' = 'interface') {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  mounted.push({ root, container })
  await act(async () => {
    root.render(createElement(SettingsView, { active: true, section, onSectionChange: vi.fn() }))
  })
  return container
}

beforeEach(() => {
  localStorage.clear()
  document.documentElement.removeAttribute('data-theme')
})

afterEach(async () => {
  for (const item of mounted.splice(0)) {
    await act(async () => item.root.unmount())
    item.container.remove()
  }
})

/**
 * ENTRÉE QUI DOIT FAIRE ÉCHOUER CE TEST : retirer l'onglet Interface de Settings, débrancher la
 * liste du réglage, ou la recâbler en dur sur deux valeurs — l'utilisateur aurait un réglage qui
 * ne fait rien, ou une liste qui ne pourrait plus accueillir de thème.
 *
 * Pourquoi une LISTE et plus un interrupteur : mesure du 2026-09-07, un interrupteur ne sait dire
 * que oui / non, donc il plafonnait l'application à deux apparences. Le cas « la liste est peuplée
 * depuis le registre » ci-dessous est celui qui empêche de revenir en arrière : il échoue si
 * quelqu'un réécrit les options à la main.
 */
describe('Settings · Interface', () => {
  it('propose un onglet Interface dans la barre de sections', async () => {
    const container = await monter('behaviour')
    const onglets = [...container.querySelectorAll('button')].map((b) => b.textContent)
    expect(onglets).toContain('Interface')
  })

  it('peuple la liste depuis le REGISTRE, pas à la main', async () => {
    // Le cas qui rend le plafond de deux thèmes impossible à réintroduire : la liste doit offrir
    // exactement ce que `THEMES` déclare. Ajouter un thème au registre suffit donc à le proposer.
    const container = await monter()
    const liste = container.querySelector<HTMLSelectElement>('[data-testid="interface-theme"]')
    expect(liste).not.toBeNull()

    const proposes = [...liste!.options].map((o) => o.value)
    expect(proposes).toEqual(THEMES.map((t) => t.id))
    // Et le libellé lu par l'utilisateur vient du registre lui aussi.
    expect([...liste!.options].map((o) => o.textContent)).toEqual(THEMES.map((t) => t.libelle))
  })

  it('choisit le clair, le mémorise et le pose sur la racine du document', async () => {
    const container = await monter()
    const liste = container.querySelector<HTMLSelectElement>('[data-testid="interface-theme"]')!
    expect(liste.value).toBe('sombre')

    // Une liste native ne réagit pas à `click()` : on pose la valeur puis on émet `change`,
    // ce que React écoute réellement.
    await act(async () => {
      liste.value = 'clair'
      liste.dispatchEvent(new Event('change', { bubbles: true }))
    })

    expect(localStorage.getItem(THEME_MODE_STORAGE_KEY)).toBe('clair')
    expect(document.documentElement.getAttribute('data-theme')).toBe('clair')
  })

  it('revient au sombre en RETIRANT l’attribut, sans laisser d’état bâtard', async () => {
    localStorage.setItem(THEME_MODE_STORAGE_KEY, 'clair')
    const container = await monter()
    const liste = container.querySelector<HTMLSelectElement>('[data-testid="interface-theme"]')!
    expect(liste.value).toBe('clair')
    expect(document.documentElement.getAttribute('data-theme')).toBe('clair')

    await act(async () => {
      liste.value = 'sombre'
      liste.dispatchEvent(new Event('change', { bubbles: true }))
    })

    expect(localStorage.getItem(THEME_MODE_STORAGE_KEY)).toBe('sombre')
    // Le sombre est l'état NU du document : aucun attribut. Les 102 blocs de style écrits sans
    // préfixe en dépendent — s'il écrivait `data-theme="sombre"`, rien ne casserait visiblement
    // aujourd'hui, mais la règle « sombre = défaut nu » serait perdue.
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false)
  })
})
