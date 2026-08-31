import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { motifChaineApresJugeNonJouee } from './workflow-walk'

describe('motif de non-jeu de la chaine apres-juge', () => {
  it('ne dit rien quand la chaine a bien ete jouee', () => {
    expect(
      motifChaineApresJugeNonJouee({ noeudsDeclares: ['learn-1'], gateBloque: false })
    ).toBeUndefined()
  })

  it('distingue le verdict non vert du profil sans learn', () => {
    expect(motifChaineApresJugeNonJouee({ noeudsDeclares: ['learn-1'], gateBloque: true })).toContain(
      'verdict non vert'
    )
    expect(motifChaineApresJugeNonJouee({ noeudsDeclares: [], gateBloque: false })).toContain(
      'aucun noeud learn declare'
    )
    expect(motifChaineApresJugeNonJouee({ noeudsDeclares: [], gateBloque: true })).toContain(
      'verdict non vert ET aucun noeud learn'
    )
  })

  it("est POUSSE dans la trace par l'orchestrateur, sur les deux sorties", () => {
    const orchestrateur = readFileSync('src/main/orchestrator.ts', 'utf8')
    expect(orchestrateur).toContain('motifChaineApresJugeNonJouee({')
    expect(orchestrateur).toContain('gateBloque: true')
    expect(orchestrateur).toContain('gateBloque: false')
    expect(orchestrateur.match(/push\(\{ step: 'gate', role: 'gate', detail: motif/g)?.length).toBe(2)
  })
})
