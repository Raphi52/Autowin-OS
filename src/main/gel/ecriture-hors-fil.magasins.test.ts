import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import * as fs from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { attendreFichier, viderFichiersEnAttente } from './ecriture-hors-fil'
import { configureRememberDepositStore, forgetSessionDeposits } from '../brain/brain-remember'
import { enregistrerMur, chargerMurs, oublierMurs, mursStorePath } from '../runs/murs-store'
import { loadChatSessions, saveChatSession } from '../runs/chat-session-store'
import {
  configureSessionMemoryEcho,
  noteRemembered,
  rememberedFacts
} from '../brain/session-memory-echo'
import { cheminFichierPlans, stockageFichier } from '../orchestration/plans-de-lots-app'
import {
  coutDuTourDepuisCumul,
  imposerCheminMagasinCoutsDeSession
} from '../providers/claude-session-cost'
import { persistTaskStore } from '../task-manager/task-store-disk'
import { TaskStore } from '../task-manager/task-store'
import { TaskScheduler } from '../task-manager/task-scheduler'

/**
 * CHAQUE MAGASIN DU RELEVÉ DES GELS, SORTI DU FIL PRINCIPAL (2026-10-31).
 *
 * `gels.jsonl` sur 7 jours, `renameSync` : 23,4 s sur `scheduled-tasks.json`, 23,7 s sur
 * `json-index-store.ts:58` (`chat-sessions.json`, `murs-rencontres.json`), 10,1 s sur
 * `remember-deposits.json`, 6,6 s sur `claude-session-cost.json`, 2,3 s sur `session-memory.json`,
 * 1,2 s sur `plans-de-lots.json`.
 *
 * ENTRÉE QUI DOIT FAIRE ÉCHOUER : un retour à `renameSync` ou `writeFileSync` sur l'un de ces chemins.
 * Et pour ceux qui relisent leur propre fichier : une écriture perdue entre deux mutations rapprochées.
 */
vi.mock('node:fs', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:fs')>()
  return {
    ...real,
    default: real,
    renameSync: vi.fn(real.renameSync),
    writeFileSync: vi.fn(real.writeFileSync)
  }
})

const bloquants = (): Array<ReturnType<typeof vi.fn>> =>
  [fs.renameSync, fs.writeFileSync] as unknown as Array<ReturnType<typeof vi.fn>>
/*
 * Les espions ne suffisent pas (mesuré le 2026-10-31) : `tests/reinit-couts-session.ts`
 * (setupFiles) charge `claude-session-cost`, donc `chat-session-store` et `json-index-store`, AVANT le
 * `vi.mock` de ce fichier. Ces modules gardent le vrai `node:fs` : sur le code d'avant, un `renameSync`
 * ici passait inaperçu et leurs tests restaient verts. D'où la seconde preuve, qui ne dépend d'aucun
 * espion : une écriture synchrone laisse son fichier, ou son temporaire, dans le dossier AVANT de rendre
 * la main ; une écriture hors du fil n'y a encore rien posé.
 */
const aucunBloquant = (): void => {
  for (const appel of bloquants()) expect(appel).not.toHaveBeenCalled()
  expect(readdirSync(dir)).toEqual([])
}

let dir = ''
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'aos-magasins-'))
  for (const appel of bloquants()) appel.mockClear()
})
afterEach(async () => {
  await attendreFichier()
  rmSync(dir, { recursive: true, force: true })
})

/** Une entrée du registre des murs telle qu'écrite sur disque : sa date est celle de l'horloge. */
const mur = (signature: string): unknown => ({ signature, derniereFois: expect.any(String) })

describe('json-index-store — murs et sessions du chat', () => {
  it('écrit sans appel bloquant', async () => {
    enregistrerMur('conv-1', 'run::refus', dir)
    aucunBloquant()
    await attendreFichier()
    expect(JSON.parse(readFileSync(mursStorePath(dir), 'utf8'))).toEqual({
      'conv-1': [mur('run::refus')]
    })
  })

  it('ne perd aucune écriture quand deux mutations se suivent sans attendre le disque', async () => {
    enregistrerMur('conv-1', 'premier', dir)
    enregistrerMur('conv-1', 'second', dir)
    enregistrerMur('conv-2', 'autre fil', dir)

    expect(chargerMurs('conv-1', dir)).toEqual(['premier', 'second'])
    await attendreFichier()
    expect(JSON.parse(readFileSync(mursStorePath(dir), 'utf8'))).toEqual({
      'conv-1': [mur('premier'), mur('second')],
      'conv-2': [mur('autre fil')]
    })
  })

  it('relit une session juste enregistrée : le tour suivant reprend sans attendre le disque', () => {
    saveChatSession('conv-1', 'claude:opus', 'session-1', dir)
    saveChatSession('conv-2', 'claude:opus', 'session-2', dir)
    expect(Object.keys(loadChatSessions(dir))).toEqual(['conv-1', 'conv-2'])
    aucunBloquant()
  })

  it('oublier la dernière entrée supprime le fichier, après l’écriture encore en attente', async () => {
    enregistrerMur('conv-1', 'mur', dir)
    oublierMurs('conv-1', dir)

    expect(chargerMurs('conv-1', dir)).toEqual([])
    await attendreFichier()
    expect(existsSync(mursStorePath(dir))).toBe(false)
  })
})

describe('task-store-disk — tâches programmées', () => {
  const entree = {
    title: 'Rapport',
    prompt: 'Fais le rapport',
    enabled: true,
    mode: 'active-only' as const,
    destination: { kind: 'existing' as const, conversationId: 'conv-1' },
    schedule: {
      startDate: '2026-08-03',
      time: '09:30',
      timeZone: 'Europe/Paris',
      recurrence: { unit: 'day' as const, interval: 1 }
    }
  }

  it('enregistre un changement sans appel bloquant', async () => {
    const chemin = join(dir, 'scheduled-tasks.json')
    const store = new TaskStore({ now: () => 1000, id: () => 'tache-1' })
    persistTaskStore(store, chemin)

    store.create(entree)

    aucunBloquant()
    await attendreFichier()
    expect(JSON.parse(readFileSync(chemin, 'utf8')).tasks).toHaveLength(1)
  })

  it('un redémarrage dans le même processus retrouve le changement encore en attente', () => {
    const chemin = join(dir, 'scheduled-tasks.json')
    const avant = new TaskStore({ now: () => 1000, id: () => 'tache-1' })
    persistTaskStore(avant, chemin)
    avant.create(entree)

    const apres = new TaskStore({ now: () => 2000, id: () => 'tache-2' })
    persistTaskStore(apres, chemin)

    expect(apres.listTasks().map((t) => t.id)).toEqual(['tache-1'])
  })

  it('la fermeture pose la dernière valeur sur place', () => {
    const chemin = join(dir, 'scheduled-tasks.json')
    const store = new TaskStore({ now: () => 1000, id: () => 'tache-1' })
    const fermer = persistTaskStore(store, chemin)
    store.create(entree)

    fermer()

    expect(JSON.parse(readFileSync(chemin, 'utf8')).tasks).toHaveLength(1)
  })

  /*
   * « exactement une fois, même après redémarrage » (task-store.test.ts) : une tâche ne doit pas
   * partir tant que sa revendication n'est pas sur le disque, sinon un plantage juste après la
   * rejouerait au démarrage suivant.
   */
  it('une tâche ne part pas avant que sa revendication soit sur le disque', async () => {
    const chemin = join(dir, 'scheduled-tasks.json')
    const store = new TaskStore({ now: () => 1000, id: () => 'tache-1' })
    persistTaskStore(store, chemin)
    const tache = store.create(entree)
    await attendreFichier()

    let surDisqueAuDepart: string[] = []
    const dispatcher = {
      run: async () => {
        surDisqueAuDepart = JSON.parse(readFileSync(chemin, 'utf8')).occurrences.map(
          (o: { status: string }) => o.status
        )
        return { status: 'completed' as const }
      }
    }
    const scheduler = new TaskScheduler(store, dispatcher as never, {} as never)

    await scheduler.runNow(tache.id)

    expect(surDisqueAuDepart).toEqual(['running'])
  })

  it('une revendication que le disque refuse : la tâche ne part pas, et le dit', async () => {
    const store = new TaskStore({ now: () => 1000, id: () => 'tache-1' })
    const tache = store.create(entree)
    store.attendrePersistance = async () => false
    const dispatcher = { run: vi.fn() }
    const scheduler = new TaskScheduler(store, dispatcher as never, {} as never)

    await scheduler.runNow(tache.id)

    expect(dispatcher.run).not.toHaveBeenCalled()
    expect(store.listOccurrences().map((o) => o.status)).toEqual(['failed'])
  })
})

describe('brain-remember — registre anti-doublon', () => {
  afterEach(() => configureRememberDepositStore())

  it('enregistre sans appel bloquant', async () => {
    const chemin = join(dir, 'remember-deposits.json')
    configureRememberDepositStore(chemin)

    forgetSessionDeposits()

    aucunBloquant()
    await attendreFichier()
    expect(JSON.parse(readFileSync(chemin, 'utf8'))).toEqual({ version: 2, deposits: [] })
  })
})

describe('session-memory-echo — écho du fil', () => {
  afterEach(() => configureSessionMemoryEcho())

  it('enregistre sans appel bloquant, et un redémarrage retrouve le fait encore en attente', () => {
    const chemin = join(dir, 'session-memory.json')
    configureSessionMemoryEcho(chemin)

    noteRemembered('conv-1', { title: 'Un fait', body: 'Le corps du fait' })
    aucunBloquant()

    configureSessionMemoryEcho(chemin)
    expect(rememberedFacts('conv-1').map((f) => f.title)).toEqual(['Un fait'])
  })
})

describe('plans-de-lots — fichier des plans', () => {
  it('enregistre sans appel bloquant, et relit la dernière valeur avant qu’elle soit posée', async () => {
    const chemin = cheminFichierPlans(dir)
    const stockage = stockageFichier(chemin)

    stockage.ecrire('{"version":1,"plans":[]}')

    aucunBloquant()
    expect(stockage.lire()).toBe('{"version":1,"plans":[]}')
    await attendreFichier()
    expect(readFileSync(chemin, 'utf8')).toBe('{"version":1,"plans":[]}')
  })

  it('un fichier absent reste une chaîne vide', () => {
    expect(stockageFichier(cheminFichierPlans(dir)).lire()).toBe('')
  })
})

describe('claude-session-cost — cumul des sessions', () => {
  afterEach(() => imposerCheminMagasinCoutsDeSession(undefined))

  it('enregistre sans appel bloquant', async () => {
    const chemin = join(dir, 'claude-session-cost.json')
    imposerCheminMagasinCoutsDeSession(chemin)

    coutDuTourDepuisCumul('session-1', 1, 1000, () => new Set())

    aucunBloquant()
    await attendreFichier()
    expect(JSON.parse(readFileSync(chemin, 'utf8'))['session-1'].lastTotalUsd).toBe(1)
  })

  /* Relire l'ancien cumul facturerait deux fois le premier tour. */
  it('deux tours rapprochés : le second ne paie que sa différence', () => {
    imposerCheminMagasinCoutsDeSession(join(dir, 'claude-session-cost.json'))

    expect(coutDuTourDepuisCumul('session-1', 1, 1000, () => new Set())).toBe(1)
    expect(coutDuTourDepuisCumul('session-1', 1.5, 2000, () => new Set())).toBe(0.5)
  })
})

describe('fermeture de l’app', () => {
  it('vide tous les magasins sur place', () => {
    enregistrerMur('conv-1', 'mur', dir)
    viderFichiersEnAttente()
    expect(JSON.parse(readFileSync(mursStorePath(dir), 'utf8'))).toEqual({ 'conv-1': [mur('mur')] })
  })
})
