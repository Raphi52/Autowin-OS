import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { configureAutowinAppDataBase } from './app-data'
import { appliquerBrainReglage } from './brain-reglage'
import type { BrainRetrievalOptions, BrainRetrievalResult } from './brain-retrieval'
import { AppCommandBus } from './commands'

/**
 * DEUX BRAINS DANS LE BUS (conv-1233, 2026-10-28) : `brain_query` cherche dans les deux,
 * `brain_read` ouvre une note `perso:` sur le serveur perso, et `remember` range selon `portee`
 * — jamais un fait perso rabattu sur le Brain d'équipe.
 *
 * `rememberFact` est espionné en laissant passer le vrai code, jeton vidé : aucun test ne part sur
 * le réseau.
 */
const espion = vi.hoisted(() => ({
  appels: [] as Array<{ args: Record<string, unknown>; origin?: string }>
}))
vi.mock('./brain-remember', async (importOriginal) => {
  const reel = await importOriginal<typeof import('./brain-remember')>()
  return {
    ...reel,
    rememberFact: (
      args: Record<string, unknown>,
      deps: Parameters<typeof reel.rememberFact>[1]
    ) => {
      espion.appels.push({ args, ...(deps?.origin ? { origin: deps.origin } : {}) })
      return reel.rememberFact(args, { ...deps, token: '' })
    }
  }
})

const dossiers: string[] = []
const temp = (prefixe: string): string => {
  const d = mkdtempSync(join(tmpdir(), prefixe))
  dossiers.push(d)
  return d
}
let perso: string

const fait = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  title: 'Recette du dimanche',
  fact: 'la pâte repose une nuit',
  type: 'domain',
  scope: 'global',
  source: 'session:test',
  ...extra
})

beforeEach(() => {
  const poste = temp('bus-brain-perso-')
  vi.stubEnv('APPDATA', join(poste, 'Roaming'))
  vi.stubEnv('LOCALAPPDATA', join(poste, 'Local'))
  vi.stubEnv('AUTOWIN_BRAIN_ORIGIN', 'http://127.0.0.1:8766')
  configureAutowinAppDataBase(temp('bus-brain-perso-data-'))
  perso = temp('bus-brain-perso-dossier-')
  espion.appels.length = 0
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  configureAutowinAppDataBase(undefined)
  for (const d of dossiers.splice(0)) rmSync(d, { recursive: true, force: true })
})

const reglerPerso = (): Promise<unknown> =>
  appliquerBrainReglage({ chemin: perso }, { racineParDefaut: 'X:/jamais', quel: 'perso' })

describe('remember range selon la portée', () => {
  it('perso SANS Brain perso : refusé, rien envoyé, et surtout pas au Brain d’équipe', async () => {
    const bus = new AppCommandBus(
      { roles: { getBinding: () => ({ model: 'test' }) } } as never,
      () => {}
    )
    const res = await bus.exec('remember', fait({ portee: 'perso' }))
    const data = res.data as Record<string, unknown>
    expect(data.stored).toBe(false)
    expect(data.rangement).toBe('rien')
    expect(String(data.detail)).toMatch(/aucun Brain perso/)
    expect(espion.appels).toHaveLength(0)
  })

  it('perso AVEC Brain perso : envoyé au serveur perso, et le compte-rendu dit où', async () => {
    await reglerPerso()
    const bus = new AppCommandBus(
      { roles: { getBinding: () => ({ model: 'test' }) } } as never,
      () => {}
    )
    const res = await bus.exec('remember', fait({ portee: 'perso' }))
    expect(espion.appels).toHaveLength(1)
    expect(espion.appels[0].origin).toBe('http://127.0.0.1:8775')
    expect((res.data as Record<string, unknown>).rangement).toBe('Brain perso')
  })

  it('sans portée : Brain d’équipe, comme avant', async () => {
    await reglerPerso()
    const bus = new AppCommandBus(
      { roles: { getBinding: () => ({ model: 'test' }) } } as never,
      () => {}
    )
    const res = await bus.exec('remember', fait())
    expect(espion.appels).toHaveLength(1)
    expect(espion.appels[0].origin).toBeUndefined()
    expect((res.data as Record<string, unknown>).rangement).toBe('Brain d’équipe')
  })
})

describe('brain_query cherche dans les deux Brains', () => {
  // Comme le vrai serveur : la liste arrive aussi en sources SIGNÉES, seules retenues par le bus.
  const liste = (chemin: string): BrainRetrievalResult => {
    const bloc = `### Candidate 1 — Note\n\`${chemin}\` · 1 Ko · domain`
    return {
      context: bloc,
      structuredContext: { preamble: '', sources: [{ path: chemin, content: bloc }] },
      status: 'found'
    }
  }

  it('les deux répondent : une liste, les notes perso préfixées perso:', async () => {
    await reglerPerso()
    const appels: BrainRetrievalOptions[] = []
    const retrieve = vi.fn(async (_q: string, opts: BrainRetrievalOptions = {}) => {
      appels.push(opts)
      return opts.env?.AUTOWIN_BRAIN_ROOT === perso
        ? liste('knowledge/domain/recette.md')
        : liste('knowledge/decisions/equipe.md')
    })
    const bus = new AppCommandBus(
      { roles: { getBinding: () => ({ model: 'test' }) } } as never,
      () => {},
      undefined,
      () => true,
      retrieve as never
    )
    const res = await bus.exec('brain_query', { question: 'la recette du dimanche ?' })
    const data = res.data as Record<string, unknown>
    expect(retrieve).toHaveBeenCalledTimes(2)
    expect(appels.some((o) => o.env?.AUTOWIN_BRAIN_ROOT === perso)).toBe(true)
    expect(String(data.knowledge)).toContain('`knowledge/decisions/equipe.md`')
    expect(String(data.knowledge)).toContain('`perso:knowledge/domain/recette.md`')
  })

  it('sans Brain perso : une seule recherche, liste de l’équipe inchangée', async () => {
    const retrieve = vi.fn(async () => liste('knowledge/decisions/equipe.md'))
    const bus = new AppCommandBus(
      { roles: { getBinding: () => ({ model: 'test' }) } } as never,
      () => {},
      undefined,
      () => true,
      retrieve as never
    )
    const res = await bus.exec('brain_query', { question: 'une décision ?' })
    expect(retrieve).toHaveBeenCalledTimes(1)
    expect(String((res.data as Record<string, unknown>).knowledge)).not.toContain('perso:')
  })
})

describe('brain_read ouvre une note perso sur le serveur perso', () => {
  it('le préfixe perso: est retiré et la requête part sur le port perso', async () => {
    await reglerPerso()
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('réseau coupé pour le test'))
    const bus = new AppCommandBus(
      { roles: { getBinding: () => ({ model: 'test' }) } } as never,
      () => {}
    )
    await bus.exec('brain_read', { path: 'perso:knowledge/domain/recette.md' })
    expect(fetchSpy).toHaveBeenCalledOnce()
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('http://127.0.0.1:8775/read')
    expect(JSON.parse(String(init.body))).toMatchObject({ path: 'knowledge/domain/recette.md' })
  })
})
