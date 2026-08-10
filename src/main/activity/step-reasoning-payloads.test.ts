import { describe, expect, it } from 'vitest'
import { stepPayloads } from './step-reasoning-payloads'

/**
 * MANQUE CONSTATE LE 2026-08-07 : `step.thinking` — le raisonnement d'un sous-agent — est alimente en
 * cinq endroits de `orchestrator.ts` et AFFICHE dans le chat (`ChatView.parts.tsx:69-74`, bloc
 * « Raisonnement »), mais la charge structurelle de la trace ne retenait que
 * `step.error ?? step.text ?? step.detail`. Le mot « thinking » n'apparaissait nulle part dans
 * `src/main/activity/` (verifie insensible a la casse).
 *
 * Consequence : Observatory montrait la CONCLUSION d'un sous-agent sans la deliberation qui y menait —
 * exactement l'information qu'on cherche quand on veut comprendre POURQUOI un sous-agent a tranche
 * ainsi.
 */

describe('stepPayloads', () => {
  it('conserve la charge principale existante (non-regression)', () => {
    const payloads = stepPayloads({ step: 'exec', text: 'la réponse' })
    expect(payloads[0].kind).toBe('model-response')
    expect(payloads[0].content).toBe('la réponse')
  })

  it('utilise `app-state` pour une etape de controle, comme avant', () => {
    const payloads = stepPayloads({ step: 'gate', detail: 'gate ok' })
    expect(payloads[0].kind).toBe('app-state')
  })

  it('AJOUTE le raisonnement du sous-agent en charge `reasoning`', () => {
    const payloads = stepPayloads({
      step: 'exec',
      text: 'conclusion',
      thinking: 'j’ai comparé A et B'
    })
    const reasoning = payloads.find((p) => p.kind === 'reasoning')
    expect(reasoning?.content).toBe('j’ai comparé A et B')
  })

  it('n’ajoute RIEN quand il n’y a pas de raisonnement', () => {
    expect(stepPayloads({ step: 'exec', text: 'x' })).toHaveLength(1)
  })

  it('garde la conclusion et la deliberation SEPAREES, jamais concatenees', () => {
    // Les fusionner ferait passer une deliberation pour une conclusion remise.
    const payloads = stepPayloads({ step: 'exec', text: 'conclusion', thinking: 'délibération' })
    expect(payloads).toHaveLength(2)
    expect(payloads[0].content).not.toContain('délibération')
  })

  it('l’erreur prime sur le texte, comme dans le code d’origine', () => {
    const payloads = stepPayloads({ step: 'exec', text: 'ignoré', error: 'ça a cassé' })
    expect(payloads[0].content).toBe('ça a cassé')
  })

  it('ignore un raisonnement vide ou fait d’espaces', () => {
    expect(stepPayloads({ step: 'exec', text: 'x', thinking: '   ' })).toHaveLength(1)
  })
})
