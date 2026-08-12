import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  chatSessionStorePath,
  forgetChatSession,
  loadChatSessions,
  saveChatSession
} from './chat-session-store'

/**
 * CE QUE CE STORE FAIT GAGNER, mesuré dans ce dépôt et cité par `agent-pilot.ts:299-307` :
 * sans reprise de session, un tour re-paie ~79 k tokens de contexte, et il a été mesuré 1,85 M de
 * tokens de `cache_write` par heure. La reprise existe déjà (`--resume` du CLI Claude) MAIS son index
 * vit dans une `Map` MÉMOIRE (`agent-pilot.ts:255`) : à chaque redémarrage de l'app, la session est
 * oubliée et le tour suivant re-paie l'historique entier.
 *
 * Ce module rend cet index PERSISTANT. C'est le seul endroit de ce chantier où le gain de tokens est
 * mécaniquement certain : on ne change ni le prompt ni l'ordre des blocs, on cesse simplement de
 * perdre un identifiant qu'on possédait déjà.
 *
 * FAIL-OPEN assumé : perdre une session coûte un renvoi d'historique, jamais une réponse fausse. Un
 * fichier corrompu ou illisible doit donc être traité comme « aucune session connue », PAS comme une
 * erreur qui casse le tour. C'est l'inverse du choix qu'on fait sur une frontière de sécurité, et
 * c'est délibéré : ici la donnée est un cache, là c'était une autorité.
 */
describe('persistance des sessions de chat', () => {
  const racine = () => mkdtempSync(join(tmpdir(), 'aos-chatsess-'))

  it('un store vide ne rend rien et ne jette pas', () => {
    expect(loadChatSessions(racine())).toEqual({})
  })

  it('SURVIT AU REDÉMARRAGE : relu depuis un processus qui ne partage aucune mémoire', () => {
    const root = racine()
    saveChatSession('conv-1', 'claude:opus', 'sess-abc', root)
    // Aucun état en mémoire : on relit à froid, comme le ferait une app qui vient de démarrer.
    expect(loadChatSessions(root)).toEqual({
      'conv-1': { key: 'claude:opus', sessionId: 'sess-abc' }
    })
  })

  it('remplace la session d une conversation au lieu d en accumuler', () => {
    const root = racine()
    saveChatSession('conv-1', 'claude:opus', 'sess-1', root)
    saveChatSession('conv-1', 'claude:opus', 'sess-2', root)
    expect(loadChatSessions(root)['conv-1'].sessionId).toBe('sess-2')
    expect(Object.keys(loadChatSessions(root))).toEqual(['conv-1'])
  })

  it('garde les conversations indépendantes', () => {
    const root = racine()
    saveChatSession('conv-1', 'claude:opus', 'sess-1', root)
    saveChatSession('conv-2', 'codex:gpt', 'sess-2', root)
    const tout = loadChatSessions(root)
    expect(tout['conv-1'].sessionId).toBe('sess-1')
    expect(tout['conv-2'].key).toBe('codex:gpt')
  })

  it('oublier une conversation ne touche pas les autres', () => {
    const root = racine()
    saveChatSession('conv-1', 'claude:opus', 'sess-1', root)
    saveChatSession('conv-2', 'codex:gpt', 'sess-2', root)
    forgetChatSession('conv-1', root)
    expect(loadChatSessions(root)['conv-1']).toBeUndefined()
    expect(loadChatSessions(root)['conv-2'].sessionId).toBe('sess-2')
  })

  it('oublier une conversation inconnue est sans effet et ne jette pas', () => {
    const root = racine()
    saveChatSession('conv-1', 'claude:opus', 'sess-1', root)
    expect(() => forgetChatSession('inconnue', root)).not.toThrow()
    expect(loadChatSessions(root)['conv-1'].sessionId).toBe('sess-1')
  })

  it('FAIL-OPEN : un fichier corrompu vaut « aucune session », pas une exception', () => {
    const root = racine()
    saveChatSession('conv-1', 'claude:opus', 'sess-1', root)
    writeFileSync(chatSessionStorePath(root), '{ ceci n est pas du JSON', 'utf8')
    expect(loadChatSessions(root)).toEqual({})
    // Et on doit pouvoir repartir : le store se réécrit par-dessus la corruption.
    expect(() => saveChatSession('conv-2', 'codex:gpt', 'sess-2', root)).not.toThrow()
    expect(loadChatSessions(root)['conv-2'].sessionId).toBe('sess-2')
  })

  it('FAIL-OPEN : une forme JSON valide mais inattendue vaut « aucune session »', () => {
    const root = racine()
    for (const forme of ['[]', '"chaine"', '42', 'null', '{"conv-1":"pas-un-objet"}']) {
      writeFileSync(chatSessionStorePath(root), forme, 'utf8')
      expect(loadChatSessions(root)).toEqual({})
    }
  })

  it('REFUSE d écrire une entrée incomplète — mieux vaut pas de session qu une session fausse', () => {
    const root = racine()
    expect(() => saveChatSession('', 'claude:opus', 'sess', root)).toThrow(/conversation/i)
    expect(() => saveChatSession('conv-1', '', 'sess', root)).toThrow(/binding|key/i)
    expect(() => saveChatSession('conv-1', 'claude:opus', '', root)).toThrow(/session/i)
    expect(loadChatSessions(root)).toEqual({})
  })

  it('écrit de façon ATOMIQUE : aucun fichier temporaire ne subsiste', () => {
    const root = racine()
    saveChatSession('conv-1', 'claude:opus', 'sess-1', root)
    const brut = readFileSync(chatSessionStorePath(root), 'utf8')
    expect(() => JSON.parse(brut)).not.toThrow()
    expect(brut).toContain('sess-1')
  })
})
