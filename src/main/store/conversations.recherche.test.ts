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

  it('rend un resultat vide plutot que tout le corpus sur un terme absent', () => {
    const store = magasinPeuple()
    expect(store.search('kubernetes')).toEqual([])
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
