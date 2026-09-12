import { mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import {
  journaliserSaisie,
  lireOrientationsRattachees,
  rattacherSaisieAuTour,
  lireSaisies
} from './journal-saisie'

/**
 * Les consignes tapées PENDANT un tour étaient écrites puis jamais relues par la conversation :
 * 101 saisies de voie `orientation` dormaient dans le journal le 2026-09-12. Ce test prouve la
 * relecture ET la jointure vers le tour infléchi, qui est l'ancre d'affichage dans le fil.
 */
describe('relecture des consignes données pendant un tour', () => {
  it('rend les orientations avec le tour qu’elles ont infléchi, et rien d’autre', () => {
    const racine = mkdtempSync(join(tmpdir(), 'journal-orientations-'))
    journaliserSaisie(
      { conversationId: 'conv-1', texte: 'demande initiale', voie: 'message' },
      racine
    )
    journaliserSaisie(
      { conversationId: 'conv-1', texte: 'non, garde le bouton', voie: 'orientation' },
      racine
    )
    journaliserSaisie({ conversationId: 'conv-2', texte: 'autre fil', voie: 'orientation' }, racine)

    const orientation = lireSaisies('conv-1', racine).find(
      (saisie) => saisie.voie === 'orientation'
    )
    expect(orientation).toBeDefined()
    expect(rattacherSaisieAuTour('conv-1', 'turn-7', 'non, garde le bouton', racine)).toBe(true)

    const relues = lireOrientationsRattachees('conv-1', racine)
    expect(relues).toHaveLength(1)
    expect(relues[0]?.texte).toBe('non, garde le bouton')
    expect(relues[0]?.turnId).toBe('turn-7')
    // Filtre STRICT sur la conversation : le texte d'un autre fil ne doit jamais fuiter ici.
    expect(lireOrientationsRattachees('conv-2', racine).map((item) => item.texte)).toEqual([
      'autre fil'
    ])
  })

  it('rend une orientation sans tour quand aucun lien n’a été posé', () => {
    const racine = mkdtempSync(join(tmpdir(), 'journal-orientations-orphelines-'))
    journaliserSaisie({ conversationId: 'conv-9', texte: 'attends', voie: 'orientation' }, racine)
    const relues = lireOrientationsRattachees('conv-9', racine)
    expect(relues).toHaveLength(1)
    expect(relues[0]?.turnId).toBeUndefined()
  })

  it('rend une liste vide quand le journal n’existe pas', () => {
    expect(lireOrientationsRattachees('conv-1', mkdtempSync(join(tmpdir(), 'vide-')))).toEqual([])
  })
})
