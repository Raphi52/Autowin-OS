import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  journaliserSaisie,
  journalSaisiePath,
  type SaisieJournalisee
} from './journal-saisie'

/**
 * Le défaut reproduit ici est celui du 2026-09-01 (conv-30) : un texte tapé PENDANT un tour, dont
 * l'injection échoue, n'atteint jamais la conversation et disparaît sans trace. Ces tests exigent
 * qu'il reste retrouvable, et que le journal ne puisse jamais faire échouer un envoi.
 */
describe('journal des saisies utilisateur', () => {
  let racine: string
  beforeEach(() => {
    racine = mkdtempSync(join(tmpdir(), 'autowin-saisie-'))
  })
  afterEach(() => {
    rmSync(racine, { recursive: true, force: true })
  })

  const lire = (): SaisieJournalisee[] =>
    readFileSync(journalSaisiePath(racine), 'utf8')
      .split(/\r?\n/)
      .filter(Boolean)
      .map((ligne) => JSON.parse(ligne) as SaisieJournalisee)

  it('retrouve un texte injecté qui n’a jamais créé de tour', () => {
    expect(journaliserSaisie({ conversationId: 'conv-30', texte: 'mon texte perdu', voie: 'orientation' }, racine)).toBe(true)
    const [entree] = lire()
    expect(entree.texte).toBe('mon texte perdu')
    expect(entree.conversationId).toBe('conv-30')
    expect(entree.voie).toBe('orientation')
    expect(entree.ts).toBeGreaterThan(0)
  })

  it('conserve TOUTES les saisies successives, sans en écraser aucune', () => {
    journaliserSaisie({ conversationId: 'conv-30', texte: 'premier', voie: 'orientation' }, racine)
    journaliserSaisie({ conversationId: 'conv-30', texte: 'deuxieme', voie: 'orientation' }, racine)
    journaliserSaisie({ conversationId: 'conv-30', texte: 'troisieme', voie: 'message' }, racine)
    // Le symptôme d'origine : deux messages disparus quand le troisième est écrit.
    expect(lire().map((e) => e.texte)).toEqual(['premier', 'deuxieme', 'troisieme'])
  })

  it('distingue la voie empruntée — c’est elle qui explique un texte sans tour', () => {
    journaliserSaisie({ conversationId: 'c', texte: 'a', voie: 'message' }, racine)
    journaliserSaisie({ conversationId: 'c', texte: 'b', voie: 'orientation' }, racine)
    expect(lire().map((e) => e.voie)).toEqual(['message', 'orientation'])
  })

  it('ignore un texte vide — une trace sans contenu n’a rien sauvé', () => {
    expect(journaliserSaisie({ conversationId: 'c', texte: '   ', voie: 'message' }, racine)).toBe(false)
    expect(existsSync(journalSaisiePath(racine))).toBe(false)
  })

  it('NE LÈVE JAMAIS quand le disque refuse — un envoi ne doit pas échouer à cause du journal', () => {
    const introuvable = join(racine, 'dossier', 'inexistant')
    expect(() =>
      journaliserSaisie({ conversationId: 'c', texte: 'texte', voie: 'message' }, introuvable)
    ).not.toThrow()
    expect(journaliserSaisie({ conversationId: 'c', texte: 'texte', voie: 'message' }, introuvable)).toBe(false)
  })
})
