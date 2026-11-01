import { describe, expect, it } from 'vitest'
import { sortieFrameAvecCasLimites } from './frame-cas-limites'
import { OPTION_ARRETER } from './gates/etendue-repetee'
import {
  BORNE_CADRAGE,
  BORNE_DEMANDE,
  consigneDeLaReponse,
  consigneDeReprise,
  ligneDePanneDeRelecture,
  ligneDeRelecture,
  lireRelecture,
  promptDeRelecture,
  questionDuCadrageRepris,
  relectureAPasser
} from './relecture-froide'

describe('lireRelecture', () => {
  it('lit les écarts, sous toutes les formes rendues par les vrais modèles', () => {
    expect(
      lireRelecture(
        [
          '**2. ÉCARTS**',
          'ÉCART: tout en anglais → un premier lot',
          '- ÉCART : le test réel → un plan écrit',
          '**ÉCART:** la voix → reportée',
          '`ÉCART: le menu → non traduit`'
        ].join('\n')
      )
    ).toEqual({
      kind: 'ecarts',
      ecarts: [
        'tout en anglais → un premier lot',
        'le test réel → un plan écrit',
        'la voix → reportée',
        'le menu → non traduit'
      ]
    })
  })

  it('accepte une casse et des accents dégradés', () => {
    expect(lireRelecture('ecart: a → b')).toEqual({ kind: 'ecarts', ecarts: ['a → b'] })
    expect(lireRelecture('Écart: a → b').kind).toBe('ecarts')
  })

  it('jumeau : `ÉCARTS: aucun` est conforme, même décoré', () => {
    expect(lireRelecture('1. PARAPHRASE\nblabla\n2. ÉCARTS: aucun')).toEqual({ kind: 'conforme' })
    expect(lireRelecture('**ÉCARTS:** aucun')).toEqual({ kind: 'conforme' })
    expect(lireRelecture('ÉCART: aucun')).toEqual({ kind: 'conforme' })
    expect(lireRelecture('ÉCARTS : aucun réel')).toEqual({ kind: 'conforme' })
  })

  it('les écarts priment sur un `ÉCARTS: aucun` dans la même réponse', () => {
    expect(lireRelecture('ÉCARTS: aucun\nÉCART: a → b')).toEqual({
      kind: 'ecarts',
      ecarts: ['a → b']
    })
  })

  it('un titre `ÉCARTS :` suivi de prose n’est ni un écart ni une conformité', () => {
    expect(lireRelecture('ÉCARTS : la demande se réduit au seul mot reprend.').kind).toBe(
      'illisible'
    )
  })

  it('une réponse vide ou hors format est illisible', () => {
    expect(lireRelecture('').kind).toBe('illisible')
    expect(lireRelecture('   \n ').kind).toBe('illisible')
    expect(lireRelecture('VALIDE').kind).toBe('illisible')
  })

  it('borne le nombre et la longueur des écarts', () => {
    const issue = lireRelecture(
      Array.from({ length: 20 }, () => `ÉCART: ${'x'.repeat(900)}`).join('\n')
    )
    expect(issue.kind === 'ecarts' && issue.ecarts).toHaveLength(8)
    expect(issue.kind === 'ecarts' && issue.ecarts[0]).toHaveLength(600)
  })
})

describe('promptDeRelecture', () => {
  it('ne contient que la demande et le cadrage', () => {
    expect(promptDeRelecture(' la demande ', ' le cadrage ')).toBe(
      "=== DEMANDE D'ORIGINE ===\nla demande\n\n=== CADRAGE ===\nle cadrage"
    )
  })

  it('une demande ou un cadrage trop longs sont coupés, et le prompt le dit', () => {
    const prompt = promptDeRelecture('d'.repeat(BORNE_DEMANDE + 5), 'c'.repeat(BORNE_CADRAGE + 5))
    expect(prompt.match(/\[coupé ici/gu)).toHaveLength(2)
    expect(prompt).not.toContain('d'.repeat(BORNE_DEMANDE + 1))
    expect(prompt).not.toContain('c'.repeat(BORNE_CADRAGE + 1))
  })

  it('jumeau : pile à la borne, rien n’est coupé', () => {
    expect(promptDeRelecture('d'.repeat(BORNE_DEMANDE), 'c'.repeat(BORNE_CADRAGE))).not.toContain(
      '[coupé ici'
    )
  })
})

describe('relectureAPasser', () => {
  const etat = {
    dejaFaite: false,
    buildPrevu: true,
    cadrageJoue: true,
    arretDemande: false,
    annule: false,
    critique: true,
    cadrage: '## Besoin\nUn besoin.'
  }

  it('part sur un cadrage complet, joué, suivi d’un build', () => {
    expect(relectureAPasser(etat)).toBe(true)
  })

  it.each([
    ['déjà faite', { dejaFaite: true }],
    ['aucun build prévu', { buildPrevu: false }],
    ['cadrage repris après un redémarrage', { cadrageJoue: false }],
    ['`SUITE: fin`', { arretDemande: true }],
    ['run annulé', { annule: true }],
    ['tâche non critique', { critique: false }],
    ['cadrage vide', { cadrage: '  ' }]
  ])('ne part pas : %s', (_, ecart) => {
    expect(relectureAPasser({ ...etat, ...ecart })).toBe(false)
  })

  it('attend qu’un cadrage refusé par les cas limites soit refait', () => {
    const refuse = sortieFrameAvecCasLimites('## Besoin\nUn drapeau `--depuis`.')
    expect(relectureAPasser({ ...etat, cadrage: refuse })).toBe(false)
  })
})

describe('consigneDeReprise', () => {
  it('porte chaque écart et les trois sorties', () => {
    const consigne = consigneDeReprise(['a → b', 'c → d'])
    expect(consigne).toContain('- ÉCART: a → b')
    expect(consigne).toContain('- ÉCART: c → d')
    expect(consigne).toContain('`Écart assumé : <raison>`')
    expect(consigne).toContain('`- Question : <question>')
    expect(consigne).toContain('2 écart(s)')
  })
})

describe('questionDuCadrageRepris', () => {
  const bilan = (question: string): string =>
    `### Bilan de l’étape\n- Verdict : fait — cadrage refait.\n- Fichiers touchés : aucun\n- Preuves : aucune\n- Reste à faire : aucun reste\n- Question : ${question}`

  it('lit la question du bilan dans la forme de la fenêtre', () => {
    expect(questionDuCadrageRepris(bilan('Tout livrer d’un coup ? → Oui | Non, par lots'))).toEqual(
      {
        text: 'Tout livrer d’un coup ?',
        options: ['Oui', 'Non, par lots'],
        reason: 'material-ambiguity'
      }
    )
  })

  it('jumeau : `aucune`, un bilan absent ou une ligne mal formée ne posent rien', () => {
    expect(questionDuCadrageRepris(bilan('aucune'))).toBeUndefined()
    expect(questionDuCadrageRepris('## Besoin\nSans bilan.')).toBeUndefined()
    expect(questionDuCadrageRepris(bilan('Une question sans réponses ?'))).toBeUndefined()
  })
})

describe('consigneDeLaReponse', () => {
  it('garde une réponse, choisie ou écrite', () => {
    expect(consigneDeLaReponse(' Non, par lots ')).toBe('Non, par lots')
    expect(consigneDeLaReponse(OPTION_ARRETER)).toBe(OPTION_ARRETER)
  })

  it('jumeau : sans réponse ou fenêtre fermée, rien n’est transmis', () => {
    expect(consigneDeLaReponse(undefined)).toBeUndefined()
    expect(consigneDeLaReponse('   ')).toBeUndefined()
    expect(consigneDeLaReponse('attend pour l’instant')).toBeUndefined()
  })
})

describe('les lignes de trace', () => {
  it('disent le résultat, les écarts et le coût', () => {
    expect(ligneDeRelecture({ kind: 'conforme' }, 0.0412)).toBe(
      'Relecture à froid du cadrage : aucun écart (0.0412 $).'
    )
    expect(ligneDeRelecture({ kind: 'illisible' }, undefined)).toContain('coût inconnu')
    const ligne = ligneDeRelecture({ kind: 'ecarts', ecarts: ['a → b', 'c → d'] }, 0.06)
    expect(ligne).toContain('2 écart(s)')
    expect(ligne).toContain('a → b ; c → d')
  })

  it('une panne se dit et borne son message', () => {
    expect(ligneDePanneDeRelecture(new Error('x'.repeat(900))).length).toBeLessThan(400)
    expect(ligneDePanneDeRelecture('texte')).toContain('texte')
  })
})
