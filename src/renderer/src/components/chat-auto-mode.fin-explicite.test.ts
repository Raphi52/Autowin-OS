import { describe, expect, it } from 'vitest'
import type { Msg } from './chat-view-types'
import { deciderRelanceAuto } from './chat-auto-mode'
import { retirerLignePromptSuivant, signalFinExplicite } from '../../../shared/prompt-suivant'

const agent = (texte: string): Msg =>
  ({ role: 'assistant', content: texte, parts: [{ kind: 'text', text: texte }] }) as unknown as Msg
const base = {
  actif: true,
  occupe: false,
  dernierTourTraite: null,
  dernierPromptEnvoye: null,
  brouillonPresent: false
}

describe('mode auto — signal de fin explicite AUTOWIN_FIN_V1', () => {
  it("arrête sur la ligne de fin, même quand la rubrique ne dit pas « rien »", () => {
    const texte = ['✅ Fait', '- titres allongés', '👉 Recommandé — aucune suite, le travail est livré', 'AUTOWIN_FIN_V1'].join('\n')
    expect(deciderRelanceAuto({ ...base, fil: [agent(texte)] })).toMatchObject({
      action: 'arreter',
      raison: 'fin-explicite'
    })
  })
  it('passe avant un prompt suivant écrit par erreur', () => {
    const texte = ['👉 Recommandé — passer en terrain', 'AUTOWIN_PROMPT_V1: lance X', 'AUTOWIN_FIN_V1: livré'].join('\n')
    expect(deciderRelanceAuto({ ...base, fil: [agent(texte)] })).toMatchObject({ raison: 'fin-explicite' })
  })
  it("ne se déclenche ni dans un bloc de code ni au milieu d'une phrase", () => {
    expect(signalFinExplicite('```\nAUTOWIN_FIN_V1\n```')).toBe(false)
    expect(signalFinExplicite('écris AUTOWIN_FIN_V1 quand tu as fini')).toBe(false)
    expect(deciderRelanceAuto({ ...base, fil: [agent('👉 Recommandé — passer en terrain\nAUTOWIN_PROMPT_V1: lance X')] })).toMatchObject({ action: 'envoyer' })
  })
  it("reste invisible à l'affichage, y compris en cours d'écriture", () => {
    expect(retirerLignePromptSuivant('Fini.\nAUTOWIN_FIN_V1')).not.toContain('AUTOWIN_FIN')
    expect(retirerLignePromptSuivant('Fini.\nAUTOWIN_FI')).not.toContain('AUTOWIN_FI')
  })
})
