import { beforeEach, describe, expect, it } from 'vitest'
import {
  calculerBlocsAvecReprise,
  decouperMarkdownSansReprise,
  oublierRepriseMarkdown
} from './Markdown'

/*
 * DEFAUT MESURE le 2026-09-05 (conv-303) : pendant le streaming, le message est REANALYSE EN ENTIER
 * a chaque lot de texte recu. Sur le plus long message reel du depot (76 ko), 14 ms si on l'analyse
 * une fois, 1500 ms en 195 analyses successives — 107 fois plus. Cote journal : 115 s de fenetre
 * morte cote interface pour la seule journee du 04/09.
 *
 * La reprise incrementale ne vaut QUE si elle rend le meme decoupage que l'analyse complete. C'est
 * ce que ce fichier interdit de casser : un gain de vitesse qui change l'affichage n'est pas un
 * gain, c'est un bug.
 */


beforeEach(() => oublierRepriseMarkdown())

describe('rendu du chat — la reprise incrementale ne change pas le decoupage', () => {
  const CAS: Array<[string, string]> = [
    ['prose simple', 'Bonjour.\n\nUne deuxieme ligne.'],
    [
      'un bloc de code FERME puis de la prose',
      'Avant.\n\n```js\nconst a = 1\n```\n\nApres le bloc.'
    ],
    [
      'DEUX blocs fermes — le premier fige, le second aussi',
      'Un.\n\n```sh\nls\n```\n\nDeux.\n\n```py\nprint(1)\n```\n\nFin.'
    ],
    ['CAS LIMITE — une fence encore OUVERTE ne fige rien', 'Debut.\n\n```js\nconst a = 1'],
    ['CAS LIMITE — texte vide', ''],
    ['CAS LIMITE — que du code, sans prose', '```\nrien\n```']
  ]

  for (const [nom, texte] of CAS) {
    it(`rend le meme decoupage qu'une analyse complete : ${nom}`, () => {
      const reference = decouperMarkdownSansReprise(texte)
      // On rejoue le texte lot par lot : c'est exactement ce que fait le streaming.
      oublierRepriseMarkdown()
      let dernier = calculerBlocsAvecReprise('')
      for (let n = 1; n <= texte.length; n += 7) {
        dernier = calculerBlocsAvecReprise(texte.slice(0, n))
      }
      dernier = calculerBlocsAvecReprise(texte)
      expect(dernier).toEqual(reference)
    })
  }

  it('CAS LIMITE — un texte qui NE PROLONGE PAS le precedent repart d’une analyse complete', () => {
    decouperMarkdownSansReprise('Un.\n\n```js\na\n```\n\nsuite')
    const autre = 'Rien a voir.\n\n```py\nb\n```\n'
    expect(decouperMarkdownSansReprise(autre)).toEqual(decouperMarkdownSansReprise(autre))
  })
})
