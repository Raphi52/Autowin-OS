import { describe, expect, it } from 'vitest'
import { lignesDuCarnet, resumeDAbsence, texteDeCorrection } from './carnet-du-fil'
import type { Msg } from './chat-view-types'

/**
 * CARNET VIVANT DU FIL (conv-1038, 2026-10-21). Les fils longs dérivent (p90 = 14 messages de
 * l'utilisateur par fil), et la mémoire du fil n'existait que pour l'agent. Le carnet relit ce que
 * le fil a DÉJÀ écrit — la dernière demande, la dernière clôture, la question ouverte, les fichiers
 * touchés, ce que l'agent a retenu — sans rien inventer.
 *
 * Les entrées qui feraient échouer une version fausse :
 *  - un tour EN COURS en bas du fil : le carnet garde la clôture du tour précédent au lieu de se vider ;
 *  - DEUX clôtures dans une même réponse : seule la dernière dit l'état ;
 *  - une ORIENTATION tapée pendant un tour : ce n'est pas l'objectif ;
 *  - un tour commencé AVANT la dernière visite : il n'est pas « pendant ton absence ».
 */

const user = (content: string, ts: number, extra: Record<string, unknown> = {}): Msg =>
  ({ role: 'user', content, ts, ...extra }) as Msg

const asst = (text: string, extra: Record<string, unknown> = {}): Msg =>
  ({
    role: 'assistant',
    status: 'completed',
    done: true,
    parts: [{ kind: 'text', text }],
    ...extra
  }) as unknown as Msg

const CLOTURE = [
  'Réponse.',
  '',
  '✅ Fait',
  '- notification de fin de tour',
  '- barre sur un passage',
  '📍 Maintenant : le carnet du fil',
  '⏳ Reste à faire',
  '1. idée 6',
  '2. **idée 3** (décision, `os.ts:513`)',
  '👉 Recommandé : lancer le juge'
].join('\n')

describe('lignesDuCarnet — ce que le fil a déjà écrit, rubrique par rubrique', () => {
  it('objectif, fait, maintenant, reste et recommandé viennent de la dernière clôture', () => {
    const lignes = lignesDuCarnet({ fil: [user('construis les 7 idées', 1), asst(CLOTURE)] })
    const par = (rubrique: string): string[] =>
      lignes.filter((ligne) => ligne.rubrique === rubrique).map((ligne) => ligne.texte)
    expect(par('objectif')).toEqual(['construis les 7 idées'])
    expect(par('fait')).toEqual(['notification de fin de tour', 'barre sur un passage'])
    expect(par('maintenant')).toEqual(['le carnet du fil'])
    expect(par('reste')).toEqual(['idée 6', 'idée 3 (décision, os.ts:513)'])
    expect(par('recommande')).toEqual(['lancer le juge'])
  })

  it('un tour EN COURS ne vide pas le carnet : la clôture précédente reste', () => {
    const fil = [
      user('construis', 1),
      asst(CLOTURE),
      user('continue sur l’idée 6', 2),
      // Le tour en cours a déjà commencé SA clôture : une moitié de ligne ne remplace pas l'état fini.
      asst('', {
        status: 'streaming',
        done: false,
        parts: [{ kind: 'text', text: '⏳ Reste à faire\n- en cours d’écri' }]
      })
    ]
    const reste = lignesDuCarnet({ fil }).filter((ligne) => ligne.rubrique === 'reste')
    expect(reste.map((ligne) => ligne.texte)).toEqual(['idée 6', 'idée 3 (décision, os.ts:513)'])
  })

  it('deux clôtures dans une réponse : seule la dernière compte', () => {
    const double = [
      '⏳ Reste à faire',
      '- ancien',
      '',
      'Suite.',
      '⏳ Reste à faire',
      '- récent'
    ].join('\n')
    const reste = lignesDuCarnet({ fil: [user('x', 1), asst(double)] }).filter(
      (ligne) => ligne.rubrique === 'reste'
    )
    expect(reste.map((ligne) => ligne.texte)).toEqual(['récent'])
  })

  it('une orientation tapée pendant un tour n’est pas l’objectif', () => {
    const fil = [
      user('refais la page d’accueil', 1),
      user('au fait garde le logo', 2, { orientation: true }),
      asst(CLOTURE)
    ]
    const objectif = lignesDuCarnet({ fil }).find((ligne) => ligne.rubrique === 'objectif')
    expect(objectif?.texte).toBe('refais la page d’accueil')
  })

  it('une question à choix encore ouverte en bas du fil est dite', () => {
    const question = asst('', {
      parts: [
        {
          kind: 'action',
          name: 'ask',
          ok: true,
          data: {
            question: 'Je garde l’ancien format ?',
            options: [{ libelle: 'Oui' }, { libelle: 'Non' }]
          }
        }
      ]
    })
    const lignes = lignesDuCarnet({ fil: [user('x', 1), question] })
    expect(lignes.find((ligne) => ligne.rubrique === 'question')?.texte).toBe(
      'Je garde l’ancien format ?'
    )
    // Répondue (un message de l'utilisateur après elle) : plus de question en attente.
    const repondue = lignesDuCarnet({ fil: [user('x', 1), question, user('Oui', 2)] })
    expect(repondue.some((ligne) => ligne.rubrique === 'question')).toBe(false)
  })

  it('les faits retenus et les fichiers touchés ont leurs lignes, sans doublon de fichier', () => {
    const lignes = lignesDuCarnet({
      fil: [user('x', 1)],
      retenus: [{ title: 'Décision A', body: 'on part sur A' }],
      fichiers: ['src/a.ts', 'src/b.ts', 'src/a.ts']
    })
    const retenu = lignes.find((ligne) => ligne.rubrique === 'retenu')
    expect(retenu).toMatchObject({ texte: 'Décision A — on part sur A', titreRetenu: 'Décision A' })
    expect(lignes.filter((ligne) => ligne.rubrique === 'fichier').map((l) => l.texte)).toEqual([
      'src/a.ts',
      'src/b.ts'
    ])
  })

  it('chaque ligne a une clé stable et unique : barrer l’une ne barre pas sa voisine', () => {
    const lignes = lignesDuCarnet({ fil: [user('x', 1), asst(CLOTURE)] })
    const cles = lignes.map((ligne) => ligne.cle)
    expect(new Set(cles).size).toBe(cles.length)
    expect(lignesDuCarnet({ fil: [user('x', 1), asst(CLOTURE)] }).map((l) => l.cle)).toEqual(cles)
  })

  it('un fil vide donne un carnet vide', () => {
    expect(lignesDuCarnet({ fil: [] })).toEqual([])
  })
})

describe('texteDeCorrection — ce qui part au tour suivant', () => {
  const ligne = { cle: 'reste:0', rubrique: 'reste' as const, texte: 'idée 6' }

  it('barrer : la ligne est citée et déclarée fausse', () => {
    expect(texteDeCorrection(ligne)).toBe(
      'Carnet du fil — à oublier (Reste à faire) : « idée 6 ». Ce n’est plus vrai : ne t’appuie plus dessus.'
    )
  })

  it('corriger : l’ancien texte et le nouveau', () => {
    expect(texteDeCorrection(ligne, 'idée 6, en mosaïque')).toBe(
      'Carnet du fil — correction (Reste à faire) : « idée 6 » devient « idée 6, en mosaïque ».'
    )
  })

  it('une correction vide revient à barrer', () => {
    expect(texteDeCorrection(ligne, '   ')).toBe(texteDeCorrection(ligne))
  })
})

describe('resumeDAbsence — « Pendant ton absence »', () => {
  const VUE = 1_000

  it('compte les tours commencés après la dernière visite, leurs fichiers et leur coût', () => {
    const fil = [
      user('a', 500),
      asst('ancien', { ts: 600, debutDuTour: 600, coutUsd: 9 }),
      user('b', 1_100),
      asst('nouveau 1', { ts: 1_100, debutDuTour: 1_100, coutUsd: 0.5 }),
      asst('nouveau 2', { ts: 1_200, debutDuTour: 1_200, coutUsd: 0.25 })
    ]
    const resume = resumeDAbsence({
      fil,
      vueA: VUE,
      traces: [
        { timestamp: new Date(900).toISOString(), paths: ['avant.ts'] },
        { timestamp: new Date(1_150).toISOString(), paths: ['x.ts', 'y.ts'] },
        { timestamp: new Date(1_250).toISOString(), paths: ['x.ts'] }
      ]
    })
    expect(resume).toEqual({
      tours: 2,
      fichiers: 2,
      question: false,
      coutUsd: 0.75,
      coutPartiel: false
    })
  })

  it('un coût inconnu sur un tour rend le total partiel, jamais faux', () => {
    const fil = [
      asst('n1', { ts: 1_100, debutDuTour: 1_100, coutUsd: 0.5 }),
      asst('n2', { ts: 1_200, debutDuTour: 1_200 })
    ]
    expect(resumeDAbsence({ fil, vueA: VUE, traces: [] })).toMatchObject({
      tours: 2,
      coutUsd: 0.5,
      coutPartiel: true
    })
  })

  it('rien de neuf depuis la visite, ou fil jamais ouvert : pas de carte', () => {
    const fil = [asst('ancien', { ts: 600, debutDuTour: 600 })]
    expect(resumeDAbsence({ fil, vueA: VUE, traces: [] })).toBeNull()
    expect(resumeDAbsence({ fil, vueA: undefined, traces: [] })).toBeNull()
  })

  it('un tour encore en cours ne compte pas comme fini', () => {
    const fil = [asst('', { ts: 1_100, debutDuTour: 1_100, status: 'streaming', done: false })]
    expect(resumeDAbsence({ fil, vueA: VUE, traces: [] })).toBeNull()
  })
})
