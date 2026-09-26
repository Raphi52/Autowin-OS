import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  cheminJournalWatchdogTeams,
  creerBattementWatchdog,
  creerJournalWatchdog,
  empreinteConversation,
  type ValeurJournal
} from './journal-watchdog-teams'
import { WatchdogEngine } from './watchdog-engine'
import { mailWatchdogSeed } from './watchdog-mail'
import type { ScheduledTask, WatchdogSource } from './types'

// conv-770, 2026-09-26 : l'app relancee par restart_app n'enregistre pas sa sortie console
// (app-restart.ts, stdio 'ignore') ; le watchdog Teams n'ecrivait QUE dans cette console, donc on
// ne pouvait prouver ni la voie choisie, ni une detection, ni une reponse. Ce journal est son seul
// temoin lisible apres coup.

const dossiers: string[] = []
const dossier = (): string => {
  const d = mkdtempSync(join(tmpdir(), 'journal-wd-'))
  dossiers.push(d)
  return d
}
afterEach(() => {
  for (const d of dossiers.splice(0)) rmSync(d, { recursive: true, force: true })
})

describe('journal du watchdog Teams', () => {
  it('ecrit une ligne horodatee par evenement, lisible et sans retour a la ligne injecte', () => {
    const chemin = cheminJournalWatchdogTeams(dossier())
    const journal = creerJournalWatchdog(chemin, () => new Date(2026, 8, 26, 11, 2, 3))
    journal('source', { mode: 'local', jetonGraph: 'absent' })
    journal('reponse', { ok: false, erreur: 'envoi annulé\nligne forgée' })
    expect(readFileSync(chemin, 'utf8')).toBe(
      '2026-09-26T11:02:03 source mode=local jetonGraph=absent\n' +
        '2026-09-26T11:02:03 reponse ok=false erreur="envoi annulé ligne forgée"\n'
    )
  })

  it('ne leve jamais : un journal illisible ne doit pas casser le watchdog', () => {
    const racine = dossier()
    const bloquant = join(racine, 'fichier')
    writeFileSync(bloquant, 'x')
    const journal = creerJournalWatchdog(join(bloquant, 'sous', 'watchdog-teams.log'))
    expect(() => journal('source', { mode: 'local' })).not.toThrow()
  })

  it('reste borne : au-dela de la taille maximale, l’ancien journal passe en .1', () => {
    const chemin = cheminJournalWatchdogTeams(dossier())
    const journal = creerJournalWatchdog(chemin, () => new Date(2026, 8, 26), 200)
    for (let i = 0; i < 10; i++) journal('detecte', { conv: 'abcdef12', n: i })
    expect(existsSync(`${chemin}.1`)).toBe(true)
    expect(readFileSync(chemin, 'utf8').length).toBeLessThanOrEqual(200 + 80)
  })

  it('empreinte de conversation : stable, courte, sans l’identifiant brut (qui contient des ids de personnes)', () => {
    const id = 'teams:19:aaaa-1111_bbbb-2222@unq.gbl.spaces:1700000000000'
    const e = empreinteConversation(id)
    expect(e).toMatch(/^[0-9a-f]{8}$/)
    expect(empreinteConversation('teams:19:aaaa-1111_bbbb-2222@unq.gbl.spaces:1800000000000')).toBe(
      e
    )
    expect(empreinteConversation('teams:19:cccc@unq.gbl.spaces:1')).not.toBe(e)
  })
})

describe('battement « toujours actif » du watchdog Teams', () => {
  // conv-770, 2026-09-26 : le journal n'ecrit rien tant que tout va bien (derniere ligne a 11:11:23,
  // puis silence) ; on ne distinguait pas « aucun message » de « la boucle de lecture est morte ».
  const lignes: Array<[string, Record<string, ValeurJournal>]> = []
  const journal = (e: string, d: Record<string, ValeurJournal> = {}): void => {
    lignes.push([e, d])
  }
  afterEach(() => {
    lignes.length = 0
  })

  it('au plus une ligne par intervalle, avec les lectures et echecs depuis la precedente', () => {
    let t = 0
    const battement = creerBattementWatchdog(journal, 3_600_000, () => t)
    for (let i = 0; i < 59; i++) {
      t += 60_000
      battement(i !== 10) // une lecture en echec
    }
    expect(lignes).toEqual([]) // 59 min : pas encore d'heure pleine
    t += 60_000
    battement(true)
    expect(lignes).toEqual([['actif', { lectures: 59, echecs: 1, depuisMin: 60 }]])
    // Les compteurs repartent de zero pour l'heure suivante.
    t += 3_600_000
    battement(true)
    expect(lignes[1]).toEqual(['actif', { lectures: 1, echecs: 0, depuisMin: 60 }])
  })

  it('ecrit par la BOUCLE elle-meme : sans lecture, aucune ligne, meme apres des heures', () => {
    let t = 0
    creerBattementWatchdog(journal, 3_600_000, () => t)
    t += 5 * 3_600_000
    expect(lignes).toEqual([]) // l'absence de ligne « actif » est le signal d'une boucle arretee
  })
})

describe('WatchdogEngine.notifyMail — bilan par regle', () => {
  const task = (id: string, source: WatchdogSource): ScheduledTask =>
    ({
      ...mailWatchdogSeed(),
      id,
      watchdog: { ...mailWatchdogSeed().watchdog!, source },
      nextRunAt: null,
      createdAt: 0,
      updatedAt: 0
    }) as ScheduledTask

  it('dit pour chaque regle si elle a declenche ou pourquoi elle a refuse', async () => {
    const runWatchdog = vi.fn(async () => ({ fired: true }))
    const tasks = [
      task('outlook', { kind: 'outlook-mail', channel: 'outlook' }),
      task('teams', {
        kind: 'outlook-mail',
        channel: 'teams',
        senders: { 'teams:bob': { name: 'Bob', enabled: false } }
      })
    ]
    const engine = new WatchdogEngine(() => tasks, { runWatchdog })
    expect(
      await engine.notifyMail({
        itemId: 'teams:c:1',
        context: 'c',
        channel: 'teams',
        senderKey: 'teams:al'
      })
    ).toEqual([
      { taskId: 'outlook', issue: 'autre-canal' },
      { taskId: 'teams', issue: 'declenche' }
    ])
    expect(
      await engine.notifyMail({
        itemId: 'teams:c:2',
        context: 'c',
        channel: 'teams',
        senderKey: 'teams:bob'
      })
    ).toEqual([
      { taskId: 'outlook', issue: 'autre-canal' },
      { taskId: 'teams', issue: 'interlocuteur-coupe' }
    ])
    // Meme message une seconde fois : la garde anti-doublon refuse, avec sa raison.
    const doublon = await engine.notifyMail({
      itemId: 'teams:c:1',
      context: 'c',
      channel: 'teams',
      senderKey: 'teams:al'
    })
    expect(doublon[1].taskId).toBe('teams')
    expect(doublon[1].issue).not.toBe('declenche')
    expect(runWatchdog).toHaveBeenCalledTimes(1)
  })
})
