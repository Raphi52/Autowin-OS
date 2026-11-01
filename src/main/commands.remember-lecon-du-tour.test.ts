import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { configureAutowinAppDataBase } from './app-data'
import { AppCommandBus } from './commands'

/*
 * UN SEUL `learningOutcome` PAR TOUR NE VEUT PAS DIRE UNE SEULE NOTE (kaizen de conv-1332, sur le
 * dossier de conv-1306). Tour 72a6a446-668f-4d7a-ba3c-fe092a0d5a02, action natif:2:20 : l'agent
 * voulait corriger sa note, devenue fausse après un correctif du même tour. Le refus disait « aucun
 * doublon écrit » sans dire que la voie restait ouverte ; il a conclu qu'il ne pouvait rien faire,
 * et la note périmée est restée en revue. Rien ne bloquait pourtant un `remember` ordinaire.
 * ENTRÉE QUI DOIT FAIRE ÉCHOUER CE TEST : retirer de ce refus la façon de corriger la note.
 */
const espion = vi.hoisted(() => ({ appels: 0 }))
vi.mock('./brain-remember', async (importOriginal) => {
  const reel = await importOriginal<typeof import('./brain-remember')>()
  return {
    ...reel,
    rememberFact: (
      args: Record<string, unknown>,
      deps: Parameters<typeof reel.rememberFact>[1]
    ) => {
      espion.appels += 1
      return reel.rememberFact(args, { ...deps, token: '' })
    }
  }
})

const fait = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  title: 'La reprise ne change plus le dossier',
  fact: 'le cas de la consigne de reprise est couvert',
  type: 'lesson',
  scope: 'autowin-os',
  source: 'session:test',
  ...extra
})

/** Le suivi tel qu'il répond quand ce tour a déjà sa leçon : la réservation est refusée. */
const busDontLeTourASaLecon = (): AppCommandBus =>
  new AppCommandBus(
    { roles: { getBinding: () => ({ model: 'test' }) } } as never,
    () => {},
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    { reserveProposal: () => undefined, recordProposal: () => {} } as never
  )

let racine: string

beforeEach(() => {
  racine = mkdtempSync(join(tmpdir(), 'remember-lecon-du-tour-'))
  configureAutowinAppDataBase(racine)
  espion.appels = 0
})

afterEach(() => {
  configureAutowinAppDataBase(undefined)
  rmSync(racine, { recursive: true, force: true })
})

describe('remember quand le tour a déjà sa leçon', () => {
  it('le refus dit que rien n’est écrit, et comment corriger la première note', async () => {
    const res = await busDontLeTourASaLecon().exec(
      'remember',
      fait({ learningOutcome: 'success' }),
      'conv-1',
      undefined,
      'tour-1'
    )
    expect(espion.appels).toBe(0)
    expect(res.data).toMatchObject({ stored: false, note: 'duplicate' })
    const detail = String((res.data as { detail?: unknown }).detail)
    expect(detail).toMatch(/rien n’a été écrit/u)
    expect(detail).toMatch(/rappelle `remember` sans `learningOutcome`/u)
  })

  it('la voie annoncée est ouverte : sans `learningOutcome`, le fait part au Brain', async () => {
    await busDontLeTourASaLecon().exec('remember', fait(), 'conv-1', undefined, 'tour-1')
    expect(espion.appels).toBe(1)
  })
})
