import { describe, expect, it } from 'vitest'
import { refusPourOutcome, type OutcomeDePublication } from './issue-de-refus'

/**
 * DEFAUT VECU conv-1407 (2026-08-26), quatrieme volet.
 *
 * `withIsolatedMutation` blanchit quatre issues de publication et fait tomber TOUTES LES AUTRES
 * dans un seul et meme message, celui du motif `publication-differee` :
 *
 *   « Le bureau a ete conserve : publication automatique incomplete : edit_file — Le bureau est
 *     conserve : rien n'est perdu. Ouvre Worktrees, section « Bureaux conserves » : ... »
 *
 * Trois defauts dans cette phrase unique.
 *
 * 1. Elle ne nomme JAMAIS ce qui s'est reellement passe. Un conflit de fusion, une copie verrouillee
 *    et une copie deja liberee recoivent le meme texte. L'agent ne peut donc que retenter a
 *    l'identique -- la trace le montre : le meme refus, mot pour mot, trois fois.
 * 2. Elle promet un geste IMPOSSIBLE sur `absente` et `libere` : le bureau n'existe plus, il n'y a
 *    rien a rouvrir dans « Bureaux conserves ». C'est exactement ce que l'en-tete de ce module dit
 *    avoir corrige une fois deja -- « orienter vers un geste impossible coute PLUS qu'un refus nu ».
 * 3. Son detail est le nom de l'outil (`edit_file`), deja affiche au-dessus : zero information.
 *
 * Ironie du nom : depuis conv-1404, le VRAI differe (`finalized === undefined`) ne passe plus par
 * la. Ce message s'appelle « publication differee » alors qu'il ne sert plus qu'a des cas qui n'en
 * sont pas.
 *
 * ENTREE QUI DOIT FAIRE ECHOUER CE TEST SI LA CORRECTION EST FAUSSE : deux outcomes qui
 * retomberaient sur le meme texte. Nommer six situations avec une phrase unique est precisement le
 * defaut corrige ; le premier test compte les textes DISTINCTS, il ne se contente pas de leur
 * existence.
 */

const TOUS: OutcomeDePublication[] = [
  'absente',
  'blocked',
  'conflict',
  'libere',
  'preserve-et-libere',
  'refuse'
]

describe('un refus de publication nomme CE QUI s est passe', () => {
  it('donne un message DISTINCT a chaque situation', () => {
    const messages = TOUS.map((o) => refusPourOutcome(o))
    expect(new Set(messages).size).toBe(TOUS.length)
  })

  it('propose un GESTE a chaque situation, jamais un constat nu', () => {
    for (const outcome of TOUS) {
      // Un tiret cadratin separe le constat de sa sortie : sans lui, il n'y a pas de sortie.
      expect(refusPourOutcome(outcome)).toContain('—')
    }
  })

  it('ne renvoie PAS vers un bureau conserve quand le bureau n existe plus', () => {
    for (const outcome of ['absente', 'libere'] as OutcomeDePublication[]) {
      expect(refusPourOutcome(outcome).toLowerCase()).not.toContain('bureaux conserves')
    }
  })

  it('renvoie vers le bureau conserve quand il EXISTE vraiment', () => {
    expect(refusPourOutcome('conflict').toLowerCase()).toContain('bureaux conserves')
  })

  it('nomme la branche quand c est elle qui porte le travail', () => {
    expect(refusPourOutcome('preserve-et-libere').toLowerCase()).toContain('branche')
  })

  it('nomme l outcome technique, pour que la trace soit diagnosticable', () => {
    expect(refusPourOutcome('conflict')).toContain('conflict')
  })
})
