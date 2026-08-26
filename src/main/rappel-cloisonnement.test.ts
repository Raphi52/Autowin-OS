import { describe, expect, it } from 'vitest'
import { rappelDesEchangesPasses } from './rappel-conversations'
import { ConversationStore } from './store/conversations'

/**
 * LE RAPPEL NE DOIT PAS TRAVERSER LA FRONTIERE D'UN PROJET.
 *
 * Le cloisonnement par fournisseur, pose au cycle 3, fermait la fuite vers un TIERS. Il ne fermait
 * pas la fuite vers un AUTRE CLIENT : deux conversations servies par le meme moteur mais rattachees
 * a deux projets differents pouvaient se rappeler l'une l'autre.
 *
 * Consequence concrete dans un cabinet qui travaille pour plusieurs clients : un extrait du projet A
 * -- un contrat, un identifiant, une donnee nominative -- entre dans le prompt d'une conversation du
 * projet B et part sur le reseau. L'utilisateur ne l'a jamais demande et ne le voit pas passer.
 *
 * Le modele de donnees portait deja la frontiere (`projectPath`), et la recherche l'ignorait. Le long
 * commentaire qui justifiait le cloisonnement par fournisseur ne mentionnait meme pas celle-la --
 * j'avais ferme une porte en laissant l'autre ouverte, avec l'assurance de celui qui a ferme une porte.
 *
 * ENTREE QUI DOIT FAIRE ECHOUER CE TEST SI LE CLOISONNEMENT EST TROP DUR : deux conversations SANS
 * projet (le cas courant) doivent continuer de se rappeler, sinon la fonction disparait pour la
 * majorite des usages. Le dernier cas garde ce bord.
 */

function corpus(): ConversationStore {
  let horloge = 1000
  const store = new ConversationStore(() => horloge++)
  const clientA = store.create({ title: 'Client A', provider: 'claude' })
  store.append(clientA.id, { role: 'user', content: 'le contrat pastille du client A' })
  store.rangerDansDossier(clientA.id, 'C:/projets/client-a')
  const sansProjet = store.create({ title: 'Sans projet', provider: 'claude' })
  store.append(sansProjet.id, { role: 'user', content: 'une note pastille sans projet' })
  return store
}

describe('le rappel reste dans son projet', () => {
  it('ne traverse pas la frontiere entre deux projets', () => {
    const rappel = rappelDesEchangesPasses(
      corpus(),
      'pastille',
      'conv-9',
      'claude',
      'C:/projets/client-b'
    )
    expect(rappel).not.toContain('client A')
  })

  it('rappelle bien a l interieur du MEME projet', () => {
    const rappel = rappelDesEchangesPasses(
      corpus(),
      'pastille',
      'conv-9',
      'claude',
      'C:/projets/client-a'
    )
    expect(rappel).toContain('client A')
  })

  it('laisse se rappeler deux conversations SANS projet, le cas courant', () => {
    const rappel = rappelDesEchangesPasses(corpus(), 'pastille', 'conv-9', 'claude', undefined)
    expect(rappel).toContain('sans projet')
  })
})
