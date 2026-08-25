import { describe, expect, it } from 'vitest'
import { recommendedEffort } from './model-effort-recommendations'

describe('recommendedEffort', () => {
  it('recommande low sur Opus 5 (claude) et xhigh sur Sol (codex)', () => {
    expect(recommendedEffort('claude', 'claude-opus-5')).toBe('low')
    expect(recommendedEffort('claude', 'opus-5')).toBe('low')
    expect(recommendedEffort('codex', 'gpt-5.6-sol')).toBe('xhigh')
    // Releve LIVE du catalogue Codex (2026-08-25) : « sol » n'est pas expose ; le modele phare
    // reellement present est terra — c'est lui qui porte la pastille xhigh dans la popup.
    expect(recommendedEffort('codex', 'gpt-5.6-terra')).toBe('xhigh')
  })

  it('ne recommande rien sur un modèle voisin — entrée qui casserait une règle trop large', () => {
    // Si la reco était posée sur « opus » ou « gpt-5.6 » au lieu du modèle NOMMÉ,
    // ces trois entrées porteraient une pastille verte à tort.
    expect(recommendedEffort('claude', 'claude-opus-4-5')).toBeUndefined()
    expect(recommendedEffort('codex', 'gpt-5.6-luna')).toBeUndefined()
  })
})
