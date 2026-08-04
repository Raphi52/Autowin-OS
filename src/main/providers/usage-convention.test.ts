import { describe, expect, it } from 'vitest'
import { normalizeClaudeUsage } from './claude'

/**
 * DEUX PROVIDERS, DEUX CONVENTIONS OPPOSÉES SUR `inputTokens` — et un seul consommateur qui n'en
 * suppose qu'une. Le compteur était donc juste pour codex et faux pour claude.
 *
 * Mesuré le 2026-08-04 sur le journal réel :
 *   - codex  : `cacheRead <= input` sur 1 048 enregistrements, 0 exception (ratios 0,95–0,98)
 *              → le cache est un SOUS-ENSEMBLE de l'input, convention OpenAI.
 *   - claude : `cacheRead > input` sur 486 enregistrements, 0 exception (ex. input=6, cache=13 486)
 *              → quantités DISJOINTES, convention Anthropic.
 *
 * `execution-supervisor` borne le cache à l'input (`Math.min(input, cache)`) puis totalise
 * `input + output` : correct sous convention OpenAI. Appliqué à claude, il écrasait 13 486 tokens de
 * cache à 6 et comptait un tour de 13 492 tokens comme un tour de 6 — un budget `maxTotalTokens` qui
 * ne pouvait jamais mordre sur claude, et un « Usage supervisé : N tokens » faux d'un facteur ~2 000.
 *
 * On corrige à la FRONTIÈRE de l'adaptateur, pas chez le consommateur : `Usage.inputTokens` porte
 * désormais l'input TOTAL (cache inclus), `cacheReadTokens` en étant le sous-ensemble. Une seule
 * convention, tenue par celui qui connaît la sémantique de son provider.
 */
describe("convention d'usage — claude ramené à l'input TOTAL", () => {
  it("additionne le cache à l'input, comme l'exige l'invariant", () => {
    const u = normalizeClaudeUsage({
      input_tokens: 6,
      output_tokens: 250,
      cache_read_input_tokens: 13_486
    })
    expect(u.inputTokens).toBe(13_492)
    expect(u.cacheReadTokens).toBe(13_486)
    expect(u.outputTokens).toBe(250)
  })

  it("respecte l'invariant cacheRead <= inputTokens (celui que le superviseur suppose)", () => {
    const u = normalizeClaudeUsage({
      input_tokens: 6,
      output_tokens: 1,
      cache_read_input_tokens: 13_486
    })
    expect(u.cacheReadTokens!).toBeLessThanOrEqual(u.inputTokens)
  })

  it('sans cache, l\'input est inchangé (aucune inflation inventée)', () => {
    const u = normalizeClaudeUsage({ input_tokens: 4_000, output_tokens: 120 })
    expect(u.inputTokens).toBe(4_000)
    expect(u.cacheReadTokens).toBeUndefined()
  })

  it('champs absents → zéros, pas de NaN (un NaN empoisonnerait tout cumul)', () => {
    const u = normalizeClaudeUsage({})
    expect(u.inputTokens).toBe(0)
    expect(u.outputTokens).toBe(0)
    expect(Number.isNaN(u.inputTokens)).toBe(false)
  })

  it('reporte le coût quand le CLI le donne, et rien quand il ne le donne pas', () => {
    expect(normalizeClaudeUsage({ input_tokens: 1 }, 0.42).costUsd).toBeCloseTo(0.42)
    expect(normalizeClaudeUsage({ input_tokens: 1 }).costUsd).toBeUndefined()
  })
})
