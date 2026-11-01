import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import * as fs from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  journaliserSaisie,
  journalSaisiePath,
  lireOrientationsRattachees,
  lireSaisies,
  rattacherSaisieAuTour
} from './journal-saisie'

/**
 * LE JOURNAL DES SAISIES NE TIENT PLUS LE FIL PRINCIPAL (conv-1368, 2026-10-31).
 *
 * Mesure `gels.jsonl` sur 7 jours : `openSync` de `journal-saisie.ts` a figé la fenêtre 45,6 s, dont
 * 9,9 s d'un seul coup sur un fichier de 3 Mo, à l'ouverture d'un fil (`chat:orientations`) et à chaque
 * message (`rattacherSaisieAuTour`). Le SSD n'y est pour rien (420 ms au pire sur 675 relevés
 * Windows) : l'appel attendait au-dessus du disque.
 *
 * ENTRÉE QUI DOIT FAIRE ÉCHOUER : un retour à `openSync`, `readSync`, `fstatSync`, `existsSync` ou
 * `appendFileSync` sur ces deux chemins.
 */
vi.mock('node:fs', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:fs')>()
  return {
    ...real,
    default: real,
    openSync: vi.fn(real.openSync),
    readSync: vi.fn(real.readSync),
    fstatSync: vi.fn(real.fstatSync),
    existsSync: vi.fn(real.existsSync),
    appendFileSync: vi.fn(real.appendFileSync)
  }
})

const espions = (): Array<ReturnType<typeof vi.fn>> =>
  [
    fs.openSync,
    fs.readSync,
    fs.fstatSync,
    fs.existsSync,
    fs.appendFileSync
  ] as unknown as Array<ReturnType<typeof vi.fn>>

let dir = ''
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'aos-saisie-sans-gel-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('journal des saisies — lecture hors du fil principal', () => {
  it('relit les consignes d’un fil sans un seul appel bloquant', async () => {
    journaliserSaisie({ conversationId: 'conv-1', texte: 'corrige ça', voie: 'orientation' }, dir)
    for (const espion of espions()) espion.mockClear()

    const orientations = await lireOrientationsRattachees('conv-1', dir)

    for (const espion of espions()) expect(espion).not.toHaveBeenCalled()
    expect(orientations.map((o) => o.texte)).toEqual(['corrige ça'])
  })

  it('rattache une saisie à son tour sans un seul appel bloquant', async () => {
    journaliserSaisie({ conversationId: 'conv-1', texte: 'bonjour', voie: 'message' }, dir)
    for (const espion of espions()) espion.mockClear()

    expect(await rattacherSaisieAuTour('conv-1', 't-1', 'bonjour', dir)).toBe(true)

    for (const espion of espions()) expect(espion).not.toHaveBeenCalled()
    expect(readFileSync(journalSaisiePath(dir), 'utf8')).toContain('"turnId":"t-1"')
  })

  it('rend vide sur un journal absent, sans lever : le cas sain le plus proche', async () => {
    expect(await lireOrientationsRattachees('conv-1', dir)).toEqual([])
    expect(await rattacherSaisieAuTour('conv-1', 't-1', 'bonjour', dir)).toBe(false)
  })

  it('ne double aucune ligne quand des lectures se croisent', async () => {
    journaliserSaisie({ conversationId: 'conv-1', texte: 'une', voie: 'orientation' }, dir)
    journaliserSaisie({ conversationId: 'conv-1', texte: 'deux', voie: 'orientation' }, dir)

    const lectures = await Promise.all([
      lireOrientationsRattachees('conv-1', dir),
      lireOrientationsRattachees('conv-1', dir),
      lireOrientationsRattachees('conv-1', dir)
    ])

    for (const lecture of lectures) expect(lecture.map((o) => o.texte)).toEqual(['une', 'deux'])
    // Le lecteur synchrone de /kaizen partage le même index : il ne doit rien recompter non plus.
    expect(lireSaisies('conv-1', dir).map((s) => s.texte)).toEqual(['une', 'deux'])
  })

  it('suit un journal qui grandit, puis un journal réécrit plus court', async () => {
    journaliserSaisie({ conversationId: 'conv-1', texte: 'avant', voie: 'orientation' }, dir)
    await lireOrientationsRattachees('conv-1', dir)
    journaliserSaisie({ conversationId: 'conv-1', texte: 'après', voie: 'orientation' }, dir)
    expect((await lireOrientationsRattachees('conv-1', dir)).map((o) => o.texte)).toEqual([
      'avant',
      'après'
    ])

    writeFileSync(journalSaisiePath(dir), '', 'utf8')
    journaliserSaisie({ conversationId: 'conv-1', texte: 'neuf', voie: 'orientation' }, dir)
    expect((await lireOrientationsRattachees('conv-1', dir)).map((o) => o.texte)).toEqual(['neuf'])
  })
})
