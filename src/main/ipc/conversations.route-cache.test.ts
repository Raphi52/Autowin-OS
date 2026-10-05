import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * LA PART DE CACHE DU TRI N'ETAIT PAS MESURABLE. L'audit conclut « cacheRead = 0 » sur les 1 894
 * classements, mais le journal `conversation-route` ne recopiait que input/output/cout : les deux
 * champs de cache portes par `decision.usage` n'etaient JAMAIS ecrits. Un zero par absence
 * d'ecriture ne prouve rien sur le cache — il rend seulement la question invisible.
 */
const source = readFileSync(join(__dirname, 'conversations.ts'), 'utf8')
const bloc = source.slice(
  source.indexOf("kind: 'conversation-route'"),
  source.indexOf("kind: 'conversation-route'") + 900
)

/**
 * FAUX « Reponse interrompue avant la fin » pendant le tri (conv-98, 2026-10-05) : l'ecran est
 * « en cours » des l'envoi, mais le principal ne repondait « oui » a la sonde qu'a l'arrivee de
 * `pilotChat`, APRES ce tri qui interroge un modele (mediane 6 s). Le tri doit compter.
 */
describe('le tri compte comme une reponse en cours', () => {
  it('enveloppe l’appel au routeur dans trackPreparation', () => {
    const handler = source.slice(source.indexOf("'os:conversations:routeMessage'"))
    const avantRoute = handler.slice(0, handler.indexOf('conversationRouteCoordinator.route('))
    expect(avantRoute).toContain('activeChatTurns.trackPreparation(conversationId')
  })
})

describe('journal du tri de conversation', () => {
  it('ecrit la part de cache lue ET ecrite de l’appel de classement', () => {
    expect(bloc).toContain('cacheReadTokens: decision.usage?.cacheReadTokens')
    expect(bloc).toContain('cacheCreationTokens: decision.usage?.cacheCreationTokens')
  })
})
