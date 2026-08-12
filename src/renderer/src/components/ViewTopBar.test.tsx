// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ViewTopBar } from './ViewTopBar'

/**
 * UNE SEULE définition de la barre du haut, pour toutes les vues.
 *
 * Elles avaient deux arrangements DIFFÉRENTS pour la même intention : Task Manager posait un
 * `ModuleHeader` (surtitre + titre + description) PUIS ses pastilles de sections ; Agent Studio,
 * Settings et Knowledge ouvraient directement sur `nav.domain-tabs`, sans en-tête. Même CSS de
 * pastilles, arrangements divergents — donc la vue qu'on ouvrait changeait de forme sans raison.
 *
 * L'utilisateur a tranché : celle de Task Manager fait référence. Ce composant l'encapsule au lieu de
 * la recopier dans cinq fichiers — c'est la même leçon que le reste de cette session : deux copies
 * d'une intention divergent toujours, et on ne s'en aperçoit qu'à l'usage.
 *
 * DÉTAIL QUI N'EST PAS UN DÉTAIL : `.domain-tabs` n'est stylé que dans `DomainShell.css`, que
 * TaskManagerView n'importait PAS. Sa barre n'était jolie que parce qu'une AUTRE vue avait chargé
 * cette feuille (le CSS d'un bundle est global). Ce composant importe la feuille lui-même, donc la
 * barre ne dépend plus de l'ordre de chargement des vues.
 */
;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

const mounted: Array<{ root: ReturnType<typeof createRoot>; container: HTMLDivElement }> = []

afterEach(async () => {
  for (const item of mounted.splice(0)) {
    await act(async () => item.root.unmount())
    item.container.remove()
  }
})

async function monter(props: Parameters<typeof ViewTopBar>[0]) {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  mounted.push({ root, container })
  await act(async () => root.render(createElement(ViewTopBar, props)))
  return container
}

const ONGLETS = [
  { id: 'a', label: 'Alpha' },
  { id: 'b', label: 'Bravo' }
]

describe('ViewTopBar — la barre de Task Manager, pour toutes les vues', () => {
  it('rend surtitre, titre et description dans l ordre de Task Manager', async () => {
    const container = await monter({
      eyebrow: 'AUTOMATISATION',
      title: 'Task Manager',
      description: 'Planifie de vrais prompts Chat.',
      tabs: ONGLETS,
      active: 'a',
      onSelect: () => {}
    })
    const entete = container.querySelector('.module-header')
    expect(entete?.querySelector('span')?.textContent).toBe('AUTOMATISATION')
    expect(entete?.querySelector('h1')?.textContent).toBe('Task Manager')
    expect(container.querySelector('.view-topbar-description')?.textContent).toBe(
      'Planifie de vrais prompts Chat.'
    )
  })

  it('la description est OPTIONNELLE et n occupe aucune place quand elle manque', async () => {
    const container = await monter({
      eyebrow: 'X',
      title: 'Y',
      tabs: ONGLETS,
      active: 'a',
      onSelect: () => {}
    })
    expect(container.querySelector('.view-topbar-description')).toBeNull()
  })

  it('les pastilles portent la classe partagée, donc le style partagé', async () => {
    const container = await monter({
      eyebrow: 'X',
      title: 'Y',
      tabs: ONGLETS,
      active: 'b',
      onSelect: () => {}
    })
    const nav = container.querySelector('nav.domain-tabs')
    expect(nav).not.toBeNull()
    expect([...nav!.querySelectorAll('button')].map((b) => b.textContent?.trim())).toEqual([
      'Alpha',
      'Bravo'
    ])
  })

  it('marque l onglet actif pour un lecteur d écran ET en classe', async () => {
    const container = await monter({
      eyebrow: 'X',
      title: 'Y',
      tabs: ONGLETS,
      active: 'b',
      onSelect: () => {}
    })
    const [alpha, bravo] = [...container.querySelectorAll<HTMLButtonElement>('.domain-tabs button')]
    expect(bravo.getAttribute('aria-pressed')).toBe('true')
    expect(bravo.className).toContain('is-active')
    expect(alpha.getAttribute('aria-pressed')).toBe('false')
    expect(alpha.className).not.toContain('is-active')
  })

  it('remonte la sélection', async () => {
    const onSelect = vi.fn()
    const container = await monter({
      eyebrow: 'X',
      title: 'Y',
      tabs: ONGLETS,
      active: 'a',
      onSelect
    })
    const bravo = [...container.querySelectorAll<HTMLButtonElement>('.domain-tabs button')][1]
    await act(async () => bravo.click())
    expect(onSelect).toHaveBeenCalledWith('b')
  })

  it('porte un badge d anomalie quand un onglet en déclare un, et PAS sinon', async () => {
    const container = await monter({
      eyebrow: 'X',
      title: 'Y',
      tabs: [
        { id: 'a', label: 'Alpha' },
        { id: 'b', label: 'Bravo', anomaly: { count: 2, title: 'deux soucis' } }
      ],
      active: 'a',
      onSelect: () => {}
    })
    const badges = container.querySelectorAll('.domain-tab-anomaly')
    expect(badges).toHaveLength(1)
    expect(badges[0].textContent).toBe('2')
    expect(badges[0].getAttribute('title')).toBe('deux soucis')
  })

  it('un badge à ZÉRO ne s affiche pas — un compteur nul n est pas une alerte', async () => {
    const container = await monter({
      eyebrow: 'X',
      title: 'Y',
      tabs: [{ id: 'a', label: 'Alpha', anomaly: { count: 0, title: 'rien' } }],
      active: 'a',
      onSelect: () => {}
    })
    expect(container.querySelector('.domain-tab-anomaly')).toBeNull()
  })

  it('accepte des actions à droite, comme le bouton « + Nouvelle tâche »', async () => {
    const container = await monter({
      eyebrow: 'X',
      title: 'Y',
      tabs: ONGLETS,
      active: 'a',
      onSelect: () => {},
      actions: createElement('button', { type: 'button' }, '+ Nouvelle tâche')
    })
    expect(container.querySelector('.view-topbar-actions')?.textContent).toContain(
      '+ Nouvelle tâche'
    )
  })
})
