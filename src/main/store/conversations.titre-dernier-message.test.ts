import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { ConversationStore } from './conversations'
import { attendreEcrituresConversations, persistConversations } from './conversations-disk'

/*
 * Demande du 2026-10-16 (conv-999) : « j'aimerais que le nom de la conv devienne basé sur mon
 * dernier message de la conv et pas le premier si je lui ai jamais donné de nom moi même ».
 * Le titre était figé au premier message ; il suit désormais chaque message qui lance un tour.
 */
let tour = 0
const envoyer = (store: ConversationStore, id: string, texte: string): void => {
  tour += 1
  store.beginTurn(id, { content: texte }, { turnId: `turn-${tour}` })
}

describe('le titre suit le dernier message de l utilisateur', () => {
  it('un fil créé d avance (« Nouvelle conversation ») prend son premier message (bug du 30/08)', () => {
    const store = new ConversationStore()
    const c = store.create({ title: 'Nouvelle conversation', provider: 'claude' })
    envoyer(store, c.id, 'corrige le titrage des conversations')
    expect(store.get(c.id)?.title).toBe('corrige le titrage des conversations')
    expect(store.get(c.id)?.origineTitre).toBe('auto')
  })

  it('le titre repris du premier message suit ensuite le DERNIER', () => {
    const store = new ConversationStore()
    const c = store.create({ title: 'corrige le bouton Stop', provider: 'claude' })
    envoyer(store, c.id, 'corrige le bouton Stop')
    envoyer(store, c.id, 'maintenant ajoute un export CSV des runs')
    expect(store.get(c.id)?.title).toBe('maintenant ajoute un export CSV des runs')
  })

  it('« go » ne renomme pas : le titre reste le dernier message qui disait le sujet', () => {
    const store = new ConversationStore()
    const c = store.create({ title: 'Nouvelle conversation', provider: 'claude' })
    envoyer(store, c.id, 'ajoute un export CSV')
    envoyer(store, c.id, 'go')
    expect(store.get(c.id)?.title).toBe('ajoute un export CSV')
  })

  it('un nom donné à la main n est plus jamais réécrit', () => {
    const store = new ConversationStore()
    const c = store.create({ title: 'Nouvelle conversation', provider: 'claude' })
    envoyer(store, c.id, 'premier sujet')
    store.rename(c.id, 'Factures client')
    envoyer(store, c.id, 'autre sujet complètement')
    expect(store.get(c.id)?.title).toBe('Factures client')
    expect(store.get(c.id)?.origineTitre).toBe('utilisateur')
  })

  it('un ancien fil renommé avant la règle (titre étranger au premier message) est gardé', () => {
    const store = new ConversationStore()
    const c = store.create({ title: 'Audit qualité', provider: 'claude' })
    envoyer(store, c.id, 'regarde les tests rouges')
    envoyer(store, c.id, 'et maintenant le lint')
    expect(store.get(c.id)?.title).toBe('Audit qualité')
  })

  it('une consigne tapée pendant un tour ne renomme pas', () => {
    const store = new ConversationStore()
    const c = store.create({ title: 'Nouvelle conversation', provider: 'claude' })
    envoyer(store, c.id, 'ajoute un export CSV')
    store.append(c.id, { role: 'user', content: 'attends, plutôt en JSON', orientation: true })
    expect(store.get(c.id)?.title).toBe('ajoute un export CSV')
  })

  it('un homonyme d un autre fil reçoit le moment en suffixe', () => {
    const store = new ConversationStore(() => new Date(2026, 9, 16, 10, 5).getTime())
    store.create({ title: '/salvage', provider: 'claude' })
    const c = store.create({ title: 'Nouvelle conversation', provider: 'claude' })
    envoyer(store, c.id, '/salvage')
    expect(store.get(c.id)?.title).toBe('/salvage · 16/10 10:05')
  })
})

describe('le titre suivi survit au redémarrage (rejeu du journal)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aos-titre-dernier-'))
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  it('retrouve le titre du dernier message et sa provenance', async () => {
    const p = join(dir, 'conversations.json')
    const a = new ConversationStore(() => 1000)
    persistConversations(a, p)
    const c = a.create({ title: 'Nouvelle conversation', provider: 'claude' })
    envoyer(a, c.id, 'premier sujet')
    envoyer(a, c.id, 'second sujet, le vrai')
    await attendreEcrituresConversations()

    const b = new ConversationStore(() => 2000)
    persistConversations(b, p)
    expect(b.get(c.id)?.title).toBe('second sujet, le vrai')
    expect(b.get(c.id)?.origineTitre).toBe('auto')

    b.rename(c.id, 'Mon nom')
    await attendreEcrituresConversations()
    const d = new ConversationStore(() => 3000)
    persistConversations(d, p)
    envoyer(d, c.id, 'troisième sujet')
    expect(d.get(c.id)?.title).toBe('Mon nom')
  })
})
