import { describe, expect, it } from 'vitest'
import { catalogueAgy, lireModelesAgy } from './agy-modeles'

// Sortie RÉELLE de `agy models` (agy 1.5.0, compte connecté, 2026-11-04).
const SORTIE_REELLE = [
  'Fetching available models...',
  'gemini-3.8-flash-high\tGemini 3.8 Flash (High)',
  'gemini-3.8-flash-medium\tGemini 3.8 Flash (Medium)',
  'gemini-3.8-flash-low\tGemini 3.8 Flash (Low)',
  'claude-sonnet-4-6\tClaude Sonnet 4.6 (Thinking)',
  'claude-opus-4-6-thinking\tClaude Opus 4.6 (Thinking)',
  'gpt-oss-120b-medium\tGPT-OSS 120B (Medium)',
  ''
].join('\r\n')

describe('modèles agy', () => {
  it('sortie réelle : les 3 Gemini, avec leur libellé, et rien d’autre', () => {
    const modeles = lireModelesAgy(SORTIE_REELLE)
    expect(modeles.map((m) => [m.id, m.model, m.label])).toEqual([
      ['agy/gemini-3.8-flash-high', 'gemini-3.8-flash-high', 'Gemini 3.8 Flash (High)'],
      ['agy/gemini-3.8-flash-medium', 'gemini-3.8-flash-medium', 'Gemini 3.8 Flash (Medium)'],
      ['agy/gemini-3.8-flash-low', 'gemini-3.8-flash-low', 'Gemini 3.8 Flash (Low)']
    ])
    expect(modeles.every((m) => m.provider === 'agy' && m.dynamicallyLoaded)).toBe(true)
  })

  it('catalogue : l’entrée défaut d’abord, puis les modèles listés', async () => {
    const modeles = await catalogueAgy(
      () => 'agy.exe',
      async () => SORTIE_REELLE
    )
    expect(modeles.map((m) => m.model)).toEqual([
      'default',
      'gemini-3.8-flash-high',
      'gemini-3.8-flash-medium',
      'gemini-3.8-flash-low'
    ])
  })

  it('listage en panne (non connecté, délai dépassé) : l’entrée défaut seule', async () => {
    const modeles = await catalogueAgy(
      () => 'agy.exe',
      async () => {
        throw new Error('Authentication required')
      }
    )
    expect(modeles.map((m) => m.model)).toEqual(['default'])
  })

  it('programme absent : aucun modèle, et agy n’est pas lancé', async () => {
    let lance = false
    const modeles = await catalogueAgy(
      () => undefined,
      async () => {
        lance = true
        return SORTIE_REELLE
      }
    )
    expect(modeles).toEqual([])
    expect(lance).toBe(false)
  })

  it('ligne sans libellé ou doublon : id repris, une seule entrée', () => {
    expect(lireModelesAgy('gemini-4-pro\ngemini-4-pro\tGemini 4 Pro').map((m) => m.label)).toEqual([
      'gemini-4-pro'
    ])
  })
})
