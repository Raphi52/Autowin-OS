import { describe, expect, it } from 'vitest'
import { groupAssistantActivity, type ChatPart } from './chat-view-model'

/**
 * La DECISION se lit apres le compte rendu, pas avant.
 *
 * Le modele appelle `ask` AVANT d'ecrire sa cloture : dans l'ordre du flux, les reponses cliquables
 * arrivaient donc AU-DESSUS du « ce qui est fait / ce qu'il reste ». L'utilisateur devait choisir
 * avant d'avoir lu de quoi choisir. L'ordre de PRODUCTION et l'ordre de LECTURE sont opposes ici.
 */
const questionCliquable = (question: string): ChatPart =>
  ({
    kind: 'action',
    name: 'ask',
    ok: true,
    data: {
      question,
      options: [{ libelle: 'Oui' }, { libelle: 'Non' }]
    }
  }) as unknown as ChatPart

const texte = (contenu: string): ChatPart => ({ kind: 'text', text: contenu })

describe('groupAssistantActivity — la question cliquable ferme le message', () => {
  it('descend la décision SOUS le compte rendu écrit après elle', () => {
    const blocks = groupAssistantActivity([
      texte('Voici ce que j’ai fait.'),
      questionCliquable('On pousse ?'),
      texte('✅ Fait\n1. le correctif\n\n⏳ Reste à faire — pousser')
    ])
    expect(blocks.map((bloc) => bloc.kind)).toEqual(['text', 'text', 'ask-decision'])
  })

  it('ne bouge pas une décision déjà en dernier', () => {
    const blocks = groupAssistantActivity([
      texte('Rapport complet.'),
      questionCliquable('On pousse ?')
    ])
    expect(blocks.map((bloc) => bloc.kind)).toEqual(['text', 'ask-decision'])
  })

  it('deux questions gardent leur ordre relatif, seule la dernière ferme', () => {
    const blocks = groupAssistantActivity([
      questionCliquable('Première ?'),
      texte('Un mot entre les deux.'),
      questionCliquable('Seconde ?'),
      texte('Le compte rendu final.')
    ])
    expect(blocks.map((bloc) => bloc.kind)).toEqual([
      'ask-decision',
      'text',
      'text',
      'ask-decision'
    ])
    const derniere = blocks.at(-1)
    expect(derniere?.kind === 'ask-decision' && derniere.decision.question).toBe('Seconde ?')
  })

  it('un message sans décision est laissé intact', () => {
    // Deux textes consécutifs sont FUSIONNES par `coalesceAssistantParts` — comportement existant,
    // anterieur au deplacement de la decision. Une premiere version de ce test attendait deux blocs
    // et tombait pour cette raison.
    const blocks = groupAssistantActivity([texte('Analyse.'), texte('Conclusion.')])
    expect(blocks.map((bloc) => bloc.kind)).toEqual(['text'])
  })
})
