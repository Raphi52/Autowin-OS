import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { ConversationStore } from './conversations'
import { attendreEcrituresConversations, persistConversations } from './conversations-disk'

/*
 * Le titre d'un fil est celui de son PREMIER message et ne bouge plus. La règle « le titre suit le
 * dernier message » (conv-999, 2026-10-16) a été annulée le 2026-10-28 (conv-1203) : « annule le
 * changement de name des convs qui devient celui de mon dernier message ».
 */
let tour = 0
const envoyer = (store: ConversationStore, id: string, texte: string): void => {
  tour += 1
  store.beginTurn(id, { content: texte }, { turnId: `turn-${tour}` })
}

describe('le titre reste celui du premier message', () => {
  it('un fil créé d avance (« Nouvelle conversation ») prend son premier message (bug du 30/08)', () => {
    const store = new ConversationStore()
    const c = store.create({ title: 'Nouvelle conversation', provider: 'claude' })
    envoyer(store, c.id, 'corrige le titrage des conversations')
    expect(store.get(c.id)?.title).toBe('corrige le titrage des conversations')
    expect(store.get(c.id)?.origineTitre).toBe('auto')
  })

  it('un message suivant ne renomme PLUS le fil (annulation conv-1203)', () => {
    const store = new ConversationStore()
    const c = store.create({ title: 'corrige le bouton Stop', provider: 'claude' })
    envoyer(store, c.id, 'corrige le bouton Stop')
    envoyer(store, c.id, 'maintenant ajoute un export CSV des runs')
    expect(store.get(c.id)?.title).toBe('corrige le bouton Stop')
  })

  it('un fil créé d avance garde son premier sujet malgré les messages suivants', () => {
    const store = new ConversationStore()
    const c = store.create({ title: 'Nouvelle conversation', provider: 'claude' })
    envoyer(store, c.id, 'premier sujet')
    envoyer(store, c.id, 'second sujet, tout autre')
    expect(store.get(c.id)?.title).toBe('premier sujet')
  })

  it('« go » en premier ne nomme pas : le premier message qui dit le sujet le fait', () => {
    const store = new ConversationStore()
    const c = store.create({ title: 'Nouvelle conversation', provider: 'claude' })
    envoyer(store, c.id, 'go')
    expect(store.get(c.id)?.title).toBe('Nouvelle conversation')
    envoyer(store, c.id, 'ajoute un export CSV')
    envoyer(store, c.id, 'puis un export JSON')
    expect(store.get(c.id)?.title).toBe('ajoute un export CSV')
  })

  it('un nom donné à la main n est jamais réécrit', () => {
    const store = new ConversationStore()
    const c = store.create({ title: 'Nouvelle conversation', provider: 'claude' })
    envoyer(store, c.id, 'premier sujet')
    store.rename(c.id, 'Factures client')
    envoyer(store, c.id, 'autre sujet complètement')
    expect(store.get(c.id)?.title).toBe('Factures client')
    expect(store.get(c.id)?.origineTitre).toBe('utilisateur')
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

describe('le titre survit au redémarrage (rejeu du journal)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aos-titre-premier-'))
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  it('retrouve le titre du premier message et sa provenance', async () => {
    const p = join(dir, 'conversations.json')
    const a = new ConversationStore(() => 1000)
    persistConversations(a, p)
    const c = a.create({ title: 'Nouvelle conversation', provider: 'claude' })
    envoyer(a, c.id, 'premier sujet, le vrai')
    envoyer(a, c.id, 'second sujet')
    await attendreEcrituresConversations()

    const b = new ConversationStore(() => 2000)
    persistConversations(b, p)
    expect(b.get(c.id)?.title).toBe('premier sujet, le vrai')
    expect(b.get(c.id)?.origineTitre).toBe('auto')

    b.rename(c.id, 'Mon nom')
    await attendreEcrituresConversations()
    const d = new ConversationStore(() => 3000)
    persistConversations(d, p)
    envoyer(d, c.id, 'troisième sujet')
    expect(d.get(c.id)?.title).toBe('Mon nom')
  })
})
