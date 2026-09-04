import { describe, expect, it } from 'vitest'
import { estPromptDePublication, PROMPT_SALVAGE } from './prompt-suivant'

/*
 * LA BOUCLE SANS FIN DU 2026-09-04 (conv-288), vecue TROIS TOURS D'AFFILEE.
 *
 * L'utilisateur envoie `/salvage`. Le tri est fait de bout en bout : toutes les cachettes sondees,
 * chaque travail juge par son contenu, les verdicts enregistres. La seule suite qui reste est de
 * publier. Ce prompt de publication etait alors REECRIT en `/salvage`. L'utilisateur renvoie ce que
 * le champ lui propose, le tri est refait, ne trouve rien, propose de publier. La boucle est
 * parfaite et ne se termine jamais.
 *
 * Le garde-fou relisait le prompt SORTANT sans jamais regarder la demande ENTRANTE. Quand cette
 * demande EST l'ordre de tri, le tri a eu lieu dans ce tour meme : exiger qu'il soit refait avant de
 * publier, c'est exiger l'impossible.
 *
 * Les deux bords comptent, et les deux sont testes ici : la boucle doit mourir, et le garde-fou doit
 * garder tout son mordant quand le tri n'a PAS eu lieu — sinon on aurait remplace une boucle par une
 * publication aveugle par-dessus du travail existant.
 */
describe('le garde-fou de publication ne rejoue pas un tri deja fait', () => {
  const PUBLIER = 'Pousse les 6 commits locaux sur le depot distant.'

  it('la demande du tour ETAIT le tri : la publication proposee passe telle quelle', () => {
    expect(estPromptDePublication(PUBLIER, PROMPT_SALVAGE)).toBe(false)
    expect(estPromptDePublication(PUBLIER, '/salvage')).toBe(false)
    expect(estPromptDePublication(PUBLIER, '/salvage tout et remet moi sur main')).toBe(false)
  })

  it('sans tri dans le tour, le garde-fou mord toujours', () => {
    expect(estPromptDePublication(PUBLIER)).toBe(true)
    expect(estPromptDePublication(PUBLIER, 'corrige le bouton stop')).toBe(true)
    expect(estPromptDePublication('Ouvre une pull request', 'agrandis la police')).toBe(true)
  })

  it('une demande vide ou absente ne desarme rien', () => {
    expect(estPromptDePublication(PUBLIER, '')).toBe(true)
    expect(estPromptDePublication(PUBLIER, undefined)).toBe(true)
  })
})
