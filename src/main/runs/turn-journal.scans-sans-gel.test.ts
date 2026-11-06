/**
 * LES INVENTAIRES ET LA CLÔTURE DU JOURNAL DE TOUR NE TIENNENT PLUS LE FIL PRINCIPAL.
 *
 * `gels.jsonl`, matinée du 2026-11-05 (05:00 → 09:10 UTC) : `appendFileSync` de
 * `turn-journal.ts:192` appelé par `flushAllTurnJournals` (`:206`) a figé la fenêtre 90 s en 20
 * appels. Ce n'était pas l'arrêt de l'app : chaque inventaire (`listUnfinishedTurns`, sa version
 * dite « sans E/S synchrone », `pruneFinishedTurnJournals`) vidait d'abord TOUS les tampons en
 * bloquant. Et `readFileSync` de `:231`, la relecture du journal entier avant chaque clôture
 * (`clotureDejaEcrite`), 37 s en 15 appels. Le SSD était inactif à 93 % : le mur est au-dessus du
 * disque (`scripts/trace-blocage-disque.ps1`).
 *
 * ENTRÉES QUI DOIVENT FAIRE ÉCHOUER : un inventaire qui rappelle `appendFileSync` ; un tour qui
 * n'existe encore qu'en mémoire et que l'inventaire ne voit pas (il ne serait jamais repris) ; un
 * journal en cours d'écriture supprimé par le ménage ; une clôture d'un tour né dans ce processus
 * qui relit son journal en bloquant ; une clôture en double qui passe.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

vi.mock('node:fs', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:fs')>()
  return {
    ...real,
    default: real,
    appendFileSync: vi.fn(real.appendFileSync),
    readFileSync: vi.fn(real.readFileSync)
  }
})

const fs = await import('node:fs')
const {
  appendTurnEvent,
  attendreEcrituresJournal,
  listUnfinishedTurns,
  listUnfinishedTurnsAsync,
  listUnfinishedTurnsPuisMenage,
  pruneFinishedTurnJournals,
  turnJournalPath
} = await import('./turn-journal')

const ecritureBloquante = vi.mocked(fs.appendFileSync)
const lectureBloquante = vi.mocked(fs.readFileSync)
const lecturesDe = (chemin: string): number =>
  lectureBloquante.mock.calls.filter(([lu]) => String(lu) === chemin).length

let root = ''
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'turnjournal-scans-'))
  ecritureBloquante.mockClear()
  lectureBloquante.mockClear()
})
afterEach(async () => {
  await attendreEcrituresJournal()
  rmSync(root, { recursive: true, force: true })
})

const troisDeltas = (conversationId: string, turnId: string): void => {
  for (let i = 0; i < 3; i++)
    appendTurnEvent(root, conversationId, turnId, { kind: 'delta', text: `t${i}` })
}

describe('inventaires — aucun vidage bloquant, et le tour encore en mémoire reste visible', () => {
  it('listUnfinishedTurns', () => {
    troisDeltas('conv-a', 'tour-1')

    const liste = listUnfinishedTurns(root)

    expect(ecritureBloquante).not.toHaveBeenCalled()
    expect(liste).toMatchObject([{ conversationId: 'conv-a', turnId: 'tour-1', events: 3 }])
  })

  it('listUnfinishedTurnsAsync', async () => {
    troisDeltas('conv-a', 'tour-1')

    const liste = await listUnfinishedTurnsAsync(root)

    expect(ecritureBloquante).not.toHaveBeenCalled()
    expect(liste).toMatchObject([{ conversationId: 'conv-a', turnId: 'tour-1', events: 3 }])
  })

  it('listUnfinishedTurnsPuisMenage', () => {
    troisDeltas('conv-a', 'tour-1')

    const liste = listUnfinishedTurnsPuisMenage(root, { planifier: () => undefined })

    expect(ecritureBloquante).not.toHaveBeenCalled()
    expect(liste).toMatchObject([{ conversationId: 'conv-a', turnId: 'tour-1', events: 3 }])
  })

  it('un tour déjà sur le disque et prolongé en mémoire est compté une fois, en entier', async () => {
    troisDeltas('conv-a', 'tour-1')
    await attendreEcrituresJournal()
    troisDeltas('conv-a', 'tour-1')

    const liste = listUnfinishedTurns(root)

    expect(ecritureBloquante).not.toHaveBeenCalled()
    expect(liste).toMatchObject([{ conversationId: 'conv-a', turnId: 'tour-1', events: 6 }])
  })

  it('le ménage ne vide rien en bloquant, et ne supprime pas un journal en cours d’écriture', () => {
    const chemin = turnJournalPath(root, 'conv-a', 'tour-vieux')
    fs.mkdirSync(join(root, 'conv-a'), { recursive: true })
    fs.writeFileSync(chemin, `${JSON.stringify({ kind: 'done', at: 1 })}\n`)
    const ilYaHuitJours = new Date(Date.now() - 8 * 24 * 3_600_000)
    fs.utimesSync(chemin, ilYaHuitJours, ilYaHuitJours)
    appendTurnEvent(root, 'conv-a', 'tour-vieux', { kind: 'resumed' })

    const supprimes = pruneFinishedTurnJournals(root)

    expect(ecritureBloquante).not.toHaveBeenCalled()
    expect(supprimes).toBe(0)
    expect(fs.existsSync(chemin)).toBe(true)
  })
})

describe('clôture — le doublon se refuse sans relire le journal en bloquant', () => {
  it('un tour né dans ce processus se clôt sans relire son journal', async () => {
    troisDeltas('conv-a', 'tour-1')
    await attendreEcrituresJournal()
    const chemin = turnJournalPath(root, 'conv-a', 'tour-1')
    lectureBloquante.mockClear()

    appendTurnEvent(root, 'conv-a', 'tour-1', { kind: 'done' })

    expect(lecturesDe(chemin)).toBe(0)
    // La clôture reste posée tout de suite : la garantie contre le tour zombie ne bouge pas.
    expect(fs.readFileSync(chemin, 'utf8')).toContain('"kind":"done"')
    lectureBloquante.mockClear()
    expect(() => appendTurnEvent(root, 'conv-a', 'tour-1', { kind: 'done' })).toThrow(/déjà écrite/)
    expect(lecturesDe(chemin)).toBe(0)
  })

  it('une clôture déjà sur le disque, écrite avant ce processus, reste refusée — prélue ou non', async () => {
    const echec = { kind: 'failed', error: 'reprise refusée, définitive' }
    for (const turnId of ['tour-prelu', 'tour-froid']) {
      fs.mkdirSync(join(root, 'conv-b'), { recursive: true })
      fs.writeFileSync(
        turnJournalPath(root, 'conv-b', turnId),
        `${JSON.stringify({ ...echec, at: 1 })}\n`
      )
    }
    appendTurnEvent(root, 'conv-b', 'tour-prelu', { kind: 'resumed' })
    await attendreEcrituresJournal()
    lectureBloquante.mockClear()

    expect(() => appendTurnEvent(root, 'conv-b', 'tour-prelu', echec)).toThrow(/déjà écrite/)
    expect(lecturesDe(turnJournalPath(root, 'conv-b', 'tour-prelu'))).toBe(0)
    // Jamais prélu : la relecture d'avant reste le filet, et le doublon est toujours refusé.
    expect(() => appendTurnEvent(root, 'conv-b', 'tour-froid', echec)).toThrow(/déjà écrite/)
  })
})
