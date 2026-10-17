import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * /draft EN VOLUME : LA SCENE 3D VA DANS LE CARROUSEL, PAS AU-DESSUS.
 *
 * Demande utilisateur, conv-318 (2026-10-17, tour 5b0c4fcb-e354-410e-99b6-567740e86db1, saisie ts
 * 2026-10-17T15:40:06.421Z) : « le bloc 3d doit etre dans le bloc draft », capture a l'appui du /draft
 * de conv-315 (tour a6fcfb6e-c5ce-41c9-86c8-dcde195c67f2) : une scene ```threejs avec ses propres
 * boutons 0 a 6, puis, dessous, le carrousel de fiches. La procedure le prescrivait (« les scenes
 * restent au-dessus et le carrousel vient dessous », commit d0d5f656). Depuis, le carrousel porte la
 * scene (champ `scene3d` de scripts/draft-carrousel.mjs) et le fil la monte dans sa place.
 */
const SKILL = readFileSync(join(__dirname, '..', '..', 'skills', 'draft', 'SKILL.md'), 'utf8')
const regle = SKILL.split('\n').find((ligne) => ligne.includes('BLOC DE CHOIX, À CHAQUE FOURNÉE'))

describe('procédure /draft : la scène 3D dans le carrousel', () => {
  it('met la scène DANS le carrousel, par son champ scene3d, et la fait suivre le choix', () => {
    expect(regle, 'paragraphe « BLOC DE CHOIX, À CHAQUE FOURNÉE » absent').toBeTruthy()
    expect(regle).toMatch(/`scene3d`/)
    expect(regle).toMatch(/autowin\.surChoix/)
    expect(regle).toMatch(/DANS le carrousel/)
    expect(regle).toMatch(/scene-3d-apercu\.mjs/)
  })

  it('ne prescrit plus deux blocs séparés, scène au-dessus et carrousel dessous', () => {
    expect(regle).not.toMatch(/restent au-dessus/)
    expect(regle).not.toMatch(/carrousel vient dessous/)
  })

  it('la ligne « sujet en VOLUME » des moteurs ne contredit pas le paragraphe de choix', () => {
    // Elle prescrivait « un bloc ```threejs par variante (ou une scène à plusieurs vues) » : c'est
    // elle qui a produit, dans conv-315, une scène à boutons 0 à 6 posée AU-DESSUS du carrousel.
    const ligneVolume = SKILL.split('\n').find((ligne) => ligne.startsWith('| **sujet en VOLUME**'))
    if (!ligneVolume) return
    expect(ligneVolume).not.toMatch(/un bloc ```threejs par variante \(/)
    expect(ligneVolume).toMatch(/`scene3d`/)
  })
})
