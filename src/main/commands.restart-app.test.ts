import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AppCommandBus } from './commands'
import { consommerReprise } from './redemarrage-reprise'
import { ensureAutowinAppData } from './app-data'

/*
 * `restart_app` doit tenir DEUX promesses indissociables : redemarrer, et ne pas perdre la tache.
 * Un redemarrage sans consigne posee serait exactement le defaut qu'il corrige.
 */
const os = {
  conversations: { get: () => undefined, list: () => [] },
  listBrains: () => [],
  executionWorkspace: process.cwd()
} as unknown as ConstructorParameters<typeof AppCommandBus>[0]

let appdata = ''
let appdataPrecedent: string | undefined
beforeEach(() => {
  appdata = mkdtempSync(join(tmpdir(), 'aw-restart-'))
  appdataPrecedent = process.env.APPDATA
  process.env.APPDATA = appdata
})
afterEach(() => {
  if (appdataPrecedent === undefined) delete process.env.APPDATA
  else process.env.APPDATA = appdataPrecedent
  rmSync(appdata, { recursive: true, force: true })
})

describe('restart_app', () => {
  it('pose la consigne AVANT de relancer, dans la conversation courante', async () => {
    vi.useFakeTimers()
    const bus = new AppCommandBus(os, () => undefined)
    const relance = vi.fn()
    bus.redemarrerApp = relance

    const result = await bus.exec(
      'restart_app',
      { consigne: 'reprends le câblage du bus', raison: 'src/main modifié' },
      'conv-42'
    )

    expect(result.ok).toBe(true)
    expect((result.data as { redemarre: boolean }).redemarre).toBe(true)
    // La consigne est sur le DISQUE avant que le process meure : c'est tout l'objet du mécanisme.
    expect(consommerReprise(ensureAutowinAppData())).toMatchObject({
      conversationId: 'conv-42',
      consigne: 'reprends le câblage du bus',
      raison: 'src/main modifié'
    })
    expect(relance).not.toHaveBeenCalled()
    vi.runAllTimers()
    expect(relance).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })

  it('refuse de redemarrer sans consigne — sinon la tache mourrait avec le process', async () => {
    const bus = new AppCommandBus(os, () => undefined)
    const relance = vi.fn()
    bus.redemarrerApp = relance

    const result = await bus.exec('restart_app', {}, 'conv-42')

    expect((result.data as { redemarre: boolean }).redemarre).toBe(false)
    expect(relance).not.toHaveBeenCalled()
    expect(consommerReprise(ensureAutowinAppData())).toBeNull()
  })

  it('annonce l indisponibilite plutot que de promettre une relance non cablee', async () => {
    const bus = new AppCommandBus(os, () => undefined)

    const result = await bus.exec('restart_app', { consigne: 'reprends' }, 'conv-42')

    expect((result.data as { redemarre: boolean; detail: string }).redemarre).toBe(false)
    expect((result.data as { detail: string }).detail).toContain('indisponible')
    expect(consommerReprise(ensureAutowinAppData())).toBeNull()
  })

  it('est publiee dans le catalogue offert au modele', () => {
    const bus = new AppCommandBus(os, () => undefined)
    expect(bus.catalog().map((c) => c.name)).toContain('restart_app')
  })
})
