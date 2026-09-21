import { describe, expect, it } from 'vitest'
import type { Msg } from './chat-view-types'
import { deciderRelanceAuto } from './chat-auto-mode'

const askMsg = (options: unknown[]): Msg =>
  ({
    role: 'assistant',
    content: 'Quelle voie ?',
    parts: [
      { kind: 'text', text: 'Je te laisse choisir.' },
      { kind: 'action', name: 'ask', ok: true, data: { question: 'Quelle voie ?', options } }
    ]
  }) as unknown as Msg
const humain: Msg = { role: 'user', content: 'go' } as Msg
const base = { actif: true, occupe: false, dernierTourTraite: null, dernierPromptEnvoye: null, brouillonPresent: false }

describe('mode auto — répond seul aux questions ask', () => {
  it('envoie la première option quand aucune n’est marquée', () => {
    const d = deciderRelanceAuto({ ...base, fil: [humain, askMsg(['Voie A', 'Voie B'])] })
    expect(d).toMatchObject({ action: 'envoyer', texte: 'Voie A' })
  })
  it('préfère l’option marquée recommandée, et son envoi', () => {
    const d = deciderRelanceAuto({
      ...base,
      fil: [humain, askMsg([{ libelle: 'A' }, { libelle: 'B', recommande: true, envoi: 'fais B' }])]
    })
    expect(d).toMatchObject({ action: 'envoyer', texte: 'fais B' })
  })
  it('ne répond jamais seul une option destructrice', () => {
    const d = deciderRelanceAuto({ ...base, fil: [humain, askMsg(['Supprimer la branche', 'Garder'])] })
    expect(d.action).not.toBe('envoyer')
  })
  it('reste inerte quand le mode est éteint', () => {
    const d = deciderRelanceAuto({ ...base, actif: false, fil: [humain, askMsg(['A', 'B'])] })
    expect(d.action).toBe('attendre')
  })
})
