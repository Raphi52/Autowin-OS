import { describe, expect, it } from 'vitest'
import { shortModelLabel } from './model-display-label'

describe('shortModelLabel', () => {
  it('retire le provider répété devant le libellé', () => {
    expect(shortModelLabel('Claude Opus 5 · CLI', 'claude')).toBe('Opus 5 · CLI')
    expect(shortModelLabel('Claude Haiku 4.5 (20251001) · CLI', 'claude')).toBe(
      'Haiku 4.5 (20251001) · CLI'
    )
  })

  it('laisse intact un libellé qui ne commence pas par le provider', () => {
    expect(shortModelLabel('GPT-5.6 Sol · ChatGPT', 'codex')).toBe('GPT-5.6 Sol · ChatGPT')
    expect(shortModelLabel('Kimi Code · compte OAuth', 'kimi')).toBe('Code · compte OAuth')
  })

  it('ne vide jamais un libellé réduit au seul nom du provider', () => {
    expect(shortModelLabel('Claude', 'claude')).toBe('Claude')
  })

  it('rend le libellé tel quel sans provider', () => {
    expect(shortModelLabel('Claude Opus 5 · CLI', undefined)).toBe('Claude Opus 5 · CLI')
  })
})
