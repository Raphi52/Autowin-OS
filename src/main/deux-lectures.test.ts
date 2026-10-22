import { describe, expect, it } from 'vitest'
import {
  AVIS_DEUX_LECTURES,
  chargeDeuxLectures,
  demandeDeChangementDeRendu,
  lireDeuxLectures,
  meriteUneLecture,
  prefixeDeCommande,
  questionDesDeuxLectures,
  reprendSesMots,
  suitUneQuestionDesLectures
} from './deux-lectures'

/** La demande RÉELLE de conv-767 (premier message, 2026-09-22) — 2,47 $ sur une mauvaise lecture. */
const DEMANDE_767 =
  '/scout une task (toujours la meme) qui est pratique pour etre évaluée via /arena'
const LECTURES_767 = JSON.stringify({
  lectures: [
    'une task (toujours la meme) facile à évaluer, pour lancer des /arena dessus et comparer les workflows',
    'une task (toujours la meme) à corriger dans le code, assez petite pour etre évaluée via /arena'
  ]
})

describe('lireDeuxLectures — la réponse du petit modèle', () => {
  it('rend les deux lectures de conv-767 quand elles reprennent ses mots', () => {
    const lectures = lireDeuxLectures(LECTURES_767, DEMANDE_767)
    expect(lectures?.[0]).toContain('comparer les workflows')
    expect(lectures?.[1]).toContain('corriger dans le code')
  })

  it('tolère du texte autour du JSON', () => {
    expect(lireDeuxLectures(`Voici :\n${LECTURES_767}\n`, DEMANDE_767)).toHaveLength(2)
  })

  it('une seule lecture, ou aucune, ne pose AUCUNE question', () => {
    expect(lireDeuxLectures('{"lectures":[]}', DEMANDE_767)).toBeUndefined()
    expect(
      lireDeuxLectures('{"lectures":["une task facile à évaluer via arena"]}', DEMANDE_767)
    ).toBeUndefined()
  })

  it('une réponse illisible ou absente ne bloque jamais : undefined', () => {
    expect(lireDeuxLectures('je ne sais pas', DEMANDE_767)).toBeUndefined()
    expect(lireDeuxLectures('{"lectures": [', DEMANDE_767)).toBeUndefined()
    expect(lireDeuxLectures(undefined, DEMANDE_767)).toBeUndefined()
  })

  it('refuse deux lectures identiques', () => {
    const memes = JSON.stringify({
      lectures: ['une task pratique évaluée via arena', 'Une task pratique, évaluée via arena !']
    })
    expect(lireDeuxLectures(memes, DEMANDE_767)).toBeUndefined()
  })

  it('refuse une lecture qui ne reprend PAS les mots de l’utilisateur', () => {
    const savante = JSON.stringify({
      lectures: [
        'une task (toujours la meme) facile à évaluer via /arena',
        'un banc de mesure reproductible pour comparer des orchestrations'
      ]
    })
    expect(lireDeuxLectures(savante, DEMANDE_767)).toBeUndefined()
  })

  it('refuse une lecture trop longue pour un bouton', () => {
    const longue = JSON.stringify({
      lectures: ['une task pratique évaluée via arena', `une task ${'très '.repeat(60)}via arena`]
    })
    expect(lireDeuxLectures(longue, DEMANDE_767)).toBeUndefined()
  })
})

describe('reprendSesMots', () => {
  it('compte les mots porteurs, sans accent ni mots-outils', () => {
    expect(reprendSesMots('une task évaluée par arena', DEMANDE_767)).toBe(true)
    expect(reprendSesMots('un banc pour mesurer', DEMANDE_767)).toBe(false)
  })
})

describe('la question posée', () => {
  it('garde la commande /scout devant chaque lecture envoyée, la plus probable recommandée', () => {
    const [a, b] = lireDeuxLectures(LECTURES_767, DEMANDE_767) as [string, string]
    const { options } = questionDesDeuxLectures([a, b], DEMANDE_767)
    expect(options).toHaveLength(2)
    expect(options[0]).toMatchObject({ libelle: a, recommande: true, envoi: `/scout ${a}` })
    expect(options[1]).toMatchObject({ libelle: b, envoi: `/scout ${b}` })
    expect(options[1].recommande).toBeUndefined()
  })

  it('sans commande, la lecture part telle quelle', () => {
    expect(prefixeDeCommande('la barre de scroll masque le contenu')).toBe('')
    const { options } = questionDesDeuxLectures(['lecture a', 'lecture b'], 'la barre masque')
    expect(options[0].envoi).toBe('lecture a')
  })
})

describe('une seule question par demande', () => {
  it('la réponse — cliquée ou tapée — qui suit la question n’est jamais réinterrogée', () => {
    expect(
      suitUneQuestionDesLectures([
        { role: 'user', content: DEMANDE_767 },
        { role: 'assistant', content: AVIS_DEUX_LECTURES },
        { role: 'user', content: 'non, je veux comparer les workflows' }
      ])
    ).toBe(true)
  })

  it('une demande neuve, après une autre réponse de l’agent, est lue', () => {
    expect(
      suitUneQuestionDesLectures([
        { role: 'assistant', content: AVIS_DEUX_LECTURES },
        { role: 'user', content: 'ok' },
        { role: 'assistant', content: 'Fait.' },
        { role: 'user', content: DEMANDE_767 }
      ])
    ).toBe(false)
    expect(suitUneQuestionDesLectures([{ role: 'user', content: DEMANDE_767 }])).toBe(false)
  })
})

describe('les filtres déterministes, avant tout appel de modèle', () => {
  it('une relance ou un message trop court n’est pas lu', () => {
    for (const relance of ['ok', 'go', 'vas-y', 'continue', 'oui !', 'fais le'])
      expect(meriteUneLecture(relance)).toBe(false)
    expect(meriteUneLecture(DEMANDE_767)).toBe(true)
  })

  it('une demande de changement d’affichage est repérée ; une question ne l’est pas', () => {
    // conv-542 : la barre de défilement a été SUPPRIMÉE au lieu d'écarter le contenu.
    expect(
      demandeDeChangementDeRendu(
        'la barre de scroll dans les widgets elle masque un peu le contenu'
      )
    ).toBe(true)
    expect(demandeDeChangementDeRendu('le texte du bouton Active remonte de 1 px')).toBe(true)
    expect(demandeDeChangementDeRendu('comment rendre mon graph plus clair')).toBe(false)
    expect(demandeDeChangementDeRendu('ca fait la meme chose les deux boutons ?')).toBe(false)
    expect(demandeDeChangementDeRendu('relance les tests du module de paie')).toBe(false)
  })

  it('la charge porte ce que font les commandes citées, et seulement elles', () => {
    expect(
      chargeDeuxLectures(DEMANDE_767, undefined, {
        scout: 'rend des candidats d’amélioration',
        arena: 'mesure le meilleur workflow',
        build: 'répare'
      })
    ).toContain(
      '- /scout : rend des candidats d’amélioration\n- /arena : mesure le meilleur workflow'
    )
    expect(chargeDeuxLectures(DEMANDE_767, undefined, { build: 'répare' })).not.toContain('/build')
  })

  it('le contexte remis au petit modèle est borné', () => {
    const charge = chargeDeuxLectures('nan pas ça', 'x'.repeat(5000))
    expect(charge.length).toBeLessThan(1000)
    expect(charge).toContain('nan pas ça')
  })
})
