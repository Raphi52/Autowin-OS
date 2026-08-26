import { describe, expect, it } from 'vitest'
import { ConversationStore } from './conversations'

/**
 * LE MOT QUE L'UTILISATEUR EMPLOIE N'EST PAS CELUI DU CORPUS.
 *
 * La recherche multi-mots sur la racine rattrapait les pluriels et les accords : « pastilles »
 * trouvait « pastille ». Elle ne rattrapait pas les mots DIFFERENTS pour la meme chose -- « badges »
 * ne trouvait jamais « pastilles », alors que c'est le meme objet a l'ecran, nomme autrement selon
 * le jour.
 *
 * C'est le cas le plus courant en pratique : personne ne retient le mot exact employe la derniere
 * fois. Une recherche qui l'exige demande a l'utilisateur de se souvenir de sa propre formulation --
 * exactement ce qu'il vient chercher.
 *
 * CE QUE CE N'EST PAS : un modele semantique. Un lexique nomme des familles VUES dans ce produit,
 * il ne devine pas un synonyme qu'on ne lui a pas appris. C'est borne, editable, et honnete sur sa
 * portee -- un index d'embeddings sur 28 Mo relus a chaque tour a ete ecarte pour sa latence et pour
 * l'etat qu'il faut tenir a jour.
 *
 * ENTREE QUI DOIT FAIRE ECHOUER CE TEST SI L'EXPANSION EST TROP LARGE : deux mots sans rapport ne
 * doivent PAS se rejoindre. Le dernier cas le garde -- une expansion qui relie tout ne cherche plus.
 */

function corpus(): ConversationStore {
  let horloge = 1000
  const store = new ConversationStore(() => horloge++)
  const a = store.create({ title: 'Pastilles', provider: 'claude' })
  store.append(a.id, {
    role: 'user',
    content: 'explique le code couleur de la pastille a cote des conversations'
  })
  const b = store.create({ title: 'Bureaux', provider: 'claude' })
  store.append(b.id, { role: 'user', content: 'le worktree agent a ete conserve' })
  return store
}

describe('la recherche rattrape le mot AUTREMENT nomme', () => {
  // Chaque cas cherche le synonyme SEUL. « badges de couleur » passait deja -- par « couleur »,
  // pas par « badges » : le test ne prouvait rien de ce qu'il annoncait.
  it('« badges » seul retrouve « pastille »', () => {
    expect(corpus().search('badges').map((c) => c.title)).toContain('Pastilles')
  })

  it('« bureau » seul retrouve « worktree », les deux mots de ce produit pour la meme chose', () => {
    expect(corpus().search('bureau').map((c) => c.title)).toContain('Bureaux')
  })

  it('et l inverse : « worktree » retrouve ce qui parle de bureaux', () => {
    let horloge = 1000
    const store = new ConversationStore(() => horloge++)
    const c = store.create({ title: 'Bureau conserve', provider: 'claude' })
    store.append(c.id, { role: 'user', content: 'le bureau a ete conserve, rien n est perdu' })
    expect(store.search('worktree').map((x) => x.title)).toContain('Bureau conserve')
  })

  it('la recherche directe continue de marcher, sans detour', () => {
    expect(corpus().search('pastille').map((c) => c.title)).toContain('Pastilles')
  })

  it('ne relie PAS deux mots sans rapport', () => {
    expect(corpus().search('kubernetes')).toEqual([])
    expect(corpus().search('badges').map((c) => c.title)).not.toContain('Bureaux')
  })
})
