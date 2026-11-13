import { describe, expect, it } from 'vitest'
import { ConversationStore } from './conversations'

/**
 * LA RECHERCHE NE DOIT PLUS GELER LE FIL PRINCIPAL.
 *
 * Mesuré sur le corpus réel (1616 fils, 15 691 messages) : la PREMIÈRE recherche classée bloquait
 * 3,5 s, et chaque recherche par frappe 300 ms. Les index se construisent désormais par tranches, et les
 * recherches asynchrones rendent la main entre deux tranches. Ces tests disent ce qui doit rester vrai :
 * même résultat qu'en synchrone, rendu de la main réel, index inutile pour un terme court.
 *
 * ENTRÉE QUI DOIT FAIRE ÉCHOUER CE FICHIER SI LE CHANTIER CASSE LA RECHERCHE : un résultat asynchrone
 * différent du synchrone, ou une recherche qui ne cède jamais la main sur un corpus qui en a besoin.
 */

/** Un corpus au-delà d'une tranche (48 messages) : la recherche doit céder la main au moins une fois. */
function corpusVolumineux(): ConversationStore {
  let horloge = 1000
  const store = new ConversationStore(() => horloge++)
  for (let i = 0; i < 40; i++) {
    const fil = store.create({ title: `Fil ${i}`, provider: 'claude' })
    store.append(fil.id, {
      role: 'user',
      content: `question ${i} sur le code couleur de la pastille ambre`
    })
    store.append(fil.id, {
      role: 'assistant',
      content: `réponse ${i} : ambre = en cours, cyan = à jour, fichier ${i}`
    })
    store.append(fil.id, { role: 'user', content: `suite ${i} sur les commits et la fusion` })
  }
  return store
}

describe('recherche classée : asynchrone, par tranches', () => {
  it('rend le même résultat que la version synchrone et cède la main pendant le travail', async () => {
    const synchrone = corpusVolumineux().search('code couleur pastille', {
      limite: 10,
      extraitsParConversation: 3
    })
    const store = corpusVolumineux()
    const avant = store.tranchesCedees
    const asynchrone = await store.searchAsync('code couleur pastille', {
      limite: 10,
      extraitsParConversation: 3
    })
    expect(asynchrone).toEqual(synchrone)
    expect(store.tranchesCedees - avant).toBeGreaterThan(0)
  })

  it('ne construit les index qu’à la demande, et un terme court reste littéral', () => {
    const store = corpusVolumineux()
    expect(store.indexPret()).toBe(false)
    // « 5a » n'a aucun mot de trois lettres : la recherche doit rester littérale, sans index.
    store.search('5a')
    expect(store.indexPret()).toBe(false)
    store.search('code couleur pastille')
    expect(store.indexPret()).toBe(true)
  })

  it('préchauffe les index par tranches, sans rien changer au résultat', async () => {
    const store = corpusVolumineux()
    await store.prechaufferIndex()
    expect(store.indexPret()).toBe(true)
    const attendu = corpusVolumineux().search('code couleur pastille', { limite: 10 })
    expect(store.search('code couleur pastille', { limite: 10 })).toEqual(attendu)
  })
})

describe('recherche par contenu : le terme est du texte, jamais une expression', () => {
  it('trouve les caractères spéciaux tels quels, ignore accents et casse, et rend le texte d’origine', () => {
    let horloge = 1000
    const store = new ConversationStore(() => horloge++)
    const fil = store.create({ title: 'Syntaxe', provider: 'claude' })
    store.append(fil.id, {
      role: 'user',
      content: 'Déjà vu : f(x) = a[0] ^ b - c, puis c++ et « ALLO »'
    })
    const trouvees = (terme: string): string[] =>
      store.rechercherParContenu(terme).map((resultat) => resultat.id)
    expect(trouvees('a[0]')).toEqual([fil.id])
    expect(trouvees('f(x)')).toEqual([fil.id])
    expect(trouvees('c++')).toEqual([fil.id])
    expect(trouvees('^ b')).toEqual([fil.id])
    expect(trouvees('deja vu')).toEqual([fil.id])
    expect(trouvees('allo')).toEqual([fil.id])
    // Le point ne joue pas le rôle de joker : « a.0 » n'est pas « a[0] ».
    expect(trouvees('a.0')).toEqual([])
    // L'extrait rendu garde les accents et la casse de l'original.
    expect(store.rechercherParContenu('deja vu')[0].extrait).toContain('Déjà vu')
  })
})

describe('recherche par contenu : asynchrone, et fils archivés inclus', () => {
  it('rend la main et trouve les fils archivés comme la version synchrone', async () => {
    const store = corpusVolumineux()
    const archives = store
      .listResumes()
      .map((resume) => resume.id)
      .slice(0, 5)
    store.archiverFils(archives)
    const attendu = store.rechercherParContenu('pastille', { limite: 2000 })
    const avant = store.tranchesCedees
    const obtenu = await store.rechercherParContenuAsync('pastille', { limite: 2000 })
    expect(obtenu).toEqual(attendu)
    expect(obtenu.map((r) => r.id)).toEqual(expect.arrayContaining(archives))
    expect(store.tranchesCedees - avant).toBeGreaterThan(0)
  })
})
