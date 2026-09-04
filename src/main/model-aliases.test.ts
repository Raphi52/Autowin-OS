import { describe, expect, it } from 'vitest'
import {
  KNOWN_ALIASES,
  compareClaudeVersions,
  isKnownAlias,
  parseClaudeVersion,
  resolveAlias
} from './model-aliases'
import type { ImportedModel } from './models'

const claude = (model: string): ImportedModel => ({
  id: `claude/${model}`,
  provider: 'claude',
  model,
  label: model,
  reasoningEfforts: ['high'],
  defaultReasoningEffort: 'high'
})

const codex = (
  model: string,
  extra: Partial<ImportedModel> = {}
): ImportedModel => ({
  id: `codex/${model}`,
  provider: 'codex',
  model,
  label: model,
  reasoningEfforts: ['medium'],
  defaultReasoningEffort: 'medium',
  ...extra
})

describe('alias de familles', () => {
  it('dérive les alias des seules familles claude — aucun alias de moteur retiré', () => {
    expect(KNOWN_ALIASES.map((a) => a.id).sort()).toEqual([
      'claude/fable-latest',
      'claude/haiku-latest',
      'claude/opus-latest',
      'claude/sonnet-latest'
    ])
    expect(isKnownAlias('claude/opus-latest')).toBe(true)
    // Moteurs retirés : un alias n'aurait plus rien à résoudre, le catalogue ne les contient plus.
    expect(isKnownAlias('codex/flagship')).toBe(false)
    expect(isKnownAlias('kimi/latest')).toBe(false)
    expect(isKnownAlias('gemini/latest')).toBe(false)
  })

  it('parse les ids Claude versionnés (et rejette le reste)', () => {
    expect(parseClaudeVersion('claude-opus-4-6')).toEqual({
      family: 'opus',
      major: 4,
      minor: 6,
      date: null
    })
    expect(parseClaudeVersion('claude-haiku-4-5-20251001')).toEqual({
      family: 'haiku',
      major: 4,
      minor: 5,
      date: '20251001'
    })
    expect(parseClaudeVersion('claude-fable-5')).toEqual({
      family: 'fable',
      major: 5,
      minor: 0,
      date: null
    })
    expect(parseClaudeVersion('gpt-5.6-terra')).toBeNull()
  })

  it('ordonne major → minor → non-daté préféré au snapshot daté', () => {
    const v = (s: string) => parseClaudeVersion(s)!
    expect(compareClaudeVersions(v('claude-opus-4-6'), v('claude-opus-4-5'))).toBeGreaterThan(0)
    expect(compareClaudeVersions(v('claude-opus-5'), v('claude-opus-4-9'))).toBeGreaterThan(0)
    // À version égale : le non-daté suit la révision courante, il gagne sur le snapshot.
    expect(
      compareClaudeVersions(v('claude-opus-4-6'), v('claude-opus-4-6-20260101'))
    ).toBeGreaterThan(0)
    // Entre deux snapshots : la date la plus récente gagne.
    expect(
      compareClaudeVersions(v('claude-opus-4-6-20260201'), v('claude-opus-4-6-20260101'))
    ).toBeGreaterThan(0)
  })

  it('résout claude/opus-latest sur le meilleur opus du catalogue', () => {
    const catalog = [
      claude('claude-opus-4-5'),
      claude('claude-opus-4-6-20260101'),
      claude('claude-opus-4-6'),
      claude('claude-fable-5'),
      codex('gpt-5.6-terra')
    ]
    expect(resolveAlias('claude/opus-latest', catalog)?.model).toBe('claude-opus-4-6')
    expect(resolveAlias('claude/fable-latest', catalog)?.model).toBe('claude-fable-5')
  })

  it('un alias de moteur retiré ne résout RIEN, même si le catalogue en garde des entrées', () => {
    // Cas réel : un cache antérieur au retrait contient encore des modèles codex. L'alias ne doit
    // plus les faire remonter — sinon un binding sauvegardé continuerait de router vers du mort.
    const catalog = [
      codex('gpt-5.6-terra', { priority: 2, visibility: 'list' }),
      codex('gpt-5.6-sol', { priority: 1, visibility: 'list' })
    ]
    expect(resolveAlias('codex/flagship', catalog)).toBeUndefined()
    expect(resolveAlias('codex/flagship', [codex('gpt-5.6-terra')])).toBeUndefined()
  })

  it("n'invente JAMAIS un modèle : alias non résoluble → undefined", () => {
    expect(resolveAlias('claude/sonnet-latest', [claude('claude-opus-4-6')])).toBeUndefined()
    expect(resolveAlias('inconnu/latest', [claude('claude-opus-4-6')])).toBeUndefined()
  })
})
