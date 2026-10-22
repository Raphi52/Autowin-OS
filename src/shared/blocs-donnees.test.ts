import { describe, expect, it } from 'vitest'
import { FORMES_DONNEES, LIGNES_TABLEAU_MAX, lireBlocDonnees } from './blocs-donnees'

/**
 * BLOCS DE DONNEES (conv-1074, 2026-10-22) : le modele n'envoie que des DONNEES (JSON), l'app fait
 * la mise en page dans le theme choisi. Une source illisible n'est jamais devinee : elle est refusee
 * avec sa raison, et le fil la montre comme du code (meme repli qu'un diagramme mermaid invalide).
 *
 * ENTREE QUI FERAIT ECHOUER UN LECTEUR TROP INDULGENT : une ligne de tableau PLUS LONGUE que ses
 * colonnes — l'accepter afficherait une cellule sans en-tete, ou la couperait sans le dire.
 */
describe('lireBlocDonnees — aw-tableau', () => {
  it('lit colonnes, lignes, tons et note', () => {
    const bloc = lireBlocDonnees(
      'aw-tableau',
      JSON.stringify({
        titre: 'Tests',
        colonnes: ['Suite', 'Résultat', 'Durée'],
        lignes: [
          ['unité', { texte: 'vert', ton: 'ok' }, 12],
          ['interface', { texte: 'rouge', ton: 'ko' }, null]
        ],
        note: 'Mesuré le 22/10.'
      })
    )
    expect(bloc).toEqual({
      forme: 'aw-tableau',
      titre: 'Tests',
      colonnes: ['Suite', 'Résultat', 'Durée'],
      lignes: [
        [{ texte: 'unité' }, { texte: 'vert', ton: 'ok' }, { texte: '12' }],
        [{ texte: 'interface' }, { texte: 'rouge', ton: 'ko' }, { texte: '' }]
      ],
      note: 'Mesuré le 22/10.'
    })
  })

  it('jumeau accepté : une ligne plus COURTE est complétée de cellules vides', () => {
    const bloc = lireBlocDonnees('aw-tableau', '{"colonnes":["A","B"],"lignes":[["seul"]]}')
    expect(bloc).toMatchObject({ lignes: [[{ texte: 'seul' }, { texte: '' }]] })
  })

  it('refuse une ligne plus LONGUE que les colonnes, en disant laquelle', () => {
    const bloc = lireBlocDonnees('aw-tableau', '{"colonnes":["A"],"lignes":[["1","2"]]}')
    expect(bloc).toEqual({ erreur: expect.stringMatching(/ligne 1/) })
  })

  it('refuse un tableau sans colonnes, ou au-delà de la borne de lignes', () => {
    expect(lireBlocDonnees('aw-tableau', '{"lignes":[]}')).toHaveProperty('erreur')
    const trop = {
      colonnes: ['A'],
      lignes: Array.from({ length: LIGNES_TABLEAU_MAX + 1 }, () => ['x'])
    }
    expect(lireBlocDonnees('aw-tableau', JSON.stringify(trop))).toEqual({
      erreur: expect.stringMatching(new RegExp(String(LIGNES_TABLEAU_MAX)))
    })
  })

  it('refuse un ton inconnu plutôt que de l’ignorer', () => {
    const bloc = lireBlocDonnees(
      'aw-tableau',
      '{"colonnes":["A"],"lignes":[[{"texte":"x","ton":"rose"}]]}'
    )
    expect(bloc).toHaveProperty('erreur')
  })
})

describe('lireBlocDonnees — aw-comparaison et aw-etapes', () => {
  it('lit les options, leurs points, leur verdict et la recommandée', () => {
    const bloc = lireBlocDonnees(
      'aw-comparaison',
      JSON.stringify({
        options: [
          {
            nom: 'Filtre',
            points: ['peu cher', 'couvre 5 endroits'],
            verdict: { texte: 'retenu', ton: 'ok' },
            recommande: true
          },
          { nom: 'Session neuve', points: ['coûte un tour sans cache'] }
        ]
      })
    )
    expect(bloc).toEqual({
      forme: 'aw-comparaison',
      options: [
        {
          nom: 'Filtre',
          points: ['peu cher', 'couvre 5 endroits'],
          verdict: { texte: 'retenu', ton: 'ok' },
          recommande: true
        },
        { nom: 'Session neuve', points: ['coûte un tour sans cache'] }
      ]
    })
  })

  it('refuse une comparaison à une seule option : ce n’est pas une comparaison', () => {
    expect(
      lireBlocDonnees('aw-comparaison', '{"options":[{"nom":"seule","points":[]}]}')
    ).toHaveProperty('erreur')
  })

  it('lit les étapes et leur statut', () => {
    const bloc = lireBlocDonnees(
      'aw-etapes',
      '{"titre":"Plan","etapes":[{"titre":"Tests rouges","statut":"fait"},{"titre":"Code","detail":"4 fichiers","statut":"en-cours"},{"titre":"Commit"}]}'
    )
    expect(bloc).toEqual({
      forme: 'aw-etapes',
      titre: 'Plan',
      etapes: [
        { titre: 'Tests rouges', statut: 'fait' },
        { titre: 'Code', detail: '4 fichiers', statut: 'en-cours' },
        { titre: 'Commit' }
      ]
    })
  })

  it('refuse un statut d’étape inconnu', () => {
    expect(
      lireBlocDonnees('aw-etapes', '{"etapes":[{"titre":"x","statut":"peut-être"}]}')
    ).toHaveProperty('erreur')
  })
})

describe('lireBlocDonnees — entrées illisibles', () => {
  it('un JSON invalide est refusé avec sa raison', () => {
    expect(lireBlocDonnees('aw-tableau', '{colonnes: [A]}')).toEqual({
      erreur: expect.stringMatching(/JSON/)
    })
  })

  it('une forme inconnue est refusée', () => {
    expect(lireBlocDonnees('aw-camembert', '{}')).toHaveProperty('erreur')
  })

  it('les trois formes annoncées sont exactement celles lues', () => {
    expect([...FORMES_DONNEES]).toEqual(['aw-tableau', 'aw-comparaison', 'aw-etapes'])
  })
})
