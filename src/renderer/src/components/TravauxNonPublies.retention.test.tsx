// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TravauxNonPublies } from './TravauxNonPublies'
import type { RapportRetention } from '../../../shared/rapport-retention'

/**
 * LE RAPPORT DU BALAYAGE DOIT ETRE LISIBLE A L'ECRAN, pas seulement dans la console.
 *
 * Le balayage de retention tournait au demarrage puis chaque heure et n'ecrivait son verdict que
 * dans `console.info` — donc hors de portee de qui utilise l'application. C'est la meme cause qui a
 * laisse quatorze travaux dormir sur des branches de secours le 2026-08-24 : le verdict existait,
 * personne ne pouvait le voir. Ces tests echouent si l'affichage disparait.
 */

let container: HTMLDivElement
let root: Root

function monter(rapport: RapportRetention | undefined): Promise<void> {
  const connu: Record<string, unknown> = {
    getTravauxNonPublies: vi.fn().mockResolvedValue([]),
    getRapportRetention: vi.fn().mockResolvedValue(rapport)
  }
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: new Proxy(connu, {
      get: (cible, propriete: string) =>
        cible[propriete] ?? (cible[propriete] = vi.fn().mockResolvedValue(undefined))
    })
  })
  return act(async () => {
    root.render(createElement(TravauxNonPublies, { onFermer: () => undefined }))
    await Promise.resolve()
    await Promise.resolve()
  })
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('le rapport du balayage de rétention est VISIBLE dans le panneau', () => {
  it('affiche les comptes de la dernière passe', async () => {
    await monter({
      faitLe: '2026-09-08T10:00:00.000Z',
      examines: 249,
      sansPerte: ['autowin/secours/a', 'autowin/secours/b'],
      aTrancher: ['autowin/preserve/gel'],
      reportees: 0
    })
    const resume = container.querySelector('[data-testid="tnp-retention-resume"]')?.textContent
    expect(resume).toContain('249')
    expect(resume).toContain('2 sans')
    expect(resume).toContain('1 à trancher')
  })

  it('SEPARE les deux catégories — « déjà en base » et « périmé » n’engagent pas la même chose', async () => {
    await monter({
      faitLe: '2026-09-08T10:00:00.000Z',
      examines: 3,
      sansPerte: ['autowin/secours/deja-en-base'],
      aTrancher: ['autowin/preserve/porteur'],
      reportees: 0
    })
    const sansPerte = container.querySelector('[data-testid="tnp-retention-sans-perte"]')
    const aTrancher = container.querySelector('[data-testid="tnp-retention-a-trancher"]')
    expect(sansPerte?.textContent).toContain('autowin/secours/deja-en-base')
    expect(sansPerte?.textContent).not.toContain('porteur')
    expect(aTrancher?.textContent).toContain('autowin/preserve/porteur')
  })

  it('annonce le report quand le plafond du passage a mordu', async () => {
    await monter({
      faitLe: '2026-09-08T10:00:00.000Z',
      examines: 300,
      sansPerte: [],
      aTrancher: [],
      reportees: 7
    })
    expect(container.querySelector('[data-testid="tnp-retention-resume"]')?.textContent).toContain(
      '7 au prochain passage'
    )
  })

  /**
   * « Rien a signaler » et « on n'a rien regarde » ne se disent PAS pareil : afficher un stock sain
   * alors qu'aucune passe n'a eu lieu serait une fausse assurance, exactement le defaut qu'on repare.
   */
  it('distingue « aucune passe encore faite » d’un stock sain', async () => {
    await monter(undefined)
    expect(container.querySelector('[data-testid="tnp-retention-jamais"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="tnp-retention-resume"]')).toBeNull()
  })
})
