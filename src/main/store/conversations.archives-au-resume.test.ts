import { describe, expect, it, vi } from 'vitest'
import { type Conversation, ConversationStore, LIMITE_FILS_ARCHIVES_RELUS } from './conversations'

/**
 * UN FIL ARCHIVÉ NE TIENT EN MÉMOIRE QUE SON RÉSUMÉ ET SON TEXTE CHERCHABLE.
 *
 * Le « disque » de ces tests (`disque`) tient lieu du dossier d'archives : un fil archivé y vit en
 * entier. Le store n'en garde que le résumé et le texte ; son historique complet se relit à la
 * demande (`get`), dans une borne. Les tests tiennent les deux côtés : ce qui sort de la mémoire, et
 * ce qui ne doit JAMAIS changer pour l'utilisateur (contenu exact, recherche, modification, suppression).
 */

/** Horloge de test : chaque appel avance d'une unité, donc des dates strictement croissantes. */
function horloge(depart = 1000): () => number {
  let t = depart
  return () => t++
}

/** Des fils complets, comme les produit un store : messages alternés utilisateur / assistant. */
function filsComplets(
  fils: ReadonlyArray<{ titre: string; messages: readonly string[] }>
): Conversation[] {
  const amont = new ConversationStore(horloge())
  return fils.map(({ titre, messages }) => {
    const fil = amont.create({ title: titre, provider: 'claude' })
    messages.forEach((contenu, i) =>
      amont.append(fil.id, { role: i % 2 === 0 ? 'user' : 'assistant', content: contenu })
    )
    return structuredClone(amont.get(fil.id)!)
  })
}

/** Un store dont le « disque » est `disque` : un fil archivé y est relu à la demande, et chaque lecture est notée. */
function storeAvecDisque(disque: Map<string, Conversation>): {
  store: ConversationStore
  lectures: string[]
} {
  const lectures: string[] = []
  const store = new ConversationStore(horloge(10_000))
  store.chargeurDArchive = (id) => {
    lectures.push(id)
    const copie = disque.get(id)
    return copie ? structuredClone(copie) : undefined
  }
  return { store, lectures }
}

const fils = (n: number): Conversation[] =>
  filsComplets(
    Array.from({ length: n }, (_, i) => ({
      titre: `Ancien ${i}`,
      messages: [`question ${i}`, `réponse ${i}`]
    }))
  )

describe('integrerArchives : le store ne garde que le résumé et le texte d’un fil archivé', () => {
  it('aucun fil complet en mémoire, mais le résumé et le texte cherchable', () => {
    const [fil] = filsComplets([
      { titre: 'Ancien', messages: ['Question de janvier', 'Réponse de janvier'] }
    ])
    const { store } = storeAvecDisque(new Map([[fil.id, fil]]))

    expect(store.integrerArchives([structuredClone(fil)])).toBe(1)

    expect(store.listAvecMessages()).toEqual([])
    expect(store.listResumes()).toEqual([
      expect.objectContaining({ id: fil.id, title: 'Ancien', messageCount: 2 })
    ])
    expect(store.listAvecTexte().map((f) => f.messages.map((m) => m.content))).toEqual([
      ['Question de janvier', 'Réponse de janvier']
    ])
  })

  it('la lecture texte rend les messages SANS leurs parts : le texte suffit à chercher et à lister', () => {
    const store = new ConversationStore(horloge())
    const fil = store.create({ title: 'Avec outils', provider: 'claude' })
    store.beginTurn(fil.id, { content: 'Question' }, { turnId: 'tour-1' })
    store.applyTurnEvent(fil.id, 'tour-1', {
      kind: 'delta',
      streamId: '0:0',
      text: 'Réponse texte.'
    })
    store.applyTurnEvent(fil.id, 'tour-1', { kind: 'done' })
    const complet = structuredClone(store.get(fil.id)!)
    // Précondition : le fil porte bien des parts, sinon le test ne prouve rien.
    expect(complet.messages.some((m) => (m.parts?.length ?? 0) > 0)).toBe(true)

    const lecteur = new ConversationStore(horloge(10_000))
    lecteur.integrerArchives([complet])

    const [texte] = lecteur.listAvecTexte()
    expect(texte.messages.map((m) => m.content)).toEqual(complet.messages.map((m) => m.content))
    expect(texte.messages.every((m) => !('parts' in m))).toBe(true)
  })

  it('hydrate remplace tout le corpus : un fil archivé de l’ancien corpus n’y reste pas', () => {
    const [ancien] = filsComplets([{ titre: 'Ancien', messages: ['Question'] }])
    const store = new ConversationStore(horloge(10_000))
    store.integrerArchives([structuredClone(ancien)])
    expect(store.listResumes().map((r) => r.id)).toEqual([ancien.id])

    store.hydrate([])

    expect(store.listResumes()).toEqual([])
    expect(store.listAvecTexte()).toEqual([])
  })
})

describe('get : un fil archivé se relit entier, dans une borne', () => {
  it('get rend le fil entier, identique à celui de son archive', () => {
    const [fil] = filsComplets([{ titre: 'Ancien', messages: ['question', 'réponse'] }])
    const { store } = storeAvecDisque(new Map([[fil.id, fil]]))
    store.integrerArchives([structuredClone(fil)])

    expect(store.get(fil.id)).toEqual(fil)
  })

  it('au plus LIMITE_FILS_ARCHIVES_RELUS fils relus restent en mémoire, et chacun reste exact', () => {
    const corpus = fils(LIMITE_FILS_ARCHIVES_RELUS + 4)
    const { store } = storeAvecDisque(new Map(corpus.map((fil) => [fil.id, fil])))
    store.integrerArchives(corpus.map((fil) => structuredClone(fil)))

    for (const fil of corpus) expect(store.get(fil.id)).toEqual(fil)

    expect(store.listAvecMessages().length).toBeLessThanOrEqual(LIMITE_FILS_ARCHIVES_RELUS)
    // Le premier, rendu à son résumé, se relit toujours à l'identique.
    expect(store.get(corpus[0].id)).toEqual(corpus[0])
  })

  it('un fil relu puis MODIFIÉ n’est jamais évincé : sa modification reste en mémoire', () => {
    const corpus = fils(LIMITE_FILS_ARCHIVES_RELUS + 4)
    const { store } = storeAvecDisque(new Map(corpus.map((fil) => [fil.id, fil])))
    store.integrerArchives(corpus.map((fil) => structuredClone(fil)))

    store.get(corpus[0].id)
    store.append(corpus[0].id, { role: 'user', content: 'ajout récent' })
    for (const fil of corpus.slice(1)) store.get(fil.id)

    expect(store.listAvecMessages().map((fil) => fil.id)).toContain(corpus[0].id)
    expect(store.get(corpus[0].id)?.messages.at(-1)?.content).toBe('ajout récent')
  })

  it('un fil archivé dont le fichier a disparu ne se relit pas : get rend undefined', () => {
    const [fil] = filsComplets([{ titre: 'Disparu', messages: ['question'] }])
    const disque = new Map([[fil.id, fil]])
    const { store } = storeAvecDisque(disque)
    store.integrerArchives([structuredClone(fil)])
    disque.delete(fil.id)

    expect(store.get(fil.id)).toBeUndefined()
  })
})

describe('archiverFils : un fil actif sort de la mémoire, et revient entier', () => {
  it('le fil quitte la mémoire, reste listé, se relit à l’identique, puis redevient actif quand on le touche', () => {
    const store = new ConversationStore(horloge())
    const disque = new Map<string, Conversation>()
    store.chargeurDArchive = (id) => {
      const copie = disque.get(id)
      return copie ? structuredClone(copie) : undefined
    }
    const fil = store.create({ title: 'Actif', provider: 'claude' })
    store.append(fil.id, { role: 'user', content: 'question' })
    store.append(fil.id, { role: 'assistant', content: 'réponse' })
    const avant = structuredClone(store.get(fil.id)!)
    // L'archive écrite sur le disque, avant la bascule.
    disque.set(fil.id, structuredClone(avant))

    expect(store.archiverFils([fil.id])).toBe(1)

    expect(store.listAvecMessages()).toEqual([])
    expect(store.listResumes().map((resume) => resume.id)).toEqual([fil.id])
    expect(store.get(fil.id)).toEqual(avant)

    store.append(fil.id, { role: 'user', content: 'reprise' })

    expect(store.listAvecMessages().map((f) => f.id)).toEqual([fil.id])
    expect(store.get(fil.id)?.messages.map((m) => m.content)).toEqual([
      'question',
      'réponse',
      'reprise'
    ])
  })
})

describe('un fil archivé reste un fil : modification, suppression, recherche', () => {
  it('un fil archivé modifié redevient actif : le hook de persistance reçoit le fil ENTIER', () => {
    const [fil] = filsComplets([{ titre: 'Ancien', messages: ['question', 'réponse'] }])
    const { store } = storeAvecDisque(new Map([[fil.id, fil]]))
    store.integrerArchives([structuredClone(fil)])
    const onChange = vi.fn()
    store.onChange = onChange

    store.rename(fil.id, 'Nouveau titre')

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        id: fil.id,
        conversation: expect.objectContaining({
          title: 'Nouveau titre',
          messages: fil.messages
        })
      })
    )
  })

  it('un fil archivé supprimé : le hook reçoit la suppression, et ni la liste ni la recherche ne le rendent', () => {
    const [fil] = filsComplets([{ titre: 'Ancien', messages: ['motifSupprimeRare'] }])
    const { store } = storeAvecDisque(new Map([[fil.id, fil]]))
    store.integrerArchives([structuredClone(fil)])
    const onChange = vi.fn()
    store.onChange = onChange
    // Précondition : trouvable avant la suppression, sinon l'absence après ne prouve rien.
    expect(store.rechercherParContenu('motifsupprimerare').map((r) => r.id)).toEqual([fil.id])

    expect(store.remove(fil.id)).toBe(true)

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ id: fil.id, conversation: undefined })
    )
    expect(store.listResumes().map((resume) => resume.id)).not.toContain(fil.id)
    expect(store.rechercherParContenu('motifsupprimerare').map((r) => r.id)).not.toContain(fil.id)
  })

  // fix-ok: cause mesurée — rouge avant correction : `search` relisait le fil candidat par `get`
  // (des lectures disque comptées ; la pile passait par `porte` dans conversations.ts).
  it('la recherche trouve un fil archivé par son contenu, sans relire le disque à chaque demande', () => {
    const [fil] = filsComplets([
      { titre: 'Ancien', messages: ['Une gastronomie rare et ancienne', 'Réponse sans rapport'] }
    ])
    const { store, lectures } = storeAvecDisque(new Map([[fil.id, fil]]))
    store.integrerArchives([structuredClone(fil)])

    expect(store.rechercherParContenu('gastronomie').map((r) => r.id)).toEqual([fil.id])
    expect(store.search('gastronomie rare').map((r) => r.id)).toContain(fil.id)
    expect(store.rechercherParContenu('gastronomie').map((r) => r.id)).toEqual([fil.id])
    expect(lectures).toEqual([])
  })
})
