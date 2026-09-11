import { describe, expect, it } from 'vitest'
import {
  estPromptDePublication,
  publicationJamaisDemandee,
  PROMPT_SALVAGE
} from './prompt-suivant'

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

/*
 * LE HARCELEMENT A PUBLIER DU 2026-09-10 (conv-410). L'utilisateur demande le retrait d'un bouton
 * sur un projet tiers ; la cloture invente une publication ; l'application la reecrit en `/salvage`.
 * Reponse : « j'ai pas de git arrete de me casser les couilles pour publier ». Quand la demande
 * entrante ne parle PAS de publier, la bonne suite n'est ni publier ni trier : c'est aucune suite.
 */
describe('une publication que personne n a demandee ne propose rien', () => {
  const PUBLIER = 'Pousse les 6 commits locaux sur le depot distant.'

  it('demande sans rapport avec la publication : aucune suite', () => {
    expect(publicationJamaisDemandee(PUBLIER, 'enleve le bouton historique vged')).toBe(true)
    expect(publicationJamaisDemandee(PUBLIER, 'agrandis la police')).toBe(true)
    // Demande inconnue = aucune information : l'ancien garde-fou reste, on ne supprime rien.
    expect(publicationJamaisDemandee(PUBLIER, undefined)).toBe(false)
  })

  it('l utilisateur veut publier : le tri garde son mordant, rien n est desarme', () => {
    expect(publicationJamaisDemandee(PUBLIER, 'commit et push tout ca')).toBe(false)
    expect(estPromptDePublication(PUBLIER, 'commit et push tout ca')).toBe(true)
  })

  it('le tri vient d avoir lieu : ce n est pas une publication non demandee', () => {
    expect(publicationJamaisDemandee(PUBLIER, PROMPT_SALVAGE)).toBe(false)
  })

  it('une suite qui n est pas une publication n est jamais touchee', () => {
    expect(publicationJamaisDemandee('Lance les tests de saisie', 'corrige le bouton')).toBe(false)
  })
})
