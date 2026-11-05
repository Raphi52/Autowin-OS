import { describe, expect, it } from 'vitest'
import type { Msg } from './chat-view-types'
import { PROMPT_NOUVELLE_CIBLE, deciderRelanceAuto } from './chat-auto-mode'
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

/*
 * SUR LE FIL AFFICHÉ AUSSI, AUTOWIN_FIN_V1 ÉTEINT LE MODE AUTO (conv-1575, 2026-11-05).
 *
 * Demande de l'utilisateur : « quand ya écris ça, ça doit arrêter le mode auto aussi ». La fin écrite
 * par Autowin (« passer à la prochaine demande ») le faisait déjà ; la ligne de fin du modèle, elle,
 * ne coupait que les fils d'arrière-plan : sur le fil affiché (`proposerNouvelleCible: true`), elle
 * envoyait la relève « propose-moi avec `ask` 2 à 10 nouvelles cibles », un tour payé de plus sur une
 * chaîne que l'agent venait de déclarer finie.
 */
describe('mode auto — AUTOWIN_FIN_V1 éteint aussi le fil affiché', () => {
  const affiche = { ...base, proposerNouvelleCible: true }
  const humain = { role: 'user', content: '/build ajoute la garde' } as unknown as Msg

  it('arrête, sans envoyer la relève « nouvelles cibles »', () => {
    const fil = [humain, agent('Garde ajoutée, tests verts.\n\nAUTOWIN_FIN_V1: livré')]
    const decision = deciderRelanceAuto({ ...affiche, fil })
    expect(decision).toMatchObject({ action: 'arreter', raison: 'fin-explicite' })
    expect(decision).not.toMatchObject({ texte: PROMPT_NOUVELLE_CIBLE })
  })

  it('arrête aussi quand la rubrique dit « rien » en plus de la ligne de fin', () => {
    const texte = 'Livré.\n\n⏳ Reste à faire : rien\nAUTOWIN_FIN_V1'
    expect(deciderRelanceAuto({ ...affiche, fil: [humain, agent(texte)] })).toMatchObject({
      action: 'arreter',
      raison: 'fin-explicite'
    })
  })

  it('jumeau : une fin écrite par le modèle sans la ligne garde sa relève (conv-307)', () => {
    const fil = [humain, agent('Livré.\n\n⏳ Reste à faire : rien')]
    expect(deciderRelanceAuto({ ...affiche, fil })).toMatchObject({
      action: 'envoyer',
      texte: PROMPT_NOUVELLE_CIBLE
    })
  })

  it('jumeau : la ligne citée dans un bloc de code ne coupe rien', () => {
    const fil = [humain, agent('Livré.\n\n```\nAUTOWIN_FIN_V1\n```\n\n⏳ Reste à faire : rien')]
    expect(deciderRelanceAuto({ ...affiche, fil })).toMatchObject({
      action: 'envoyer',
      texte: PROMPT_NOUVELLE_CIBLE
    })
  })
})
