// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BrainPersoSettings } from './BrainPersoSettings'
import type { BrainPersoState } from '../../../shared/preload-contracts'
;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

/** Réglages › Brain perso (conv-1233, 2026-10-28) : privé, à côté du Brain d'équipe. */
const mounted: Array<{ root: ReturnType<typeof createRoot>; container: HTMLDivElement }> = []
afterEach(async () => {
  for (const item of mounted.splice(0)) {
    await act(async () => item.root.unmount())
    item.container.remove()
  }
})

const etat = (partiel: Partial<BrainPersoState> = {}): BrainPersoState => ({
  choisi: null,
  racine: null,
  origine: 'http://127.0.0.1:8775',
  serveurJoignable: false,
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
  await act(async () => root.render(createElement(BrainPersoSettings)))
  await act(async () => undefined)
  return container
}

function saisir(input: HTMLInputElement, valeur: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  setter.call(input, valeur)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

describe('Réglages — Brain perso', () => {
  it('sans réglage : dit que tout va au Brain d’équipe, et n’offre pas d’enregistrer un vide', async () => {
    const c = await monter({ brainPerso: vi.fn().mockResolvedValue(etat()) })
    expect(c.querySelector('[data-testid="brain-perso-etat"]')?.textContent).toContain(
      'Brain d’équipe'
    )
    const bouton = c.querySelector('[data-testid="brain-perso-enregistrer"]') as HTMLButtonElement
    expect(bouton.disabled).toBe(true)
    expect(c.querySelector('[data-testid="brain-perso-retirer"]')).toBeNull()
  })

  it('enregistre le dossier saisi, puis montre le Brain perso et son serveur', async () => {
    const enregistrer = vi
      .fn()
      .mockResolvedValue(
        etat({ choisi: { chemin: 'D:\\MonBrain' }, racine: 'D:\\MonBrain', serveurJoignable: true })
      )
    const c = await monter({
      brainPerso: vi.fn().mockResolvedValue(etat()),
      enregistrerBrainPerso: enregistrer
    })
    await act(async () => {
      saisir(c.querySelector('[data-testid="brain-perso-chemin"]')!, 'D:\\MonBrain')
    })
    await act(async () => {
      ;(c.querySelector('[data-testid="brain-perso-enregistrer"]') as HTMLButtonElement).click()
    })
    expect(enregistrer).toHaveBeenCalledWith({ chemin: 'D:\\MonBrain' })
    const texte = c.querySelector('[data-testid="brain-perso-etat"]')?.textContent ?? ''
    expect(texte).toContain('D:\\MonBrain')
    expect(texte).toContain('serveur prêt')
    expect(c.querySelector('[data-testid="brain-perso-retirer"]')).not.toBeNull()
  })

  it('serveur lancé sur un ancien dossier : le dit', async () => {
    const c = await monter({
      brainPerso: vi.fn().mockResolvedValue(
        etat({
          choisi: { chemin: 'D:\\MonBrain' },
          racine: 'D:\\MonBrain',
          serveurJoignable: true,
          serveurRacine: 'D:\\Ancien',
          serveurSurUnAutreDossier: true
        })
      )
    })
    expect(c.querySelector('[data-testid="brain-perso-serveur"]')?.textContent).toContain(
      'D:\\Ancien'
    )
  })
})
