import { describe, expect, it } from 'vitest'
import { normaliserReponsesAsk } from './ask-options'

describe('normaliserReponsesAsk — le contrat elargi accepte l’ancienne forme sans la privilegier', () => {
  it('accepte les chaines nues et les rend en libelles seuls', () => {
    expect(normaliserReponsesAsk(['Oui', '  Non  '])).toEqual([
      { libelle: 'Oui' },
      { libelle: 'Non' }
    ])
  })

  it('garde le libelle, la consequence, la marque et le detail', () => {
    const reponses = normaliserReponsesAsk([
      {
        libelle: 'Les deux correctifs',
        consequence: 'Couvre les deux causes.',
        recommande: true,
        detail: {
          fait: 'Rend le serveur silencieux',
          neReglePas: 'La moitie serveur reste hors dépôt'
        },
        envoi: 'applique les deux correctifs'
      }
    ])
    expect(reponses[0]).toEqual({
      libelle: 'Les deux correctifs',
      consequence: 'Couvre les deux causes.',
      recommande: true,
      detail: {
        fait: 'Rend le serveur silencieux',
        neReglePas: 'La moitie serveur reste hors dépôt'
      },
      envoi: 'applique les deux correctifs'
    })
  })

  it('deux « recommande » ne recommandent rien : seule la premiere garde la marque', () => {
    const reponses = normaliserReponsesAsk([
      { libelle: 'A', recommande: true },
      { libelle: 'B', recommande: true },
      { libelle: 'C' }
    ])
    expect(reponses.map((option) => option.recommande)).toEqual([true, undefined, undefined])
    // L'option n'est pas perdue au passage : seule sa marque tombe.
    expect(reponses.map((option) => option.libelle)).toEqual(['A', 'B', 'C'])
  })

  it('laisse tomber ce qui n’est pas exploitable, sans jeter le reste', () => {
    expect(normaliserReponsesAsk([{ libelle: '   ' }, 42, null, { libelle: 'Vrai' }])).toEqual([
      { libelle: 'Vrai' }
    ])
    expect(normaliserReponsesAsk('a, b')).toEqual([])
  })

  it('plafonne a quatre reponses et borne les longueurs', () => {
    const long = 'x'.repeat(500)
    const reponses = normaliserReponsesAsk([
      { libelle: long, consequence: long },
      'b',
      'c',
      'd',
      'e'
    ])
    expect(reponses).toHaveLength(4)
    expect(reponses[0].libelle).toHaveLength(200)
    expect(reponses[0].consequence).toHaveLength(400)
  })

  it('un detail entierement vide ne produit pas de dépliable fantome', () => {
    const reponses = normaliserReponsesAsk([
      { libelle: 'A', detail: { fait: '  ' } },
      { libelle: 'B' }
    ])
    expect(reponses[0].detail).toBeUndefined()
  })
})
