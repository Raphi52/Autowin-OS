import { describe, it, expect, vi } from 'vitest'
import { runPreflight } from './preflight'

describe('runPreflight', () => {
  it('tout OK → ok:true, résumé positif', async () => {
    const r = await runPreflight({
      pingBrain: async () => true,
      hasBin: async () => true,
      claudeSession: () => 'authenticated',
      hasBrainToken: () => true,
      hasBrainRuntime: () => true
    })
    expect(r.ok).toBe(true)
    // Codex et Kimi retirés : il ne reste que Brain (x3) + CLI claude + session claude.
    expect(r.checks).toHaveLength(5)
    expect(r.summary).toContain('OK')
  })

  it('brain down + claude absent → ok:false, détaille les manquants', async () => {
    const r = await runPreflight({
      pingBrain: async () => false,
      hasBin: async () => false,
      claudeSession: () => 'authenticated',
      hasBrainToken: () => true,
      hasBrainRuntime: () => true
    })
    expect(r.ok).toBe(false)
    const failed = r.checks.filter((c) => !c.ok).map((c) => c.id)
    expect(failed).toContain('brain')
    expect(failed).toContain('claude')
    expect(r.summary).toMatch(/incomplète/i)
  })

  it('CONTRÔLE NÉGATIF : plus aucun contrôle Codex ni Kimi au démarrage', async () => {
    const r = await runPreflight({
      pingBrain: async () => true,
      hasBin: async () => true,
      hasBrainToken: () => true,
      hasBrainRuntime: () => true,
      claudeSession: () => 'authenticated'
    })

    expect(r.checks.map((c) => c.id)).not.toContain('codex')
    expect(r.checks.map((c) => c.id)).not.toContain('codex-session')
    expect(r.checks.map((c) => c.id)).not.toContain('kimi')
  })

  it('un probe qui throw = ko, jamais un crash', async () => {
    const r = await runPreflight({
      pingBrain: async () => {
        throw new Error('ECONNREFUSED')
      },
      hasBin: async () => {
        throw new Error('spawn fail')
      },
      claudeSession: () => {
        throw new Error('claude auth status fail')
      },
      hasBrainToken: () => {
        throw new Error('fs')
      },
      hasBrainRuntime: () => {
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
        claudeSession: () => 'authenticated',
        hasBrainToken: () => true,
        hasBrainRuntime: () => true
      },
      { standbyProviders: ['claude'] }
    )

    expect(hasBin).not.toHaveBeenCalledWith('claude')
    expect(r.checks).toContainEqual(
      expect.objectContaining({ id: 'claude', ok: true, standby: true })
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
    hasBrainToken: () => true,
    hasBrainRuntime: () => true
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

/**
 * « injoignable » et « jamais installé » sont DEUX pannes, avec deux gestes opposés. Les confondre
 * en un seul rouge « brain_server » offrait un bouton « Démarrer » qui ne pouvait pas aboutir.
 */
describe('runPreflight — runtime Brain', () => {
  const sain = {
    pingBrain: async () => true,
    hasBin: async () => true,
    claudeSession: () => 'authenticated' as const,
    hasBrainToken: () => true,
    hasBrainRuntime: () => true
  }

  it('runtime absent → rouge DÉDIÉ, distinct du ping brain', async () => {
    const r = await runPreflight({ ...sain, hasBrainRuntime: () => false })
    const venv = r.checks.find((c) => c.id === 'brain-venv')
    expect(venv?.ok).toBe(false)
    expect(r.checks.find((c) => c.id === 'brain')?.ok).toBe(true)
    expect(r.ok).toBe(false)
  })

  it('runtime présent → aucun rouge d’installation', async () => {
    const r = await runPreflight(sain)
    expect(r.checks.find((c) => c.id === 'brain-venv')?.ok).toBe(true)
  })

  it('sonde muette → fail-closed (jamais un vert non prouvé)', async () => {
    const r = await runPreflight({
      ...sain,
      hasBrainRuntime: () => {
        throw new Error('fs')
      }
    })
    expect(r.checks.find((c) => c.id === 'brain-venv')?.ok).toBe(false)
  })
})
