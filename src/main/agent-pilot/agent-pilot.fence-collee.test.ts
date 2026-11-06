import { describe, expect, it } from 'vitest'
import { detacherFenceCollee } from './agent-pilot'

/**
 * CE QUE CES TESTS PROUVENT : un bloc `html-render` dont la fence est SOUDEE a la fin de la phrase
 * precedente redevient rendable, et une simple MENTION de fence en prose ne devient jamais un bloc.
 *
 * DEFAUT VECU (conv-8, 2026-09-03) : l'utilisateur signale « le html ne s'est pas render ». Le
 * journal du tour porte un seul delta de 4 925 caracteres contenant
 * « …est bien branchee.```html-render\n<!doctype html> ». CommonMark exige une fence en DEBUT de
 * ligne : les 4 900 caracteres de HTML ont ete affiches en prose. `DeltaCollageTracker` ne regarde
 * que la jointure ENTRE deux deltas — le collage etait deja a l'interieur d'un delta unique.
 *
 * ENTREE QUI FAIT ECHOUER CES TESTS SI LA CORRECTION EST FAUSSE : le texte exact du journal. Sans
 * `detacherFenceCollee`, la fence reste en milieu de ligne et le premier test tombe rouge.
 */
describe('detacherFenceCollee', () => {
  it('detache la fence soudee a la phrase precedente (texte reel du journal conv-8)', () => {
    const recu = "pour confirmer que la session en cours est bien branchee.```html-render\n<!doctype html>\n```"
    const repare = detacherFenceCollee(recu)
    expect(repare).toContain('branchee.\n\n```html-render\n')
    // La fence est desormais en DEBUT de ligne : c'est la seule condition que CommonMark exige.
    expect(repare.split('\n').some((ligne) => ligne === '```html-render')).toBe(true)
  })

  it('ne touche PAS une mention de fence en prose (le prompt de chat en contient)', () => {
    const prose = 'prefere un bloc ferme ```html-render contenant une mini-page autonome.'
    expect(detacherFenceCollee(prose)).toBe(prose)
  })

  it('ne touche PAS une fence deja en debut de ligne', () => {
    const correct = 'Voici :\n\n```html-render\n<p>a</p>\n```'
    expect(detacherFenceCollee(correct)).toBe(correct)
  })

  it("ne touche pas un ``` qui est du CONTENU a l'interieur d'une fence ouverte", () => {
    const dedans = '```md\nexemple : ecris ceci```html-render\n```'
    expect(detacherFenceCollee(dedans)).toBe(dedans)
  })

  it('laisse intact un texte sans aucune fence', () => {
    const simple = 'Aucune fence ici, juste du texte.'
    expect(detacherFenceCollee(simple)).toBe(simple)
  })
})
