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

  it('propose une BANDE par thème du REGISTRE, groupée par famille', async () => {
    // Le cas qui rend le plafond de deux thèmes impossible à réintroduire : l'écran doit offrir
    // exactement ce que `THEMES` déclare. Ajouter un thème au registre suffit donc à le proposer.
    const container = await monter()
    const bandes = [...container.querySelectorAll<HTMLInputElement>('.interface-theme-bande input')]
    // L'ordre à l'écran est celui des FAMILLES (sombres puis clairs), pas celui du registre :
    // c'est le regroupement qui rend les huit thèmes lisibles d'un coup d'œil. On compare donc à
    // l'attendu groupé, et le compte doit rester celui du registre — aucun thème perdu en route.
    const attendu = [
      ...THEMES.filter((t) => t.base === 'sombre'),
      ...THEMES.filter((t) => t.base === 'clair')
    ]
    expect(bandes.map((b) => b.value)).toEqual(attendu.map((t) => t.id))
    expect(bandes).toHaveLength(THEMES.length)
    // Et le libellé lu par l'utilisateur vient du registre lui aussi.
    const noms = [...container.querySelectorAll('.interface-theme-nom')].map((n) => n.textContent)
    expect(noms).toEqual(attendu.map((t) => t.libelle))
    const familles = [...container.querySelectorAll('.interface-theme-groupe legend')]
    expect(familles.map((f) => f.textContent)).toEqual(['Sombres', 'Clairs'])
  })

  /**
   * ENTRÉE QUI DOIT FAIRE ÉCHOUER CE CAS : une lecture des aperçus qui oublie de restaurer.
   * Les couleurs des bandes ne sont pas recopiées mais MESURÉES — on applique chaque thème puis
   * on relit ses jetons. Sans restauration, ouvrir ce réglage changerait l'apparence de
   * l'application pour le dernier thème de la liste.
   */
  it('n’altère pas le thème courant en mesurant les aperçus', async () => {
    localStorage.setItem(THEME_MODE_STORAGE_KEY, 'clair')
    await monter()
    expect(document.documentElement.getAttribute('data-theme')).toBe('clair')
    expect(document.documentElement.getAttribute('data-base')).toBe('clair')
  })

  it('choisit le clair, le mémorise et le pose sur la racine du document', async () => {
    const container = await monter()
    expect(
      container.querySelector<HTMLInputElement>('.interface-theme-bande input:checked')?.value
    ).toBe('sombre')

    // `click()` NATIF, et non un `Event` fabriqué : sur un bouton radio, seul le premier coche
    // réellement la case et émet le `change` que React écoute. Mesuré ici même.
    await act(async () => {
      container.querySelector<HTMLInputElement>('[data-testid="interface-theme-clair"]')!.click()
    })

    expect(localStorage.getItem(THEME_MODE_STORAGE_KEY)).toBe('clair')
    expect(document.documentElement.getAttribute('data-theme')).toBe('clair')
  })

  it('revient au sombre en RETIRANT l’attribut, sans laisser d’état bâtard', async () => {
    localStorage.setItem(THEME_MODE_STORAGE_KEY, 'clair')
    const container = await monter()
    expect(
      container.querySelector<HTMLInputElement>('.interface-theme-bande input:checked')?.value
    ).toBe('clair')
    expect(document.documentElement.getAttribute('data-theme')).toBe('clair')

    await act(async () => {
      container.querySelector<HTMLInputElement>('[data-testid="interface-theme-sombre"]')!.click()
    })

    expect(localStorage.getItem(THEME_MODE_STORAGE_KEY)).toBe('sombre')
    // Le sombre est l'état NU du document : aucun attribut. Les 102 blocs de style écrits sans
    // préfixe en dépendent — s'il écrivait `data-theme="sombre"`, rien ne casserait visiblement
    // aujourd'hui, mais la règle « sombre = défaut nu » serait perdue.
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false)
  })
})
