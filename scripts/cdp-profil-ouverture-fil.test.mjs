import { describe, expect, it } from 'vitest'
import { classerProfil } from './cdp-profil-ouverture-fil.mjs'

/*
 * Le classement du profil CPU (conv-1055) : c'est lui qui a nommé `mesurer` de ThinkingBlock.tsx
 * comme premier poste de l'ouverture d'un long fil. Un temps PROPRE mal compté accuserait
 * l'appelant au lieu de la fonction qui travaille.
 */
const profil = {
  nodes: [
    { id: 1, callFrame: { functionName: '(root)', url: '', lineNumber: -1 } },
    {
      id: 2,
      callFrame: {
        functionName: '',
        url: 'http://localhost:5173/src/components/ThinkingBlock.tsx?t=1',
        lineNumber: 193
      }
    },
    {
      id: 3,
      callFrame: {
        functionName: 'mesurer',
        url: 'http://localhost:5173/src/components/JugesPanel.tsx',
        lineNumber: 183
      }
    }
  ],
  samples: [2, 2, 3, 2, 1],
  timeDeltas: [1000, 2000, 500, 1000, 250]
}

describe('classerProfil — temps propre par fonction et par fichier', () => {
  it('additionne les échantillons par fonction (fichier:ligne lisible, sans origine ni ?t=)', () => {
    const c = classerProfil(profil)
    expect(c.parFonction[0]).toEqual({
      nom: '(anonyme) src/components/ThinkingBlock.tsx:194',
      ms: 4
    })
    expect(c.parFonction[1]).toEqual({ nom: 'mesurer src/components/JugesPanel.tsx:184', ms: 1 })
    expect(c.parFichier[0]).toEqual({ nom: 'src/components/ThinkingBlock.tsx', ms: 4 })
  })

  it('le total couvre tous les échantillons, racine comprise', () => {
    expect(classerProfil(profil).totalMs).toBe(5)
  })
})
