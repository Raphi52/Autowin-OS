import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { enregistrerDirectiveDansLeFil } from './directive-dans-le-fil'
import { ConversationStore } from './store/conversations'

/**
 * DÉFAUT VÉCU (conv-38, 2026-09-01) : « j'ai répondu à un ask, ça a écrit le message, puis ça a
 * rechargé et le message a disparu — j'ai dû recliquer ».
 *
 * Cause : répondre pendant qu'un tour tourne passe par l'INJECTION (`os:pilotChat:inject`). Ce
 * chemin empile la directive pour la boucle pilote et n'écrit RIEN dans la conversation : le seul
 * témoin était un reçu vivant dans la mémoire de l'écran. Un rechargement l'efface.
 *
 * ENTRÉE QUI DOIT FAIRE ÉCHOUER CES TESTS SI LA CORRECTION EST FAUSSE : une directive acceptée
 * pendant un tour en cours. Si elle n'est pas écrite dans la conversation, le fil relu ne la
 * contient pas — exactement ce que l'utilisateur a vécu.
 */
describe('une réponse injectée pendant un tour devient un VRAI message du fil', () => {
  it('écrit un message utilisateur PERSISTÉ et prévient l’écran', () => {
    let horloge = 1
    const store = new ConversationStore(() => horloge++)
    const conv = store.create({ title: 'A', provider: 'claude' })
    store.beginTurn(conv.id, { content: 'corrige le gabarit' }, { turnId: 't1' })
    const broadcast = vi.fn()

    const messageId = enregistrerDirectiveDansLeFil({
      conversations: store,
      conversationId: conv.id,
      texte: 'Oui, corrige',
      broadcast
    })

    const relu = store.get(conv.id)!.messages
    const ecrit = relu.filter((m) => m.role === 'user' && m.content === 'Oui, corrige')
    expect(ecrit).toHaveLength(1)
    expect(messageId).toBe(ecrit[0].messageId)
    // L'écran doit relire la conversation active, sinon le message n'apparaît qu'au rechargement.
    expect(broadcast).toHaveBeenCalledWith({ type: 'refresh', scope: 'chat', convId: conv.id })
  })

  it('une conversation inconnue ne fait PAS échouer l’injection (la trace ne casse pas l’envoi)', () => {
    const store = new ConversationStore(() => 1)
    const broadcast = vi.fn()
    expect(() =>
      enregistrerDirectiveDansLeFil({
        conversations: store,
        conversationId: 'conv-absente',
        texte: 'Oui',
        broadcast
      })
    ).not.toThrow()
    expect(broadcast).not.toHaveBeenCalled()
  })

  it('le canal d’injection APPELLE cette écriture, après avoir accepté la directive', () => {
    const source = readFileSync(join(__dirname, 'index.ts'), 'utf8')
    const debut = source.indexOf("'os:pilotChat:inject'")
    const handler = source.slice(debut, source.indexOf('ipcMain.handle', debut + 10))
    const accepte = handler.indexOf('pendingDirectives.set(conversationId, queued)')
    const ecriture = handler.indexOf('enregistrerDirectiveDansLeFil(')
    expect(accepte).toBeGreaterThanOrEqual(0)
    expect(ecriture).toBeGreaterThan(accepte)
    // Le renderer doit pouvoir savoir que le message existe : sans cet identifiant, il continue
    // d'afficher son reçu et l'utilisateur voit DEUX fois le même texte.
    expect(handler).toContain('return { ok: true, messageId }')
  })
})
