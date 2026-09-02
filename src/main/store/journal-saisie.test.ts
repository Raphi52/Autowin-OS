import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  journaliserSaisie,
  journalSaisiePath,
  lireSaisies,
  rattacherSaisieAuTour,
  saisieDuTour,
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

/**
 * RATTACHEMENT AU TOUR — mesure conv-131 : la saisie porte la conversation mais AUCUN numero de
 * tour, parce qu'elle est ecrite AVANT que le tour existe. Relire « quel texte a produit ce tour »
 * se faisait donc au rapprochement d'horodatages, approximatif par construction.
 */
describe('journal des saisies — rattachement au tour', () => {
  it('ecrit une ligne portant turnId et la relie a la saisie exacte', () => {
    const racine = mkdtempSync(join(tmpdir(), 'saisie-tour-'))
    try {
      journaliserSaisie(
        { conversationId: 'c1', texte: 'repare les journaux', voie: 'message' },
        racine
      )
      expect(rattacherSaisieAuTour('c1', 'tour-1', 'repare les journaux', racine)).toBe(true)

      const lignes = readFileSync(join(racine, 'saisies-utilisateur.jsonl'), 'utf8')
        .trim()
        .split(/\r?\n/)
        .map((l) => JSON.parse(l))
      expect(lignes).toHaveLength(2)
      expect(lignes[1].turnId).toBe('tour-1')
      expect(lignes[1].saisieTs).toBe(lignes[0].ts)

      expect(saisieDuTour('c1', 'tour-1', racine)?.texte).toBe('repare les journaux')
    } finally {
      rmSync(racine, { recursive: true, force: true })
    }
  })

  it('ne rattache RIEN quand aucune saisie ne correspond (pas d alibi)', () => {
    const racine = mkdtempSync(join(tmpdir(), 'saisie-tour-'))
    try {
      journaliserSaisie({ conversationId: 'c1', texte: 'autre chose', voie: 'message' }, racine)
      expect(rattacherSaisieAuTour('c1', 'tour-1', 'repare les journaux', racine)).toBe(false)
      expect(saisieDuTour('c1', 'tour-1', racine)).toBeUndefined()
    } finally {
      rmSync(racine, { recursive: true, force: true })
    }
  })

  it('la ligne de rattachement ne pollue PAS la relecture des saisies', () => {
    const racine = mkdtempSync(join(tmpdir(), 'saisie-tour-'))
    try {
      journaliserSaisie({ conversationId: 'c1', texte: 'bonjour', voie: 'message' }, racine)
      rattacherSaisieAuTour('c1', 'tour-1', 'bonjour', racine)
      const saisies = lireSaisies('c1', racine)
      expect(saisies).toHaveLength(1)
      expect(saisies[0]?.texte).toBe('bonjour')
    } finally {
      rmSync(racine, { recursive: true, force: true })
    }
  })

  it('le tour de chat rattache reellement sa saisie', () => {
    const source = readFileSync(join(__dirname, '..', 'chat', 'run-pilot-chat.ts'), 'utf8')
    expect(source).toContain('rattacherSaisieAuTour(')
  })
})
