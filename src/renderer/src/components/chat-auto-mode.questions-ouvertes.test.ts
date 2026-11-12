import { describe, expect, it } from 'vitest'
import type { Msg } from './chat-view-types'
import { deciderRelanceAuto } from './chat-auto-mode'

const agent = (t: string): Msg =>
  ({ role: 'assistant', content: t, parts: [{ kind: 'text', text: t }] }) as unknown as Msg
const humain = (t: string): Msg => ({ role: 'user', content: t }) as Msg
const base = {
  actif: true,
  occupe: false,
  dernierTourTraite: null,
  dernierPromptEnvoye: null,
  brouillonPresent: false
}
const SUITE = 'Branche la vue Tickets sur la nouvelle source.'
const avecQuestions = `✅ Fait
1. Source écrite.
📍 Maintenant
- prête
⏳ Reste à faire
- brancher la vue
❓ À éclaircir
1. Les tickets fermés doivent-ils apparaître ?
👉 Recommandé
- brancher la vue Tickets

AUTOWIN_PROMPT_V1: [85] ${SUITE}`

/*
 * LES QUESTIONS « ❓ À ÉCLAIRCIR » NE BLOQUENT PAS LE MODE AUTO (choix de l'utilisateur, 12/11) : la
 * suite part. Mais elle partait muette, et l'agent du tour suivant ne savait pas que personne n'avait
 * répondu : il pouvait attendre la réponse ou reposer les mêmes questions à chaque tour.
 * ENTRÉE QUI DOIT FAIRE ÉCHOUER : un envoi qui ne dit rien des questions restées ouvertes.
 */
describe('questions « ❓ À éclaircir » restées sans réponse', () => {
  it('l’envoi automatique dit à l’agent de les trancher lui-même, sans les reposer', () => {
    const d = deciderRelanceAuto({
      ...base,
      fil: [humain('ajoute la vue Tickets'), agent(avecQuestions)]
    })
    expect(d).toMatchObject({ action: 'envoyer' })
    if (d.action !== 'envoyer') return
    expect(d.texte).toContain(SUITE)
    expect(d.texte).toMatch(/« ❓ À éclaircir ».*sans réponse.*hypothèse/u)
  })

  it('JUMEAU : sans rubrique de questions, l’envoi n’en parle pas', () => {
    const sans = avecQuestions.replace(/❓ À éclaircir\n1\.[^\n]*\n/u, '')
    const d = deciderRelanceAuto({ ...base, fil: [humain('ajoute la vue Tickets'), agent(sans)] })
    expect(d).toMatchObject({ action: 'envoyer' })
    if (d.action !== 'envoyer') return
    expect(d.texte).not.toContain('À éclaircir')
  })
})
