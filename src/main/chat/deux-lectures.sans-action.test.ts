import { describe, expect, it } from 'vitest'
import { demandeSansAction } from './deux-lectures'

// Tri AVANT le tour : une demande purement interrogative part sur le modèle léger ; tout doute
// reste sur le modèle du chat. Le faux négatif coûte de l'argent, le faux positif coûte une action
// faite par un modèle plus faible : on penche donc vers le modèle du chat.
describe('demandeSansAction', () => {
  it.each([
    'Comment fonctionne le cache de prompt dans Autowin ?',
    'Pourquoi le test échoue-t-il sur le dossier conv-1725 ?',
    'Quel est le prix de Haiku 5.5 au-delà de 100 000 jetons ?',
    'Combien de tours ont coûté plus de 5 dollars la semaine dernière ?',
    'Explique la différence entre les deux lectures',
    'Le bouton de la page accueil est où ?',
    'Peux-tu me résumer ce fichier ?',
    'Peux-tu lire le journal de ce tour ?',
    'Peux-tu lister les runs bloqués ?',
    'Tu peux expliquer la différence ?',
    'Peux-tu comparer les deux colonnes ?',
    'Est-ce que le cache est en 1 h ?',
    'Qu’est-ce que le cache de prompt ?'
  ])('une question pure passe sur le modèle léger : %s', (demande) => {
    expect(demandeSansAction(demande)).toBe(true)
  })

  it.each([
    // Cas relevés par le juge : une demande d'action tournée en question partait sur Haiku.
    'Peux-tu écrire un résumé dans NOTES.md ?',
    'Peux-tu exécuter le build ?',
    'Peux-tu déplacer ce fichier dans src/shared ?',
    'Peux-tu envoyer le message au fil conv-1725 ?',
    'Peux-tu merger la branche ?',
    'Peux-tu me supprimer ce brouillon ?',
    'Pourrais-tu éditer le README ?',
    'Tu peux copier ça ailleurs ?',
    'Peux-tu rebaser la branche ?',
    'Peux-tu compiler le projet ?',
    'Est-ce que tu peux installer le paquet ?',
    'Peux-tu lire le journal et corriger l’erreur ?',
    // Une question sans verbe de lecture ni mot interrogatif : le doute reste sur le modèle du chat.
    'Et si on passait ça en prod ?',
    'Corrige le bouton de la page accueil',
    'Tu peux corriger ça ?',
    'Ajoute un test pour le cache ?',
    'lance un scout sur les gels',
    'Fais un commit de ce travail',
    'Montre-moi la vue des runs',
    '/build le coût du chat',
    'ok',
    '',
    undefined
  ])(
    'une demande d’action, une commande ou une relance reste sur le modèle du chat : %s',
    (demande) => {
      expect(demandeSansAction(demande)).toBe(false)
    }
  )
})
