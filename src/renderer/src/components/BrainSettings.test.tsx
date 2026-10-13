// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BrainSettings } from './BrainSettings'
import type { BrainReglageState } from '../../../shared/preload-contracts'
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

const etat = (partiel: Partial<BrainReglageState> = {}): BrainReglageState => ({
  actif: '\\\\fichiers\\equipe\\Brain',
  effectif: '\\\\fichiers\\equipe\\Brain',
  choisi: null,
  estUnDepot: false,
  redemarrageNecessaire: false,
  serveurRacine: null,
  serveurSurUnAutreDossier: false,
  ...partiel
})

async function monter(api: Record<string, unknown>): Promise<HTMLDivElement> {
  Object.defineProperty(window, 'api', { configurable: true, value: api })
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  mounted.push({ root, container })
  await act(async () => root.render(createElement(BrainSettings)))
  await act(async () => undefined)
  return container
}

function saisir(input: HTMLInputElement, valeur: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  setter.call(input, valeur)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

describe('Réglages — Brain (chemin et/ou dépôt)', () => {
  it('dit le dossier actif et qu’un simple dossier ne reçoit aucune commande git', async () => {
    const c = await monter({ brainReglage: vi.fn().mockResolvedValue(etat()) })
    const actif = c.querySelector('[data-testid="brain-reglage-actif"]')?.textContent ?? ''
    expect(actif).toContain('\\\\fichiers\\equipe\\Brain')
    expect(actif).toContain('aucune commande git')
  })

  it('enregistre le chemin ET le dépôt saisis, puis annonce le redémarrage', async () => {
    const enregistrer = vi.fn().mockResolvedValue(
      etat({
        effectif: 'D:\\Brain',
        choisi: { chemin: 'D:\\Brain', depot: 'https://github.com/moi/brain.git' },
        estUnDepot: true,
        redemarrageNecessaire: true
      })
    )
    const c = await monter({ brainReglage: vi.fn().mockResolvedValue(etat()), enregistrerBrainReglage: enregistrer })

    await act(async () => {
      saisir(c.querySelector('[data-testid="brain-reglage-chemin"]')!, 'D:\\Brain')
      saisir(c.querySelector('[data-testid="brain-reglage-depot"]')!, 'https://github.com/moi/brain.git')
    })
    await act(async () => {
      ;(c.querySelector('[data-testid="brain-reglage-enregistrer"]') as HTMLButtonElement).click()
    })

    expect(enregistrer).toHaveBeenCalledWith({ chemin: 'D:\\Brain', depot: 'https://github.com/moi/brain.git' })
    expect(c.querySelector('[data-testid="brain-reglage-redemarrage"]')?.textContent).toContain('D:\\Brain')
  })

  it('montre le refus du réglage et prévient quand le serveur sert un autre dossier', async () => {
    const c = await monter({
      brainReglage: vi.fn().mockResolvedValue(
        etat({ serveurRacine: 'C:\\ancien', serveurSurUnAutreDossier: true, erreur: 'Dossier introuvable : X:\\nope' })
      )
    })
    expect(c.querySelector('[data-testid="brain-reglage-erreur"]')?.textContent).toContain('introuvable')
    expect(c.querySelector('[data-testid="brain-reglage-serveur"]')?.textContent).toContain('C:\\ancien')
  })
})
