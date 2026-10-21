import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AppCommandBus } from './commands'
import { consommerReprise } from './redemarrage-reprise'
import { ensureAutowinAppData } from './app-data'
import {
  cheminJournalArrets,
  journaliserCauseFermeture,
  oublierOrigineFermeture
} from './journal-arrets'

/*
 * `restart_app` doit tenir DEUX promesses indissociables : redemarrer, et ne pas perdre la tache.
 * Un redemarrage sans consigne posee serait exactement le defaut qu'il corrige.
 */
const os = {
  conversations: { get: () => undefined, list: () => [] },
  listBrains: () => [],
  executionWorkspace: process.cwd()
} as unknown as ConstructorParameters<typeof AppCommandBus>[0]

/**
 * Ce que lira le processus SUIVANT, demarre apres la pose : une consigne n'est jamais rendue au
 * processus qui l'a posee (conv-1033, `redemarrage-reprise.ts`).
 */
const repriseAuDemarrageSuivant = (): ReturnType<typeof consommerReprise> =>
  consommerReprise(ensureAutowinAppData(), Date.now(), Date.now() + 1)

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
  it('nomme la cause dans le journal des arrets — sinon la fermeture est indistinguable', async () => {
    oublierOrigineFermeture()
    vi.useFakeTimers()
    const bus = new AppCommandBus(os, () => undefined)
    bus.redemarrerApp = vi.fn()

    await bus.exec(
      'restart_app',
      { consigne: 'reprends le travail', raison: 'src/main modifié' },
      'conv-66'
    )
    // Ce que le veilleur ecrira ensuite dira « code=0 arret propre » ; CETTE ligne dit qui l'a voulu.
    const ligne = journaliserCauseFermeture(cheminJournalArrets(appdata))

    expect(ligne).toContain('fermeture demandee-par=restart_app (conv-66) — src/main modifié')
    vi.useRealTimers()
    oublierOrigineFermeture()
  })

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
    expect(repriseAuDemarrageSuivant()).toMatchObject({
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
    expect(repriseAuDemarrageSuivant()).toBeNull()
  })

  it('annonce l indisponibilite plutot que de promettre une relance non cablee', async () => {
    const bus = new AppCommandBus(os, () => undefined)

    const result = await bus.exec('restart_app', { consigne: 'reprends' }, 'conv-42')

    expect((result.data as { redemarre: boolean; detail: string }).redemarre).toBe(false)
    expect((result.data as { detail: string }).detail).toContain('indisponible')
    expect(repriseAuDemarrageSuivant()).toBeNull()
  })

  /*
   * Conv-304 (2026-10-17, tour 48eb0f5b-a0df-4028-876a-557d9c7e88eb) : conv-303 tournait ; le seul
   * redemarrage offert la coupait, l'agent a pose un `ask` au lieu d'agir. « J'ai un systeme pour
   * mettre le redemarrage en queue, tu aurais du l'utiliser. »
   */
  it('d autres agents tournent : met le redemarrage EN FILE au lieu de les couper', async () => {
    vi.useFakeTimers()
    const bus = new AppCommandBus(os, () => undefined)
    const relance = vi.fn()
    const demandes: Array<{ cause: string; avantRelance?: () => void }> = []
    bus.redemarrerApp = relance
    bus.conversationsEnVol = () => ['conv-304', 'conv-303']
    bus.redemarrerAuRepos = (demande) => {
      demandes.push(demande)
      return true
    }

    const result = await bus.exec(
      'restart_app',
      { consigne: 'vérifie le bloc Étapes sur un vrai tour', raison: 'claude.ts modifié' },
      'conv-304'
    )

    const data = result.data as { enFile?: boolean; attend?: string[]; detail: string }
    expect(result.ok).toBe(true)
    expect(data.enFile).toBe(true)
    expect(data.attend).toEqual(['conv-303'])
    expect(data.detail).toMatch(/ne demande rien à l’utilisateur/)
    vi.runAllTimers()
    expect(relance).not.toHaveBeenCalled()
    expect(demandes).toHaveLength(1)
    expect(demandes[0]!.cause).toBe('restart_app (conv-304) — claude.ts modifié')
    // La consigne est sur le disque, et la file la repose (horodatage frais) juste avant de relancer.
    expect(repriseAuDemarrageSuivant()).toMatchObject({ conversationId: 'conv-304' })
    demandes[0]!.avantRelance?.()
    expect(repriseAuDemarrageSuivant()).toMatchObject({
      consigne: 'vérifie le bloc Étapes sur un vrai tour'
    })
    vi.useRealTimers()
  })

  it('d autres agents tournent et AUCUNE file : ne coupe personne et le dit', async () => {
    vi.useFakeTimers()
    const bus = new AppCommandBus(os, () => undefined)
    const relance = vi.fn()
    bus.redemarrerApp = relance
    bus.conversationsEnVol = () => ['conv-303']
    bus.redemarrerAuRepos = () => false

    const result = await bus.exec('restart_app', { consigne: 'reprends' }, 'conv-304')

    const data = result.data as { redemarre: boolean; detail: string }
    expect(data.redemarre).toBe(false)
    expect(data.detail).toMatch(/conv-303 tourne encore/)
    vi.runAllTimers()
    expect(relance).not.toHaveBeenCalled()
    expect(repriseAuDemarrageSuivant()).toBeNull()
    vi.useRealTimers()
  })

  it('seule la conversation courante tourne : redemarrage immediat, comme avant', async () => {
    vi.useFakeTimers()
    const bus = new AppCommandBus(os, () => undefined)
    const relance = vi.fn()
    const file = vi.fn(() => true)
    bus.redemarrerApp = relance
    bus.conversationsEnVol = () => ['conv-304']
    bus.redemarrerAuRepos = file

    await bus.exec('restart_app', { consigne: 'reprends' }, 'conv-304')
    vi.runAllTimers()

    expect(file).not.toHaveBeenCalled()
    expect(relance).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })

  it('est publiee dans le catalogue offert au modele', () => {
    const bus = new AppCommandBus(os, () => undefined)
    expect(bus.catalog().map((c) => c.name)).toContain('restart_app')
  })
})
