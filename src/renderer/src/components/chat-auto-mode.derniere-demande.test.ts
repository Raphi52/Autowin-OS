import { describe, expect, it } from 'vitest'
import type { Msg } from './chat-view-types'
import {
  PROMPT_NOUVELLE_CIBLE,
  ancrerSurLaDemande,
  deciderRelanceAuto,
  derniereDemandeHumaine
} from './chat-auto-mode'

/**
 * LE MODE AUTO S'ANCRE SUR LA DERNIERE DEMANDE DE L'UTILISATEUR (conv-889, 2026-09-30).
 *
 * Demande : « ancre le mode auto sur ma derniere demande tapee a la main, pas sur le premier message
 * du fil ». Constat : parti de « c'est quoi chatgpt dots », conv-889 a change de sujet par des
 * messages TAPES, et chaque envoi automatique rappelait encore les Dots.
 *
 * ENTREE QUI DOIT FAIRE ECHOUER CE FICHIER SI L'ANCRE REVIENT AU PREMIER MESSAGE : le fil de
 * `filConv889`, dont le premier message parle des Dots.
 */
const demande = (texte: string, orientation?: boolean): Msg =>
  ({
    role: 'user',
    content: texte,
    ...(orientation ? { orientation: true } : {})
  }) as unknown as Msg
const reponse = (texte: string): Msg =>
  ({ role: 'assistant', parts: [{ kind: 'text', text: texte }] }) as unknown as Msg
const question = (options: string[]): Msg =>
  ({
    role: 'assistant',
    parts: [
      { kind: 'text', text: 'Quelle cible ensuite ?' },
      { kind: 'action', name: 'ask', ok: true, data: { question: 'Quelle cible ?', options } }
    ]
  }) as unknown as Msg

const filConv889 = (): Msg[] => [
  demande('c’est quoi chatgpt dots'),
  reponse('Ce sont des agents…'),
  demande(ancrerSurLaDemande('Rends le rappel plus sélectif', 'c’est quoi chatgpt dots')),
  reponse('Fait.'),
  demande(PROMPT_NOUVELLE_CIBLE),
  question([
    'Corrige la publication',
    'Ancre le mode auto',
    'Améliore le rang 1',
    'Traite la fonction morte'
  ])
]

describe('derniereDemandeHumaine', () => {
  it('un choix par numéros est résolu en texte des options choisies', () => {
    const fil = [...filConv889(), demande('2 3 4')]
    expect(derniereDemandeHumaine(fil)).toBe(
      'Ancre le mode auto · Améliore le rang 1 · Traite la fonction morte'
    )
  })

  it('un accord nu ne remplace pas la demande qu’il accepte', () => {
    const fil = [demande('Mesure le rappel sur le corpus réel'), reponse('ok ?'), demande('go')]
    expect(derniereDemandeHumaine(fil)).toBe('Mesure le rappel sur le corpus réel')
    expect(derniereDemandeHumaine([demande('Refais le test'), demande('Vas-y !')])).toBe(
      'Refais le test'
    )
  })

  it('le tour de relève, envoyé sans ancre, n’est pas une demande', () => {
    // Sans demande tapée après, on retombe sur l'ancre du dernier envoi automatique.
    expect(derniereDemandeHumaine(filConv889())).toBe('c’est quoi chatgpt dots')
  })

  it('un numéro hors des options ne s’invente pas une demande', () => {
    const fil = [...filConv889(), demande('9')]
    expect(derniereDemandeHumaine(fil)).toBe('c’est quoi chatgpt dots')
  })

  it('une orientation tapée pendant un tour reste écartée', () => {
    const fil = [demande('Mesure le rappel'), demande('optimise', true)]
    expect(derniereDemandeHumaine(fil)).toBe('Mesure le rappel')
  })

  it('l’envoi automatique porte la nouvelle formule, et elle se relit', () => {
    const envoye = ancrerSurLaDemande('Lance le build', 'Répare le bouton')
    expect(envoye).toContain('(Mode auto — dernière demande de l’utilisateur'.replace('’', "'"))
    expect(derniereDemandeHumaine([demande(envoye)])).toBe('Répare le bouton')
  })
})

describe('la réponse choisie seule par le mode auto est ancrée', () => {
  it('sinon l’option recommandée par l’agent deviendrait la demande d’ancrage', () => {
    const fil = [demande('Répare le bouton mode auto'), question(['Voie A', 'Voie B'])]
    const d = deciderRelanceAuto({
      actif: true,
      occupe: false,
      fil,
      dernierTourTraite: null,
      dernierPromptEnvoye: null,
      brouillonPresent: false
    })
    expect(d.action).toBe('envoyer')
    if (d.action !== 'envoyer') return
    expect(d.texte.startsWith('Voie A')).toBe(true)
    expect(d.texte).toContain('« Répare le bouton mode auto »')
    // Le tour suivant relit l'ancre dans cet envoi, pas « Voie A ».
    expect(derniereDemandeHumaine([...fil, demande(d.texte), reponse('fait')])).toBe(
      'Répare le bouton mode auto'
    )
  })
})
