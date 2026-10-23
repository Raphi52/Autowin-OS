import { describe, expect, it } from 'vitest'
import {
  AVIS_DEUX_LECTURES,
  ECART_MAX_POUR_DEMANDER,
  annonceDeLaLectureRetenue,
  chargeDeuxLectures,
  consigneDeLectureRetenue,
  lireLesLectures,
  tacheAvecLectureRetenue,
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
/** La réponse du petit modèle : chaque lecture et sa probabilité, en %. */
function reponse(...lectures: Array<[string, number]>): string {
  return JSON.stringify({ lectures: lectures.map(([texte, proba]) => ({ texte, proba })) })
}
const LECTURE_ARENA_767 =
  'une task (toujours la meme) facile à évaluer, pour lancer des /arena dessus et comparer les workflows'
const LECTURE_CODE_767 =
  'une task (toujours la meme) à corriger dans le code, assez petite pour etre évaluée via /arena'
const LECTURES_767 = reponse([LECTURE_ARENA_767, 50], [LECTURE_CODE_767, 50])

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
      lireDeuxLectures(reponse(['une task facile à évaluer via arena', 100]), DEMANDE_767)
    ).toBeUndefined()
  })

  it('une lecture qui DOMINE ne pose AUCUNE question : seule la quasi-égalité bloque (conv-1123)', () => {
    // Le cas réel du 2026-10-23 : « choix de période » sur la rivière, zoom ou filtre. Le zoom allait
    // de soi ; la question a coupé le tour pour rien.
    const demande =
      'Ajoute à la rivière de la Carte du projet un choix de période (2 semaines, 1 mois, 3 mois), en gardant la molette qui déplace la colonne large.'
    const zoom =
      'Le choix 2 semaines / 1 mois / 3 mois règle la durée affichée de la rivière, la molette continuant de déplacer la colonne large.'
    const filtre =
      'Le choix de période filtre la rivière : elle ne garde que les éléments des 2 semaines, 1 mois ou 3 mois passés.'
    expect(lireDeuxLectures(reponse([zoom, 70], [filtre, 30]), demande)).toBeUndefined()
    expect(lireDeuxLectures(reponse([zoom, 56], [filtre, 44]), demande)).toBeUndefined()
    expect(lireDeuxLectures(reponse([zoom, 55], [filtre, 45]), demande)).toEqual([zoom, filtre])
    expect(ECART_MAX_POUR_DEMANDER).toBe(10)
  })

  it('une lecture SANS probabilité ne pose aucune question : pas de score, pas de doute prouvé', () => {
    const sansScore = JSON.stringify({ lectures: [LECTURE_ARENA_767, LECTURE_CODE_767] })
    expect(lireDeuxLectures(sansScore, DEMANDE_767)).toBeUndefined()
    const scoreTexte = JSON.stringify({
      lectures: [
        { texte: LECTURE_ARENA_767, proba: '50' },
        { texte: LECTURE_CODE_767, proba: 50 }
      ]
    })
    expect(lireDeuxLectures(scoreTexte, DEMANDE_767)).toBeUndefined()
  })

  it('normalise les probabilités et range la plus probable d’abord', () => {
    // 0,47 / 0,53 = 47/53 : quasi égal, et la lecture « code » passe devant, recommandée.
    expect(
      lireDeuxLectures(reponse([LECTURE_ARENA_767, 0.47], [LECTURE_CODE_767, 0.53]), DEMANDE_767)
    ).toEqual([LECTURE_CODE_767, LECTURE_ARENA_767])
    expect(
      lireDeuxLectures(reponse([LECTURE_ARENA_767, 0], [LECTURE_CODE_767, 0]), DEMANDE_767)
    ).toBeUndefined()
  })

  it('une réponse illisible ou absente ne bloque jamais : undefined', () => {
    expect(lireDeuxLectures('je ne sais pas', DEMANDE_767)).toBeUndefined()
    expect(lireDeuxLectures('{"lectures": [', DEMANDE_767)).toBeUndefined()
    expect(lireDeuxLectures(undefined, DEMANDE_767)).toBeUndefined()
  })

  it('refuse deux lectures identiques', () => {
    const memes = reponse(
      ['une task pratique évaluée via arena', 50],
      ['Une task pratique, évaluée via arena !', 50]
    )
    expect(lireDeuxLectures(memes, DEMANDE_767)).toBeUndefined()
  })

  it('refuse une lecture qui ne reprend PAS les mots de l’utilisateur', () => {
    const savante = reponse(
      ['une task (toujours la meme) facile à évaluer via /arena', 50],
      ['un banc de mesure reproductible pour comparer des orchestrations', 50]
    )
    expect(lireDeuxLectures(savante, DEMANDE_767)).toBeUndefined()
  })

  it('refuse une lecture trop longue pour un bouton', () => {
    const longue = reponse(
      ['une task pratique évaluée via arena', 50],
      [`une task ${'très '.repeat(60)}via arena`, 50]
    )
    expect(lireDeuxLectures(longue, DEMANDE_767)).toBeUndefined()
  })
})

describe('lireLesLectures — question ou lecture retenue (conv-1123)', () => {
  it('quasi-égalité → question ; lecture dominante → retenue, l’autre nommée', () => {
    expect(
      lireLesLectures(reponse([LECTURE_ARENA_767, 52], [LECTURE_CODE_767, 48]), DEMANDE_767)
    ).toEqual({ kind: 'question', lectures: [LECTURE_ARENA_767, LECTURE_CODE_767] })
    expect(
      lireLesLectures(reponse([LECTURE_ARENA_767, 25], [LECTURE_CODE_767, 75]), DEMANDE_767)
    ).toEqual({ kind: 'retenue', retenue: LECTURE_CODE_767, ecartee: LECTURE_ARENA_767 })
  })

  it('une réponse douteuse ne retient RIEN : pas d’annonce sur une lecture non validée', () => {
    expect(lireLesLectures('{"lectures":[]}', DEMANDE_767)).toBeUndefined()
    const savante = reponse(
      ['une task (toujours la meme) facile à évaluer via /arena', 90],
      ['un banc de mesure reproductible pour comparer des orchestrations', 10]
    )
    expect(lireLesLectures(savante, DEMANDE_767)).toBeUndefined()
  })

  it('l’annonce tient en une ligne : la lecture qui part, puis l’autre', () => {
    const ligne = annonceDeLaLectureRetenue('zoom de la frise', 'filtre des éléments')
    expect(ligne).toBe(
      'Lecture retenue : « zoom de la frise » — si tu voulais plutôt « filtre des éléments », dis-le.'
    )
    expect(ligne).not.toContain('\n')
  })

  it('la tâche du run garde la demande entière et ne prend la précision qu’une fois', () => {
    const une = tacheAvecLectureRetenue(DEMANDE_767, 'lecture a', 'lecture b')
    expect(une.startsWith(DEMANDE_767)).toBe(true)
    expect(une).toContain('« lecture a »')
    expect(tacheAvecLectureRetenue(une, 'lecture a', 'lecture b')).toBe(une)
  })

  it('la consigne du modèle est une relance d’Autowin, jamais des mots de l’utilisateur', () => {
    const consigne = consigneDeLectureRetenue('lecture a', 'lecture b')
    expect(consigne.startsWith('SYSTÈME:')).toBe(true)
    expect(consigne).toContain('« lecture a »')
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
