/**
 * UN DISQUE QUI CALE NE DOIT PAS GELER L'INTERFACE.
 *
 * Incident du 2026-09-09 (`gels.jsonl`, 15:38:48 → 15:39:14) : TROIS `appendFileSync` de journal de
 * tour ont bloqué 10 003, 10 007 et 10 004 ms d'affilée sur des fichiers de quelques Ko. Le volume
 * n'y était pour rien — le disque a calé. Comme l'écriture vivait sur le fil qui dessine
 * l'interface, l'app est restée figée ~26 s et l'utilisateur a dû la fermer de force.
 *
 * Ce que ces tests exigent, et l'entrée qui les ferait échouer si la correction était défaite :
 *  (a) l'écriture COURANTE (lot plein, délai écoulé) ne passe JAMAIS par un appel bloquant — un
 *      retour à `appendFileSync` sur ce chemin rallume le gel et échoue ici ;
 *  (b) un disque LENT (10 s, la durée réellement mesurée) ne retarde pas d'un pouce l'émission des
 *      deltas : le fil principal rend la main tout de suite ;
 *  (c) la CLÔTURE d'un tour reste synchrone — sinon une mort du process laisse un tour « inachevé »
 *      que la reprise rejoue à l'infini (tour zombie) ;
 *  (d) pendant qu'une écriture est EN VOL, la relecture rend quand même le tour COMPLET : la
 *      durabilité perçue ne doit rien perdre au passage en asynchrone.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

vi.mock('node:fs', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:fs')>()
  return { ...real, default: real, appendFileSync: vi.fn(real.appendFileSync) }
})

/** Le disque est pilotable : `retard` simule le stall réellement observé. */
let retardMs = 0
vi.mock('node:fs/promises', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...real,
    default: real,
    appendFile: vi.fn(async (...args: Parameters<typeof real.appendFile>) => {
      if (retardMs > 0) await new Promise((resolve) => setTimeout(resolve, retardMs))
      return real.appendFile(...args)
    })
  }
})

const fs = await import('node:fs')
const fsp = await import('node:fs/promises')
const { appendTurnEvent, readTurnJournal, attendreEcrituresJournal, isTurnFinished } =
  await import('./turn-journal')

const FLUSH_EVERY = 64

let root = ''
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'turnjournal-horsfil-'))
  retardMs = 0
  vi.mocked(fs.appendFileSync).mockClear()
  vi.mocked(fsp.appendFile).mockClear()
})
afterEach(async () => {
  retardMs = 0
  await attendreEcrituresJournal()
  rmSync(root, { recursive: true, force: true })
})

describe('journal de tour — écriture hors du fil principal', () => {
  it("n'appelle AUCUNE écriture bloquante pour les deltas courants (lot plein)", async () => {
    for (let i = 0; i < FLUSH_EVERY; i++) {
      appendTurnEvent(root, 'conv-gel', 'tour-1', { kind: 'delta', text: `t${i}` })
    }

    // C'est l'assertion qui garde le correctif : au RETOUR de l'émission, RIEN n'a touché le disque
    // en bloquant. Le lot n'est même pas encore soumis — le fil principal a déjà rendu la main.
    expect(vi.mocked(fs.appendFileSync)).not.toHaveBeenCalled()

    await attendreEcrituresJournal()
    // Et le lot est bien parti par la voie asynchrone, en UNE écriture.
    expect(vi.mocked(fsp.appendFile)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(fs.appendFileSync)).not.toHaveBeenCalled()
    expect(readTurnJournal(root, 'conv-gel', 'tour-1')).toHaveLength(FLUSH_EVERY)
  })

  it('rend la main tout de suite même si le disque cale 10 s (la durée du gel réel)', async () => {
    retardMs = 10_000
    vi.useFakeTimers()
    try {
      const debut = performance.now()
      for (let i = 0; i < FLUSH_EVERY * 3; i++) {
        appendTurnEvent(root, 'conv-gel', 'tour-lent', { kind: 'delta', text: `t${i}` })
      }
      const bloquageMs = performance.now() - debut

      // L'incident bloquait ~10 s par écriture. Ici le fil principal ne doit pas attendre le disque.
      expect(bloquageMs).toBeLessThan(1_000)
      expect(vi.mocked(fs.appendFileSync)).not.toHaveBeenCalled()

      // Rien n'est perdu pour autant : le tour reste relisible ENTIER pendant que le disque cale.
      expect(readTurnJournal(root, 'conv-gel', 'tour-lent')).toHaveLength(FLUSH_EVERY * 3)
    } finally {
      vi.useRealTimers()
      retardMs = 0
    }
  })

  it('écrit la CLÔTURE du tour en bloquant (sinon la reprise voit un tour zombie)', () => {
    appendTurnEvent(root, 'conv-gel', 'tour-2', { kind: 'delta', text: 'a' })
    expect(vi.mocked(fs.appendFileSync)).not.toHaveBeenCalled()

    appendTurnEvent(root, 'conv-gel', 'tour-2', { kind: 'done' })

    expect(vi.mocked(fs.appendFileSync)).toHaveBeenCalledTimes(1)
    const events = readTurnJournal(root, 'conv-gel', 'tour-2')
    expect(events.map((e) => e.kind)).toEqual(['delta', 'done'])
    expect(isTurnFinished(events)).toBe(true)
  })

  it('rend le tour COMPLET et DANS L’ORDRE pendant qu’une écriture est en vol', async () => {
    retardMs = 50
    for (let i = 0; i < FLUSH_EVERY + 5; i++) {
      appendTurnEvent(root, 'conv-gel', 'tour-3', { kind: 'delta', text: `t${i}` })
    }

    // Lot déjà soumis (en vol) + 5 encore en tampon : la relecture doit voir les deux, dans l'ordre.
    const pendantLeVol = readTurnJournal(root, 'conv-gel', 'tour-3')
    expect(pendantLeVol).toHaveLength(FLUSH_EVERY + 5)
    expect(pendantLeVol.map((e) => e.text)).toEqual(
      Array.from({ length: FLUSH_EVERY + 5 }, (_, i) => `t${i}`)
    )

    await attendreEcrituresJournal()
    appendTurnEvent(root, 'conv-gel', 'tour-3', { kind: 'done' })
    const apres = readTurnJournal(root, 'conv-gel', 'tour-3')
    expect(apres).toHaveLength(FLUSH_EVERY + 6)
    expect(apres.at(-1)?.kind).toBe('done')
  })
})
