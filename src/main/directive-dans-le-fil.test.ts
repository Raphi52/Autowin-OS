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
  // DÉFAUT VÉCU (2026-09-24) : une image envoyée pendant un tour s'affichait « 📎 image.png » au lieu
  // de sa miniature — seule la liste des noms était écrite dans le texte du message.
  it('garde la vignette de l’image en pièce jointe, pas un libellé « 📎 nom » dans le texte', () => {
    const store = new ConversationStore(() => 1)
    const conv = store.create({ title: 'A', provider: 'claude' })
    store.beginTurn(conv.id, { content: 'fais des drafts' }, { turnId: 't1' })
    const thumbnail = 'data:image/jpeg;base64,bWluaQ=='
    const messageId = enregistrerDirectiveDansLeFil({
      conversations: store,
      conversationId: conv.id,
      texte: 'il manque des éléments',
      attachments: [{ name: 'image.png', mimeType: 'image/png', size: 42, thumbnail }],
      broadcast: vi.fn()
    })
    const message = store.get(conv.id)!.messages.find((m) => m.messageId === messageId)!
    expect(message.content).toBe('il manque des éléments')
    expect(message.attachments).toEqual([
      { name: 'image.png', mimeType: 'image/png', size: 42, thumbnail }
    ])
  })

  /**
   * MESURE DU 2026-09-11 (conv-439) : « le message vient de s'afficher APRÈS ton bloc fait, comme un
   * cheveu sur la soupe ». Le brouillon assistant est VIDE à l'injection : son texte n'arrive qu'à
   * la clôture. Poser la consigne après lui la met donc sous la réponse qui la traite — l'utilisateur
   * croit qu'elle a été ignorée. Elle se pose AVANT le brouillon encore en cours.
   *
   * Le défaut inverse (2026-09-03, « ça l'écrit au-dessus ») concernait l'affichage PENDANT le tour
   * et il est traité côté écran par le reçu qui scinde la réponse en vol : cette position persistée
   * n'a plus à le compenser.
   */
  it('se place AVANT la réponse en cours — pas sous le bloc qui la traite', () => {
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
    expect(messages.map((message) => message.content)).toEqual([
      'commite le chantier',
      'ensuite push sur azure sur main',
      ''
    ])
    const rangConsigne = messages.findIndex((message) => message.messageId === messageId)
    const rangReponse = messages.findIndex(
      (message) => message.role === 'assistant' && message.turnId === 't1'
    )
    expect(rangConsigne).toBeGreaterThanOrEqual(0)
    expect(rangConsigne).toBeLessThan(rangReponse)
  })

  /**
   * MESURE DU 2026-09-15 (conv-544) : « enleve le widget reprendre meme en fait » a ete injecte
   * alors que la reponse en cours AVAIT DEJA ecrit plusieurs lignes que l'utilisateur venait de
   * lire. Remonte au-dessus de ce texte, son message se relisait AVANT ce qu'il venait de voir :
   * « il aurait du apparaitre tout en bas du fil ».
   *
   * ENTREE QUI DOIT FAIRE ECHOUER CE TEST SI LA CORRECTION EST FAUSSE : un tour dont le brouillon
   * porte deja du texte. Si la consigne repasse devant, elle se lit avant la reponse deja vue.
   */
  it('reste EN FIN de fil quand la reponse en cours a deja ecrit', () => {
    let horloge = 1
    const store = new ConversationStore(() => horloge++)
    const conv = store.create({ title: 'A', provider: 'claude' })
    store.beginTurn(conv.id, { content: 'enleve le bouton reprendre' }, { turnId: 't1' })
    store.applyTurnEvent(conv.id, 't1', {
      kind: 'delta',
      streamId: 's1',
      text: 'Bouton retire, je verifie la capture.'
    })

    const messageId = enregistrerDirectiveDansLeFil({
      conversations: store,
      conversationId: conv.id,
      texte: 'enleve le widget reprendre meme en fait',
      broadcast: vi.fn()
    })

    const messages = store.get(conv.id)!.messages
    const rangConsigne = messages.findIndex((message) => message.messageId === messageId)
    const rangReponse = messages.findIndex(
      (message) => message.role === 'assistant' && message.turnId === 't1'
    )
    expect(rangConsigne).toBe(messages.length - 1)
    expect(rangConsigne).toBeGreaterThan(rangReponse)
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
