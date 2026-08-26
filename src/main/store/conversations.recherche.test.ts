import { describe, expect, it } from 'vitest'
import { ConversationStore } from './conversations'

/**
 * DEFAUT VECU le 2026-08-26 (conv-1407). L'orchestrateur a recu « remake les pastilles de
 * couleurs » — quatre mots qui referent au tour precedent, dans une AUTRE conversation. Il n'avait
 * aucun moyen de le retrouver : `get_state` ne rend que des titres tronques, `conversation_read`
 * exige un id connu d'avance, et la seule recherche par CONTENU du catalogue, `find_in_files`,
 * fouille les fichiers du depot. Il a donc cherche son propre besoin dans le CODE SOURCE : 20
 * inspections, zero `conversation_read`, un run arrete a 0,96 $.
 *
 * Ce n'est pas un agent distrait, c'est un agent qui se sert du seul instrument qu'on lui laisse.
 * Le corpus est pourtant deja en memoire vive (`list()`, `messagesOf()`) : la matiere etait sous sa
 * main, sans poignee.
 *
 * ENTREE QUI DOIT FAIRE ECHOUER CE TEST SI LA RECHERCHE EST FAUSSE : une conversation qui ne
 * contient PAS le terme doit rester absente du resultat. Une recherche qui rend tout est aussi
 * inutile qu'une recherche qui ne rend rien -- elle rendrait juste l'inutilite plus chere.
 */

const SAUT = String.fromCharCode(10)

function magasinPeuple(): ConversationStore {
  let horloge = 1000
  const store = new ConversationStore(() => horloge++)
  const a = store.create({ title: 'Pastilles', provider: 'claude' })
  store.append(a.id, { role: 'user', content: 'explique le code couleur de la pastille' })
  store.append(a.id, { role: 'assistant', content: 'ambre = en cours, cyan = a jour' })
  const b = store.create({ title: 'Autre sujet', provider: 'claude' })
  store.append(b.id, { role: 'user', content: 'parle-moi des tickets RIG' })
  return store
}

describe('recherche par contenu dans le corpus des conversations', () => {
  it('retrouve la conversation qui porte le terme', () => {
    const store = magasinPeuple()
    const trouve = store.search('pastille')
    expect(trouve.length).toBe(1)
    expect(trouve[0].title).toBe('Pastilles')
    expect(trouve[0].extraits.length).toBeGreaterThan(0)
    expect(trouve[0].extraits[0].extrait.toLowerCase()).toContain('pastille')
  })

  it('laisse dehors une conversation qui ne porte pas le terme', () => {
    const store = magasinPeuple()
    const trouve = store.search('pastille')
    expect(trouve.map((c) => c.title)).not.toContain('Autre sujet')
  })

  it('ignore la casse et les accents, comme un humain qui tape vite', () => {
    const store = magasinPeuple()
    expect(store.search('PASTILLE').length).toBe(1)
    expect(store.search('a jour').length).toBe(1)
  })

  it('ne confond pas « conversion » avec « conversation », le mot le plus frequent d ici', () => {
    let horloge = 1000
    const store = new ConversationStore(() => horloge++)
    const parasite = store.create({ title: 'Parasite', provider: 'claude' })
    store.append(parasite.id, { role: 'user', content: 'range mes conversations par dossier' })
    const vraie = store.create({ title: 'Vraie cible', provider: 'claude' })
    store.append(vraie.id, { role: 'user', content: 'la conversion du fichier a echoue' })

    // Racine a six lettres, « conversation » et « conversion » donnaient tous deux « conver » :
    // chercher une conversion remontait presque tout le corpus, dont le sujet EST la conversation.
    const trouve = store.search('conversion').map((c) => c.title)
    expect(trouve).toContain('Vraie cible')
    expect(trouve).not.toContain('Parasite')
  })

  it('retrouve une REFORMULATION : la demande n est jamais formulee comme la reponse', () => {
    const store = magasinPeuple()
    // Ce que l utilisateur a tape en conv-1407, contre ce qui avait ete dit en conv-1405.
    // Cherchee comme UNE chaine, cette demande ne trouvait rien ; ni au pluriel, ni dans le desordre.
    const trouve = store.search('remake les pastilles de couleurs')
    expect(trouve.map((c) => c.title)).toContain('Pastilles')
  })

  it('rend la REPONSE avec la question : le sens est dans la reponse', () => {
    const store = magasinPeuple()
    const trouve = store.search('code couleur pastille')
    const textes = trouve[0].extraits.map((e) => e.extrait).join(' ')
    expect(textes).toContain('ambre')
  })

  it('classe en tete ce qui porte le PLUS de mots de la demande', () => {
    let horloge = 1000
    const store = new ConversationStore(() => horloge++)
    const faible = store.create({ title: 'Un seul mot', provider: 'claude' })
    store.append(faible.id, { role: 'user', content: 'juste une pastille ici' })
    const fort = store.create({ title: 'Trois mots', provider: 'claude' })
    store.append(fort.id, { role: 'user', content: 'le code couleur de la pastille, remake' })
    // « Un seul mot » est PLUS ANCIEN mais porte moins : la pertinence passe avant la recence.
    expect(store.search('remake les pastilles de couleurs')[0].title).toBe('Trois mots')
  })

  it('rend un resultat vide plutot que tout le corpus sur un terme absent', () => {
    const store = magasinPeuple()
    expect(store.search('kubernetes')).toEqual([])
  })

  it('compte les mots ENSEMBLE, pas disperses dans une longue conversation', () => {
    let horloge = 1000
    const store = new ConversationStore(() => horloge++)
    // Une conversation fourre-tout : chaque mot y est, mais dans des messages sans rapport.
    const fourreTout = store.create({ title: 'Fourre-tout', provider: 'claude' })
    store.append(fourreTout.id, { role: 'user', content: 'on parle de couleur ici' })
    store.append(fourreTout.id, { role: 'user', content: 'et de pastille, mais bien plus tard' })
    store.append(fourreTout.id, { role: 'user', content: 'un remake, sans lien avec ce qui precede' })
    // Une phrase qui dit les trois choses A LA FOIS.
    const precise = store.create({ title: 'Precise', provider: 'claude' })
    store.append(precise.id, { role: 'user', content: 'remake de la pastille de couleur' })

    // Cumules sur la conversation, les deux scoreraient 3 et la plus recente gagnerait. C'est la
    // PROXIMITE qui fait le sens : trois mots dans une phrase valent mieux que trois mots eparpilles.
    expect(store.search('remake pastille couleur')[0].title).toBe('Precise')
  })

  it('borne le nombre de conversations rendues', () => {
    let horloge = 1000
    const store = new ConversationStore(() => horloge++)
    for (let i = 0; i < 30; i++) {
      const c = store.create({ title: 'sujet ' + i, provider: 'claude' })
      store.append(c.id, { role: 'user', content: 'terme commun' + SAUT })
    }
    expect(store.search('terme commun', { limite: 5 }).length).toBe(5)
  })
})
