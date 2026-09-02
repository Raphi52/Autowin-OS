import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { demarrerDetecteurDeGel, journaliserGel, ouvrirTourDeChat } from './gel-main'
import type { Gel } from '../shared/gel-detector'

/**
 * UN GEL SANS TOUR NE S'IMPUTE A RIEN.
 *
 * Mesure du 2026-09-02 sur `gels.jsonl` reel : aucune ligne ne porte de conversation ni de tour. On
 * lit « la fenetre a ete figee 33 s » sans jamais pouvoir dire PENDANT QUOI, alors que l'app sait
 * exactement quel tour de chat tournait a cet instant. Le rapprochement se faisait a la main, a
 * l'horodatage — et il est faux des que deux conversations travaillent.
 */
const gel = (): Gel => ({
  ts: '2026-09-02T12:00:00.000Z',
  blocageMs: 4200,
  operation: 'ipc:chat (sync)'
})

describe('journal des gels — la ligne dit PENDANT QUEL tour la fenetre a gele', () => {
  let ecrits: Gel[]
  let arreter: () => void
  let dir: string
  beforeEach(() => {
    ecrits = []
    dir = mkdtempSync(join(tmpdir(), 'gels-'))
    // Puits INJECTE par l'API existante : on observe le meme point d'ecriture que le produit.
    arreter = demarrerDetecteurDeGel(dir, 3_600_000, (g) => ecrits.push(g))
  })
  afterEach(() => {
    arreter()
    rmSync(dir, { recursive: true, force: true })
  })

  it('joint le tour ouvert au gel', () => {
    const fermer = ouvrirTourDeChat({ conversationId: 'conv-131', turnId: 'turn-77' })
    journaliserGel(gel())
    fermer()
    expect(ecrits[0]).toMatchObject({ conversationId: 'conv-131', turnId: 'turn-77' })
  })

  it('n invente RIEN quand aucun tour ne tourne — hors tour, la ligne reste muette', () => {
    journaliserGel(gel())
    expect('conversationId' in (ecrits[0] as object)).toBe(false)
    expect('turnId' in (ecrits[0] as object)).toBe(false)
  })

  it('oublie le tour des qu il est referme — pas d imputation a un tour clos', () => {
    ouvrirTourDeChat({ conversationId: 'conv-131', turnId: 'turn-77' })()
    journaliserGel(gel())
    expect('turnId' in (ecrits[0] as object)).toBe(false)
  })

  /*
   * L'ALIBI. Deux tours en vol, un gel : n'importe lequel des deux serait une accusation en l'air.
   * Le defaut a deja ete paye sur `timer:balayage:copiesAbandonnees` (28 gels attribues a tort).
   */
  it('n accuse AUCUN tour quand deux tours tournent en meme temps', () => {
    const fermerA = ouvrirTourDeChat({ conversationId: 'conv-131', turnId: 'turn-77' })
    const fermerB = ouvrirTourDeChat({ conversationId: 'conv-9', turnId: 'turn-78' })
    journaliserGel(gel())
    expect('turnId' in (ecrits[0] as object)).toBe(false)
    // Le tour A refermerait un scalaire partage : ici il ne retire QUE son entree.
    fermerB()
    journaliserGel(gel())
    expect(ecrits[1]).toMatchObject({ turnId: 'turn-77' })
    fermerA()
  })
})
