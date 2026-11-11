// @vitest-environment happy-dom
/**
 * Le bloc « Décodage de l'image » : le texte du décodage tel quel, ouvert par défaut, repliable au clic.
 *
 * Cas visé : le décodage s'allonge pendant le direct. Un bloc replié par l'utilisateur doit rester
 * replié à chaque fragment. Si la mise à jour remontait le bloc (clé changée, état remis à zéro), il
 * se rouvrirait à chaque fragment, et le texte réapparaîtrait malgré le repli choisi.
 */
import { describe, expect, it } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { LookDecodeBlock } from './LookDecodeBlock'

// fix-ok: cause mesurée — sans ce drapeau, React écrit « not configured to support act(...) » à
// chaque act() : 9 avertissements dans ce fichier avant ce réglage (relevés par vitest).
;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

const TEXTE = 'The image shows a red cube on a white table.\nIts edges look sharp.'

function monter(): { host: HTMLDivElement; root: Root } {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  return { host, root }
}

describe('LookDecodeBlock', () => {
  it('affiche le titre et le texte du décodage tel quel, sans traduction', async () => {
    const { host, root } = monter()
    await act(async () => {
      root.render(createElement(LookDecodeBlock, { text: TEXTE }))
    })
    expect(host.querySelector('.look-decode-titre')?.textContent).toBe("Décodage de l'image")
    expect(host.querySelector('[data-testid="look-decode-block-body"]')?.textContent).toBe(TEXTE)
    await act(async () => root.unmount())
    host.remove()
  })

  it('est OUVERT par défaut', async () => {
    const { host, root } = monter()
    await act(async () => {
      root.render(createElement(LookDecodeBlock, { text: TEXTE }))
    })
    const bloc = host.querySelector<HTMLDetailsElement>('[data-testid="look-decode-block"]')
    expect(bloc, 'le bloc du décodage doit exister').not.toBeNull()
    expect(bloc!.open).toBe(true)
    await act(async () => root.unmount())
    host.remove()
  })

  it('se replie au clic sur le titre, puis se rouvre au second clic', async () => {
    const { host, root } = monter()
    await act(async () => {
      root.render(createElement(LookDecodeBlock, { text: TEXTE }))
    })
    const bloc = host.querySelector<HTMLDetailsElement>('[data-testid="look-decode-block"]')!
    const titre = host.querySelector<HTMLElement>('.look-decode-titre')!
    await act(async () => titre.click())
    expect(bloc.open).toBe(false)
    await act(async () => titre.click())
    expect(bloc.open).toBe(true)
    await act(async () => root.unmount())
    host.remove()
  })

  it('un décodage qui s’allonge pendant le direct ne rouvre pas un bloc replié', async () => {
    const { host, root } = monter()
    await act(async () => {
      root.render(createElement(LookDecodeBlock, { text: 'Premier fragment.' }))
    })
    const avant = host.querySelector<HTMLDetailsElement>('[data-testid="look-decode-block"]')!
    await act(async () => host.querySelector<HTMLElement>('.look-decode-titre')!.click())
    expect(avant.open).toBe(false)
    await act(async () => {
      root.render(createElement(LookDecodeBlock, { text: 'Premier fragment. Deuxième fragment.' }))
    })
    // Relu APRÈS le second rendu : un bloc remonté serait un autre élément, rouvert à son défaut.
    const bloc = host.querySelector<HTMLDetailsElement>('[data-testid="look-decode-block"]')!
    expect(bloc).toBe(avant)
    expect(bloc.open).toBe(false)
    expect(host.querySelector('[data-testid="look-decode-block-body"]')?.textContent).toBe(
      'Premier fragment. Deuxième fragment.'
    )
    await act(async () => root.unmount())
    host.remove()
  })
})
