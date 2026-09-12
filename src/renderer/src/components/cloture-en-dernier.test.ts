import { describe, expect, it } from 'vitest'
import { clotureEnDernier } from './cloture-en-dernier'

/**
 * DEMANDE DE L'UTILISATEUR (2026-09-12, capture a l'appui) : « le bloc Fait, c'est ce qui doit
 * apparaitre en dernier ».
 *
 * Ce qui se passait : le modele peut emettre une action (ici un depot de lecon) APRES avoir ecrit
 * sa cloture, puis une derniere phrase. L'affichage suit l'ordre d'emission, donc le cadre de
 * cloture — le resume qu'on lit en premier d'un coup d'oeil — se retrouvait ENTERRE au milieu du
 * message, avec une carte d'action et du texte en dessous.
 *
 * Regle posee : dans un message TERMINE, le morceau qui porte le bloc de cloture passe en dernier.
 * L'ordre relatif de tout le reste est conserve : on deplace, on ne masque rien.
 */
const texte = (text: string): { kind: 'text'; text: string } => ({ kind: 'text', text })
const action = (nom: string): { kind: 'tool'; name: string } => ({ kind: 'tool', name: nom })

const CLOTURE = [
  '✅ Fait — le correctif est en place.',
  '📍 Maintenant — code modifie.',
  '⏳ Reste à faire — aucune limite connue.',
  '👉 Recommandé — relancer un clic.'
].join('\n')

describe('le bloc de cloture s affiche en dernier', () => {
  it('deplace en fin le morceau qui porte la cloture', () => {
    const parts = [texte('Voici le diagnostic.'), texte(CLOTURE), action('remember'), texte('Fini.')]
    const rendu = clotureEnDernier(parts)
    expect(rendu.map((part) => (part.kind === 'text' ? part.text : part.name))).toEqual([
      'Voici le diagnostic.',
      'remember',
      'Fini.',
      CLOTURE
    ])
  })

  it('ne touche a rien quand la cloture est deja le dernier morceau', () => {
    const parts = [texte('Diagnostic.'), action('verify'), texte(CLOTURE)]
    expect(clotureEnDernier(parts)).toEqual(parts)
  })

  it('ne touche a rien quand aucun bloc de cloture n est ecrit', () => {
    const parts = [texte('Une reponse courte.'), action('read_file')]
    expect(clotureEnDernier(parts)).toEqual(parts)
  })

  it('ne deplace que le DERNIER bloc de cloture quand le message en porte deux', () => {
    const parts = [texte(CLOTURE), texte('Suite du travail.'), texte(`${CLOTURE}\n\nvoila`)]
    const rendu = clotureEnDernier(parts)
    expect(rendu[rendu.length - 1]).toEqual(texte(`${CLOTURE}\n\nvoila`))
    expect(rendu).toHaveLength(3)
  })
})
