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
    // Chaque motif CALCULÉ est POUSSÉ — une sortie par état du verdict. L'ancien compte du préfixe
    // `detail: motif` (2) attrapait aussi le `motif` de « Réparation interrompue » ajouté par
    // 82522eec (2026-09-15) et rougissait sans défaut (conv-770, 2026-09-28).
    const calcules = [
      ...orchestrateur.matchAll(
        /const (\w+) = motifChaineApresJugeNonJouee\(\{[^}]*gateBloque: (true|false)/g
      )
    ]
    expect(calcules.map((appel) => appel[2]).sort()).toEqual(['false', 'true'])
    for (const [, variable] of calcules)
      expect(orchestrateur).toContain(
        `if (${variable}) push({ step: 'gate', role: 'gate', detail: ${variable} })`
      )
  })
})
