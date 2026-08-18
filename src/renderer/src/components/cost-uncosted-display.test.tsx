// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { StepThread } from './ChatView.parts'
import { costByModel, type OrchStep } from './chat-view-model'

/**
 * LE COÛT AFFICHÉ MENTAIT, et par un facteur d'ordre 8.
 *
 * Mesuré le 2026-08-04 sur le journal de prompts réel : codex ne remonte AUCUN `costUsd` — 1 280 appels
 * pour 532M de tokens. `costByModel` sommant `costUsd ?? 0`, l'écran affichait « 0.0000 $ » à
 * côté de « ×1280 ». Un zéro se lit « gratuit » : c'est pire qu'une absence, car on décide dessus.
 *
 * Le correctif n'invente pas de tarif (un prix sans source tracée serait un faux présenté comme
 * mesuré) : il rend le volume NON CHIFFRÉ visible à côté du montant connu.
 */
let container: HTMLDivElement
let root: Root

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

const render = (steps: OrchStep[]): void => {
  act(() => root.render(createElement(StepThread, { steps })))
}

describe('coût non chiffré — modèle', () => {
  it('cumule les tokens des steps sans coût, par modèle', () => {
    const r = costByModel([
      { step: 'exec', model: 'codex', tokens: 400_000 },
      { step: 'exec', model: 'codex', tokens: 395_000 },
      { step: 'exec', model: 'opus', costUsd: 0.02, tokens: 12_000 }
    ])
    const codex = r.find((m) => m.model === 'codex')!
    expect(codex.unpricedTokens).toBe(795_000)
    expect(codex.unpricedCalls).toBe(2)
    const opus = r.find((m) => m.model === 'opus')!
    expect(opus.unpricedTokens).toBe(0)
    expect(opus.unpricedCalls).toBe(0)
  })

  it('un step sans coût NI tokens compte quand même comme appel non chiffré', () => {
    // Sinon un provider muet sur tout disparaîtrait du décompte, et le zéro redeviendrait crédible.
    const r = costByModel([{ step: 'exec', model: 'codex' }])
    expect(r[0].unpricedCalls).toBe(1)
    expect(r[0].unpricedTokens).toBe(0)
  })

  /**
   * Le tri ne doit plus mettre en tête le modèle au plus gros MONTANT quand un autre a englouti un
   * volume non chiffré bien supérieur : la ligne la plus coûteuse est celle qu'on doit voir en premier.
   */
  it('un modèle massivement non chiffré passe devant un petit montant connu', () => {
    const r = costByModel([
      { step: 'exec', model: 'opus', costUsd: 0.02, tokens: 12_000 },
      { step: 'exec', model: 'codex', tokens: 90_000_000 }
    ])
    expect(r[0].model).toBe('codex')
  })
})

describe('coût non chiffré — affichage', () => {
  it("n'affiche PAS un simple « 0.0000 $ » pour un modèle non chiffré", () => {
    render([
      { step: 'exec', model: 'opus', costUsd: 0.02, tokens: 12_000, detail: 'phase frame' },
      { step: 'exec', model: 'codex', tokens: 795_000, detail: 'phase frame' }
    ])
    const recap = container.querySelector('[data-testid="run-cost-recap"]')
    expect(recap).not.toBeNull()
    const chipCodex = [...container.querySelectorAll('.run-cost-chip')].find((c) =>
      c.textContent?.includes('codex')
    )
    expect(chipCodex).toBeDefined()
    const txt = chipCodex!.textContent ?? ''
    // Le volume doit être là, et la mention explicite de non-chiffré aussi.
    expect(txt).toMatch(/non chiffré/i)
    expect(txt).toMatch(/795|0,8|0\.8/)
    // Et surtout : pas de montant qui se lise comme un total réel pour ce modèle.
    expect(txt).not.toMatch(/0\.0000 \$/)
  })

  /**
   * L'étape elle-même, pas seulement le récap : `typeof costUsd === 'number'` n'affichait RIEN quand
   * le provider ne chiffre pas. Ce n'est pas un mensonge mais un silence — une étape à 795k tokens
   * paraissait sans poids. On montre le volume à la place du montant absent.
   */
  it('une étape sans coût mais avec des tokens affiche son volume', () => {
    render([
      { step: 'exec', role: 'subagent', model: 'codex', tokens: 795_000, text: 'x' },
      { step: 'exec', role: 'subagent', model: 'opus', costUsd: 0.02, tokens: 12_000, text: 'y' }
    ])
    const etapes = [...container.querySelectorAll('.subagent-step')]
    const etapeCodex = etapes.find((e) => e.textContent?.includes('codex'))
    expect(etapeCodex).toBeDefined()
    expect(etapeCodex!.textContent).toMatch(/795k tokens/)
  })

  it('une étape chiffrée montre son montant, pas son volume', () => {
    render([{ step: 'exec', role: 'subagent', model: 'opus', costUsd: 0.02, tokens: 12_000 }])
    const etape = container.querySelector('.subagent-step')
    expect(etape!.textContent).toContain('0.0200')
    expect(etape!.textContent).not.toMatch(/12k tokens/)
  })

  it('un modèle chiffré garde son montant, inchangé', () => {
    render([
      { step: 'exec', model: 'opus', costUsd: 0.02, tokens: 12_000, detail: 'phase frame' },
      { step: 'exec', model: 'codex', tokens: 795_000, detail: 'phase frame' }
    ])
    const chipOpus = [...container.querySelectorAll('.run-cost-chip')].find((c) =>
      c.textContent?.includes('opus')
    )
    expect(chipOpus!.textContent).toContain('0.0200')
    expect(chipOpus!.textContent).not.toMatch(/non chiffré/i)
  })
})
