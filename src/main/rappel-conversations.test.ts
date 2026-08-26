import { describe, expect, it } from 'vitest'
import { rappelDesEchangesPasses } from './rappel-conversations'
import { ConversationStore } from './store/conversations'

/**
 * L'OMNISCIENCE NE DOIT PAS DEPENDRE D'UN CHOIX.
 *
 * Les volets precedents ont donne a l'orchestrateur de quoi chercher (`conversation_search`) et de
 * quoi relire (`conversation_read`, `retrospective`). Restait une faille que ces outils ne peuvent
 * pas fermer : rien ne garantit que le modele PENSE a les appeler. Or il ne sait pas qu'il ignore
 * quelque chose -- « remake les pastilles de couleurs » se lit comme une demande complete.
 *
 * Un agent qui ne sait pas qu'il lui manque une information ne va pas la chercher. Attendre qu'il
 * s'en avise, c'est reconduire conv-1407 en esperant mieux.
 *
 * Le tour porte donc DEJA le rappel. Le bloc de contexte existait -- il etait rempli de bruit AST
 * (`.all()`, `.constructor()`) : la place etait la, mal employee.
 *
 * BORNES, parce qu'un rappel qui noie vaut le bruit qu'il remplace :
 *  - une demande LONGUE se suffit a elle-meme, elle ne declenche rien ;
 *  - la conversation COURANTE est exclue (le modele l'a deja) ;
 *  - le volume est plafonne.
 *
 * ENTREE QUI DOIT FAIRE ECHOUER CE TEST SI LA BORNE EST FAUSSE : une demande longue et explicite qui
 * declencherait quand meme un rappel. Le dernier cas la garde.
 */

function corpus(): ConversationStore {
  let horloge = 1000
  const store = new ConversationStore(() => horloge++)
  const a = store.create({ title: 'Code couleur', provider: 'claude' })
  store.append(a.id, {
    role: 'user',
    content: "tu peux m'expliquer le code couleur de la pastille a cote des conversations"
  })
  store.append(a.id, { role: 'assistant', content: 'ambre = en cours, cyan = a jour' })
  const b = store.create({ title: 'Courante', provider: 'claude' })
  store.append(b.id, { role: 'user', content: 'remake les pastilles de couleurs' })
  return store
}

describe('le tour porte deja ce que la demande suppose', () => {
  it('rappelle l echange ou le sens a ete donne', () => {
    const rappel = rappelDesEchangesPasses(corpus(), 'remake les pastilles de couleurs', 'conv-2')
    expect(rappel).toContain('ambre')
    expect(rappel).toContain('conv-1')
  })

  it('exclut la conversation COURANTE, que le modele a deja', () => {
    const rappel = rappelDesEchangesPasses(corpus(), 'remake les pastilles de couleurs', 'conv-2')
    expect(rappel).not.toContain('conv-2')
  })

  it('ne rappelle rien quand la demande ne renvoie a rien de connu', () => {
    expect(rappelDesEchangesPasses(corpus(), 'installe kubernetes', 'conv-2')).toBe('')
  })

  it('se tait sur une demande LONGUE, qui se suffit a elle-meme', () => {
    const longue =
      'Dans src/renderer/src/components/ChatView.parts.tsx, le composant SubAgentText rend son ' +
      'bouton de depliage inconditionnellement, y compris pour un texte de deux lignes qui tient ' +
      'dans les 160px de la classe subagent-text ; il faut le rendre conditionnel et couvrir la ' +
      'decision par un test unitaire dedie qui exerce le cas court et le cas long des pastilles.'
    expect(rappelDesEchangesPasses(corpus(), longue, 'conv-2')).toBe('')
  })

  it('reste borne en volume, meme sur un corpus bavard', () => {
    let horloge = 1000
    const store = new ConversationStore(() => horloge++)
    for (let i = 0; i < 40; i++) {
      const c = store.create({ title: 'sujet ' + i, provider: 'claude' })
      store.append(c.id, { role: 'user', content: 'pastille '.repeat(400) })
    }
    expect(rappelDesEchangesPasses(store, 'pastille', 'conv-999').length).toBeLessThan(4_000)
  })
})
