import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  ORIGINE_INCONNUE,
  annoncerFermeture,
  cheminJournalArrets,
  journaliserCauseFermeture,
  oublierOrigineFermeture
} from './journal-arrets'

function racineTemporaire(): string {
  return mkdtempSync(join(tmpdir(), 'autowin-arrets-'))
}

afterEach(() => oublierOrigineFermeture())

describe('journal des arrets — cause de fermeture', () => {
  it('ecrit QUI a demande la fermeture, a cote des lignes du veilleur', () => {
    const racine = racineTemporaire()
    try {
      const chemin = cheminJournalArrets(racine)
      expect(chemin.endsWith('app-exits.log')).toBe(true)

      annoncerFermeture('restart_app (conv-66)')
      journaliserCauseFermeture(chemin, new Date(2026, 8, 1, 16, 10, 12))

      expect(readFileSync(chemin, 'utf8')).toBe(
        '2026-09-01T16:10:12 fermeture demandee-par=restart_app (conv-66)\n'
      )
    } finally {
      rmSync(racine, { recursive: true, force: true })
    }
  })

  it("nomme l'ignorance quand aucun chemin interne n'a revendique la fermeture", () => {
    const racine = racineTemporaire()
    try {
      const chemin = cheminJournalArrets(racine)

      const ligne = journaliserCauseFermeture(chemin)

      expect(ligne).toContain(`fermeture demandee-par=${ORIGINE_INCONNUE}`)
      expect(readFileSync(chemin, 'utf8')).toBe(ligne)
    } finally {
      rmSync(racine, { recursive: true, force: true })
    }
  })

  it('retient la DERNIERE origine annoncee et ajoute une ligne par fermeture', () => {
    const racine = racineTemporaire()
    try {
      const chemin = cheminJournalArrets(racine)

      annoncerFermeture('mise a jour appliquee')
      journaliserCauseFermeture(chemin, new Date(2026, 8, 1, 9, 0, 0))
      annoncerFermeture('   ')
      annoncerFermeture('menu tray')
      journaliserCauseFermeture(chemin, new Date(2026, 8, 1, 9, 5, 0))

      expect(readFileSync(chemin, 'utf8').trim().split('\n')).toEqual([
        '2026-09-01T09:00:00 fermeture demandee-par=mise a jour appliquee',
        '2026-09-01T09:05:00 fermeture demandee-par=menu tray'
      ])
    } finally {
      rmSync(racine, { recursive: true, force: true })
    }
  })

  it('ne casse jamais la fermeture si le journal est inaccessible', () => {
    const racine = racineTemporaire()
    try {
      // Un FICHIER la ou le module attend un dossier : `mkdirSync` echoue, la fermeture continue.
      const cheminImpossible = join(cheminJournalArrets(racine), 'sous', 'app-exits.log')
      annoncerFermeture('restart_app (conv-1)')

      expect(() => journaliserCauseFermeture(cheminImpossible)).not.toThrow()
    } finally {
      rmSync(racine, { recursive: true, force: true })
    }
  })
})
