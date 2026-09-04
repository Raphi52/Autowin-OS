import { describe, expect, it } from 'vitest'
import type { Msg } from './chat-view-types'
import { deciderRelanceAuto, texteDerniereDemande } from './chat-auto-mode'
import { PROMPT_SALVAGE } from '../../../shared/prompt-suivant'

/*
 * LA BOUCLE SANS FIN DU 2026-09-04 (conv-288), cote MODE AUTO — le bord le plus couteux.
 *
 * L'utilisateur (ou le mode auto) envoie l'ordre de tri. Le tri est fait de bout en bout, la seule
 * suite qui reste est de publier, et ce prompt de publication etait REECRIT en `/salvage`. Le mode
 * auto le renvoyait tout seul, a ses frais, indefiniment : le garde-fou « deux fois la meme suite »
 * ne mordait meme pas, puisque chaque tour reformule.
 */
const agent = (texte: string): Msg =>
  ({ role: 'assistant', content: texte, parts: [{ kind: 'text', text: texte }] }) as unknown as Msg
const humain = (texte: string): Msg => ({ role: 'user', content: texte }) as Msg

const SAUT = String.fromCharCode(10)
const base = {
  actif: true,
  occupe: false,
  dernierTourTraite: null,
  dernierPromptEnvoye: null,
  brouillonPresent: false
}
const REPONSE_PUBLIER = [
  '✅ Fait',
  '- tout trie',
  '👉 Recommandé — pousser les commits',
  'AUTOWIN_PROMPT_V1: Pousse les 6 commits locaux sur le depot distant.'
].join('\n')

describe('mode auto — le tri deja joue ne se rejoue pas', () => {
  it('quand la demande du tour ETAIT le tri, la publication part telle quelle', () => {
    const decision = deciderRelanceAuto({
      ...base,
      fil: [humain(PROMPT_SALVAGE), agent(REPONSE_PUBLIER)]
    })
    expect(decision.action).toBe('envoyer')
    // La SUITE elle-meme est la publication. Le rappel de tache initiale ajoute plus bas cite le
    // texte du premier message et peut donc contenir le mot : seul le debut de l'envoi compte.
    expect(decision.action === 'envoyer' && decision.texte.split(SAUT)[0]).toBe(
      'Pousse les 6 commits locaux sur le depot distant.'
    )
  })

  it('sans tri dans le tour, le garde-fou mord toujours', () => {
    const decision = deciderRelanceAuto({
      ...base,
      fil: [humain('corrige le bouton stop'), agent(REPONSE_PUBLIER)]
    })
    expect(decision.action === 'envoyer' && decision.texte.split(SAUT)[0]).toBe(PROMPT_SALVAGE)
  })

  it('la derniere demande se lit sur le dernier message utilisateur', () => {
    expect(texteDerniereDemande([humain('un'), agent('x'), humain('deux')])).toBe('deux')
    expect(texteDerniereDemande([agent('x')])).toBeNull()
  })
})
