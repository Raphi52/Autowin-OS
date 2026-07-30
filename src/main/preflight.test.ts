import { describe, it, expect, vi } from 'vitest'
import { runPreflight } from './preflight'

describe('runPreflight', () => {
  it('tout OK → ok:true, résumé positif', async () => {
    const r = await runPreflight({
      pingBrain: async () => true,
      hasBin: async () => true,
      hasCodexSession: () => true,
      claudeSession: () => 'authenticated',
      hasBrainToken: () => true
    })
    expect(r.ok).toBe(true)
    expect(r.checks).toHaveLength(7)
    expect(r.summary).toContain('OK')
  })

  it('brain down + codex absent → ok:false, détaille les manquants', async () => {
    const r = await runPreflight({
      pingBrain: async () => false,
      hasBin: async (w) => w === 'claude',
      hasCodexSession: () => true,
      claudeSession: () => 'authenticated',
      hasBrainToken: () => true
    })
    expect(r.ok).toBe(false)
    const failed = r.checks.filter((c) => !c.ok).map((c) => c.id)
    expect(failed).toContain('brain')
    expect(failed).toContain('codex')
    expect(failed).not.toContain('claude')
    expect(r.summary).toMatch(/incomplète/i)
  })

  it('CLI codex présent sans session → état non opérationnel explicite', async () => {
    const r = await runPreflight({
      pingBrain: async () => true,
      hasBin: async () => true,
      hasBrainToken: () => true,
      hasCodexSession: () => false,
      claudeSession: () => 'authenticated'
    })

    expect(r.ok).toBe(false)
    expect(r.checks).toContainEqual(
      expect.objectContaining({
        id: 'codex-session',
        ok: false,
        detail: expect.stringMatching(/session|oauth|authent/i)
      })
    )
    expect(r.checks).toContainEqual(expect.objectContaining({ id: 'codex', ok: true }))
  })

  it('un probe qui throw = ko, jamais un crash', async () => {
    const r = await runPreflight({
      pingBrain: async () => {
        throw new Error('ECONNREFUSED')
      },
      hasBin: async () => {
        throw new Error('spawn fail')
      },
      hasCodexSession: () => {
        throw new Error('auth store fail')
      },
      claudeSession: () => {
        throw new Error('claude auth status fail')
      },
      hasBrainToken: () => {
        throw new Error('fs')
      }
    })
    expect(r.ok).toBe(false)
    expect(r.checks.every((c) => !c.ok)).toBe(true)
  })

  it('ignore un provider en standby sans l’essayer ni dégrader le diagnostic', async () => {
    const hasBin = vi.fn(async () => true)
    const r = await runPreflight(
      {
        pingBrain: async () => true,
        hasBin,
        hasCodexSession: () => true,
        claudeSession: () => 'authenticated',
        hasBrainToken: () => true
      },
      { standbyProviders: ['kimi'] }
    )

    expect(hasBin).not.toHaveBeenCalledWith('kimi')
    expect(r.checks).toContainEqual(
      expect.objectContaining({ id: 'kimi', ok: true, standby: true })
    )
    expect(r.ok).toBe(true)
  })
})

/**
 * LA RÉGRESSION FERMÉE (constatée en réel le 2026-07-30) : le seul check claude était adossé à
 * `hasBin`, donc VERT sur un poste installé mais jamais loggué. Tout le diagnostic passait, puis le
 * premier prompt renvoyait « Not logged in · Please run /login ». Codex avait déjà ses deux entrées ;
 * claude n'en avait qu'une — alors que `hasBin` dit lui-même que « l'authentification a son propre
 * contrôle ». Ce contrôle n'existait pas.
 */
describe('runPreflight — la session claude n’est plus déduite de la présence du binaire', () => {
  const base = {
    pingBrain: async () => true,
    hasBin: async () => true,
    hasCodexSession: () => true,
    hasBrainToken: () => true
  }

  it('LE CAS REPRODUIT : binaire présent, session absente → « CLI claude » vert MAIS diagnostic rouge', async () => {
    const r = await runPreflight({ ...base, claudeSession: () => 'absent' })

    expect(r.ok).toBe(false)
    expect(r.checks).toContainEqual(expect.objectContaining({ id: 'claude', ok: true }))
    expect(r.checks).toContainEqual(
      expect.objectContaining({
        id: 'claude-session',
        ok: false,
        detail: expect.stringMatching(/claude auth login/i)
      })
    )
    expect(r.summary).toMatch(/Session claude/)
  })

  it('une sonde indéterminée ne devient JAMAIS un vert', async () => {
    const r = await runPreflight({ ...base, claudeSession: () => 'unknown' })

    expect(r.ok).toBe(false)
    expect(r.checks).toContainEqual(
      expect.objectContaining({
        id: 'claude-session',
        ok: false,
        detail: expect.stringMatching(/indéterminé/i)
      })
    )
  })

  it('binaire absent : on ne sonde pas la session, et le rouge reste porté par les deux checks', async () => {
    const claudeSession = vi.fn(() => 'authenticated' as const)
    const r = await runPreflight({ ...base, hasBin: async (w) => w !== 'claude', claudeSession })

    expect(claudeSession).not.toHaveBeenCalled()
    expect(r.checks).toContainEqual(expect.objectContaining({ id: 'claude', ok: false }))
    // Le détail ne prescrit PAS « claude auth login » : cette console répondrait « terme non
    // reconnu ». Il renvoie vers le check qui porte la vraie cause.
    expect(r.checks).toContainEqual(
      expect.objectContaining({
        id: 'claude-session',
        ok: false,
        detail: expect.stringMatching(/CLI absent/i)
      })
    )
    expect(r.checks.find((c) => c.id === 'claude-session')?.detail).not.toMatch(/auth login/i)
  })

  it('claude en standby : session non sondée, diagnostic non dégradé (symétrique de codex)', async () => {
    const claudeSession = vi.fn(() => 'absent' as const)
    const r = await runPreflight({ ...base, claudeSession }, { standbyProviders: ['claude'] })

    expect(claudeSession).not.toHaveBeenCalled()
    expect(r.checks).toContainEqual(
      expect.objectContaining({ id: 'claude-session', ok: true, standby: true })
    )
    expect(r.ok).toBe(true)
  })
})
