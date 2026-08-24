import { appendFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { ConversationStore } from './conversations'
import { conversationJournalPath, loadConversations, persistConversations } from './conversations-disk'

/**
 * LE DÉFAUT, vécu le 2026-08-24 sur les données réelles de l'utilisateur.
 *
 * Un enregistrement de journal sans `title` ni `provider` a suffi à rendre l'application
 * DÉFINITIVEMENT inbootable : `applyConversationJournal` levait « Journal conversations corrompu
 * ligne 1 », la fenêtre s'appelait « Error », et 1175 conversations devenaient inaccessibles. Il a
 * fallu retirer la ligne à la main pour que l'app redémarre.
 *
 * Le fichier portait DÉJÀ un commentaire disant que ce piège s'était produit une première fois — le
 * champ `category` était exigé alors qu'il n'était plus écrit, et « un seul champ manquant faisait
 * déclarer le store ENTIER corrompu ». La leçon avait été écrite, pas appliquée : le tout-ou-rien
 * est resté.
 *
 * Perdre UNE conversation vaut infiniment mieux que perdre l'accès à mille cent soixante-quinze.
 */

const dir = mkdtempSync(join(tmpdir(), 'aos-journal-fautif-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

const ligneFautive = (id: string): string =>
  JSON.stringify({
    schema: 'autowin.conversation-change/v1',
    op: 'upsert',
    // Exactement la forme observée sur le disque : ni `title`, ni `provider`.
    conversation: { schemaVersion: 3, id, messages: [], createdAt: 1, updatedAt: 1 }
  })

describe('une seule ligne de journal fautive', () => {
  it('ne fait PAS perdre les conversations saines', () => {
    const p = join(dir, 'a', 'conversations.json')
    const store = new ConversationStore(() => 1000)
    persistConversations(store, p)
    const saine = store.create({ title: 'Celle qu’il ne faut pas perdre', provider: 'codex' })
    appendFileSync(conversationJournalPath(p), ligneFautive('conv-fautive') + '\n', 'utf8')

    const relues = loadConversations(p)

    expect(relues.map((c) => c.id)).toContain(saine.id)
  })

  it('ne jette pas : le chargement aboutit au lieu de bloquer le démarrage', () => {
    const p = join(dir, 'b', 'conversations.json')
    const store = new ConversationStore(() => 1000)
    persistConversations(store, p)
    store.create({ title: 'Saine', provider: 'codex' })
    appendFileSync(conversationJournalPath(p), ligneFautive('conv-fautive') + '\n', 'utf8')

    expect(() => loadConversations(p)).not.toThrow()
  })

  it('écarte la conversation fautive plutôt que de l’inventer à moitié', () => {
    const p = join(dir, 'c', 'conversations.json')
    const store = new ConversationStore(() => 1000)
    persistConversations(store, p)
    store.create({ title: 'Saine', provider: 'codex' })
    appendFileSync(conversationJournalPath(p), ligneFautive('conv-fautive') + '\n', 'utf8')

    expect(loadConversations(p).map((c) => c.id)).not.toContain('conv-fautive')
  })

  it('survit aux DELTAS orphelins que la ligne écartée laisse derrière elle', () => {
    // C'est ce qui s'est réellement passé : 3 lignes fautives et 24 deltas qui les référençaient.
    // Écarter l'upsert sans tolérer ses deltas déplacerait simplement l'échec d'une ligne.
    const p = join(dir, 'd', 'conversations.json')
    const store = new ConversationStore(() => 1000)
    persistConversations(store, p)
    const saine = store.create({ title: 'Saine', provider: 'codex' })
    const j = conversationJournalPath(p)
    appendFileSync(j, ligneFautive('conv-fautive') + '\n', 'utf8')
    appendFileSync(
      j,
      JSON.stringify({
        schema: 'autowin.conversation-change/v1',
        op: 'append-messages',
        id: 'conv-fautive',
        messages: [{ id: 'm1', role: 'user', content: 'perdu', createdAt: 2 }],
        updatedAt: 2
      }) + '\n',
      'utf8'
    )

    const relues = loadConversations(p)

    expect(relues.map((c) => c.id)).toContain(saine.id)
  })

  it('REFUSE encore un journal illisible — on ne devient pas aveugle pour autant', () => {
    // L'entrée qui doit faire échouer une tolérance devenue trop large : ce n'est même pas du JSON,
    // au MILIEU du fichier (une dernière ligne tronquée est deja toleree a dessein).
    const p = join(dir, 'e', 'conversations.json')
    const store = new ConversationStore(() => 1000)
    persistConversations(store, p)
    store.create({ title: 'Saine', provider: 'codex' })
    const j = conversationJournalPath(p)
    appendFileSync(j, 'ceci n est pas du json\n', 'utf8')
    appendFileSync(j, ligneFautive('conv-z') + '\n', 'utf8')

    expect(() => loadConversations(p)).toThrow()
  })
})
