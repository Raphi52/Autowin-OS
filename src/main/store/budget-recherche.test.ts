import { describe, expect, it } from 'vitest'
import { ConversationStore } from './conversations'

/**
 * LE PIRE CAS DOIT ETRE BORNE PAR LE TEMPS, PAS PAR LA TAILLE DU CORPUS.
 *
 * Le rappel est calcule sur le thread qui sert l'interface. Mesure sur le corpus actuel : ~35 ms,
 * sous le seuil de perception. Mais ce chiffre est une PHOTO : il dit ce que coute un corpus de 1197
 * conversations, pas ce que coutera celui de l'an prochain. A corpus double, il double ; a corpus
 * dix fois plus gros, il gele l'interface pendant un tiers de seconde.
 *
 * Une garantie qui depend d'une taille de donnees n'est pas une garantie, c'est un sursis. Un budget
 * de temps la rend independante du corpus : la recherche rend ce qu'elle a trouve quand le budget est
 * epuise, au lieu de finir a tout prix.
 *
 * C'est un compromis ASSUME et il faut le nommer : sous budget serre, le resultat peut etre INCOMPLET.
 * Pour un rappel -- un confort, jamais une autorite -- un resultat partiel rendu a temps vaut mieux
 * qu'un resultat complet qui fait attendre. Ce compromis serait inacceptable pour
 * `conversation_search`, appele explicitement par l'agent qui attend une reponse complete : c'est
 * pourquoi le budget est un PARAMETRE, absent par defaut.
 */

function grosCorpus(): ConversationStore {
  let horloge = 1000
  const store = new ConversationStore(() => horloge++)
  for (let index = 0; index < 600; index++) {
    const c = store.create({ title: 'sujet ' + index, provider: 'claude' })
    store.append(c.id, { role: 'user', content: `message ${index} au sujet des pastilles de statut` })
  }
  return store
}

describe('la recherche respecte un budget de temps', () => {
  it('sans budget, elle cherche partout', () => {
    const trouve = grosCorpus().search('pastilles', { limite: 50 })
    expect(trouve.length).toBe(50)
  })

  it('avec un budget epuise d avance, elle rend ce qu elle a au lieu de finir a tout prix', () => {
    const trouve = grosCorpus().search('pastilles', { limite: 50, budgetMs: 0 })
    expect(trouve.length).toBeLessThan(50)
  })

  it('un budget confortable ne change rien au resultat', () => {
    const sans = grosCorpus().search('pastilles', { limite: 10 })
    const avec = grosCorpus().search('pastilles', { limite: 10, budgetMs: 10_000 })
    expect(avec.map((c) => c.id)).toEqual(sans.map((c) => c.id))
  })
})
