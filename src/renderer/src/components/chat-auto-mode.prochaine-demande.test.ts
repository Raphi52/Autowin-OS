import { describe, expect, it } from 'vitest'
import type { Msg } from './chat-view-types'
import { deciderRelanceAuto, PROMPT_NOUVELLE_CIBLE } from './chat-auto-mode'
import { formatOrchestrationOutcome } from '../../../shared/orchestration-outcome'

/**
 * « 👉 Recommandé : passer à la prochaine demande. » ÉTEINT LE MODE AUTO — sur le fil AFFICHÉ aussi.
 *
 * Demande de l'utilisateur (conv-1575, 2026-11-05) : « quand ya écris ça, ça doit arrêter le mode
 * auto aussi ». Vécu dans ce fil : un run fini rendait cette clôture (écrite par Autowin, pas par le
 * modèle), et sur le fil affiché le mode auto envoyait quand même la relève « La chaîne de ce fil
 * est terminée… propose-moi avec `ask` 2 à 10 nouvelles cibles » — un tour payé de plus, puis la
 * réponse automatique à l'`ask`, sur une chaîne que l'utilisateur considérait finie.
 *
 * La relève reste pour une fin ÉCRITE par le modèle (« Reste à faire : rien » sans cette phrase) :
 * c'est la demande de conv-307, que celle-ci ne retire pas.
 */
const agent = (texte: string): Msg =>
  ({ role: 'assistant', content: texte, parts: [{ kind: 'text', text: texte }] }) as unknown as Msg
const humain = (texte: string): Msg => ({ role: 'user', content: texte }) as unknown as Msg

const base = {
  actif: true,
  occupe: false,
  dernierTourTraite: null,
  dernierPromptEnvoye: null,
  brouillonPresent: false,
  // Le fil AFFICHÉ : c'est là que la relève partait.
  proposerNouvelleCible: true
}

/**
 * La clôture RÉELLE d'un run fini, telle qu'Autowin l'écrit après le dernier maillon.
 * `phaseOutputs` n'est pas dans le type : l'app le lit par conversion (`phasesJouees`), d'où le `as`.
 */
const clotureDuRunFini = formatOrchestrationOutcome(true, {
  status: 'succeeded',
  valid: true,
  gateBlocked: false,
  reused: false,
  result: 'Le travail de la phase.',
  phaseOutputs: [{ phase: 'judge', text: 'livrable judge' }]
} as Parameters<typeof formatOrchestrationOutcome>[1])

describe('« passer à la prochaine demande » éteint le mode auto', () => {
  it('la clôture réelle porte bien la phrase', () => {
    expect(clotureDuRunFini).toContain('👉 Recommandé : passer à la prochaine demande.')
  })

  it('ARRÊTE sur le fil affiché, sans envoyer la relève', () => {
    const decision = deciderRelanceAuto({
      ...base,
      fil: [humain('/build ajoute la garde'), agent(clotureDuRunFini)]
    })
    expect(decision.action).toBe('arreter')
    expect(decision).not.toMatchObject({ texte: PROMPT_NOUVELLE_CIBLE })
  })

  it('arrête aussi quand la phrase est seule, sans « Reste à faire : rien »', () => {
    const decision = deciderRelanceAuto({
      ...base,
      fil: [humain('go'), agent('Livré.\n\n👉 Recommandé : passer à la prochaine demande.')]
    })
    expect(decision.action).toBe('arreter')
  })

  it('une fin écrite par le modèle garde la relève (conv-307)', () => {
    const decision = deciderRelanceAuto({
      ...base,
      fil: [humain('go'), agent('✅ Fait\n1. Bouton réparé.\n⏳ Reste à faire : rien.')]
    })
    expect(decision).toMatchObject({ action: 'envoyer', texte: PROMPT_NOUVELLE_CIBLE })
  })

  it('une vraie suite qui parle de la prochaine demande continue', () => {
    const decision = deciderRelanceAuto({
      ...base,
      fil: [
        humain('go'),
        agent('👉 Recommandé : passer à la prochaine demande du lot, lance /build sur le tri.')
      ]
    })
    expect(decision.action).toBe('envoyer')
  })
})
