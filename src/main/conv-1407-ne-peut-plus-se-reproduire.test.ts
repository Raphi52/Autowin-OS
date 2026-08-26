import { describe, expect, it } from 'vitest'
import { AppCommandBus } from './commands'
import { ConversationStore } from './store/conversations'
import { buildTurnMessages } from './chat-turn-messages'

/**
 * LE SCENARIO DE conv-1407, REJOUE DE BOUT EN BOUT.
 *
 * Le 2026-08-26, l'utilisateur ecrit dans conv-1405 : « tu peux m'expliquer le code couleur de la
 * pastille a cote des conversations ». Puis, dans conv-1407 : « remake les pastilles de couleurs ».
 * Quatre mots, dont le sens vit dans une AUTRE conversation.
 *
 * L'orchestrateur n'avait alors aucun chemin vers ce sens : son prompt lui AFFIRMAIT connaitre
 * l'historique en lui interdisant de le redemander, et la seule recherche par contenu de son
 * catalogue portait sur les fichiers du depot. Il a cherche son propre besoin dans le CODE SOURCE
 * -- 20 inspections, zero conversation lue, run arrete a 0,96 $.
 *
 * Ce test ne verifie pas une fonction : il verifie que le CHEMIN existe, de la demande opaque
 * jusqu'au sens retrouve. Chaque maillon casse ici a coute un vrai run.
 *
 * CE QU'IL NE PROUVE PAS, et qu'aucun test de ce depot ne peut prouver : que le modele CHOISIRA
 * d'appeler ces outils. Il prouve qu'ils sont la, atteignables, et qu'ils repondent. Le choix se
 * verifie en lancant l'app, pas ici.
 */

function corpusDeConv1407(): { conversations: ConversationStore; bus: AppCommandBus } {
  let horloge = 1000
  const conversations = new ConversationStore(() => horloge++)
  const explication = conversations.create({ title: 'Code couleur', provider: 'claude' })
  conversations.append(explication.id, {
    role: 'user',
    content: "tu peux m'expliquer le code couleur de la pastille a cote des conversations"
  })
  conversations.append(explication.id, {
    role: 'assistant',
    content: 'ambre = en cours, cyan = a jour, gris = jamais ouverte'
  })
  const remake = conversations.create({ title: 'Remake', provider: 'claude' })
  conversations.append(remake.id, { role: 'user', content: 'remake les pastilles de couleurs' })
  return {
    conversations,
    bus: new AppCommandBus({ conversations } as never, () => undefined)
  }
}

describe('conv-1407 : une demande de quatre mots retrouve son sens', () => {
  it('le prompt du tour ne lui INTERDIT plus de retrouver ce qu il ignore', () => {
    const message = buildTurnMessages({
      snapshot: {},
      brainContext: '',
      memoryEcho: '',
      history: [],
      resumeSessionId: 'session-x',
      lastUserMessage: 'remake les pastilles de couleurs'
    }).join('\n')
    expect(message).not.toContain('ne le redemande pas')
    expect(message).toContain('conversation_search')
  })

  it('« pastilles » retrouve la conversation ou le sens a ete donne', async () => {
    const { bus } = corpusDeConv1407()

    const trouve = await bus.exec('conversation_search', { terme: 'pastille' })

    const data = trouve.data as { conversations: { id: string; title: string }[] }
    expect(data.conversations.map((c) => c.title)).toContain('Code couleur')
  })

  it('et ces conversations s ouvrent vraiment, la reponse est dedans', async () => {
    const { bus } = corpusDeConv1407()

    // La recherche rend DEUX conversations : les deux parlent de pastilles. C'est correct, et c'est
    // le geste reel de l'agent -- il ouvre ce qu'il a trouve, il ne parie pas sur la plus recente
    // (qui est justement celle dont il ignore le sens).
    const trouve = await bus.exec('conversation_search', { terme: 'pastille' })
    const ids = (trouve.data as { conversations: { id: string }[] }).conversations.map((c) => c.id)
    expect(ids.length).toBe(2)

    const textes: string[] = []
    for (const id of ids) {
      const lu = await bus.exec('conversation_read', { id })
      textes.push(...(lu.data as { messages: { text: string }[] }).messages.map((m) => m.text))
    }

    expect(textes.some((texte) => texte.includes('ambre'))).toBe(true)
  })

  it('la connaissance injectee ne remplit plus sa place de bruit', async () => {
    const { graphifyEvidence } = await import('./amitel-context')
    const graphe = JSON.stringify({
      nodes: [{ id: 'n1', label: '.all()', source_file: 'src/main/roles.ts' }]
    })
    expect(graphifyEvidence(graphe, 'remake les pastilles de couleurs')).toBe('')
  })
})
