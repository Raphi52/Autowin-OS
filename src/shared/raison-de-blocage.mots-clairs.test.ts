import { describe, expect, it } from 'vitest'
import { raisonDeBlocageIntegration } from './raison-de-blocage'
import { formatOrchestrationOutcome } from './orchestration-outcome'

/**
 * VECU le 2026-09-03, conv-158, turnId `e0697674-fb4a-4f79-a6a0-565be7e07998`.
 *
 * Le tour a echoue avec `intégration locale non terminée ; blocage d’intégration: base-dirty —
 * fichiers en cause: .arena/banc-noms/RUN.md, …`. C'est ce texte-la que le modele a recu, et
 * l'appel suivant (meme turnId, 05:44:26) a annonce a l'utilisateur une cause FAUSSE : « la fusion
 * a été refusée en fin de course (la branche de base a bougé pendant l'intégration) ». La base
 * n'avait pas bouge : des fichiers non committes bloquaient.
 *
 * Cause : `base-dirty` est un code interne. Le sens existait deja en clair dans
 * `orchestration-outcome.ts` (table `BLOCAGES`), mais seulement pour l'AFFICHAGE — jamais dans la
 * phrase remise au modele. Un code opaque se fait deviner ; une phrase claire ne se devine pas.
 */
describe('raisonDeBlocageIntegration — le code interne vient avec son sens en clair', () => {
  it('base-dirty : la phrase dit ce qui bloque, pas seulement son code', () => {
    const phrase = raisonDeBlocageIntegration({
      outcome: 'blocked',
      reason: 'base-dirty',
      files: ['.arena/banc-noms/RUN.md']
    })
    expect(phrase).toContain('base-dirty')
    expect(phrase).toContain('non committés')
    expect(phrase).not.toContain('a bougé')
  })

  it('un detail reel n’est jamais remplace par la traduction', () => {
    const phrase = raisonDeBlocageIntegration({
      outcome: 'blocked',
      reason: 'merge-failed',
      detail: 'Filename too long',
      files: ['a.txt']
    })
    expect(phrase).toContain('Filename too long')
  })

  it('la clôture affichée continue de lire la cause et de nommer les fichiers', () => {
    const texte = formatOrchestrationOutcome(true, {
      gateBlocked: true,
      gateReasons: [
        raisonDeBlocageIntegration({
          outcome: 'blocked',
          reason: 'base-dirty',
          files: ['.arena/banc-noms/RUN.md']
        })
      ]
    } as never)
    expect(texte).toContain('base sale')
    expect(texte).toContain('.arena/banc-noms/RUN.md')
  })
})
