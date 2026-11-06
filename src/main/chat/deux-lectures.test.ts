import { describe, expect, it } from 'vitest'
import {
  AVIS_DEUX_LECTURES,
  CONSIGNE_DEUX_LECTURES,
  ECART_MAX_POUR_DEMANDER,
  annonceDeLaLectureRetenue,
  chargeDeuxLectures,
  consigneDeLectureRetenue,
  contenusDesAvisDeLApp,
  demandesResteesSansReponse,
  dernierMessageAgent,
  extraitDuContexte,
  lectureAAnnoncer,
  lireLesLectures,
  tacheAvecLectureRetenue,
  demandeDeChangementDeRendu,
  lireDeuxLectures,
  meriteUneLecture,
  prefixeDeCommande,
  questionDesDeuxLectures,
  reprendSesMots,
  suitUneQuestionDesLectures,
  issueDesLecturesPourLaTrace
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

  it('une réponse sans lecture ne retient RIEN', () => {
    expect(lireLesLectures('{"lectures":[]}', DEMANDE_767)).toBeUndefined()
  })

  it('hors de ses mots : jamais en boutons, mais la ligne s’affiche quand même (conv-1240)', () => {
    const retenue = 'une task (toujours la meme) facile à évaluer via /arena'
    const ecartee = 'un banc de mesure reproductible pour comparer des orchestrations'
    for (const [p1, p2] of [
      [90, 10],
      [50, 50]
    ])
      expect(lireLesLectures(reponse([retenue, p1], [ecartee, p2]), DEMANDE_767)).toEqual({
        kind: 'retenue',
        retenue,
        ecartee
      })
  })

  it('l’annonce tient en une ligne : ce qui a été compris, sans l’autre lecture (conv-1280)', () => {
    const ligne = annonceDeLaLectureRetenue('zoom de la frise')
    expect(ligne).toBe('Compréhension : « zoom de la frise »')
    expect(ligne).not.toContain('\n')
    // L'autre lecture reste connue du modèle, mais ne s'affiche plus dans le fil.
    const consigne = consigneDeLectureRetenue('zoom de la frise', 'filtre des éléments')
    expect(consigne).toContain('« filtre des éléments »')
    expect(consigne).not.toContain('si tu voulais plutôt')
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

describe('une seule lecture : annoncée quand même (conv-1240, « met le tout le temps »)', () => {
  const DEMANDE = 'met le tout le temps'
  const COMPRISE =
    'Afficher la ligne « Lecture retenue » à chaque message, et plus seulement de temps en temps'

  it('une lecture seule → retenue, sans lecture écartée', () => {
    expect(lireLesLectures(reponse([COMPRISE, 100]), DEMANDE)).toEqual({
      kind: 'retenue',
      retenue: COMPRISE
    })
  })

  it('une lecture seule reformulée est annoncée telle quelle : c’est ce que l’agent a compris', () => {
    // Rejeu sur le vrai modèle (2026-10-28) : « met le tout le temps » lu « à chaque demande ».
    const reformulee = 'Afficher la ligne « Lecture retenue » à chaque demande'
    expect(lireLesLectures(reponse([reformulee, 100]), DEMANDE)).toEqual({
      kind: 'retenue',
      retenue: reformulee
    })
  })

  it('une relance sans mot porteur (« go ») est annoncée d’après le contexte', () => {
    expect(lireLesLectures(reponse(['Lancer le build recommandé', 100]), 'go')).toEqual({
      kind: 'retenue',
      retenue: 'Lancer le build recommandé'
    })
  })

  it('une lecture seule trop longue ou sans probabilité n’est pas annoncée', () => {
    expect(lireLesLectures(reponse([`temps ${'x'.repeat(250)}`, 100]), DEMANDE)).toBeUndefined()
    expect(
      lireLesLectures(JSON.stringify({ lectures: [{ texte: COMPRISE }] }), DEMANDE)
    ).toBeUndefined()
  })

  it('la ligne, la tâche du run et la consigne du modèle ne parlent d’aucune autre lecture', () => {
    expect(annonceDeLaLectureRetenue('zoom de la frise')).toBe(
      'Compréhension : « zoom de la frise »'
    )
    // Le modèle nomme la ligne comme l'étiquette du fil (conv-1280).
    for (const consigne of [consigneDeLectureRetenue('a'), consigneDeLectureRetenue('a', 'b')]) {
      expect(consigne).toContain('« compréhension »')
      expect(consigne).not.toMatch(/^L'utilisateur a déjà vu la ligne : /m)
    }
    const tache = tacheAvecLectureRetenue(DEMANDE_767, 'lecture a')
    expect(tache).toContain('« lecture a ».')
    expect(tache).not.toContain('écartée')
    expect(tacheAvecLectureRetenue(tache, 'lecture a')).toBe(tache)
    const consigne = consigneDeLectureRetenue('lecture a')
    expect(consigne.startsWith('SYSTÈME:')).toBe(true)
    expect(consigne).toContain('« lecture a »')
    expect(consigne).not.toContain('deux façons')
  })

  it('là où la question n’est pas posée, la plus probable des deux est annoncée, l’autre nommée', () => {
    expect(lectureAAnnoncer({ kind: 'question', lectures: ['a', 'b'] })).toEqual({
      kind: 'retenue',
      retenue: 'a',
      ecartee: 'b'
    })
    const seule = { kind: 'retenue', retenue: 'a' } as const
    expect(lectureAAnnoncer(seule)).toBe(seule)
  })

  it('le contexte garde le DÉBUT et la FIN du dernier message : une relance vise sa proposition', () => {
    const message = `Début du message. ${'x'.repeat(3000)} 👉 Recommandé : lancer le build.`
    const extrait = extraitDuContexte(message)
    expect(extrait.startsWith('Début du message.')).toBe(true)
    expect(extrait.endsWith('👉 Recommandé : lancer le build.')).toBe(true)
    expect(extrait.length).toBeLessThan(820)
    expect(extraitDuContexte('court')).toBe('court')
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

  // conv-1263, tour 60eda4d2-c6e0-491d-8b34-116257bf3766 : « fais une super conv » lu « améliorer
  // ses dialogues ». Sans le vocabulaire d'Autowin, rejeu Haiku : 0 lecture « plan de lots » sur 3.
  it('la consigne donne le sens des mots d’Autowin qui ne sont pas des commandes (kaizen conv-1266)', () => {
    expect(CONSIGNE_DEUX_LECTURES).toContain('Autowin OS')
    expect(CONSIGNE_DEUX_LECTURES).toMatch(/« super conv ».*« plan de lots »/u)
    expect(CONSIGNE_DEUX_LECTURES).toMatch(/« conv ».*conversation de travail/su)
  })
})

/**
 * LA TRACE DIT CE QUE LE CONTRÔLE A DÉCIDÉ, PAS LA RÉPONSE BRUTE COUPÉE (conv-1431, 2026-11-02).
 *
 * Mesuré sur `cost.jsonl` : 527 lignes `deuxLectures` sur 696 coupées à 160 caractères AVANT la
 * deuxième lecture, donc impossibles à classer. Entrée qui ferait échouer une correction fausse :
 * `LECTURES_767` (deux lectures à 50/50, plus de 160 caractères) — la réponse brute recopiée rend
 * un JSON tronqué, jamais « 2 lectures : question ».
 */
describe('issueDesLecturesPourLaTrace — une ligne lisible dans cost.jsonl', () => {
  const AVANT_D_AGIR = { questionPermise: true, moment: 'avant-d-agir' } as const
  const EN_PARALLELE = { questionPermise: true, moment: 'en-parallele' } as const

  it('à égalité, quand le tour attend la lecture pour agir : la question est posée', () => {
    expect(LECTURES_767.length).toBeGreaterThan(160)
    expect(issueDesLecturesPourLaTrace(LECTURES_767, DEMANDE_767, AVANT_D_AGIR)).toBe(
      '2 lectures : question posée'
    )
  })

  /*
   * L'OBJECTION DU CONTRÔLE FINAL (conv-1431) : sur un tour ordinaire, la lecture court EN PARALLÈLE
   * du modèle et le tour ANNONCE la plus probable ; la question n'est posée que si un run suit.
   * Entrée qui ferait échouer une correction fausse : `LECTURES_767` lue `en-parallele` — l'ancienne
   * étiquette y écrivait « question » sans qu'aucune question ne parte.
   */
  it('à égalité, lue en parallèle d’un tour ordinaire : jamais « question posée »', () => {
    expect(issueDesLecturesPourLaTrace(LECTURES_767, DEMANDE_767, EN_PARALLELE)).toBe(
      '2 lectures : à égalité, question seulement si un run suit'
    )
  })

  it('à égalité sans question permise : annoncée, quel que soit le moment', () => {
    for (const moment of ['avant-d-agir', 'en-parallele'] as const)
      expect(
        issueDesLecturesPourLaTrace(LECTURES_767, DEMANDE_767, { questionPermise: false, moment })
      ).toBe('2 lectures : annoncée (question non permise)')
  })

  it('une lecture domine : annoncée ; une seule lecture : nette', () => {
    const dominante = reponse([LECTURE_ARENA_767, 80], [LECTURE_CODE_767, 20])
    expect(issueDesLecturesPourLaTrace(dominante, DEMANDE_767, AVANT_D_AGIR)).toBe(
      '2 lectures : annoncée'
    )
    expect(
      issueDesLecturesPourLaTrace(reponse([LECTURE_ARENA_767, 100]), DEMANDE_767, EN_PARALLELE)
    ).toBe('nette')
  })

  it('illisible : nommé, avec le début de la réponse pour lire le format inattendu', () => {
    const prose = 'Je pense que la demande est claire.'
    expect(issueDesLecturesPourLaTrace(prose, DEMANDE_767, AVANT_D_AGIR)).toBe(
      `illisible : ${prose}`
    )
    expect(issueDesLecturesPourLaTrace('{"lectures":[]}', DEMANDE_767, EN_PARALLELE)).toBe(
      'illisible : {"lectures":[]}'
    )
    // Une réponse vide reste « vide » : `resumerIssue` l'écrit « (réponse vide) ».
    expect(issueDesLecturesPourLaTrace('  ', DEMANDE_767, AVANT_D_AGIR)).toBe('')
  })
})

describe('chargeDeuxLectures — skill nommée sans barre oblique (conv-412)', () => {
  const descriptions = { kaizen: 'APPLIQUE ses éditions, un commit chacune' }
  it('remet la description quand le message commence par le nom de la skill', () => {
    expect(chargeDeuxLectures('kaizen', undefined, descriptions)).toContain(
      '/kaizen : APPLIQUE ses éditions'
    )
  })
  it('ne remet rien pour un premier mot qui n est pas une skill', () => {
    expect(chargeDeuxLectures('kaizenons ce module', undefined, descriptions)).not.toContain(
      'commandes citées'
    )
  })
})

/**
 * Le fil RÉEL de conv-1558 (2026-11-05, positions 83 à 90) : quatre messages d'affilée, chacun
 * coupant le tour d'avant, qui n'a laissé que sa ligne compréhension. Lu sur le seul dernier
 * message, « améliore tout fait un lot » est devenu « tout ce qui a été évoqué sur le kimono ».
 */
describe('tours coupés : les messages restés sans réponse font partie de la demande (kaizen conv-1558)', () => {
  const PROPOSITION =
    'I have three directions… 👉 Recommandé Go with C, fix the ear in profile, then generate the 2x atlas.'
  const FIL_1558 = [
    { role: 'assistant', content: PROPOSITION },
    { role: 'user', content: 'ok on a la texture maintenant améliore la shape' },
    {
      role: 'assistant',
      arrete: true,
      content:
        "Compréhension : « Améliorer la forme 3D du tanuki (corriger l'oreille de profil) »\n\n[artefact cmp4.png]"
    },
    {
      role: 'user',
      content: 'None of them is 10x better yet: keep pushing (fur, kimono fabric, expressions)'
    },
    {
      role: 'assistant',
      arrete: true,
      content: 'Compréhension : « Continuer à améliorer le modèle 3D du tanuki »\n\n'
    },
    { role: 'user', content: 'son kimono a pas une belle forme' },
    {
      role: 'assistant',
      arrete: true,
      content:
        'Compréhension : « Retoucher la forme 3D du kimono du tanuki (volume, tombé des pans) »'
    },
    { role: 'user', content: 'améliore tout fait un lot' }
  ]

  it('rend les trois messages coupés, dans l’ordre, sans la demande courante', () => {
    expect(demandesResteesSansReponse(FIL_1558)).toEqual([
      'ok on a la texture maintenant améliore la shape',
      'None of them is 10x better yet: keep pushing (fur, kimono fabric, expressions)',
      'son kimono a pas une belle forme'
    ])
  })

  it('le contexte est la dernière VRAIE réponse de l’agent, pas la ligne du tour coupé', () => {
    expect(dernierMessageAgent(FIL_1558)).toBe(PROPOSITION)
  })

  it('la charge du petit modèle porte les trois messages avant la demande', () => {
    const charge = chargeDeuxLectures(
      'améliore tout fait un lot',
      dernierMessageAgent(FIL_1558),
      {},
      demandesResteesSansReponse(FIL_1558)
    )
    expect(charge).toContain('restés sans réponse')
    for (const sujet of ['améliore la shape', 'fur, kimono fabric, expressions', 'belle forme'])
      expect(charge).toContain(sujet)
    expect(charge).not.toContain('Retoucher la forme 3D du kimono')
    expect(charge.indexOf('belle forme')).toBeLessThan(charge.indexOf('améliore tout fait un lot'))
  })

  it('la consigne dit que la phrase couvre chacun de leurs sujets', () => {
    expect(CONSIGNE_DEUX_LECTURES).toContain('SANS RÉPONSE')
    expect(CONSIGNE_DEUX_LECTURES).toContain('CHACUN de leurs sujets')
  })

  it('sans le statut, un message réduit à sa ligne compréhension ne répond à rien non plus', () => {
    const fil = FIL_1558.map(({ role, content }) => ({ role, content }))
    expect(demandesResteesSansReponse(fil)).toHaveLength(3)
    expect(dernierMessageAgent(fil)).toBe(PROPOSITION)
  })

  it('contrôle : après une vraie réponse, rien n’est resté sans réponse', () => {
    const fil = [
      { role: 'user', content: 'améliore la shape' },
      { role: 'assistant', content: 'Compréhension : « la forme »\n\nVoici la forme corrigée.' },
      { role: 'user', content: 'et le kimono' }
    ]
    expect(demandesResteesSansReponse(fil)).toEqual([])
    expect(chargeDeuxLectures('et le kimono', dernierMessageAgent(fil))).not.toContain(
      'sans réponse'
    )
    expect(dernierMessageAgent(fil)).toContain('Voici la forme corrigée.')
  })
})

describe('un avis de l’app n’est pas la réponse de l’agent (conv-1641)', () => {
  /** Début réel de la réponse du tour 87e4b765 et de la carte Git posée dessous (`noteATrier`). */
  const REPONSE_VOIX =
    'Compréhension : « Lister des concurrents d’ElevenLabs gratuits pour la synthèse vocale »\n\n' +
    '**Oui. Le plus sérieux, c’est Google Gemini, gratuit dans la limite d’un quota par jour.**\n' +
    '```aw-tableau\n{"titre":"Alternatives gratuites à ElevenLabs"}\n```'
  const CARTE_GIT = [
    '```html-render',
    '<div class="aw-kicker">GIT : rien publié</div>',
    '<div><b>Publication auto arrêtée</b> : ce travail demande un <b>tri par contenu</b>.</div>',
    '<div>· tests rouges (vitest related src/main/board/board-dossier.ts src/main/ipc/chat.ts)</div>',
    '```'
  ].join('\n')
  const STOCKES = [
    { role: 'user', content: 'on pourrait avoir plein de comptes gmail?' },
    {
      role: 'assistant',
      turnId: 'ed669d0d',
      content: 'Non : un compte par personne chez ElevenLabs.'
    },
    { role: 'user', content: 'ya des concurrents gratuits?' },
    { role: 'assistant', turnId: '87e4b765', content: REPONSE_VOIX },
    { role: 'assistant', content: CARTE_GIT },
    { role: 'user', content: 'ya des concurrents gratuits?' }
  ]
  const avis = contenusDesAvisDeLApp(STOCKES)
  const fil = STOCKES.map(({ role, content }) => ({
    role,
    content,
    ...(role === 'assistant' && avis.has(content) ? { avisDeLApp: true } : {})
  }))

  it('repère l’avis par l’absence de turnId, jamais une réponse de tour', () => {
    expect([...avis]).toEqual([CARTE_GIT])
  })

  it('reproduction : sans le marquage, le contexte du petit modèle était la carte Git', () => {
    const nu = STOCKES.map(({ role, content }) => ({ role, content }))
    expect(dernierMessageAgent(nu)).toBe(CARTE_GIT)
  })

  it('le contexte est la réponse sur les voix, la carte Git n’y entre pas', () => {
    expect(dernierMessageAgent(fil)).toBe(REPONSE_VOIX)
    const charge = chargeDeuxLectures('ya des concurrents gratuits?', dernierMessageAgent(fil))
    expect(charge).toContain('ElevenLabs')
    expect(charge).not.toContain('Publication auto')
  })

  it('un avis ne répond à rien : la question d’avant reste dans la demande si seul un avis suit', () => {
    const sansReponse = [
      { role: 'assistant', content: 'Voici les prix.' },
      { role: 'user', content: 'faut payer elevenlabs?' },
      { role: 'assistant', avisDeLApp: true, content: CARTE_GIT },
      { role: 'user', content: 'et les concurrents ?' }
    ]
    expect(demandesResteesSansReponse(sansReponse)).toEqual(['faut payer elevenlabs?'])
    // Après la réponse de l'agent, l'avis posé dessous ne rend pas la question orpheline.
    expect(demandesResteesSansReponse(fil)).toEqual([])
  })

  it('un message vide sans turnId n’est pas un avis à repérer', () => {
    expect(contenusDesAvisDeLApp([{ role: 'assistant', content: '  ' }]).size).toBe(0)
  })
})
