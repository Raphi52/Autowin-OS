import { describe, expect, it } from 'vitest'
import { closingTurnDelivery, resteADire } from './turn-closing'

/**
 * LE MEME TEXTE, A UN SAUT DE LIGNE PRES, ETAIT PUBLIE UNE SECONDE FOIS.
 *
 * MESURE le 2026-10-11 sur `conv-234` (tour 8788916c, /draft du graphe de la demande). Le tour a
 * parle entre ses outils, puis a rendu une galerie `html-render` derriere une question `ask`. Le
 * texte deja affiche (deltas recolles) portait « …telle quelle.\n\nJ'ai fait 6 directions » ; le
 * texte de cloture, rebati par `.join('')` des morceaux une fois la commande retiree, portait
 * « …telle quelle.J'ai fait 6 directions ». Sans les blancs, les deux textes etaient IDENTIQUES
 * (34 967 caracteres chacun) ; avec, ni `startsWith` ni `includes` ne les reconnaissaient, et la
 * garde publiait les 37 970 caracteres une seconde fois. Le fil a affiche la galerie DEUX fois,
 * avec les memes identifiants d'onglets : les onglets de la seconde copie pilotaient la premiere,
 * et l'utilisateur ne voyait plus aucune proposition (« le renderer a bugge »).
 */
const AFFICHE =
  'Je contrôle la galerie.\n\nContrôle vert. Je récupère la version finale.' +
  '\n\nJ’ai fait 6 directions.\n\n```html-render\n<div class="w">galerie</div>\n```\n\n✅ Fait\n1. Galerie.'
const CLOTURE_SOUDEE =
  'Je contrôle la galerie.\n\nContrôle vert. Je récupère la version finale.' +
  'J’ai fait 6 directions.\n\n```html-render\n<div class="w">galerie</div>\n```\n\n✅ Fait\n1. Galerie.'

describe('cloture identique au texte affiche, aux blancs pres', () => {
  it('ne republie RIEN quand seuls les blancs d une jointure different (conv-234)', () => {
    expect(resteADire(CLOTURE_SOUDEE, AFFICHE)).toBe('')
    expect(closingTurnDelivery('t1', CLOTURE_SOUDEE, AFFICHE)).toBeUndefined()
  })

  it('ne publie que la SUITE quand la cloture prolonge le texte affiche, blancs differents', () => {
    const suite = '👉 Recommandé\nRien de plus.'
    expect(resteADire(`${CLOTURE_SOUDEE}\n\n${suite}`, AFFICHE)).toBe(suite)
  })

  it('publie toujours un texte final vraiment NEUF', () => {
    const neuf = 'Autre chose : le test passe.'
    expect(resteADire(neuf, AFFICHE)).toBe(neuf)
  })
})
