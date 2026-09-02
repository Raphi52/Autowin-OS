import { describe, expect, it } from 'vitest'
import type { Msg } from './chat-view-types'
import {
  ancrerSurLaTacheInitiale,
  blocFaitDitRien,
  deciderRelanceAuto,
  tacheInitiale,
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
    // Le prompt du modele, ANCRE sur la tache initiale du fil — le texte reellement envoye.
    expect(d).toMatchObject({
      action: 'envoyer',
      texte: ancrerSurLaTacheInitiale('lance le terrain sur X', 'go')
    })
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

/**
 * LA FIN DE CHAINE D'AUTOWIN — le mot « rien » tombe sur la ligne « ⏳ Reste à faire », et c'est
 * la SEULE des quatre rubriques que la porte de décision ne lisait pas.
 *
 * MESURE DU 2026-09-02 (journaux de la journée) : les tours de rattrapage « kaizen … » ont coûté
 * 19,38 $ sur 156,51 $. En rejouant la chaîne complète scout → frame → terrain → build → clean →
 * judge sur le texte que produit VRAIMENT l'app, le dernier tour rendait
 * « ⏳ Reste à faire : rien. / 👉 Recommandé : passer à la prochaine demande. » — donc le mode auto
 * envoyait « passer à la prochaine demande. » comme ordre : un tour PAYANT pour ne rien produire,
 * exactement le gaspillage mesuré. La chaîne finie doit ÉTEINDRE la boucle, pas la relancer.
 */
const FIN_DE_CHAINE_AUTOWIN = [
  '✅ Fait',
  '1. Le résultat demandé a été produit et validé — sujet : « mon-sujet ».',
  '📍 Maintenant : la tâche demandée est terminée et son résultat est disponible.',
  '⏳ Reste à faire : rien.',
  '👉 Recommandé : passer à la prochaine demande.'
].join('\n')

describe('fin de chaîne — « Reste à faire : rien » éteint la boucle', () => {
  it('ARRÊTE au lieu d’envoyer « passer à la prochaine demande »', () => {
    const decision = deciderRelanceAuto({
      ...base,
      fil: [humain('lancer judge.'), agent(FIN_DE_CHAINE_AUTOWIN)]
    })
    expect(decision.action).toBe('arreter')
  })

  it('n’arrête pas quand la chaîne continue', () => {
    const suite = FIN_DE_CHAINE_AUTOWIN.replace(
      '⏳ Reste à faire : rien.',
      '⏳ Reste à faire : clean → judge.'
    ).replace('👉 Recommandé : passer à la prochaine demande.', '👉 Recommandé : lancer clean.')
    const decision = deciderRelanceAuto({ ...base, fil: [humain('go'), agent(suite)] })
    expect(decision).toEqual({
      action: 'envoyer',
      // La suite part ANCREE sur la tache initiale du fil (« go ») : c'est le texte reellement envoye.
      texte: ancrerSurLaTacheInitiale('lancer clean.', 'go'),
      signature: expect.any(String)
    })
  })

  it('« rien ne bloque » dans cette rubrique ne coupe PAS la boucle', () => {
    const suite = FIN_DE_CHAINE_AUTOWIN.replace(
      '⏳ Reste à faire : rien.',
      '⏳ Reste à faire : rien ne bloque le lancement de clean.'
    ).replace('👉 Recommandé : passer à la prochaine demande.', '👉 Recommandé : lancer clean.')
    const decision = deciderRelanceAuto({ ...base, fil: [humain('go'), agent(suite)] })
    expect(decision.action).toBe('envoyer')
  })
})

/**
 * ANCRAGE ANTI-DÉRIVE — demande du 2026-09-02 : « le mode auto doit pas trop trop partir en
 * couille par rapport a la tache initiale non plus ». Mesuré sur conv-138 : la chaîne est partie
 * de « juge la qualité de mon prompting » et est arrivée au shader du nuage d'accueil.
 */
describe('le mode auto reste accroché à la tâche initiale', () => {
  const reponse = (texte: string): Msg =>
    ({ role: 'assistant', parts: [{ kind: 'text', text: texte }] }) as unknown as Msg
  const demande = (texte: string, orientation?: boolean): Msg =>
    ({ role: 'user', content: texte, ...(orientation ? { orientation: true } : {}) }) as unknown as Msg

  it('prend le PREMIER message de l’utilisateur, pas le dernier', () => {
    expect(
      tacheInitiale([demande('juge la qualité de mon prompting'), reponse('x'), demande('et le nuage ?')])
    ).toBe('juge la qualité de mon prompting')
  })

  it('ignore une orientation tapée PENDANT un tour', () => {
    expect(tacheInitiale([demande('arrête-toi', true), demande('la vraie demande')])).toBe(
      'la vraie demande'
    )
  })

  it('le texte ENVOYÉ porte la tâche initiale et l’ordre de s’arrêter en cas de dérive', () => {
    const decision = deciderRelanceAuto({
      actif: true,
      occupe: false,
      fil: [
        demande('juge la qualité de mon prompting'),
        reponse('⏳ Reste à faire : trier\n👉 Recommandé — regarder le nuage\nAUTOWIN_PROMPT_V1: Montre-moi le nuage')
      ],
      dernierTourTraite: null,
      dernierPromptEnvoye: null,
      brouillonPresent: false
    })
    expect(decision.action).toBe('envoyer')
    if (decision.action !== 'envoyer') return
    expect(decision.texte).toContain('Montre-moi le nuage')
    expect(decision.texte).toContain('juge la qualité de mon prompting')
    expect(decision.texte).toContain('arrête la chaîne')
  })

  it('l’anti-boucle survit à l’ancrage : la même suite deux fois n’est pas renvoyée', () => {
    const fil = [
      demande('ma demande de départ'),
      reponse('👉 Recommandé — suite\nAUTOWIN_PROMPT_V1: Refais la même chose')
    ]
    const premier = deciderRelanceAuto({
      actif: true,
      occupe: false,
      fil,
      dernierTourTraite: null,
      dernierPromptEnvoye: null,
      brouillonPresent: false
    })
    expect(premier.action).toBe('envoyer')
    if (premier.action !== 'envoyer') return
    const second = deciderRelanceAuto({
      actif: true,
      occupe: false,
      fil,
      dernierTourTraite: null,
      // Ce qui a RÉELLEMENT été envoyé, ancrage compris.
      dernierPromptEnvoye: premier.texte,
      brouillonPresent: false
    })
    expect(second).toEqual({ action: 'attendre', raison: 'prompt-identique' })
  })

  it('le premier maillon n’est pas ancré sur lui-même', () => {
    expect(ancrerSurLaTacheInitiale('fais X', 'fais X')).toBe('fais X')
  })
})
