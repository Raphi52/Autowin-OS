import { describe, expect, it } from 'vitest'
import type { Msg } from './chat-view-types'
import {
  blocFaitDitRien,
  deciderRelanceAuto,
  recommandationDitRien,
  signatureTour,
  texteDernierAssistant
} from './chat-auto-mode'

const agent = (texte: string): Msg =>
  ({ role: 'assistant', content: texte, parts: [{ kind: 'text', text: texte }] }) as unknown as Msg
const humain = (texte: string): Msg => ({ role: 'user', content: texte }) as Msg

const base = {
  actif: true,
  occupe: false,
  dernierTourTraite: null,
  dernierPromptEnvoye: null,
  brouillonPresent: false
}

const REPONSE_AVEC_SUITE = [
  '✅ Fait',
  '- un truc',
  '👉 Recommandé — passer en terrain',
  'AUTOWIN_PROMPT_V1: lance le terrain sur X'
].join('\n')

const REPONSE_RIEN = '👉 Recommandé — rien'

describe('recommandationDitRien — la condition d’arrêt demandée', () => {
  it('arrête sur « rien »', () => {
    expect(recommandationDitRien('rien')).toBe(true)
    expect(recommandationDitRien('Rien à faire de plus')).toBe(true)
    expect(recommandationDitRien('plus rien.')).toBe(true)
  })
  it('n’arrête pas sur un mot qui contient les mêmes lettres', () => {
    expect(recommandationDitRien('terrain sur X')).toBe(false)
    expect(recommandationDitRien('relancer le build')).toBe(false)
    expect(recommandationDitRien(null)).toBe(false)
  })
})

describe('blocFaitDitRien — le bloc « Fait » vide (précision utilisateur du 2026-09-02)', () => {
  it('voit « rien » posé seul, sur la ligne d’en-tête comme en puce', () => {
    expect(blocFaitDitRien('✅ Fait — rien')).toBe(true)
    expect(blocFaitDitRien('✅ **Fait**\n- rien\n\n📍 Maintenant\n- ça tourne')).toBe(true)
    expect(blocFaitDitRien('✅ Fait\nrien à signaler.')).toBe(true)
  })
  it('ne confond PAS avec un travail réussi qui emploie le mot', () => {
    expect(blocFaitDitRien('✅ Fait\n- corrigé le bug, rien de cassé ailleurs')).toBe(false)
    expect(blocFaitDitRien('✅ Fait\n- livré')).toBe(false)
  })
  it('ne lit QUE le bloc Fait : un « rien » d’une autre rubrique ne compte pas', () => {
    expect(blocFaitDitRien('✅ Fait\n- livré\n\n⏳ Reste à faire\n- rien')).toBe(false)
  })
  it('sans bloc de clôture, il n’y a rien à lire', () => {
    expect(blocFaitDitRien('une réponse en prose, rien de plus')).toBe(false)
  })
})

describe('deciderRelanceAuto — envoi', () => {
  it('envoie le PROMPT du modèle, pas la rubrique', () => {
    const d = deciderRelanceAuto({ ...base, fil: [humain('go'), agent(REPONSE_AVEC_SUITE)] })
    expect(d).toMatchObject({ action: 'envoyer', texte: 'lance le terrain sur X' })
  })
  it('retombe sur la rubrique quand aucun prompt n’est écrit', () => {
    const d = deciderRelanceAuto({ ...base, fil: [agent('👉 Recommandé — passer en terrain')] })
    expect(d).toMatchObject({ action: 'envoyer', texte: 'passer en terrain' })
  })
  it('ne s’arrête JAMAIS sur un nombre de tours : le 50e tour part encore', () => {
    const fil: Msg[] = []
    for (let i = 0; i < 50; i += 1) fil.push(humain(`t${i}`))
    fil.push(agent(REPONSE_AVEC_SUITE))
    expect(deciderRelanceAuto({ ...base, fil })).toMatchObject({ action: 'envoyer' })
  })
})

describe('deciderRelanceAuto — arrêts', () => {
  it('ARRÊTE sur « rien », même si le modèle a quand même écrit un prompt', () => {
    const fil = [agent(`${REPONSE_RIEN}\nAUTOWIN_PROMPT_V1: continue encore`)]
    expect(deciderRelanceAuto({ ...base, fil })).toMatchObject({
      action: 'arreter',
      raison: 'recommandation-rien'
    })
  })
  it('ARRÊTE quand le bloc « Fait » ne rapporte rien, même si une suite est proposée', () => {
    const fil = [
      agent('✅ Fait\n- rien\n\n👉 Recommandé — relancer\nAUTOWIN_PROMPT_V1: relance encore')
    ]
    expect(deciderRelanceAuto({ ...base, fil })).toMatchObject({
      action: 'arreter',
      raison: 'fait-rien'
    })
  })
  it('« rien » est le SEUL motif qui éteint le mode', () => {
    const arrets = [
      // même suite deux fois : on ne renvoie pas, mais l'interrupteur reste allumé
      deciderRelanceAuto({
        ...base,
        fil: [agent(REPONSE_AVEC_SUITE)],
        dernierPromptEnvoye: 'lance le terrain sur X'
      }),
      // aucune suite proposée : idem
      deciderRelanceAuto({ ...base, fil: [agent('rapport sans clôture')] })
    ]
    for (const d of arrets) expect(d.action).toBe('attendre')
  })
})

describe('deciderRelanceAuto — attentes (aucun envoi, le mode reste armé)', () => {
  const fil = [agent(REPONSE_AVEC_SUITE)]
  it('rouvrir un vieux fil sans suite proposée n’éteint pas le mode', () => {
    // Le cas signalé le 2026-09-02 : on change de conversation, elle finit sur une vieille réponse.
    expect(deciderRelanceAuto({ ...base, fil: [agent('réponse d’hier, sans clôture')] })).toEqual({
      action: 'attendre',
      raison: 'aucun-prompt'
    })
  })
  it('mode éteint', () => {
    expect(deciderRelanceAuto({ ...base, fil, actif: false })).toEqual({
      action: 'attendre',
      raison: 'inactif'
    })
  })
  it('tour en cours', () => {
    expect(deciderRelanceAuto({ ...base, fil, occupe: true })).toEqual({
      action: 'attendre',
      raison: 'tour-en-cours'
    })
  })
  it('fil sans réponse d’agent', () => {
    expect(deciderRelanceAuto({ ...base, fil: [humain('go')] })).toEqual({
      action: 'attendre',
      raison: 'aucune-reponse'
    })
  })
  it('patiente sans se couper quand l’utilisateur est en train d’écrire', () => {
    expect(deciderRelanceAuto({ ...base, fil, brouillonPresent: true })).toEqual({
      action: 'attendre',
      raison: 'brouillon'
    })
  })
  it('le MÊME tour ne déclenche jamais deux envois', () => {
    const signature = signatureTour(fil)
    expect(signature).not.toBeNull()
    expect(deciderRelanceAuto({ ...base, fil, dernierTourTraite: signature })).toEqual({
      action: 'attendre',
      raison: 'deja-traite'
    })
  })
})

describe('texteDernierAssistant', () => {
  it('recolle les morceaux de texte du dernier tour', () => {
    expect(texteDernierAssistant([agent('a'), humain('b'), agent('c')])).toBe('c')
    expect(texteDernierAssistant([humain('b')])).toBeNull()
  })
})
