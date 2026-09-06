// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { ContextGaugeIndicator } from './ContextGaugeIndicator'
import type { ContextGauge } from '../../../shared/context-gauge'

/**
 * La jauge de CONTEXTE, cliquable, avec son PROPRE panneau (demande du 2026-09-06).
 *
 * Entrées qui feraient échouer ce test si la correction était fausse :
 *  - `gauge={undefined}` (fenêtre du modèle inconnue ou entrée non mesurée) DOIT ne rien rendre du
 *    tout — un rendu inconditionnel afficherait « 0 % », c'est-à-dire « ce fil est vide », une
 *    affirmation là où la vérité est « on l'ignore ».
 *  - le détail rendu SANS clic ferait de la jauge un pavé permanent : le panneau ne doit exister
 *    qu'après ouverture.
 */
const jauge: ContextGauge = {
  used: 120_000,
  limit: 200_000,
  ratio: 0.6,
  level: 'tendu',
  cacheRead: 90_000,
  fresh: 30_000
}

async function rendre(gauge?: ContextGauge): Promise<HTMLElement> {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(createElement(ContextGaugeIndicator, { gauge }))
    await Promise.resolve()
  })
  return container
}

describe('jauge de contexte cliquable', () => {
  beforeAll(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
  })
  afterEach(() => {
    document.body.replaceChildren()
  })

  it('ouvre son panneau au clic et y montre le remplissage', async () => {
    const container = await rendre(jauge)
    const trigger = container.querySelector(
      '[data-testid="chat-context-gauge"]'
    ) as HTMLButtonElement
    expect(trigger).not.toBeNull()
    expect(trigger.textContent).toContain('60 %')
    expect(container.querySelector('[data-testid="chat-context-popover"]')).toBeNull()
    await act(async () => trigger.click())
    const popover = container.querySelector('[data-testid="chat-context-popover"]')
    expect(popover).not.toBeNull()
    const detail = container.querySelector('[data-testid="quota-context-gauge"]')
    expect(detail?.className).toContain('is-tendu')
    expect(detail?.textContent).toContain('60 %')
    // Séparateur de milliers fr-FR = espace insécable étroite selon l'ICU : on compare au format
    // rendu par l'environnement, pas à une espace ordinaire écrite à la main.
    expect(detail?.getAttribute('aria-label')).toContain((120_000).toLocaleString('fr-FR'))
    expect(detail?.getAttribute('aria-label')).toContain((200_000).toLocaleString('fr-FR'))
    expect(
      (detail?.querySelector('.quota-context-gauge-fill') as HTMLElement | null)?.style.width
    ).toBe('60%')
    // Re-clic : le panneau se referme.
    await act(async () => trigger.click())
    expect(container.querySelector('[data-testid="chat-context-popover"]')).toBeNull()
  })

  it("ne rend RIEN quand le contexte n'est pas mesuré", async () => {
    const container = await rendre(undefined)
    expect(container.querySelector('[data-testid="chat-context-gauge"]')).toBeNull()
    expect(container.textContent).toBe('')
  })
})
