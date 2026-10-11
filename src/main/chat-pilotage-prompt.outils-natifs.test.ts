import { describe, expect, it } from 'vitest'
import { buildChatPilotagePrompt } from './chat-pilotage-prompt'
import { CATALOG } from './commands'

/**
 * LE MODELE SAIT QUE LES DEUX FACONS D'APPELER UNE COMMANDE MARCHENT.
 *
 * Le chat sert desormais les commandes aussi comme outils directs (`mcp__autowin__…`, voir
 * `chat-mcp.ts`). Cote noeuds de workflow, `skill-node-tools.ts` a deja vecu l'ecart : quand un
 * seul des deux chemins etait annonce, le modele prenait l'autre une fois sur deux. Le paragraphe
 * est FIXE : un texte qui varierait d'un tour a l'autre casserait le cache du prefixe systeme
 * (`agent-pilot.stable-prefix.test.ts`).
 */
describe('consignes du chat — outils directs et texte <cmd>', () => {
  const prompt = buildChatPilotagePrompt(CATALOG)

  it('annonce les outils directs et garde le texte <cmd> valable', () => {
    expect(prompt).toContain('mcp__autowin__')
    expect(prompt).toMatch(/<cmd>/)
  })

  it('dit que `ask` et `orchestrate` restent en texte', () => {
    const debut = prompt.indexOf('mcp__autowin__')
    const paragraphe = prompt.slice(debut - 400, debut + 900)
    expect(paragraphe).toContain('`ask`')
    expect(paragraphe).toContain('`orchestrate`')
  })

  it('le texte est identique d un appel a l autre', () => {
    expect(buildChatPilotagePrompt(CATALOG)).toBe(prompt)
  })
})
