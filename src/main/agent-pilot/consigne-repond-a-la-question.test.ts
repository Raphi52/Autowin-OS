import { describe, expect, it } from 'vitest'
import { consigneRepondALaQuestion } from './consigne-repond-a-la-question'

// La forme de la question réellement posée quand un ajustement sur la vidéo l'a fait disparaître.
const hebergement = {
  question: "Comment donner accès à l'appli aux responsables ?",
  options: [
    '1. Réseau interne seulement (destinataires internes)',
    "2. Internet depuis mon PC (j'ai l'accord pour le client)",
    '3. Serveur à part avec données anonymisées',
    "4. Pas d'hébergement : proposer une démo en visio dans le mail"
  ]
}

describe('consigne arrivée pendant le tour face à la question du tour', () => {
  it('un ajustement sans rapport n’est pas une réponse', () => {
    expect(
      consigneRepondALaQuestion(
        'dans la video elle doit prononcer le nom du logiciel d’un seul mot',
        hebergement
      )
    ).toBe(false)
    expect(consigneRepondALaQuestion('mets la 2e version de la vidéo', hebergement)).toBe(false)
    expect(consigneRepondALaQuestion('ajoute aussi le mail', hebergement)).toBe(false)
  })

  it('le texte d’un bouton cliqué pendant que le tour finit est une réponse', () => {
    expect(consigneRepondALaQuestion(hebergement.options[1], hebergement)).toBe(true)
    const avecEnvoi = {
      question: 'Lequel ?',
      options: [{ libelle: 'Rapide', envoi: 'Fais la version rapide' }]
    }
    expect(consigneRepondALaQuestion('Fais la version rapide', avecEnvoi)).toBe(true)
  })

  it('un numéro, un fragment de libellé ou une forme de choix est une réponse', () => {
    expect(consigneRepondALaQuestion('2', hebergement)).toBe(true)
    expect(consigneRepondALaQuestion('plutôt la 2', hebergement)).toBe(true)
    expect(consigneRepondALaQuestion('Option 4.', hebergement)).toBe(true)
    expect(consigneRepondALaQuestion('internet depuis mon pc', hebergement)).toBe(true)
    expect(
      consigneRepondALaQuestion('Les deux', { question: 'Lequel ?', options: ['A', 'B'] })
    ).toBe(true)
    expect(consigneRepondALaQuestion('B', { question: 'Lequel ?', options: ['A', 'B'] })).toBe(true)
    expect(consigneRepondALaQuestion('la première', hebergement)).toBe(true)
  })

  it('un numéro hors des options n’est pas une réponse', () => {
    expect(consigneRepondALaQuestion('7', hebergement)).toBe(false)
  })

  it('sans option, rien ne prouve que la consigne réponde : la question reste affichée', () => {
    expect(consigneRepondALaQuestion('oui', { question: 'On continue ?' })).toBe(false)
  })

  it('plusieurs consignes : une seule qui désigne une option suffit', () => {
    expect(consigneRepondALaQuestion('corrige la vidéo / la 3', hebergement)).toBe(true)
  })
})
