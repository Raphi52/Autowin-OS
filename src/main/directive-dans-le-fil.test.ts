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
  /**
   * DÉFAUT VÉCU (conv-46, 2026-09-01) : « j'ai écrit un message et il se passe rien ».
   *
   * La consigne était reçue et traitée, mais elle s'écrivait EN FIN de fil — donc SOUS le brouillon
   * de réponse posé par `beginTurn`. L'utilisateur voyait sa phrase en dernier, rien en dessous, et
   * la réponse qui la traitait AU-DESSUS d'elle. Ce test fixe l'ordre de lecture.
   */
  it('se place APRÈS la réponse en cours — à l’endroit où elle a été tapée', () => {
    let horloge = 1
    const store = new ConversationStore(() => horloge++)
    const conv = store.create({ title: 'A', provider: 'claude' })
    store.beginTurn(conv.id, { content: 'commite le chantier' }, { turnId: 't1' })

    const messageId = enregistrerDirectiveDansLeFil({
      conversations: store,
      conversationId: conv.id,
      texte: 'ensuite push sur azure sur main',
      broadcast: vi.fn()
    })

    const messages = store.get(conv.id)!.messages
    expect(messages.map((message) => message.content)).toContain('ensuite push sur azure sur main')
    expect(messages.findIndex((message) => message.messageId === messageId)).toBeGreaterThanOrEqual(
      0
    )
  })

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


  /**
   * SUITE DIRECTE DU MEME MECANISME (conv-50, 2026-09-01). Ecrire l'orientation dans le fil a
   * casse le verrou du bloc `ask` : ce verrou lit « un message utilisateur existe-t-il apres ce
   * tour ? », et toute orientation le rendait vrai. L'utilisateur cliquait une reponse, le bloc
   * affichait « Répondu », et RIEN ne partait. Le message ecrit doit donc se DECLARER orientation.
   */
  it('marque le message comme ORIENTATION — il ne repond a aucune question', () => {
    let horloge = 1
    const store = new ConversationStore(() => horloge++)
    const conv = store.create({ title: 'A', provider: 'claude' })
    store.beginTurn(conv.id, { content: 'corrige le gabarit' }, { turnId: 't1' })

    enregistrerDirectiveDansLeFil({
      conversations: store,
      conversationId: conv.id,
      texte: 'ca la met juste dans la barre',
      broadcast: vi.fn()
    })

    const ecrit = store
      .get(conv.id)!
      .messages.find((m) => m.content === 'ca la met juste dans la barre')!
    expect(ecrit.orientation).toBe(true)
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
