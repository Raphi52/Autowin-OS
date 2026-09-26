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
const base = {
  actif: true,
  occupe: false,
  dernierTourTraite: null,
  dernierPromptEnvoye: null,
  brouillonPresent: false
}

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
    const d = deciderRelanceAuto({
      ...base,
      fil: [humain, askMsg(['Supprimer la branche', 'Garder'])]
    })
    expect(d.action).not.toBe('envoyer')
  })
  it('reste inerte quand le mode est éteint', () => {
    const d = deciderRelanceAuto({ ...base, actif: false, fil: [humain, askMsg(['A', 'B'])] })
    expect(d.action).toBe('attendre')
  })
})

describe('mode auto — choix multiples et fausse pause (conv-787)', () => {
  const multi = (options: unknown[]): Msg =>
    ({
      role: 'assistant',
      content: 'Lesquels ?',
      parts: [
        {
          kind: 'action',
          name: 'ask',
          ok: true,
          data: { question: 'Lesquels ?', options, choixMultiple: true }
        }
      ]
    }) as unknown as Msg
  it('coche toutes les options sûres quand les choix ne sont pas concurrents', () => {
    const d = deciderRelanceAuto({
      ...base,
      fil: [humain, multi(['Tests', 'Docs', 'Supprimer la branche'])]
    })
    expect(d).toMatchObject({ action: 'envoyer', texte: '- Tests\n- Docs' })
  })
  it('n’interprète plus « Voici le message… » comme une donnée à fournir', () => {
    const texte =
      '✅ Fait\n- corrigé\nAUTOWIN_PROMPT_V1: Voici le message du bandeau : dis-moi si la règle s’est trompée'
    const fil = [
      humain,
      {
        role: 'assistant',
        content: texte,
        parts: [{ kind: 'text', text: texte }]
      } as unknown as Msg
    ]
    expect(deciderRelanceAuto({ ...base, fil })).not.toMatchObject({
      raison: 'suite-attend-utilisateur'
    })
  })
})

describe('fin de chaîne écrite en phrase (conv-787)', () => {
  const reponse = (reco: string): Msg => {
    const texte = `✅ Fait\n- corrigé\n⏳ Reste à faire\n- rien de bloquant\n👉 Recommandé\n- ${reco}`
    return {
      role: 'assistant',
      content: texte,
      parts: [{ kind: 'text', text: texte }]
    } as unknown as Msg
  }
  it('s’arrête sur « Rien de plus sur ce sujet : … »', () => {
    const d = deciderRelanceAuto({
      ...base,
      fil: [humain, reponse('Rien de plus sur ce sujet : le comportement est rétabli.')]
    })
    expect(d).toMatchObject({ action: 'arreter', raison: 'recommandation-rien' })
  })
  it('continue quand une vraie suite est proposée malgré le mot « rien »', () => {
    const d = deciderRelanceAuto({
      ...base,
      fil: [humain, reponse('Rien ne bloque : lance le contrôle final sur src/app.ts')]
    })
    expect(d.action).not.toBe('arreter')
  })
})
