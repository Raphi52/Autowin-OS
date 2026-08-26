// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { OrchestrationBudgetSettings } from './OrchestrationBudgetSettings'

/**
 * LE PANNEAU NE DOIT PROMETTRE QUE CE QU'IL TIENT.
 *
 * Defaut trouve par un audit externe, puis verifie ligne par ligne dans
 * `execution-supervisor.ts` : sous le titre « Protection des runs », le panneau affirmait « Un
 * nouvel appel est refuse avant son depart des que le budget est atteint, meme quand le fournisseur
 * ne communique aucun prix » -- et proposait QUATRE champs.
 *
 * Deux d'entre eux ne refusent rien. `maxUsd` et `maxTotalTokens` sont gates par
 * `enforceSpend = limits.spendEnforcement === 'blocking'`, et `spendEnforcement` vaut
 * `metering-only` par defaut : aucun site de production ne passe `blocking` (verifie par grep).
 * Seuls les compteurs d'APPELS coupent, parce qu'ils ne sont pas gates -- le code le dit lui-meme :
 * « ce sont les JETONS et l'USD qui tuaient des runs, pas eux ».
 *
 * Ce mode est un CHOIX delibere et date (« decision du 12/08 ») : le budget ne bloque pas pour que
 * la reparation puisse enchainer sans tour humain, et le plafond dur de reparations existe
 * precisement pour cela. Le choix n'est pas en cause ici. Ce qui l'est, c'est de le presenter comme
 * une protection : l'utilisateur saisit un plafond en dollars, l'enregistre, le voit affiche -- et
 * croit etre protege.
 *
 * ENTREE QUI DOIT FAIRE ECHOUER CE TEST SI LA CORRECTION VA TROP LOIN : le panneau ne doit pas non
 * plus laisser croire que RIEN ne coupe. Les plafonds d'appels coupent vraiment, et c'est la seule
 * protection reelle -- la faire passer pour douteuse serait mentir dans l'autre sens.
 */

const mounted: Array<{ root: ReturnType<typeof createRoot>; container: HTMLDivElement }> = []

afterEach(async () => {
  for (const item of mounted.splice(0)) {
    await act(async () => item.root.unmount())
    item.container.remove()
  }
})

async function rendu(): Promise<HTMLDivElement> {
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: {
      orchestrationBudget: vi.fn().mockResolvedValue({
        maxUsd: 5,
        maxProviderCalls: 24,
        maxChatProviderCalls: 50,
        maxTotalTokens: 15_000_000
      }),
      setOrchestrationBudget: vi.fn()
    }
  })
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  mounted.push({ root, container })
  await act(async () => {
    root.render(createElement(OrchestrationBudgetSettings))
  })
  return container
}

describe('le panneau de budget dit la verite sur ce qui coupe', () => {
  it('ne promet plus qu un appel est refuse des que « le budget » est atteint', async () => {
    const texte = (await rendu()).textContent ?? ''
    expect(texte).not.toContain('Un nouvel appel est refusé avant son départ dès que le budget est')
  })

  it('dit que les plafonds de coût et de jetons MESURENT sans couper', async () => {
    const texte = (await rendu()).textContent ?? ''
    expect(texte).toMatch(/mesur|ne coupe|n’arrête|n'arrête/i)
  })

  it('dit que les plafonds d APPELS coupent vraiment', async () => {
    const texte = (await rendu()).textContent ?? ''
    expect(texte).toMatch(/appels?[^.]{0,80}(refus|coupe|arrêt)/i)
  })
})
