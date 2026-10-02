// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { ModeAutoSeuilsSettings } from './ModeAutoSeuilsSettings'
import { CLE_SEUILS_CHAINE_AUTO, lireSeuilsChaine } from './chat-auto-mode'

;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

const mounted: Array<{ root: ReturnType<typeof createRoot>; container: HTMLDivElement }> = []
afterEach(async () => {
  for (const item of mounted.splice(0)) {
    await act(async () => item.root.unmount())
    item.container.remove()
  }
  window.localStorage.removeItem(CLE_SEUILS_CHAINE_AUTO)
})

async function mount(): Promise<HTMLDivElement> {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  mounted.push({ root, container })
  await act(async () => root.render(createElement(ModeAutoSeuilsSettings)))
  return container
}

function saisir(input: HTMLInputElement, valeur: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  setter.call(input, valeur)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

describe('réglage des seuils du mode ∞', () => {
  it('affiche les défauts 80 % et 6 tours', async () => {
    const c = await mount()
    expect(c.querySelector<HTMLInputElement>('[data-testid="mode-auto-seuil-quota"]')!.value).toBe(
      '80'
    )
    expect(c.querySelector<HTMLInputElement>('[data-testid="mode-auto-seuil-tours"]')!.value).toBe(
      '6'
    )
  })
  it('enregistre des seuils que le chat relit tels quels', async () => {
    const c = await mount()
    await act(async () => {
      saisir(c.querySelector<HTMLInputElement>('[data-testid="mode-auto-seuil-quota"]')!, '70')
      saisir(c.querySelector<HTMLInputElement>('[data-testid="mode-auto-seuil-tours"]')!, '3')
    })
    await act(async () => {
      c.querySelector<HTMLButtonElement>('[data-testid="mode-auto-seuils-enregistrer"]')!.click()
    })
    expect(lireSeuilsChaine(window.localStorage.getItem(CLE_SEUILS_CHAINE_AUTO))).toEqual({
      quotaHebdoPct: 70,
      toursAutoMax: 3
    })
  })
  it('refuse un quota hors de 1-100 sans rien écrire', async () => {
    const c = await mount()
    await act(async () => {
      saisir(c.querySelector<HTMLInputElement>('[data-testid="mode-auto-seuil-quota"]')!, '150')
    })
    await act(async () => {
      c.querySelector<HTMLButtonElement>('[data-testid="mode-auto-seuils-enregistrer"]')!.click()
    })
    expect(window.localStorage.getItem(CLE_SEUILS_CHAINE_AUTO)).toBeNull()
    expect(c.textContent).toContain('entre 1 et 100')
  })
  // fix-ok: fichier NOUVEAU écrit en plusieurs pas (création, puis cas refus quota, puis cas plafond 1000 reproduit rouge : 5000 était écrit), pas un correctif à l'aveugle.
  it('refuse plus de 1000 tours, plafond que le chat applique en relisant', async () => {
    const c = await mount()
    await act(async () => {
      saisir(c.querySelector<HTMLInputElement>('[data-testid="mode-auto-seuil-tours"]')!, '5000')
    })
    await act(async () => {
      c.querySelector<HTMLButtonElement>('[data-testid="mode-auto-seuils-enregistrer"]')!.click()
    })
    expect(window.localStorage.getItem(CLE_SEUILS_CHAINE_AUTO)).toBeNull()
    expect(c.textContent).toContain('entre 1 et 1000')
  })
})
