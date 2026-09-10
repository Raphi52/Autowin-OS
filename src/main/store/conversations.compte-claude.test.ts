import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ConversationStore } from './conversations'

/**
 * LE COMPTE CLAUDE APPARTIENT A LA CONVERSATION.
 *
 * Deux exigences distinctes : le store le MEMORISE (et l'oublie proprement), et le lancement d'un
 * tour l'APPLIQUE — sans ce second point, le choix serait un decor : le fournisseur d'env du CLI
 * est global, il lit le compte actif au moment du spawn.
 */
describe('ConversationStore — compte Claude par conversation', () => {
  const clock = (): (() => number) => {
    let t = 1000
    return () => t++
  }

  it('memorise le compte choisi, et l’efface sur null', () => {
    const store = new ConversationStore(clock())
    const conv = store.create({ title: 'A', provider: 'claude' })

    expect(store.choisirCompteClaude(conv.id, 'compte-2')?.claudeAccountId).toBe('compte-2')
    expect(store.get(conv.id)?.claudeAccountId).toBe('compte-2')
    expect(store.choisirCompteClaude(conv.id, null)?.claudeAccountId).toBeUndefined()
    expect('claudeAccountId' in (store.get(conv.id) as object)).toBe(false)
  })

  it('rend undefined sur un id inconnu plutot que de jeter', () => {
    const store = new ConversationStore(clock())
    expect(store.choisirCompteClaude('conv-inconnue', 'compte-2')).toBeUndefined()
  })

  it('le lancement d’un tour applique le compte de la conversation', () => {
    const source = readFileSync(join(process.cwd(), 'src/main/index.ts'), 'utf8')
    // Le point d'application : la fonction existe et est appelee la ou TOUS les tours passent.
    expect(source).toContain('const appliquerCompteDeConversation = (conversationId: string)')
    const runPilotChat = source.slice(source.indexOf('const runPilotChat: typeof lancerTour'))
    expect(runPilotChat.slice(0, 600)).toContain('appliquerCompteDeConversation(conversationId)')
    // Et le run pipeline (`os:orchestrate`), qui ne passe pas par runPilotChat.
    const orchestrate = source.slice(source.indexOf("ipcMain.handle('os:orchestrate'"))
    expect(orchestrate.slice(0, 2000)).toContain('appliquerCompteDeConversation(conversationId)')
  })
})
