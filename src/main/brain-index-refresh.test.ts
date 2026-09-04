import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  ensureBrainIndexFresh,
  needsIndexRebuild,
  readBrainHealth,
  resetBrainIndexRefreshAttempt
} from './brain-index-refresh'

function fauxBrain(): { env: NodeJS.ProcessEnv; tooling: string; root: string } {
  const root = mkdtempSync(join(tmpdir(), 'index-refresh-'))
  const tooling = join(root, 'tooling')
  mkdirSync(join(root, 'knowledge'), { recursive: true })
  mkdirSync(tooling, { recursive: true })
  const python = join(tooling, 'python.exe')
  writeFileSync(python, '')
  writeFileSync(join(tooling, 'brain_index.py'), '')
  return {
    root,
    tooling,
    env: { AMITEL_BRAIN_ROOT: root, AUTOWIN_BRAIN_TOOLING: tooling, AMITEL_BRAIN_PYTHON: python }
  }
}

const DEGRADE = {
  state: 'degraded',
  reasons: ['index freshness mismatch (content_fresh=false): 3 notes changed']
}

describe('réindexation automatique au démarrage sur Brain dégradé', () => {
  afterEach(() => resetBrainIndexRefreshAttempt())

  it('lit /health avec le jeton de service et en extrait état + raisons', async () => {
    let vueUrl = ''
    let vuAuth: unknown
    const fetchFn = (async (url: string, init: RequestInit) => {
      vueUrl = String(url)
      vuAuth = (init.headers as Record<string, string>).authorization
      return { json: async () => ({ health: DEGRADE }) }
    }) as unknown as typeof fetch
    const sante = await readBrainHealth(fetchFn, {
      AMITEL_BRAIN_TOKEN: 'jeton-test',
      AMITEL_BRAIN_ORIGIN: 'http://127.0.0.1:8766'
    })
    expect(vueUrl).toBe('http://127.0.0.1:8766/health')
    expect(vuAuth).toBe('Bearer jeton-test')
    expect(sante).toEqual(DEGRADE)
  })

  it('un Brain sain ne déclenche AUCUNE réindexation', async () => {
    const { env } = fauxBrain()
    const spawnFn = vi.fn(() => ({ unref: vi.fn() }))
    const r = await ensureBrainIndexFresh({
      env,
      spawnFn,
      readHealth: async () => ({ state: 'healthy', reasons: [] })
    })
    expect(r.status).toBe('not-needed')
    expect(spawnFn).not.toHaveBeenCalled()
  })

  it('un Brain dégradé pour index périmé relance brain_index.py sur les bons chemins', async () => {
    const { env, root, tooling } = fauxBrain()
    const appels: { bin: string; args: string[] }[] = []
    const spawnFn = (bin: string, args: readonly string[]) => {
      appels.push({ bin, args: [...args] })
      return { unref: vi.fn() }
    }
    const r = await ensureBrainIndexFresh({ env, spawnFn, readHealth: async () => DEGRADE })
    expect(r.status).toBe('launched')
    expect(appels).toHaveLength(1)
    // Pas de cmd.exe : les chemins du Brain contiennent des espaces, le shell coupait la ligne.
    expect(appels[0].bin).toBe(join(tooling, 'python.exe'))
    const args = appels[0].args
    expect(args[0]).toBe(join(tooling, 'brain_index.py'))
    expect(args[args.indexOf('--knowledge') + 1]).toBe(join(root, 'knowledge'))
    expect(args[args.indexOf('--out') + 1]).toBe(join(tooling, 'index'))
  })

  it('ne réindexe pas pour une dégradation qui n’est pas un index périmé', async () => {
    const { env } = fauxBrain()
    const spawnFn = vi.fn(() => ({ unref: vi.fn() }))
    const r = await ensureBrainIndexFresh({
      env,
      spawnFn,
      readHealth: async () => ({ state: 'degraded', reasons: ['embedding backend unreachable'] })
    })
    expect(r.status).toBe('not-needed')
    expect(spawnFn).not.toHaveBeenCalled()
  })

  it('ne relance pas une deuxième fois dans la même session', async () => {
    const { env } = fauxBrain()
    const spawnFn = vi.fn(() => ({ unref: vi.fn() }))
    const deps = { env, spawnFn, readHealth: async () => DEGRADE }
    expect((await ensureBrainIndexFresh(deps)).status).toBe('launched')
    expect((await ensureBrainIndexFresh(deps)).status).toBe('not-needed')
    expect(spawnFn).toHaveBeenCalledTimes(1)
  })

  it('un service injoignable ne déclenche rien (ce n’est pas un index périmé)', () => {
    expect(needsIndexRebuild(null)).toBe(false)
    expect(needsIndexRebuild({ state: 'unavailable', reasons: ['index freshness mismatch'] })).toBe(
      false
    )
  })
})
