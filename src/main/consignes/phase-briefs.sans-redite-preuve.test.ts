import { describe, expect, it } from 'vitest'
import { PHASE_BRIEFS } from './phase-briefs'

// Le brief BUILD exigeait deux fois la meme chose dans le meme texte : « sa preuve HORS-MODELE
// ... jamais une auto-declaration » (Livrable) puis « ne dis "fait" que preuve a l'appui »
// (Gardes). Le reflexe 2 de la constitution, injecte dans le meme appel, le dit une 3e fois.
describe('brief build : la regle « prouver avant de dire fait » n y figure qu une fois', () => {
  it('ne redit pas « preuve à l\'appui » apres le Livrable', () => {
    const b = PHASE_BRIEFS.build
    expect(b).toContain('preuve HORS-MODÈLE')
    expect(b).not.toContain("preuve à l'appui")
  })
  it('garde la regle « si bloqué, dis bloqué »', () => {
    expect(PHASE_BRIEFS.build).toContain('si bloqué, dis "bloqué"')
  })
})
