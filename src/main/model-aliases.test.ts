import { describe, it, expect } from 'vitest'
import { isModelAlias, resolveModelAlias, type AliasCandidate } from './model-aliases'
import { DEFAULT_IMPORTED_MODELS } from './models'

const CATALOG: AliasCandidate[] = [
  { provider: 'claude', model: 'claude-opus-4-6' },
  { provider: 'claude', model: 'claude-opus-4-5' },
  { provider: 'claude', model: 'claude-fable-5' },
  { provider: 'claude', model: 'claude-haiku-4-5-20251001' },
  { provider: 'claude', model: 'claude-haiku-4-5-20250801' },
  { provider: 'codex', model: 'gpt-5.6-terra' },
  { provider: 'codex', model: 'gpt-5.2' },
  { provider: 'kimi', model: 'kimi-code/kimi-for-coding' }
]

describe('resolveModelAlias (fonction pure : liste + alias → id concret)', () => {
  it('résout chaque famille vers le modèle le plus récent de la liste', () => {
    expect(resolveModelAlias(CATALOG, 'opus-latest')).toBe('claude-opus-4-6')
    expect(resolveModelAlias(CATALOG, 'fable-latest')).toBe('claude-fable-5')
    expect(resolveModelAlias(CATALOG, 'codex-latest')).toBe('gpt-5.6-terra')
    expect(resolveModelAlias(CATALOG, 'kimi-latest')).toBe('kimi-code/kimi-for-coding')
  })

  it('départage une même version par la date suffixée', () => {
    expect(resolveModelAlias(CATALOG, 'haiku-latest')).toBe('claude-haiku-4-5-20251001')
  })

  it("retourne undefined si aucune famille ne matche — n'invente JAMAIS un nom", () => {
    expect(resolveModelAlias(CATALOG, 'sonnet-latest')).toBeUndefined()
    expect(resolveModelAlias([], 'opus-latest')).toBeUndefined()
  })

  it('un id non-alias retourne undefined (pas de résolution accidentelle)', () => {
    expect(resolveModelAlias(CATALOG, 'claude-opus-4-6')).toBeUndefined()
    expect(isModelAlias('claude-opus-4-6')).toBe(false)
    expect(isModelAlias('opus-latest')).toBe(true)
  })

  it('ne confond pas les familles (opus ne capture pas fable/haiku)', () => {
    const onlyFable: AliasCandidate[] = [{ provider: 'claude', model: 'claude-fable-5' }]
    expect(resolveModelAlias(onlyFable, 'opus-latest')).toBeUndefined()
  })

  it('résout le seed vérifié vers ses ids concrets historiques', () => {
    expect(resolveModelAlias(DEFAULT_IMPORTED_MODELS, 'fable-latest')).toBe('claude-fable-5')
    expect(resolveModelAlias(DEFAULT_IMPORTED_MODELS, 'opus-latest')).toBe('claude-opus-4-6')
    expect(resolveModelAlias(DEFAULT_IMPORTED_MODELS, 'haiku-latest')).toBe(
      'claude-haiku-4-5-20251001'
    )
    expect(resolveModelAlias(DEFAULT_IMPORTED_MODELS, 'codex-latest')).toBe('gpt-5.6-terra')
    expect(resolveModelAlias(DEFAULT_IMPORTED_MODELS, 'kimi-latest')).toBe(
      'kimi-code/kimi-for-coding'
    )
  })
})
