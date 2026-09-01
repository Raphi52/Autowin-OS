// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { ObservatoryCallDetail } from './ObservatoryCallDetail'
import type { PromptCall } from './observatory-view-types'

/**
 * L'Observatory doit NOMMER ce qu'Autowin injecte, pas seulement en montrer le texte concaténé.
 *
 * Défaut réparé le 2026-08-31 : `system` s'affichait en un `<pre>` de plusieurs milliers de
 * caractères, et le contexte poussé (mémoire de session, empreinte du dépôt, savoir Brain) était
 * fondu dans le message utilisateur. La décomposition existait pourtant côté main depuis F6 — elle
 * n'atteignait jamais l'écran, `PromptCall` ne la recopiant pas.
 */

function call(overrides: Partial<PromptCall> = {}): PromptCall {
  return {
    id: 'call-1',
    ts: '2026-08-31T10:00:00.000Z',
    conversationId: 'conv-1',
    turnId: 'turn-1',
    provider: 'claude',
    boundary: 'Autowin OS -> provider transport',
    limitation: 'capture exacte',
    messages: [],
    options: {},
    response: 'ok',
    ...overrides
  }
}

/**
 * `toLocaleString('fr-FR')` separe les milliers par une espace INSECABLE : la comparer a une
 * espace ordinaire ferait echouer le test pour une raison qui n'a rien a voir avec l'inventaire.
 */
function sansInsecables(valeur: string): string {
  // Toute espace devient une espace ORDINAIRE. Ecrit avec `\s` et non avec les deux caracteres
  // litteraux : `toLocaleString('fr-FR')` separe les milliers par une insecable, invisible dans la
  // source, et `no-irregular-whitespace` refuse a raison de la voir tapee telle quelle.
  return valeur.replace(/\s/g, ' ')
}

describe('ObservatoryCallDetail — inventaire des injections', () => {
  beforeAll(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: { shadowRouteRecommendation: vi.fn().mockResolvedValue({ kind: 'insufficient-data' }) }
    })
  })

  let root: Root | null = null
  let container: HTMLDivElement | null = null

  afterEach(async () => {
    if (root) await act(async () => root?.unmount())
    container?.remove()
    root = null
    container = null
  })

  async function monter(promptCall: PromptCall): Promise<HTMLDivElement> {
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => {
      root?.render(createElement(ObservatoryCallDetail, { call: promptCall, onClose: vi.fn() }))
    })
    return container
  }

  it('liste chaque bloc injecté, système ET contexte poussé, avec sa taille', async () => {
    const vue = await monter(
      call({
        system: 'x'.repeat(300),
        systemBlocks: [
          { name: 'constitution', chars: 200 },
          { name: 'phaseBrief', chars: 100 }
        ],
        contextBlocks: [
          { name: 'brainContext', chars: 1_500 },
          { name: 'memoryEcho', chars: 500 }
        ]
      })
    )
    const inventaire = vue.querySelector('[data-testid="observatory-injections"]')
    expect(inventaire).toBeTruthy()
    const texte = inventaire?.textContent ?? ''
    for (const nom of ['constitution', 'phaseBrief', 'brainContext', 'memoryEcho']) {
      expect(texte).toContain(nom)
    }
    // Les deux canaux sont distingués : un bloc système et un contexte poussé ne coûtent pas au
    // même endroit, les confondre rendrait l'inventaire inutilisable pour décider quoi couper.
    expect(texte).toContain('système')
    expect(texte).toContain('contexte poussé')
    // La TAILLE est lue, pas déduite d'un pourcentage : c'est elle qui dit ce qui coûte.
    expect(sansInsecables(texte)).toContain('1 500 car.')
    expect(vue.querySelector('[data-testid="observatory-injection-unattributed"]')).toBeNull()
  })

  it('affiche le RESTE non attribué au lieu de donner une liste partielle pour complète', async () => {
    const vue = await monter(
      call({ system: 'x'.repeat(500), systemBlocks: [{ name: 'constitution', chars: 120 }] })
    )
    const reste = vue.querySelector('[data-testid="observatory-injection-unattributed"]')
    expect(reste).toBeTruthy()
    expect(sansInsecables(reste?.textContent ?? '')).toContain('380 car.')
    expect(vue.textContent).toContain('liste incomplète')
  })

  it('compte un system non décomposé comme entièrement NON attribué, jamais comme vide', async () => {
    // Le piège exact que cette vue corrige : un site d'appel qui ne déclare pas ses blocs ne doit
    // pas se lire « aucune injection ».
    const vue = await monter(call({ system: 'x'.repeat(4_000) }))
    const reste = vue.querySelector('[data-testid="observatory-injection-unattributed"]')
    expect(sansInsecables(reste?.textContent ?? '')).toContain('4 000 car.')
  })

  it('ne prétend rien inventorier quand ni system ni contexte n’ont été envoyés', async () => {
    const vue = await monter(call())
    expect(vue.querySelector('[data-testid="observatory-injections"]')).toBeNull()
  })
})
