import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ConversationStore } from './conversations'

/**
 * LE COMPTE CLAUDE APPARTIENT A LA CONVERSATION.
 *
 * Deux exigences distinctes : le store le MEMORISE (et l'oublie proprement), et chaque appel du fil
 * le LIT — sans ce second point, le choix serait un decor : le CLI partirait sur le compte actif.
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

  /*
   * conv-1416 : le choix ne passe plus par le compte actif, global, que tout autre fil pouvait
   * changer. Il voyage avec chaque appel. Le comportement est prouvé dans
   * `registry.compte-du-fil.test.ts`, `agent-pilot.compte-du-fil.test.ts` et
   * `claude.lancement.test.ts` ; ici, le branchement que ces tests remplacent par un double.
   */
  it('chaque appel lit le compte sur SA conversation, sans toucher au compte actif', () => {
    const index = readFileSync(join(process.cwd(), 'src/main/index.ts'), 'utf8')
    const branchement = index.slice(index.indexOf('configureClaudeCompteDuFil((conversationId)'))
    expect(branchement.slice(0, 300)).toContain(
      'os.conversations.get(conversationId)?.claudeAccountId'
    )
    expect(index).not.toContain('appliquerCompteDeConversation')

    const os = readFileSync(join(process.cwd(), 'src/main/app/os.ts'), 'utf8')
    expect(os).toContain("(providerId === 'claude' ? claudeCompteDuFil(fil) : undefined)")
  })
})
