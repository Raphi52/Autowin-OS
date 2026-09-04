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
  // Le `tooling/` INSTALLÉ est HORS de la racine du Brain (en vrai : %LOCALAPPDATA%\AmitelBrain\
  // tooling, alors que la racine est le partage). Le mettre DANS la racine rendait le défaut du
  // 2026-09-04 invisible : `join(tooling,'index')` et `join(root,'tooling','index')` coïncidaient.
  const tooling = mkdtempSync(join(tmpdir(), 'index-refresh-tooling-'))
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
  // Chaîne RELEVÉE sur le serveur réel le 2026-09-04, en provoquant un index périmé.
  reasons: [
    'index freshness mismatch (content_fresh=false): knowledge notes changed since the index was built'
  ]
}

// État RELEVÉ sur le serveur réel : la fraîcheur est en cours de réévaluation, donc AUCUNE raison
// n'est encore disponible. Dure ~6 s après un changement du corpus (mesuré le 2026-09-04).
const INDETERMINE = { state: 'unavailable', reasons: [] as string[] }

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
    // L'index doit être écrit là où le SERVEUR le lit : racine du Brain / tooling / index
    // (`brain_server.py:405`), jamais dans le `tooling/` installé localement.
    expect(args[args.indexOf('--out') + 1]).toBe(join(root, 'tooling', 'index'))
    expect(args[args.indexOf('--out') + 1]).not.toBe(join(tooling, 'index'))
  })

  it('ne réindexe pas pour une dégradation qui n’est pas un index périmé', async () => {
    const { env } = fauxBrain()
    const spawnFn = vi.fn(() => ({ unref: vi.fn() }))
    const r = await ensureBrainIndexFresh({
      env,
      spawnFn,
      readHealth: async () => ({
        state: 'degraded',
        // Vraies chaînes du Brain (brain_retrieval.py:304 et :311) : panne de SURVEILLANCE,
        // pas un index périmé — reconstruire ne la répare pas et coûte plusieurs minutes.
        reasons: [
          'index freshness watcher error: boom',
          'index freshness watcher is not active for every source root'
        ]
      })
    })
    expect(r.status).toBe('not-needed')
    expect(spawnFn).not.toHaveBeenCalled()
  })

  it('réindexe sur la vraie chaîne d’index périmé du Brain', () => {
    // brain_retrieval.py:281 et :288
    expect(
      needsIndexRebuild({
        state: 'degraded',
        reasons: ['index freshness mismatch (hash): corpus changed']
      })
    ).toBe(true)
    expect(
      needsIndexRebuild({
        state: 'degraded',
        reasons: ['index freshness mismatch: manifest missing']
      })
    ).toBe(true)
  })

  it('ne relance pas une deuxième fois dans la même session', async () => {
    const { env } = fauxBrain()
    const spawnFn = vi.fn(() => ({ unref: vi.fn() }))
    const deps = { env, spawnFn, readHealth: async () => DEGRADE }
    expect((await ensureBrainIndexFresh(deps)).status).toBe('launched')
    expect((await ensureBrainIndexFresh(deps)).status).toBe('not-needed')
    expect(spawnFn).toHaveBeenCalledTimes(1)
  })

  it('la cause pas encore nommée est resondée, puis la réindexation part', async () => {
    // Séquence RELEVÉE sur le serveur réel le 2026-09-04 : deux lectures « unavailable » sans
    // aucune raison (fraîcheur en cours de réévaluation), PUIS le vrai diagnostic.
    const { env } = fauxBrain()
    const suite = [INDETERMINE, INDETERMINE, DEGRADE]
    let lu = 0
    const attentes: number[] = []
    const appels: string[][] = []
    const r = await ensureBrainIndexFresh({
      env,
      readHealth: async () => suite[lu++] ?? DEGRADE,
      sleepFn: async (ms) => void attentes.push(ms),
      spawnFn: (bin, args) => {
        appels.push([bin, ...args])
        return { unref: vi.fn() }
      }
    })
    expect(r.status).toBe('launched')
    expect(lu).toBe(3) // il n'a PAS abandonné à la première lecture muette
    expect(attentes).toEqual([2000, 2000])
    expect(appels).toHaveLength(1)
  })

  it('une cause jamais nommée finit par renoncer, sans réindexer', async () => {
    const { env } = fauxBrain()
    let lu = 0
    const spawnFn = vi.fn()
    const r = await ensureBrainIndexFresh({
      env,
      readHealth: async () => {
        lu++
        return INDETERMINE
      },
      sleepFn: async () => {},
      spawnFn
    })
    expect(r.status).toBe('not-needed')
    expect(lu).toBe(5) // borné : pas de sondage infini au démarrage
    expect(spawnFn).not.toHaveBeenCalled()
  })

  it('un « unavailable » MOTIVÉ est stable : aucune attente', async () => {
    const { env } = fauxBrain()
    let lu = 0
    const attentes: number[] = []
    const r = await ensureBrainIndexFresh({
      env,
      readHealth: async () => {
        lu++
        return { state: 'unavailable', reasons: ['embedding model missing'] }
      },
      sleepFn: async (ms) => void attentes.push(ms),
      spawnFn: vi.fn()
    })
    expect(r.status).toBe('not-needed')
    expect(lu).toBe(1)
    expect(attentes).toEqual([])
  })

  it('un service injoignable ne déclenche rien (ce n’est pas un index périmé)', () => {
    expect(needsIndexRebuild(null)).toBe(false)
    expect(needsIndexRebuild({ state: 'unavailable', reasons: ['index freshness mismatch'] })).toBe(
      false
    )
  })
})
