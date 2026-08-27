import { describe, expect, it } from 'vitest'
import { buildChatPilotagePrompt } from './chat-pilotage-prompt'
import { REMEMBER_TYPES } from './brain-remember'

/**
 * LES VALEURS ATTENDUES D'UN ARGUMENT DOIVENT ATTEINDRE LE MODÈLE.
 *
 * Mesuré trois fois — 2026-08-20 (conv-1086, `cause-racine`), 2026-08-26, puis 2026-08-27
 * (conv-1426, `type: "contrainte"` ET `confidence: "haute"` dans le MÊME appel). À chaque fois
 * `remember` est refusé, et à chaque fois le vocabulaire était pourtant DÉCLARÉ dans `commands.ts`
 * (`type: 'lesson | decision | preference | domain'`).
 *
 * La cause n'est pas l'inattention du modèle : c'est `Object.keys(c.args)` dans ce module, qui ne
 * gardait que les NOMS des arguments. Le modèle recevait « type » sans jamais ses quatre valeurs
 * légales, et le seul vocabulaire qui lui restait était la prose française du bloc MÉMOIRE — qui dit
 * « une contrainte d'un système ». Il écrivait donc le mot que le prompt lui soufflait.
 *
 * Les correctifs précédents ont enrichi le MESSAGE DE REFUS (`brain-remember.motif-actionnable`) :
 * utile, mais après coup — le modèle se corrige au deuxième essai. Ici on ferme la cause en amont.
 *
 * BORNE DE COÛT : on n'injecte QUE les énumérations (`a | b | c`), pas la prose de chaque argument.
 * Ce prompt part à chaque tour ; déverser toutes les descriptions du catalogue coûterait à chaque
 * appel sans rien fermer de plus. Le dernier test tient cette borne.
 */

const CATALOGUE_REMEMBER = [
  {
    name: 'remember',
    description: 'Retenir DURABLEMENT un fait vérifié',
    args: {
      title: 'titre court et retrouvable',
      fact: 'le fait, autoporté — compréhensible dans 3 mois sans cette conversation',
      type: REMEMBER_TYPES.join(' | '),
      confidence: 'facultatif — low | medium | high'
    }
  }
]

const promptRemember = (): string => buildChatPilotagePrompt(CATALOGUE_REMEMBER)

describe('le prompt de pilotage porte les valeurs attendues des arguments', () => {
  it('énumère les quatre types de `remember`, pas seulement le mot « type »', () => {
    const prompt = promptRemember()

    for (const type of REMEMBER_TYPES) {
      expect(prompt).toContain(type)
    }
  })

  it('rattache l’énumération à SON argument', () => {
    // Sans le rattachement, les quatre mots pourraient flotter n'importe où dans le prompt : le
    // modèle saurait qu'ils existent sans savoir lequel des neuf arguments les attend.
    expect(promptRemember()).toContain(`type: ${REMEMBER_TYPES.join(' | ')}`)
  })

  it('porte AUSSI l’énumération de `confidence` — l’autre refus du même appel', () => {
    expect(promptRemember()).toContain('confidence: low | medium | high')
  })

  it('conserve les arguments sans énumération, et n’en déverse pas la prose', () => {
    const prompt = promptRemember()

    // Le nom reste : la signature doit rester complète.
    expect(prompt).toContain('title')
    expect(prompt).toContain('fact')
    // Mais sa description longue ne part pas à chaque tour.
    expect(prompt).not.toContain('compréhensible dans 3 mois sans cette conversation')
  })
})
